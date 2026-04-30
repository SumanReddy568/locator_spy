/**
 * Locator Spy — v2 Engine (anchor-first)
 * ========================================
 *
 * Philosophy: separate "what makes this element identifiable" (anchors) from
 * "how to write it down" (emitters).
 *
 * Pipeline:
 *   1. Extract anchors from the element + nearest ancestors. An anchor is a
 *      single distinguishing fact: an attribute, a class atom, the visible
 *      text, the ARIA role, the accessible name, etc. Each carries a
 *      stability score.
 *   2. Search for minimal anchor sets that uniquely identify the element.
 *      Beam search over: single self-anchors → tag+attr → tag+pair →
 *      role+name → ancestor+self combinations.
 *   3. Emit each candidate via every requested emitter (CSS, XPath,
 *      Playwright, Testing Library). One logical locator → many strings.
 *   4. Validate every emitted string against the live DOM (uniqueness +
 *      exact target match). Failures become null.
 *
 * Toggle the engine at runtime:
 *   window.LocatorSpyConfig = { engine: 'v1' }   // force v1
 *   window.LocatorSpyConfig = { engine: 'v2' }   // force v2 (default)
 *   localStorage.setItem('LocatorSpyConfig', JSON.stringify({ engine: 'v1' }))
 *
 * Output schema is a superset of v1's, so popup/devtools UI keeps working.
 */
(function () {
  "use strict";

  // -------------------- DEFAULT CONFIG --------------------
  const DEFAULT_CONFIG = {
    engine: "v2",
    emitters: ["css", "xpath"],
    customTestAttributes: [
      "data-testid",
      "data-test-id",
      "data-test",
      "data-qa",
      "data-cy",
      "data-automation",
      "data-test-locator",
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
    maxAncestorDepth: 6,
    candidateBeamWidth: 12,
    minScore: 25,
    topN: 5,
  };

  // Stability scores. Higher = more resistant to layout, copy and refactor
  // changes. Tweak via config to fit a project's conventions.
  const SCORES = {
    "data-testid": 100, "data-test-id": 100, "data-test": 95,
    "data-qa": 95, "data-cy": 95, "data-automation": 95, "data-test-locator": 95,
    id: 90, name: 85, "aria-label": 85, "aria-labelledby": 80,
    role_name: 80, text: 70, href: 65, placeholder: 60,
    title: 55, alt: 55, for: 55, role: 50,
    type: 30, class: 30, tag: 10, nth: 5,
  };

  // -------------------- HELPERS --------------------
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

  function escapeXp(s) {
    if (!s.includes("'")) return `'${s}'`;
    if (!s.includes('"')) return `"${s}"`;
    return `concat('${s.replace(/'/g, "',\"'\",'")}')`;
  }

  function isStableId(id, cfg) {
    if (!id || typeof id !== "string") return false;
    return !cfg.ignoreIdPatterns.some((re) => re.test(id));
  }

  function isStableClass(cls, cfg) {
    return !cfg.ignoreClassPatterns.some((re) => re.test(cls));
  }

  function cssMatches(selector, target) {
    if (!selector) return false;
    try {
      const list = document.querySelectorAll(selector);
      return list.length === 1 && list[0] === target;
    } catch {
      return false;
    }
  }

  function xpMatches(xp, target) {
    if (!xp) return false;
    try {
      const r = document.evaluate(
        xp,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      return r.snapshotLength === 1 && r.snapshotItem(0) === target;
    } catch {
      return false;
    }
  }

  // ARIA role mapping for common HTML elements. Keeps the table small —
  // covers the cases that matter for testing locators, not full ARIA spec.
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

  function accessibleName(el) {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const ref = document.getElementById(labelledBy);
      if (ref) return (ref.textContent || "").trim();
    }
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") {
      if (el.id) {
        try {
          const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (lbl) return (lbl.textContent || "").trim();
        } catch {}
      }
      const wrap = el.closest("label");
      if (wrap) return (wrap.textContent || "").trim();
      const ph = el.getAttribute("placeholder");
      if (ph) return ph;
    }
    if (tag === "img") return el.getAttribute("alt") || "";
    const text = (el.textContent || "").trim();
    if (text && text.length <= 80 && !/[\n\t]/.test(text)) return text;
    return "";
  }

  // -------------------- ANCHOR EXTRACTION --------------------
  // An anchor: { kind, value, score, scope, name?, ancestorRef? }
  function extractAnchors(el, cfg, scope) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    out.push({ kind: "tag", value: tag, score: SCORES.tag, scope });

    for (const attr of cfg.customTestAttributes) {
      const v = el.getAttribute(attr);
      if (v) out.push({ kind: "attr", name: attr, value: v, score: SCORES[attr] || 90, scope });
    }
    if (el.id && isStableId(el.id, cfg)) {
      out.push({ kind: "attr", name: "id", value: el.id, score: SCORES.id, scope });
    }
    for (const a of ["name", "aria-label", "placeholder", "title", "alt", "href", "for", "type", "role"]) {
      const v = el.getAttribute(a);
      if (v) out.push({ kind: "attr", name: a, value: v, score: SCORES[a] || 50, scope });
    }
    if (scope === "self") {
      const text = (el.textContent || "").trim();
      if (text && text.length <= 80 && !/[\n\t]/.test(text)) {
        out.push({ kind: "text", value: text, score: SCORES.text, scope });
      }
    }
    for (const cls of Array.from(el.classList || [])) {
      if (!isStableClass(cls, cfg)) continue;
      out.push({ kind: "class", value: cls, score: SCORES.class, scope });
    }
    return out;
  }

  // -------------------- CANDIDATE SEARCH --------------------
  function anchorToCss(a) {
    if (a.kind === "tag") return a.value;
    if (a.kind === "attr") return `[${a.name}="${CSS.escape(a.value)}"]`;
    if (a.kind === "class") return `.${CSS.escape(a.value)}`;
    return null; // text / role / name have no CSS form
  }

  function candidateSignature(c) {
    return c.anchors
      .map((a) => `${a.scope}:${a.kind}:${a.name || ""}=${a.value}`)
      .join("|");
  }

  function findCandidates(el, cfg) {
    const tag = el.tagName.toLowerCase();
    const tagAnchor = { kind: "tag", value: tag, score: SCORES.tag, scope: "self" };
    const allSelf = extractAnchors(el, cfg, "self");
    const selfNonTag = allSelf
      .filter((a) => a.kind !== "tag")
      .sort((a, b) => b.score - a.score);

    const candidates = [];
    const push = (anchors, score, kind) =>
      candidates.push({ anchors, score, kind });

    // 1. Single self anchor — strongest, no tag prefix
    for (const a of selfNonTag) {
      const css = anchorToCss(a);
      if (css && cssMatches(css, el)) push([a], a.score, "self");
    }

    // 2. tag + single self anchor
    for (const a of selfNonTag) {
      const css = anchorToCss(a);
      if (!css) continue;
      const sel = `${tag}${css}`;
      if (cssMatches(sel, el)) push([tagAnchor, a], a.score - 2, "tag-attr");
    }

    // 3. tag + pair of self anchors (helps when no single class is unique)
    for (let i = 0; i < selfNonTag.length; i++) {
      for (let j = i + 1; j < selfNonTag.length; j++) {
        const a = selfNonTag[i], b = selfNonTag[j];
        const ca = anchorToCss(a), cb = anchorToCss(b);
        if (!ca || !cb) continue;
        const sel = `${tag}${ca}${cb}`;
        if (cssMatches(sel, el)) {
          push([tagAnchor, a, b], Math.round((a.score + b.score) / 2) - 4, "tag-pair");
        }
      }
    }

    // 4. text anchor (XPath / Playwright only)
    const textAnchor = allSelf.find((a) => a.kind === "text");
    if (textAnchor) push([tagAnchor, textAnchor], textAnchor.score, "text");

    // 5. role + accessible name (Playwright getByRole / Testing Library)
    const role = el.getAttribute("role") || implicitRole(el);
    const accName = accessibleName(el);
    if (role && accName && accName.length <= 80) {
      push(
        [
          { kind: "role", value: role, score: SCORES.role, scope: "self" },
          { kind: "name", value: accName, score: SCORES.text, scope: "self" },
        ],
        SCORES.role_name,
        "role-name"
      );
    }

    // 6. ancestor-anchored: walk up looking for strong attrs (id, testid),
    //    then add the cheapest self-side disambiguator.
    let cur = el.parentElement;
    let depth = 0;
    while (cur && depth < cfg.maxAncestorDepth) {
      const ancAttrs = extractAnchors(cur, cfg, "ancestor")
        .filter((a) => a.kind === "attr" && a.score >= 60)
        .sort((a, b) => b.score - a.score);

      if (ancAttrs.length) {
        const best = { ...ancAttrs[0], ancestorRef: cur, ancestorTag: cur.tagName.toLowerCase() };
        const ancCss = anchorToCss(best);

        // a) ancestor + bare tag
        if (cssMatches(`${ancCss} ${tag}`, el)) {
          push([best, tagAnchor], Math.round(best.score * 0.9), "anc-tag");
        }

        // b) ancestor + tag + strongest self attr/class
        for (const sa of selfNonTag) {
          const saCss = anchorToCss(sa);
          if (!saCss) continue;
          const sel = `${ancCss} ${tag}${saCss}`;
          if (cssMatches(sel, el)) {
            push([best, tagAnchor, sa], Math.round((best.score + sa.score) / 2), "anc-attr");
            break;
          }
        }

        // c) ancestor + text (XPath only — emitter will skip CSS)
        if (textAnchor) {
          push(
            [best, tagAnchor, textAnchor],
            Math.round((best.score + textAnchor.score) / 2),
            "anc-text"
          );
        }

        // d) ancestor + tag + nth-of-type (positional last resort)
        if (el.parentElement) {
          const sameTag = Array.from(el.parentElement.children).filter(
            (s) => s.tagName === el.tagName
          );
          if (sameTag.length > 1) {
            const idx = sameTag.indexOf(el) + 1;
            const sel = `${ancCss} ${tag}:nth-of-type(${idx})`;
            if (cssMatches(sel, el)) {
              const nthAnchor = { kind: "nth", value: idx, score: SCORES.nth, scope: "self" };
              push(
                [best, tagAnchor, nthAnchor],
                Math.round(best.score * 0.7),
                "anc-nth"
              );
            }
          }
        }
      }
      cur = cur.parentElement;
      depth++;
    }

    // Dedup + threshold + beam-width
    const seen = new Set();
    const unique = [];
    candidates.sort((a, b) => b.score - a.score);
    for (const c of candidates) {
      const sig = candidateSignature(c);
      if (seen.has(sig)) continue;
      seen.add(sig);
      unique.push(c);
    }
    return unique
      .filter((c) => c.score >= cfg.minScore)
      .slice(0, cfg.candidateBeamWidth);
  }

  // -------------------- EMITTERS --------------------
  function emitCss(c, target) {
    const ancAnchor = c.anchors.find((a) => a.scope === "ancestor");
    const selfAnchors = c.anchors.filter((a) => a.scope === "self");
    if (selfAnchors.some((a) => a.kind === "text" || a.kind === "role" || a.kind === "name")) {
      return null;
    }

    const tag = selfAnchors.find((a) => a.kind === "tag")?.value || "";
    const others = selfAnchors.filter((a) => a.kind !== "tag");
    const nthAnchor = others.find((a) => a.kind === "nth");
    const otherCss = others
      .filter((a) => a.kind !== "nth")
      .map(anchorToCss)
      .filter(Boolean)
      .join("");

    let selfPart = `${tag}${otherCss}`;
    if (nthAnchor) selfPart += `:nth-of-type(${nthAnchor.value})`;

    const sel = ancAnchor ? `${anchorToCss(ancAnchor)} ${selfPart}` : selfPart;
    return cssMatches(sel, target) ? sel : null;
  }

  function emitXPath(c, target) {
    const ancAnchor = c.anchors.find((a) => a.scope === "ancestor");
    const selfAnchors = c.anchors.filter((a) => a.scope === "self");
    if (selfAnchors.some((a) => a.kind === "role" || a.kind === "name")) return null;

    const tag = selfAnchors.find((a) => a.kind === "tag")?.value || "*";
    const others = selfAnchors.filter((a) => a.kind !== "tag");
    const nthAnchor = others.find((a) => a.kind === "nth");
    const preds = [];
    for (const a of others) {
      if (a.kind === "attr") preds.push(`@${a.name}=${escapeXp(a.value)}`);
      else if (a.kind === "class") preds.push(`contains(@class, ${escapeXp(a.value)})`);
      else if (a.kind === "text") preds.push(`normalize-space()=${escapeXp(a.value)}`);
    }
    let selfXp = `${tag}${preds.length ? `[${preds.join(" and ")}]` : ""}`;
    if (nthAnchor) selfXp = `(${ancAnchor ? "//*" : "//"}${tag})[${nthAnchor.value}]`; // rare

    const xp = ancAnchor
      ? `//*[@${ancAnchor.name}=${escapeXp(ancAnchor.value)}]//${selfXp}`
      : `//${selfXp}`;
    return xpMatches(xp, target) ? xp : null;
  }

  const EMITTERS = {
    css: emitCss,
    xpath: emitXPath,
  };

  // -------------------- ABSOLUTE XPATH (matches v1 for compat) --------------------
  function absoluteXPath(el) {
    const segs = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const tag = cur.tagName.toLowerCase();
      let index = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName.toLowerCase() === tag) index++;
        sib = sib.previousElementSibling;
      }
      segs.unshift(`${tag}[${index}]`);
      cur = cur.parentNode;
    }
    return "/" + segs.join("/");
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

    const candidates = findCandidates(element, cfg);

    const rendered = candidates.map((c) => {
      const out = { score: c.score, kind: c.kind, anchors: c.anchors };
      for (const e of cfg.emitters) {
        const fn = EMITTERS[e];
        out[e] = fn ? fn(c, element) : null;
      }
      return out;
    });

    const bestOf = (emitter) => rendered.find((r) => r[emitter]) || null;
    const cssBest = bestOf("css");
    const xpBest = bestOf("xpath");

    // Specialised xpath views — kept for v1 UI parity
    const findXpWith = (predicate) => {
      for (const c of candidates) {
        if (!c.anchors.some(predicate)) continue;
        const xp = emitXPath(c, element);
        if (xp) return xp;
      }
      return null;
    };
    const xpathByText = findXpWith((a) => a.kind === "text");
    const xpathByClassName = findXpWith((a) => a.kind === "class");

    const linkPaths = (() => {
      if (element.tagName.toLowerCase() !== "a") return { link: null, partial: null };
      const text = (element.textContent || "").trim();
      if (!text) return { link: null, partial: null };
      const link = `//a[normalize-space()=${escapeXp(text)}]`;
      const partial = `//a[contains(normalize-space(), ${escapeXp(text.slice(0, 20))})]`;
      return {
        link: xpMatches(link, element) ? link : null,
        partial: xpMatches(partial, element) ? partial : null,
      };
    })();

    const tag = element.tagName.toLowerCase();

    const xpathByTagName = (() => {
      const xp = `//${tag}`;
      return xpMatches(xp, element) ? xp : null;
    })();

    // Single-attribute XPath builder. Returns the xpath only if it resolves
    // uniquely to the target element.
    const xpathByAttr = (attrName, value, qualifyTag = true) => {
      if (!value) return null;
      const prefix = qualifyTag ? `//${tag}` : "//*";
      const xp = `${prefix}[@${attrName}=${escapeXp(value)}]`;
      return xpMatches(xp, element) ? xp : null;
    };

    const xpathById = element.id && isStableId(element.id, cfg)
      ? xpathByAttr("id", element.id, false)
      : null;
    const xpathByName = xpathByAttr("name", element.getAttribute("name"));
    const xpathByDataTestId = (() => {
      const v = element.getAttribute("data-testid");
      if (v) return xpathByAttr("data-testid", v, false);
      const v2 = element.getAttribute("data-test-id");
      if (v2) return xpathByAttr("data-test-id", v2, false);
      return null;
    })();
    const xpathByAriaLabel = xpathByAttr("aria-label", element.getAttribute("aria-label"));
    const xpathByPlaceholder = xpathByAttr("placeholder", element.getAttribute("placeholder"));

    const partialTextXPath = (() => {
      const text = (element.textContent || "").trim();
      if (!text || /[\n\t]/.test(text)) return null;
      const slice = text.length > 20 ? text.slice(0, 20) : text;
      const xp = `//${tag}[contains(normalize-space(), ${escapeXp(slice)})]`;
      return xpMatches(xp, element) ? xp : null;
    })();

    // CSS selector built from a pair of stable attributes. Useful for form
    // fields like input[name='email'][type='email'].
    const cssByAttrPair = (() => {
      const pairs = [
        ["name", "type"],
        ["type", "placeholder"],
        ["role", "type"],
        ["name", "role"],
      ];
      for (const [a, b] of pairs) {
        const va = element.getAttribute(a);
        const vb = element.getAttribute(b);
        if (!va || !vb) continue;
        const sel = `${tag}[${a}="${CSS.escape(va)}"][${b}="${CSS.escape(vb)}"]`;
        if (cssMatches(sel, element)) return sel;
      }
      return null;
    })();

    const result = {
      _engine: "v2",
      // v1-compatible fields (so existing popup/devtools UI keeps working)
      cssSelector: cssBest?.css || null,
      cssByAttrPair,
      absoluteXPath: absoluteXPath(element),
      relativeXPath: xpBest?.xpath || null,
      xpathById,
      xpathByName,
      xpathByDataTestId,
      xpathByAriaLabel,
      xpathByPlaceholder,
      xpathByText,
      partialTextXPath,
      xpathByLinkText: linkPaths.link,
      xpathByPartialLinkText: linkPaths.partial,
      xpathByClassName,
      xpathByTagName,
      tagName: tag,
      id: element.id || null,
      className: element.className || null,
      name: element.getAttribute("name") || null,
      dataTestId:
        element.getAttribute("data-testid") ||
        element.getAttribute("data-test-id") ||
        null,
      ariaLabel: element.getAttribute("aria-label") || null,
      role: element.getAttribute("role") || null,
      linkText: element.innerText || null,
      partialLinkText: element.innerText
        ? element.innerText.slice(0, 15) + "..."
        : null,
      escalatedFrom,
    };

    if (typeof window.sendLifecycleEvent === "function") {
      window.sendLifecycleEvent("generation_completed", {
        engine: "v2",
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

  // Single entry-point used by content.js. Routes to the configured engine.
  window.generateLocators = function (element) {
    const cfg = readConfig();
    const engine = cfg.engine || "v2";
    if (engine === "v1" && typeof window.generateLocatorsV1 === "function") {
      return window.generateLocatorsV1(element);
    }
    return generate(element, cfg);
  };
})();
