/**
 * Locator Spy — v2 Engine (breadth-first candidate generation)
 * ============================================================
 *
 * Goal: hand the user *every* locator a real automation suite might use for
 * the selected element — not a single "best" string per syntax. For each
 * identity source on the element (test id, id, name, role + accessible name,
 * visible text, associated label, placeholder, class, position under a stable
 * ancestor) we emit the CSS, XPath, Selenium `By.*` and Playwright `getBy*`
 * spellings of that source, then verify every one against the live DOM.
 *
 * Absolute XPath (`/html/body/div[2]/button[1]`) is deliberately NOT
 * generated. It breaks on any markup change and no maintained suite uses it.
 *
 * Pipeline
 *   1. escalate()   — a click on an <svg>/<path> retargets the closest
 *                     interactive ancestor, which is what a test would act on.
 *   2. generators   — every identity source contributes candidates.
 *   3. probe()      — each candidate runs against the document and is kept
 *                     only if it actually resolves to the target. `matches`
 *                     records how many nodes it hits, so non-unique locators
 *                     are surfaced with a count instead of being dropped.
 *   4. finalize()   — unique first, then by stability score.
 *
 * Output
 *   result.locators → [{ type, via, value, strategy, source, category, score,
 *                        matches, position, unique, verifyKind, verifyExpr }]
 *   ...plus the flat v1-compatible fields (cssSelector, relativeXPath,
 *   xpathById, …) derived from that array so older UI paths keep working.
 *
 * Toggle the engine at runtime:
 *   window.LocatorSpyConfig = { engine: 'v1' }   // force v1
 *   window.LocatorSpyConfig = { engine: 'v2' }   // force v2 (default)
 *   localStorage.setItem('LocatorSpyConfig', JSON.stringify({ engine: 'v1' }))
 */
(function () {
  "use strict";

  // -------------------- DEFAULT CONFIG --------------------
  const DEFAULT_CONFIG = {
    engine: "v2",
    customTestAttributes: [
      "data-testid",
      "data-test-id",
      "data-test",
      "data-qa",
      "data-qa-id",
      "data-cy",
      "data-automation",
      "data-automation-id",
      "data-test-locator",
      "data-e2e",
    ],
    ignoreIdPatterns: [
      /:[a-z0-9]+:/i,
      /^(headlessui-|radix-|reach-|mui-|chakra-|emotion-|fluent-)/i,
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
      /^[a-f0-9]{16,}$/i,
      /^\d+$/,
    ],
    ignoreClassPatterns: [
      /^$/, /^ng-/, /^css-/, /^chakra-/, /^Mui/, /^ant-/, /^sc-/,
      /^[\d\-_]+$/, /:/,
    ],
    // How far up the tree we look for a stable ancestor to anchor against.
    maxAncestorDepth: 6,
    // How many of those ancestors actually get locators generated for them.
    maxAnchors: 3,
    // Visible text longer than this is treated as "not a label" and skipped.
    maxTextLength: 80,
    // Attribute values longer than this make unwieldy locators.
    maxValueLength: 120,
    // Hard caps. Generation runs on hover, so it must stay cheap.
    maxLocators: 90,
    maxProbes: 600,
    // Keep locators that match more than one node, flagged with their count.
    // These are what users reach for when they add their own index/scoping.
    includeNonUnique: true,
    // …but a selector hitting this many nodes (`.flex`, `//div`) is noise, not
    // a locator. Those are dropped; their indexed variants are still offered.
    maxMatches: 20,
    // Playwright getBy* / text= / role= spellings.
    frameworkLocators: true,
  };

  // Stability scores. Higher = more resistant to layout, copy and refactor
  // changes. Drives the ordering of the generated list.
  const SCORES = {
    "data-testid": 100, "data-test-id": 100, "data-test": 96, "data-qa": 96,
    "data-qa-id": 96, "data-cy": 96, "data-automation": 95,
    "data-automation-id": 95, "data-test-locator": 95, "data-e2e": 95,
    id: 90, name: 85, "aria-label": 85, "aria-labelledby": 78,
    role_name: 82, label: 80, text: 70, href: 65, placeholder: 62,
    "aria-describedby": 58, title: 56, alt: 56, for: 55, role: 50,
    data: 62, aria: 55, attr: 35,
    src: 42, value: 38, type: 32, class: 30, structure: 25, tag: 10, nth: 8,
  };

  // Tie-break between equally-scored spellings of the same identity.
  const STRATEGY_RANK = {
    css: 0,
    id: 1, name: 1, "class name": 1, "tag name": 1,
    "link text": 1, "partial link text": 1,
    xpath: 2,
    playwright: 3,
  };

  // Display order for the identity-source buckets. Also a tie-breaker when
  // two locators score the same.
  const CATEGORY_ORDER = [
    "Test ID", "ID", "Name", "Role & ARIA", "Text", "Link Text",
    "Form", "Attributes", "Class", "Structure", "Tag",
  ];

  // Attributes that get the full spelling family generated for them, outside
  // the ones with dedicated generators (test ids, id, name, class).
  const ATTR_FAMILY = [
    { attr: "aria-label", category: "Role & ARIA", pw: (v) => `page.getByLabel(${pwStr(v)})` },
    { attr: "placeholder", category: "Form", pw: (v) => `page.getByPlaceholder(${pwStr(v)})` },
    { attr: "alt", category: "Attributes", pw: (v) => `page.getByAltText(${pwStr(v)})` },
    { attr: "title", category: "Attributes", pw: (v) => `page.getByTitle(${pwStr(v)})` },
    { attr: "role", category: "Role & ARIA" },
    { attr: "type", category: "Form" },
    { attr: "value", category: "Form" },
    { attr: "for", category: "Form" },
    { attr: "href", category: "Attributes" },
    { attr: "src", category: "Attributes" },
    { attr: "aria-labelledby", category: "Role & ARIA" },
    { attr: "aria-describedby", category: "Role & ARIA" },
  ];

  // Attributes paired up into multi-attribute locators when no single one is
  // unique — `input[name='email'][type='email']` and its XPath twin.
  const COMBO_ATTRS = [
    "name", "type", "role", "placeholder", "aria-label", "title", "alt",
    "value", "href", "for",
  ];

  // Anything else on the element is fair game for a locator too — state
  // attributes like `aria-current="page"` and app attributes like
  // `data-row-id="order-1150"` are often the most stable thing there is.
  // Skipped here: attributes a dedicated generator already covers, and ones
  // that never identify anything.
  const SKIP_GENERIC_ATTRS = new Set([
    "id", "class", "style", "name", "aria-label", "aria-labelledby",
    "aria-describedby", "placeholder", "alt", "title", "role", "type", "value",
    "for", "href", "src", "srcset", "sizes", "loading", "integrity", "nonce",
    "referrerpolicy", "crossorigin", "autocomplete", "spellcheck", "translate",
    "draggable", "slot", "part", "is", "xmlns", "xmlns:xlink", "viewbox",
  ]);

  // data-* attributes a framework wrote, not the app. No use as locators.
  const FRAMEWORK_DATA_ATTR =
    /^data-(reactid|react-|reactroot|v-|emotion|styled|svelte|ng-|turbo|astro|next-|nuxt|hk)/i;

  // -------------------- STRING HELPERS --------------------
  const NON_SEMANTIC_TAGS = new Set([
    "svg", "path", "g", "use", "circle", "rect", "polygon", "polyline",
    "line", "ellipse", "defs", "symbol", "title", "desc",
  ]);

  function escalate(el) {
    if (!NON_SEMANTIC_TAGS.has(el.tagName.toLowerCase())) {
      return { el, escalatedFrom: null };
    }
    const interactive = el.closest(
      'button, a, [role="button"], [role="link"], [onclick], input, select, textarea, label, summary'
    );
    if (interactive && interactive !== el) {
      return { el: interactive, escalatedFrom: el.tagName.toLowerCase() };
    }
    return { el, escalatedFrom: null };
  }

  function norm(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  function truncate(s, n) {
    const v = String(s);
    return v.length > n ? v.slice(0, n) + "…" : v;
  }

  // XPath string literal. Values containing both quote flavours need concat().
  function escapeXp(s) {
    const v = String(s);
    if (!v.includes("'")) return `'${v}'`;
    if (!v.includes('"')) return `"${v}"`;
    return `concat('${v.replace(/'/g, "',\"'\",'")}')`;
  }

  // A quoted CSS attribute *value* — only backslash and the quote itself need
  // escaping inside a string. CSS.escape() is for identifiers and would turn
  // every space into `\ `, which is valid but unreadable.
  function cssStr(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function cssId(v) {
    return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v;
  }

  function cssAttr(name, value) {
    return `[${name}="${cssStr(value)}"]`;
  }

  // Single-quoted JS string for Playwright expressions.
  function pwStr(s) {
    return `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }

  function isStableId(id, cfg) {
    if (!id || typeof id !== "string") return false;
    return !cfg.ignoreIdPatterns.some((re) => re.test(id));
  }

  function isStableClass(cls, cfg) {
    return !cfg.ignoreClassPatterns.some((re) => re.test(cls));
  }

  // Values we refuse to build exact-match locators from: empty, absurdly long,
  // or containing newlines (legal in XPath, a syntax error in CSS strings).
  function usableValue(v, cfg) {
    if (v == null) return null;
    const s = String(v);
    if (/[\n\r\t]/.test(s)) return null;
    const t = s.trim();
    if (!t || t.length > cfg.maxValueLength) return null;
    return t;
  }

  // The leading, human-authored part of a generated id: "user-form-8817" →
  // "user-form". Dynamic ids are the single most common reason a recorded
  // locator rots, so we offer prefix/contains forms instead of the exact one.
  function idStem(id) {
    const m = String(id).match(/^[A-Za-z][A-Za-z\-_]{2,}/);
    if (!m) return null;
    const stem = m[0].replace(/[-_]+$/, "");
    return stem.length >= 3 && stem !== String(id) ? stem : null;
  }

  // Text-derived locators get less trustworthy the longer the string: more
  // copy that can change, and a whole table row of concatenated cell text is
  // not an identity at all. Short labels ("Sign in", "Edit") keep full score.
  function textScore(base, text) {
    const len = String(text || "").length;
    return len <= 20 ? base : Math.max(12, base - Math.round((len - 20) * 0.8));
  }

  function directText(el) {
    let out = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) out += node.nodeValue + " ";
    }
    return norm(out);
  }

  // ARIA role mapping for common HTML elements. Small on purpose — it covers
  // the cases that matter for locators, not the full ARIA spec.
  function implicitRole(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : null;
    if (tag === "img") return el.getAttribute("alt") != null ? "img" : null;
    if (tag === "input") {
      const t = (el.type || "text").toLowerCase();
      return ({
        button: "button", checkbox: "checkbox", radio: "radio",
        search: "searchbox", email: "textbox", tel: "textbox",
        text: "textbox", url: "textbox", password: "textbox",
        number: "spinbutton", range: "slider",
        submit: "button", reset: "button", file: "button",
      })[t] || "textbox";
    }
    return ({
      button: "button", textarea: "textbox", select: "combobox",
      nav: "navigation", main: "main", header: "banner", footer: "contentinfo",
      aside: "complementary", section: "region",
      h1: "heading", h2: "heading", h3: "heading",
      h4: "heading", h5: "heading", h6: "heading",
      ul: "list", ol: "list", li: "listitem",
      table: "table", tr: "row", td: "cell", th: "columnheader",
      form: "form", dialog: "dialog",
    })[tag] || null;
  }

  // The <label> tied to a form control, either by `for=` or by wrapping.
  function labelInfo(el) {
    const tag = el.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") return null;
    if (el.id) {
      try {
        const lbl = document.querySelector(`label[for="${cssId(el.id)}"]`);
        const text = lbl && norm(lbl.textContent);
        if (text) return { text, kind: "for" };
      } catch {}
    }
    const wrap = el.closest("label");
    const wrapText = wrap && norm(wrap.textContent);
    if (wrapText) return { text: wrapText, kind: "wrap" };
    return null;
  }

  function accessibleName(el, cfg) {
    const aria = norm(el.getAttribute("aria-label"));
    if (aria) return aria;

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      // ARIA allows a space-separated IDREF list — concat each referent's text.
      const text = labelledBy
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => {
          const ref = document.getElementById(id);
          return ref ? norm(ref.textContent) : "";
        })
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }

    const label = labelInfo(el);
    if (label) return label.text;

    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return norm(el.getAttribute("placeholder")) || "";
    }
    if (tag === "img") return norm(el.getAttribute("alt"));

    const text = norm(el.textContent);
    return text && text.length <= cfg.maxTextLength ? text : "";
  }

  // -------------------- THE CANDIDATE SET --------------------
  // Every candidate is probed against the document before it is kept. A
  // candidate survives only if the probe actually contains the target element;
  // `matches` then tells the UI whether it is unique or needs scoping.
  function createLocatorSet(target, cfg) {
    const items = [];
    const seen = new Set();
    let probes = 0;

    function probe(kind, expr) {
      if (!expr || probes >= cfg.maxProbes) return null;
      probes++;
      let nodes;
      if (kind === "xpath") {
        try {
          const r = document.evaluate(
            expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
          );
          nodes = [];
          for (let i = 0; i < r.snapshotLength; i++) nodes.push(r.snapshotItem(i));
        } catch {
          return null;
        }
      } else {
        try {
          nodes = Array.from(document.querySelectorAll(expr));
        } catch {
          return null;
        }
      }
      const idx = nodes.indexOf(target);
      if (idx === -1) return null;
      return { matches: nodes.length, position: idx + 1 };
    }

    // Pick the first verification expression that resolves to the target.
    // Used by framework locators (getByRole etc.) which have no direct DOM
    // query but still need a highlightable equivalent.
    function firstWorking(candidates) {
      for (const c of candidates) {
        if (!c || !c.expr) continue;
        if (probe(c.kind, c.expr)) return c;
      }
      return null;
    }

    function add(spec) {
      if (!spec || !spec.value) return null;
      const value = String(spec.value);
      const strategy = spec.strategy || "css";
      const key = strategy + " " + value;
      if (seen.has(key)) return null;

      const verify =
        spec.verify || { kind: strategy === "xpath" ? "xpath" : "css", expr: value };
      const hit = probe(verify.kind, verify.expr);
      if (!hit) return null;
      if (hit.matches > 1 && !cfg.includeNonUnique) return null;
      if (hit.matches > cfg.maxMatches && !spec.keepBroad) return null;

      seen.add(key);
      const rec = {
        type: spec.type || "CSS",
        via: spec.via || null,
        value,
        strategy,
        source: spec.source || "attr",
        category: spec.category || "Attributes",
        score: spec.score == null ? 40 : spec.score,
        matches: hit.matches,
        position: hit.position,
        unique: hit.matches === 1,
        verifyKind: verify.kind,
        verifyExpr: verify.expr,
        // `true` when `matches` is an approximation because the locator's own
        // semantics (accessible-name matching) can't be queried from the DOM.
        approx: !!spec.approx,
      };
      items.push(rec);
      return rec;
    }

    function finalize() {
      const rank = (c) => {
        const i = CATEGORY_ORDER.indexOf(c);
        return i === -1 ? CATEGORY_ORDER.length : i;
      };
      items.sort(
        (a, b) =>
          Number(b.unique) - Number(a.unique) ||
          b.score - a.score ||
          // Two spellings of the same fact: lead with the portable one. CSS
          // works everywhere, then the Selenium By.* value, then XPath, and
          // last the Playwright-only accessors.
          STRATEGY_RANK[a.strategy] - STRATEGY_RANK[b.strategy] ||
          rank(a.category) - rank(b.category) ||
          a.value.length - b.value.length
      );
      return items.slice(0, cfg.maxLocators);
    }

    return {
      items,
      probe,
      firstWorking,
      add,
      finalize,
      probeCount: () => probes,
      css: (o) => add(Object.assign({ type: "CSS", strategy: "css" }, o)),
      xp: (o) => add(Object.assign({ type: "XPath", strategy: "xpath" }, o)),
      pw: (o) => add(Object.assign({ type: "Playwright", strategy: "playwright" }, o)),
    };
  }

  // -------------------- ANCHORS --------------------
  // The single strongest identifying expression for an arbitrary node. Used
  // for ancestors (to scope a locator) and for siblings (to hop across with an
  // axis). Returns null when nothing about the node stands out.
  function anchorFor(node, cfg) {
    if (!node || node.nodeType !== 1) return null;
    const tag = node.tagName.toLowerCase();
    const attrs = cfg.customTestAttributes.concat([
      "id", "name", "aria-label", "role", "title", "placeholder", "for", "alt",
    ]);

    for (const a of attrs) {
      const v = usableValue(node.getAttribute(a), cfg);
      if (!v) continue;
      if (a === "id" && !isStableId(v, cfg)) continue;
      return {
        tag,
        score: SCORES[a] || 50,
        css: a === "id" ? `#${cssId(v)}` : `${tag}${cssAttr(a, v)}`,
        xp: `//${tag}[@${a}=${escapeXp(v)}]`,
        label: a === "id" ? `#${truncate(v, 22)}` : `[${a}="${truncate(v, 18)}"]`,
      };
    }

    // An app-authored data-* attribute — `data-row-id`, `data-section` — is a
    // stronger anchor than any class.
    for (const attr of Array.from(node.attributes || [])) {
      const name = attr.name.toLowerCase();
      if (!name.startsWith("data-") || FRAMEWORK_DATA_ATTR.test(name)) continue;
      const v = usableValue(attr.value, cfg);
      if (!v) continue;
      return {
        tag,
        score: SCORES.data,
        css: `${tag}${cssAttr(name, v)}`,
        xp: `//${tag}[@${name}=${escapeXp(v)}]`,
        label: `[${name}="${truncate(v, 14)}"]`,
      };
    }

    // A class that is unique on its own is just as good an anchor as an id.
    for (const c of Array.from(node.classList || [])) {
      if (!isStableClass(c, cfg)) continue;
      const sel = `${tag}.${cssId(c)}`;
      try {
        if (document.querySelectorAll(sel).length === 1) {
          return {
            tag,
            score: SCORES.class + 20,
            css: sel,
            xp: `//${tag}[contains(@class, ${escapeXp(c)})]`,
            label: `.${truncate(c, 20)}`,
          };
        }
      } catch {}
    }

    // Short visible text — the way you'd anchor a <label> or a heading. Use
    // the full text so it matches what XPath's normalize-space() will see.
    const text = norm(node.textContent);
    if (text && text.length <= 40) {
      return {
        tag,
        score: SCORES.text,
        css: null,
        xp: `//${tag}[normalize-space()=${escapeXp(text)}]`,
        label: `"${truncate(text, 18)}"`,
      };
    }
    return null;
  }

  function ancestorAnchors(el, cfg) {
    const out = [];
    let cur = el.parentElement;
    let depth = 0;
    while (cur && cur !== document.documentElement && depth < cfg.maxAncestorDepth) {
      const a = anchorFor(cur, cfg);
      if (a && a.css) {
        out.push(Object.assign({}, a, { node: cur, direct: cur === el.parentElement }));
      }
      cur = cur.parentElement;
      depth++;
    }
    return out;
  }

  // -------------------- GENERATORS --------------------

  // Emits the whole spelling family for one attribute: bare CSS, tag-qualified
  // CSS (only when the bare form is ambiguous), both XPath axes, contains()
  // forms for long values, and the Playwright accessor when one exists.
  function addAttrFamily(set, ctx, spec) {
    const { el, tag, cfg } = ctx;
    const v = usableValue(el.getAttribute(spec.attr), cfg);
    if (!v) return;

    const label = spec.label || spec.attr;
    const cat = spec.category;
    const base = spec.score == null ? SCORES[spec.attr] || 45 : spec.score;
    const source = spec.source || spec.attr;
    const sel = cssAttr(spec.attr, v);

    const bare = set.css({ via: label, value: sel, source, category: cat, score: base });
    if (!bare || !bare.unique) {
      set.css({
        via: `${tag} + ${label}`, value: `${tag}${sel}`,
        source, category: cat, score: base - 2,
      });
    }
    set.xp({
      via: label, value: `//${tag}[@${spec.attr}=${escapeXp(v)}]`,
      source, category: cat, score: base - 1,
    });
    set.xp({
      via: `any tag + ${label}`, value: `//*[@${spec.attr}=${escapeXp(v)}]`,
      source, category: cat, score: base - 8,
    });

    // Partial matching, for values carrying a build hash or a long URL.
    if (v.length >= 12) {
      const frag = v.slice(0, Math.max(8, Math.ceil(v.length / 2)));
      set.xp({
        via: `${label} contains`,
        value: `//${tag}[contains(@${spec.attr}, ${escapeXp(frag)})]`,
        source, category: cat, score: base - 14,
      });
      set.css({
        via: `${label} contains`, value: `${tag}[${spec.attr}*="${cssStr(frag)}"]`,
        source, category: cat, score: base - 15,
      });
    }
    // href is worth an "ends with" form — paths are stable, hosts are not.
    if (spec.attr === "href" && v.length > 3) {
      const path = v.replace(/^https?:\/\/[^/]+/i, "") || v;
      set.css({
        via: "href ends with", value: `${tag}[href$="${cssStr(path)}"]`,
        source, category: cat, score: base - 10,
      });
    }

    if (spec.pw && cfg.frameworkLocators) {
      set.pw({
        via: label, value: spec.pw(v), source, category: cat, score: base,
        verify: { kind: "css", expr: sel },
      });
    }
  }

  function addTestIds(set, ctx) {
    const { el, tag, cfg } = ctx;
    for (const attr of cfg.customTestAttributes) {
      const v = usableValue(el.getAttribute(attr), cfg);
      if (!v) continue;
      const score = SCORES[attr] || 92;
      const sel = cssAttr(attr, v);

      const bare = set.css({
        via: attr, value: sel, source: "test-id", category: "Test ID", score,
      });
      if (!bare || !bare.unique) {
        set.css({
          via: `${tag} + ${attr}`, value: `${tag}${sel}`,
          source: "test-id", category: "Test ID", score: score - 2,
        });
      }
      set.xp({
        via: attr, value: `//*[@${attr}=${escapeXp(v)}]`,
        source: "test-id", category: "Test ID", score: score - 1,
      });
      set.xp({
        via: `${tag} + ${attr}`, value: `//${tag}[@${attr}=${escapeXp(v)}]`,
        source: "test-id", category: "Test ID", score: score - 3,
      });
      if (cfg.frameworkLocators) {
        set.pw({
          via: attr, value: `page.getByTestId(${pwStr(v)})`,
          source: "test-id", category: "Test ID", score,
          verify: { kind: "css", expr: sel },
        });
      }
    }
  }

  function addId(set, ctx) {
    const { el, tag, cfg } = ctx;
    const id = usableValue(el.getAttribute("id"), cfg);
    if (!id) return;

    if (isStableId(id, cfg)) {
      set.add({
        type: "ID", strategy: "id", value: id, source: "id",
        category: "ID", score: SCORES.id,
        verify: { kind: "css", expr: `#${cssId(id)}` },
      });
      const bare = set.css({
        via: "id", value: `#${cssId(id)}`, source: "id",
        category: "ID", score: SCORES.id - 1,
      });
      if (!bare || !bare.unique) {
        set.css({
          via: `${tag} + id`, value: `${tag}#${cssId(id)}`,
          source: "id", category: "ID", score: SCORES.id - 3,
        });
      }
      set.xp({
        via: "id", value: `//*[@id=${escapeXp(id)}]`, source: "id",
        category: "ID", score: SCORES.id - 2,
      });
      set.xp({
        via: `${tag} + id`, value: `//${tag}[@id=${escapeXp(id)}]`,
        source: "id", category: "ID", score: SCORES.id - 4,
      });
      return;
    }

    // Framework-generated id (`:r3:`, `mui-4821`, a uuid). The exact value is
    // worthless across runs, but its human-authored prefix usually is not.
    const stem = idStem(id);
    if (!stem) return;
    set.css({
      via: "id starts with", value: `${tag}[id^="${cssStr(stem)}"]`,
      source: "id-dynamic", category: "ID", score: 58,
    });
    set.xp({
      via: "id starts with",
      value: `//${tag}[starts-with(@id, ${escapeXp(stem)})]`,
      source: "id-dynamic", category: "ID", score: 57,
    });
    set.xp({
      via: "id contains", value: `//${tag}[contains(@id, ${escapeXp(stem)})]`,
      source: "id-dynamic", category: "ID", score: 52,
    });
  }

  function addName(set, ctx) {
    const { el, tag, cfg } = ctx;
    const v = usableValue(el.getAttribute("name"), cfg);
    if (!v) return;
    set.add({
      type: "Name", strategy: "name", value: v, source: "name",
      category: "Name", score: SCORES.name,
      verify: { kind: "css", expr: cssAttr("name", v) },
    });
    addAttrFamily(set, ctx, {
      attr: "name", category: "Name", score: SCORES.name - 1, source: "name",
    });
  }

  function addRoleAndName(set, ctx) {
    const { el, tag, cfg } = ctx;
    if (!cfg.frameworkLocators) return;
    const explicitRole = usableValue(el.getAttribute("role"), cfg);
    const role = explicitRole || implicitRole(el);
    const name = ctx.accName;
    if (!role || !name || name.length > cfg.maxTextLength) return;

    // Accessible-name resolution isn't queryable, so pick the closest DOM
    // expression that still lands on the target for highlight + match count.
    const verify = set.firstWorking([
      el.id && isStableId(el.id, cfg) ? { kind: "css", expr: `#${cssId(el.id)}` } : null,
      norm(el.getAttribute("aria-label"))
        ? { kind: "css", expr: cssAttr("aria-label", norm(el.getAttribute("aria-label"))) }
        : null,
      { kind: "xpath", expr: `//${tag}[normalize-space()=${escapeXp(name)}]` },
      explicitRole ? { kind: "css", expr: `${tag}${cssAttr("role", explicitRole)}` } : null,
      { kind: "css", expr: tag },
    ]);
    if (!verify) return;

    set.pw({
      via: `role + name`,
      value: `page.getByRole(${pwStr(role)}, { name: ${pwStr(name)} })`,
      source: "role-name", category: "Role & ARIA",
      score: textScore(SCORES.role_name, name), verify, approx: true,
    });
    set.pw({
      via: "role engine",
      value: `role=${role}[name=${JSON.stringify(name)}]`,
      source: "role-name", category: "Role & ARIA",
      score: textScore(SCORES.role_name, name) - 12, verify, approx: true,
    });
    if (explicitRole) {
      set.xp({
        via: "role + text",
        value: `//*[@role=${escapeXp(explicitRole)} and normalize-space()=${escapeXp(name)}]`,
        source: "role-name", category: "Role & ARIA",
        score: textScore(SCORES.role, name) - 2,
      });
    }
  }

  function addText(set, ctx) {
    const { el, tag, cfg } = ctx;
    const full = ctx.text;
    const own = ctx.ownText;
    if (!full && !own) return;

    // <a> first: the link-text spellings are identical to the generic text
    // ones, and Selenium's By.linkText is the more idiomatic label for them.
    if (tag === "a" && full) {
      const frag = full.length > 20 ? full.slice(0, 20) : full;
      set.add({
        type: "Link Text", strategy: "link text", value: full,
        source: "link-text", category: "Link Text", score: textScore(SCORES.text, full),
        verify: { kind: "xpath", expr: `//a[normalize-space()=${escapeXp(full)}]` },
      });
      set.xp({
        via: "link text", value: `//a[normalize-space()=${escapeXp(full)}]`,
        source: "link-text", category: "Link Text", score: textScore(SCORES.text, full),
      });
      set.add({
        type: "Partial Link Text", strategy: "partial link text", value: frag,
        source: "link-text-partial", category: "Link Text", score: textScore(SCORES.text, frag) - 8,
        verify: {
          kind: "xpath",
          expr: `//a[contains(normalize-space(), ${escapeXp(frag)})]`,
        },
      });
      set.xp({
        via: "partial link text",
        value: `//a[contains(normalize-space(), ${escapeXp(frag)})]`,
        source: "link-text-partial", category: "Link Text", score: textScore(SCORES.text, frag) - 9,
      });
    }

    if (full) {
      set.xp({
        via: "text", value: `//${tag}[normalize-space()=${escapeXp(full)}]`,
        source: "text", category: "Text", score: textScore(SCORES.text, full),
      });
      set.xp({
        via: "any tag + text",
        value: `//*[normalize-space(text())=${escapeXp(full)}]`,
        source: "text", category: "Text", score: textScore(SCORES.text, full) - 12,
      });
      const frag = full.length > 24 ? full.slice(0, 24) : full;
      set.xp({
        via: "text contains",
        value: `//${tag}[contains(normalize-space(), ${escapeXp(frag)})]`,
        source: "text-partial", category: "Text", score: textScore(SCORES.text, frag) - 6,
      });
      // Case-insensitive match, for copy that changes case between locales.
      set.xp({
        via: "text (case-insensitive)",
        value:
          `//${tag}[contains(translate(normalize-space(), ` +
          `'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ` +
          `${escapeXp(frag.toLowerCase())})]`,
        source: "text-partial", category: "Text", score: textScore(SCORES.text, frag) - 16,
      });
      if (cfg.frameworkLocators) {
        const exactXp = { kind: "xpath", expr: `//${tag}[normalize-space()=${escapeXp(full)}]` };
        set.pw({
          via: "text", value: `page.getByText(${pwStr(full)}, { exact: true })`,
          source: "text", category: "Text", score: textScore(SCORES.text, full), verify: exactXp,
        });
        set.pw({
          via: "text engine", value: `text=${JSON.stringify(full)}`,
          source: "text", category: "Text", score: textScore(SCORES.text, full) - 8, verify: exactXp,
        });
        set.pw({
          via: "has-text", value: `${tag}:has-text(${JSON.stringify(frag)})`,
          source: "text-partial", category: "Text", score: textScore(SCORES.text, frag) - 4,
          verify: {
            kind: "xpath",
            expr: `//${tag}[contains(normalize-space(), ${escapeXp(frag)})]`,
          },
        });
      }
    }

    // text() addresses the element's own text nodes only — the form to use
    // when the element also contains markup you don't want to match on.
    if (own) {
      set.xp({
        via: "own text", value: `//${tag}[text()=${escapeXp(own)}]`,
        source: "text", category: "Text", score: textScore(SCORES.text, own) - 3,
      });
      const frag = own.length > 24 ? own.slice(0, 24) : own;
      set.xp({
        via: "own text contains",
        value: `//${tag}[contains(text(), ${escapeXp(frag)})]`,
        source: "text-partial", category: "Text", score: textScore(SCORES.text, frag) - 10,
      });
    }
  }

  function addLabelAssociations(set, ctx) {
    const { el, tag, cfg } = ctx;
    const label = ctx.label;
    if (!label || !label.text || label.text.length > cfg.maxTextLength) return;
    const L = label.text;
    const id = usableValue(el.getAttribute("id"), cfg);

    if (cfg.frameworkLocators) {
      const verify = set.firstWorking([
        id && isStableId(id, cfg) ? { kind: "css", expr: `#${cssId(id)}` } : null,
        { kind: "xpath", expr: `//label[normalize-space()=${escapeXp(L)}]/following::${tag}[1]` },
        { kind: "xpath", expr: `//label[normalize-space()=${escapeXp(L)}]//${tag}` },
      ]);
      if (verify) {
        set.pw({
          via: "label", value: `page.getByLabel(${pwStr(L)})`,
          source: "label", category: "Form", score: textScore(SCORES.label, L),
          verify, approx: true,
        });
      }
    }

    // The classic "find the label, then hop to its field" XPaths.
    set.xp({
      via: "label + following",
      value: `//label[normalize-space()=${escapeXp(L)}]/following::${tag}[1]`,
      source: "label", category: "Form", score: textScore(SCORES.label, L) - 6,
    });
    if (label.kind === "for") {
      set.xp({
        via: "label for",
        value: `//${tag}[@id=//label[normalize-space()=${escapeXp(L)}]/@for]`,
        source: "label", category: "Form", score: textScore(SCORES.label, L) - 4,
      });
      set.xp({
        via: "label + sibling",
        value: `//label[normalize-space()=${escapeXp(L)}]/following-sibling::${tag}[1]`,
        source: "label", category: "Form", score: textScore(SCORES.label, L) - 8,
      });
    } else {
      set.xp({
        via: "inside label",
        value: `//label[normalize-space()=${escapeXp(L)}]//${tag}`,
        source: "label", category: "Form", score: textScore(SCORES.label, L) - 4,
      });
    }
  }

  function addClasses(set, ctx) {
    const { el, tag, cfg } = ctx;
    const stable = ctx.classes;
    if (!stable.length) return;

    for (const c of stable.slice(0, 4)) {
      const bare = set.css({
        via: "class", value: `.${cssId(c)}`, source: "class",
        category: "Class", score: SCORES.class + 4,
      });
      set.css({
        via: `${tag} + class`, value: `${tag}.${cssId(c)}`, source: "class",
        category: "Class", score: SCORES.class + 2,
      });
      set.xp({
        via: "class contains",
        value: `//${tag}[contains(@class, ${escapeXp(c)})]`,
        source: "class", category: "Class", score: SCORES.class + 1,
      });
      // By.className takes exactly one class name, so only the unique ones
      // are worth offering in that spelling.
      if (bare && bare.unique) {
        set.add({
          type: "Class Name", strategy: "class name", value: c,
          source: "class", category: "Class", score: SCORES.class + 3,
          verify: { kind: "css", expr: `.${cssId(c)}` },
        });
      }
    }

    if (stable.length > 1) {
      const chain = stable.slice(0, 4).map(cssId).join(".");
      set.css({
        via: "all classes", value: `${tag}.${chain}`, source: "class",
        category: "Class", score: SCORES.class + 8,
      });
      set.css({
        via: "class chain", value: `.${chain}`, source: "class",
        category: "Class", score: SCORES.class + 6,
      });
      set.xp({
        via: "multiple classes",
        value: `//${tag}[${stable
          .slice(0, 3)
          .map((c) => `contains(@class, ${escapeXp(c)})`)
          .join(" and ")}]`,
        source: "class", category: "Class", score: SCORES.class + 7,
      });
    }

    const raw = usableValue(el.getAttribute("class"), cfg);
    if (raw) {
      set.xp({
        via: "class (exact)", value: `//${tag}[@class=${escapeXp(raw)}]`,
        source: "class", category: "Class", score: SCORES.class + 5,
      });
    }
  }

  // Every remaining attribute on the element. This is what makes
  // `[aria-current="page"]`, `[data-row-id="order-1150"]` and `button[disabled]`
  // available instead of falling back to a positional selector.
  function addOtherAttributes(set, ctx) {
    const { el, tag, cfg } = ctx;
    let emitted = 0;
    for (const attr of Array.from(el.attributes || [])) {
      if (emitted >= 8) break;
      const name = attr.name.toLowerCase();
      if (SKIP_GENERIC_ATTRS.has(name)) continue;
      if (name.startsWith("on")) continue; // inline event handlers
      if (cfg.customTestAttributes.indexOf(name) !== -1) continue; // own pass
      if (FRAMEWORK_DATA_ATTR.test(name)) continue;

      const score = name.startsWith("data-")
        ? SCORES.data
        : name.startsWith("aria-")
        ? SCORES.aria
        : SCORES.attr;

      // Boolean attributes (disabled, required, checked, open, hidden): the
      // useful locator is the presence test, not a match on an empty string.
      if (!attr.value) {
        const rec = set.css({
          via: `${name} present`, value: `${tag}[${name}]`,
          source: name, category: "Attributes", score,
        });
        set.xp({
          via: `${name} present`, value: `//${tag}[@${name}]`,
          source: name, category: "Attributes", score: score - 1,
        });
        if (rec) emitted++;
        continue;
      }

      if (!usableValue(attr.value, cfg)) continue;
      addAttrFamily(set, ctx, {
        attr: name, category: "Attributes", score, source: name,
      });
      emitted++;
    }
  }

  function addAttributeCombos(set, ctx) {
    const { el, tag, cfg } = ctx;
    const present = [];
    for (const a of COMBO_ATTRS) {
      const v = usableValue(el.getAttribute(a), cfg);
      if (v) present.push({ a, v });
    }
    if (present.length < 2 && !(present.length && (ctx.text || ctx.classes.length))) {
      return;
    }

    let emitted = 0;
    for (let i = 0; i < present.length && emitted < 6; i++) {
      for (let j = i + 1; j < present.length && emitted < 6; j++) {
        const p = present[i];
        const q = present[j];
        const rec = set.css({
          via: `${p.a} + ${q.a}`,
          value: `${tag}${cssAttr(p.a, p.v)}${cssAttr(q.a, q.v)}`,
          source: "attr-combo", category: "Attributes", score: 58,
        });
        set.xp({
          via: `${p.a} + ${q.a}`,
          value: `//${tag}[@${p.a}=${escapeXp(p.v)} and @${q.a}=${escapeXp(q.v)}]`,
          source: "attr-combo", category: "Attributes", score: 57,
        });
        if (rec) emitted++;
      }
    }

    if (present.length) {
      const p = present[0];
      if (ctx.text) {
        set.xp({
          via: `${p.a} + text`,
          value: `//${tag}[@${p.a}=${escapeXp(p.v)} and normalize-space()=${escapeXp(ctx.text)}]`,
          source: "attr-combo", category: "Attributes",
          score: Math.min(60, textScore(SCORES.text, ctx.text)),
        });
      }
      if (ctx.classes.length) {
        set.css({
          via: `class + ${p.a}`,
          value: `${tag}.${cssId(ctx.classes[0])}${cssAttr(p.a, p.v)}`,
          source: "attr-combo", category: "Attributes", score: 50,
        });
      }
    }
  }

  function addStructure(set, ctx) {
    const { el, tag, cfg } = ctx;
    const parent = el.parentElement;
    if (!parent) return;

    const siblings = Array.from(parent.children);
    const sameTag = siblings.filter((c) => c.tagName === el.tagName);
    const nthType = sameTag.length > 1 ? sameTag.indexOf(el) + 1 : null;
    const nthChild = siblings.indexOf(el) + 1;
    const selfCss = ctx.bestSelfCss;
    const selfPred = ctx.bestSelfPred;

    for (const anc of ctx.anchors.slice(0, cfg.maxAnchors)) {
      const score = Math.round(anc.score * 0.75);
      const cat = "Structure";

      set.css({
        via: `under ${anc.label}`, value: `${anc.css} ${tag}`,
        source: "structure", category: cat, score,
      });
      if (anc.direct) {
        set.css({
          via: `child of ${anc.label}`, value: `${anc.css} > ${tag}`,
          source: "structure", category: cat, score: score - 1,
        });
      }
      if (selfCss) {
        set.css({
          via: `${anc.label} + attribute`, value: `${anc.css} ${tag}${selfCss}`,
          source: "structure", category: cat, score: score + 6,
        });
      }
      if (nthType) {
        set.css({
          via: `under ${anc.label} · nth-of-type`,
          value: `${anc.css} ${tag}:nth-of-type(${nthType})`,
          source: "structure-nth", category: cat, score: Math.round(score * 0.6),
        });
      }
      if (anc.direct && siblings.length > 1) {
        set.css({
          via: `under ${anc.label} · nth-child`,
          value: `${anc.css} > ${tag}:nth-child(${nthChild})`,
          source: "structure-nth", category: cat, score: Math.round(score * 0.55),
        });
      }

      const baseXp = `${anc.xp}//${tag}`;
      const under = set.xp({
        via: `under ${anc.label}`, value: baseXp,
        source: "structure", category: cat, score: score - 1,
      });
      if (anc.direct) {
        set.xp({
          via: `child of ${anc.label}`, value: `${anc.xp}/${tag}`,
          source: "structure", category: cat, score: score - 2,
        });
      }
      if (selfPred) {
        set.xp({
          via: `${anc.label} + attribute`, value: `${anc.xp}//${tag}[${selfPred}]`,
          source: "structure", category: cat, score: score + 5,
        });
      }
      if (ctx.text) {
        set.xp({
          via: `${anc.label} + text`,
          value: `${anc.xp}//${tag}[normalize-space()=${escapeXp(ctx.text)}]`,
          source: "structure", category: cat,
          score: Math.min(score + 4, textScore(SCORES.text, ctx.text)),
        });
      }
      // Positional inside the anchor — the honest last resort, and still
      // far more durable than an absolute path from <html>.
      const hit = under || set.probe("xpath", baseXp);
      if (hit && hit.matches > 1) {
        set.xp({
          via: `under ${anc.label} · index ${hit.position}`,
          value: `(${baseXp})[${hit.position}]`,
          source: "structure-nth", category: cat, score: Math.round(score * 0.5),
        });
      }
    }

    // Hop from an identifiable sibling. Common for form rows and toolbars.
    const prevAnchor = anchorFor(el.previousElementSibling, cfg);
    if (prevAnchor) {
      set.xp({
        via: `after ${prevAnchor.label}`,
        value: `${prevAnchor.xp}/following-sibling::${tag}[1]`,
        source: "structure", category: "Structure", score: Math.round(prevAnchor.score * 0.7),
      });
    }
    const nextAnchor = anchorFor(el.nextElementSibling, cfg);
    if (nextAnchor) {
      set.xp({
        via: `before ${nextAnchor.label}`,
        value: `${nextAnchor.xp}/preceding-sibling::${tag}[1]`,
        source: "structure", category: "Structure", score: Math.round(nextAnchor.score * 0.68),
      });
    }

    // Identify the element through a distinctive descendant — the
    // `//button[.//span[text()='Save']]` shape, for icon + label components.
    if (el.getElementsByTagName("*").length <= 20) {
      for (const kid of Array.from(el.children)) {
        const t = directText(kid);
        if (!t || t.length > 40) continue;
        const kt = kid.tagName.toLowerCase();
        set.xp({
          via: `descendant text "${truncate(t, 16)}"`,
          value: `//${tag}[.//${kt}[normalize-space()=${escapeXp(t)}]]`,
          source: "structure", category: "Structure", score: SCORES.text - 12,
        });
        set.xp({
          via: `ancestor of "${truncate(t, 16)}"`,
          value: `//${kt}[normalize-space()=${escapeXp(t)}]/ancestor::${tag}[1]`,
          source: "structure", category: "Structure", score: SCORES.text - 16,
        });
        break;
      }
    }
  }

  // A short chain from the nearest anchored ancestor down to the element,
  // adding an index only at the levels that actually need one. This does the
  // job absolute XPath used to do — locating an element with nothing
  // distinctive about it — but rooted at something meaningful, so it is a
  // handful of steps instead of a full path from <html> and it survives
  // changes anywhere above the anchor.
  function emitChain(set, ctx, anchor) {
    const { el, cfg } = ctx;
    const stopAt = anchor ? anchor.node : null;

    const segs = [];
    let cur = el;
    let reachedAnchor = false;
    let depth = 0;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const parent = cur.parentElement;
      if (!parent) break;
      const tag = cur.tagName.toLowerCase();
      const sameTag = Array.from(parent.children).filter(
        (c) => c.tagName === cur.tagName
      );
      const needsIndex = sameTag.length > 1;
      const idx = sameTag.indexOf(cur) + 1;
      segs.unshift({
        css: needsIndex ? `${tag}:nth-of-type(${idx})` : tag,
        xp: needsIndex ? `${tag}[${idx}]` : tag,
      });
      if (parent === stopAt) {
        reachedAnchor = true;
        break;
      }
      if (++depth > cfg.maxAncestorDepth) break;
      cur = parent;
    }
    if (!segs.length) return null;

    const cssChain = segs.map((s) => s.css).join(" > ");
    const xpChain = segs.map((s) => s.xp).join("/");

    let css;
    let xp;
    if (anchor && reachedAnchor) {
      css = { via: `chain from ${anchor.label}`, value: `${anchor.css} > ${cssChain}`, score: SCORES.structure + 8 };
      xp = { via: `chain from ${anchor.label}`, value: `${anchor.xp}/${xpChain}`, score: SCORES.structure + 7 };
    } else if (anchor) {
      css = { via: `under ${anchor.label} · chain`, value: `${anchor.css} ${cssChain}`, score: SCORES.structure };
      xp = { via: `under ${anchor.label} · chain`, value: `${anchor.xp}//${xpChain}`, score: SCORES.structure - 1 };
    } else {
      css = { via: "relative chain", value: cssChain, score: SCORES.structure - 8 };
      xp = { via: "relative chain", value: `//${xpChain}`, score: SCORES.structure - 9 };
    }

    const cssRec = set.css(Object.assign({ source: "chain", category: "Structure" }, css));
    const xpRec = set.xp(Object.assign({ source: "chain", category: "Structure" }, xp));
    return (cssRec && cssRec.unique) || (xpRec && xpRec.unique) ? { unique: true } : null;
  }

  // Walk outwards through the anchors until one of them yields a chain that
  // pins the element down; fall back to an unanchored chain if none does.
  function addRelativeChain(set, ctx) {
    for (const anchor of ctx.anchors.slice(0, ctx.cfg.maxAnchors)) {
      if (emitChain(set, ctx, anchor)) return;
    }
    emitChain(set, ctx, null);
  }

  function addTagOnly(set, ctx) {
    const { tag } = ctx;
    set.add({
      type: "Tag Name", strategy: "tag name", value: tag, source: "tag",
      category: "Tag", score: SCORES.tag,
      verify: { kind: "css", expr: tag },
    });
    set.css({
      via: "tag", value: tag, source: "tag", category: "Tag", score: SCORES.tag - 1,
    });
    const bare = set.xp({
      via: "tag", value: `//${tag}`, source: "tag", category: "Tag", score: SCORES.tag - 2,
    });
    // `//div` is dropped as noise on any real page, but pinning the index makes
    // it a working (if fragile) locator, so offer that form directly.
    const hit = bare || set.probe("xpath", `//${tag}`);
    if (hit && hit.matches > 1) {
      set.xp({
        via: `tag · index ${hit.position}`,
        value: `(//${tag})[${hit.position}]`,
        source: "tag-index", category: "Tag", score: SCORES.nth,
      });
    }
  }

  // A non-unique XPath becomes unique once the target's position is pinned.
  // Suites do reach for this, so offer it rather than hiding the locator.
  function addIndexedVariants(set) {
    const bases = set.items
      .filter(
        (i) =>
          i.strategy === "xpath" &&
          !i.unique &&
          i.source !== "structure-nth" &&
          !i.value.startsWith("(")
      )
      .slice(0, 6);
    for (const item of bases) {
      set.xp({
        via: `${item.via || "xpath"} · index ${item.position}`,
        value: `(${item.value})[${item.position}]`,
        source: item.source + "-index",
        category: item.category,
        score: Math.max(SCORES.nth, item.score - 22),
      });
    }
  }

  // -------------------- BUILD --------------------
  function buildContext(el, cfg) {
    const tag = el.tagName.toLowerCase();
    const fullText = norm(el.textContent);
    const text = fullText && fullText.length <= cfg.maxTextLength ? fullText : "";
    const ownRaw = directText(el);
    const ownText = ownRaw && ownRaw.length <= cfg.maxTextLength ? ownRaw : "";
    const classes = Array.from(el.classList || []).filter((c) => isStableClass(c, cfg));

    // The cheapest self-side fact that helps disambiguate inside an anchored
    // selector — reused by the structure generators in both syntaxes.
    let bestSelfCss = null;
    let bestSelfPred = null;
    const selfAttrs = cfg.customTestAttributes.concat([
      "name", "aria-label", "placeholder", "type", "role", "title", "alt",
    ]);
    for (const a of selfAttrs) {
      const v = usableValue(el.getAttribute(a), cfg);
      if (!v) continue;
      bestSelfCss = cssAttr(a, v);
      bestSelfPred = `@${a}=${escapeXp(v)}`;
      break;
    }
    if (!bestSelfCss && classes.length) {
      bestSelfCss = `.${cssId(classes[0])}`;
      bestSelfPred = `contains(@class, ${escapeXp(classes[0])})`;
    }

    return {
      el, tag, cfg, text, ownText,
      classes,
      label: labelInfo(el),
      accName: accessibleName(el, cfg),
      anchors: ancestorAnchors(el, cfg),
      bestSelfCss,
      bestSelfPred,
    };
  }

  function buildLocators(el, cfg) {
    const set = createLocatorSet(el, cfg);
    const ctx = buildContext(el, cfg);

    addTestIds(set, ctx);
    addId(set, ctx);
    addName(set, ctx);
    addRoleAndName(set, ctx);
    addText(set, ctx);
    addLabelAssociations(set, ctx);
    for (const spec of ATTR_FAMILY) addAttrFamily(set, ctx, spec);
    addOtherAttributes(set, ctx);
    addAttributeCombos(set, ctx);
    addClasses(set, ctx);
    addStructure(set, ctx);
    addRelativeChain(set, ctx);
    addTagOnly(set, ctx);
    addIndexedVariants(set);

    return { items: set.finalize(), probes: set.probeCount() };
  }

  // -------------------- LEGACY FIELD MAPPING --------------------
  // The popup, the recorder code generator and the AI prompt all read the flat
  // v1 field names. Derive them from the generated set so there is exactly one
  // source of truth. Every one of these must be unique to be usable as "the"
  // locator of its kind, which is how v1 behaved.
  function legacyFields(items) {
    const pick = (pred) => {
      const hit = items.find((i) => i.unique && pred(i));
      return hit ? hit.value : null;
    };
    const xp = (source) =>
      pick((i) => i.strategy === "xpath" && i.source === source);

    return {
      cssSelector: pick((i) => i.strategy === "css"),
      cssByAttrPair: pick((i) => i.strategy === "css" && i.source === "attr-combo"),
      relativeXPath: pick((i) => i.strategy === "xpath"),
      xpathById: xp("id") || xp("id-dynamic"),
      xpathByName: xp("name"),
      xpathByDataTestId: xp("test-id"),
      xpathByAriaLabel: xp("aria-label"),
      xpathByPlaceholder: xp("placeholder"),
      xpathByText: xp("text"),
      partialTextXPath: xp("text-partial"),
      xpathByLinkText: xp("link-text"),
      xpathByPartialLinkText: xp("link-text-partial"),
      xpathByClassName: xp("class"),
      xpathByTagName: xp("tag"),
    };
  }

  // -------------------- PUBLIC GENERATOR --------------------
  function generate(rawElement, userConfig) {
    if (!rawElement || rawElement.nodeType !== 1) return {};
    const cfg = Object.assign({}, DEFAULT_CONFIG, userConfig || {});

    const { el: element, escalatedFrom } = escalate(rawElement);

    if (typeof window.sendLifecycleEvent === "function") {
      window.sendLifecycleEvent("generation_started", {
        engine: "v2",
        element: {
          tagName: element.tagName.toLowerCase(),
          id: element.id || null,
        },
      });
    }

    const { items, probes } = buildLocators(element, cfg);
    const tag = element.tagName.toLowerCase();

    const result = Object.assign(
      {
        _engine: "v2",
        _probes: probes,
        _locatorCount: items.length,
        _uniqueCount: items.filter((i) => i.unique).length,
        // The canonical output. Ordered best-first.
        locators: items,
      },
      legacyFields(items),
      {
        tagName: tag,
        id: element.id || null,
        // Read the attribute, not `.className`: on SVG elements that property
        // is an SVGAnimatedString, which stringifies to "[object ...]".
        className: element.getAttribute("class") || null,
        name: element.getAttribute("name") || null,
        dataTestId:
          element.getAttribute("data-testid") ||
          element.getAttribute("data-test-id") ||
          null,
        ariaLabel: element.getAttribute("aria-label") || null,
        role: element.getAttribute("role") || implicitRole(element) || null,
        accessibleName: accessibleName(element, cfg) || null,
        linkText: element.innerText || null,
        partialLinkText: element.innerText
          ? element.innerText.slice(0, 15) + "..."
          : null,
        escalatedFrom,
      }
    );

    if (typeof window.sendLifecycleEvent === "function") {
      window.sendLifecycleEvent("generation_completed", {
        engine: "v2",
        locatorCount: items.length,
        uniqueCount: result._uniqueCount,
        probes,
        generatedLocators: result,
      });
    }
    return result;
  }

  // -------------------- DISPATCHER --------------------
  function readConfig() {
    const fromWindow = window.LocatorSpyConfig || {};
    let fromStorage = {};
    try {
      fromStorage = JSON.parse(localStorage.getItem("LocatorSpyConfig") || "{}");
    } catch {}
    return Object.assign({}, fromStorage, fromWindow);
  }

  window.LocatorSpyV2 = { generate, DEFAULT_CONFIG, SCORES };
  window.generateLocatorsV2 = generate;

  // -------------------- IN-MEMORY CACHE --------------------
  // Caches generation output keyed by element reference + an outerHTML
  // fingerprint. WeakMap means entries auto-GC when the element leaves the
  // DOM, and the entire cache dies on page navigation — both are desirable
  // since locator output depends on the live DOM and would go stale
  // otherwise. We deliberately do NOT use chrome.storage.local for this
  // cache: generation is synchronous, hover-driven calls would blow past
  // storage write quotas, and persisted locators can be subtly wrong after
  // the DOM has changed.
  const RULE_ENGINE_CACHE = new WeakMap();
  let ruleEngineCacheHits = 0;
  let ruleEngineCacheMisses = 0;

  function ruleEngineCfgKey(cfg) {
    return (cfg.engine || "v2") + "|" + JSON.stringify(cfg || {});
  }

  // Locator Spy injects `outline` / `outline-offset` inline styles via
  // locator_helper.highlightElement to draw the hover/validator highlight.
  // That mutation happens in a requestAnimationFrame, so the same element
  // produces a different `outerHTML` between hover-time (pre-RAF, no outline)
  // and click-time (post-RAF, outline present). Strip those properties before
  // fingerprinting so the cache actually hits on re-generation.
  function ruleEngineFingerprint(element) {
    let html = element.outerHTML || "";
    html = html.replace(/outline\s*:\s*[^;"]+;?/gi, "");
    html = html.replace(/outline-offset\s*:\s*[^;"]+;?/gi, "");
    html = html.replace(/style="\s*"/gi, "");
    html = html.replace(/style="\s*;+\s*"/gi, "");
    return html;
  }

  // Single entry-point used by content.js. Routes to the configured engine,
  // returning a memoised result when the same element + same config + same
  // outerHTML has been generated already in this page load.
  window.generateLocators = function (element) {
    if (!element || typeof element !== "object") return null;

    const cfg = readConfig();
    const cfgKey = ruleEngineCfgKey(cfg);
    // outerHTML captures attribute + child mutations, with our own outline
    // highlight stripped so it doesn't poison the fingerprint.
    const fingerprint = ruleEngineFingerprint(element);

    const cached = RULE_ENGINE_CACHE.get(element);
    if (cached && cached.cfgKey === cfgKey && cached.fingerprint === fingerprint) {
      ruleEngineCacheHits++;
      if (typeof window.sendLifecycleEvent === "function") {
        window.sendLifecycleEvent("rule_engine_cache_hit", {
          engine: cfg.engine || "v2",
          tagName: element.tagName ? element.tagName.toLowerCase() : null,
          fingerprintLen: fingerprint.length,
          totalHits: ruleEngineCacheHits,
        });
      }
      return cached.locators;
    }
    ruleEngineCacheMisses++;
    if (typeof window.sendLifecycleEvent === "function") {
      window.sendLifecycleEvent("rule_engine_cache_miss", {
        engine: cfg.engine || "v2",
        tagName: element.tagName ? element.tagName.toLowerCase() : null,
        fingerprintLen: fingerprint.length,
        reason: cached ? "fingerprint_or_cfg_changed" : "no_entry",
        totalMisses: ruleEngineCacheMisses,
      });
    }

    const engine = cfg.engine || "v2";
    let locators;
    if (engine === "v1" && typeof window.generateLocatorsV1 === "function") {
      locators = window.generateLocatorsV1(element);
    } else {
      locators = generate(element, cfg);
    }

    RULE_ENGINE_CACHE.set(element, { cfgKey, fingerprint, locators });
    return locators;
  };

  // Debug surface for inspection from the page console:
  //   window.locatorRuleEngineCache.stats()
  //   window.locatorRuleEngineCache.has(element)
  window.locatorRuleEngineCache = {
    has: (element) => RULE_ENGINE_CACHE.has(element),
    stats: () => ({
      hits: ruleEngineCacheHits,
      misses: ruleEngineCacheMisses,
      hitRate: ruleEngineCacheHits + ruleEngineCacheMisses === 0
        ? 0
        : (ruleEngineCacheHits / (ruleEngineCacheHits + ruleEngineCacheMisses)).toFixed(3),
    }),
  };
})();
