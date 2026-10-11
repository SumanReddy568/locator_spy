// v3 and v4 engines — both built on the worker's POST /generate-locator.
//
// v4 (default): API only. window.fetchLocatorsV4(element) returns exactly what
// the endpoint produced (server rules + AI), shaped like v2's output for the
// panel. Nothing is dropped; each locator is only annotated with how many
// nodes it matches here and a highlightable verify expression.
//
// v3 engine = v2 (instant, in-page) + the worker's POST /generate-locator
// (server rule engine + Workers AI suggestions), merged after the fact.
//
// The synchronous path is untouched: window.generateLocators still returns the
// v2 result for engine "v3", so hover, the recorder and the first paint after
// a click stay instant and offline-safe. On click, content.js calls
// window.enhanceLocatorsV3(element, v2Result), which asks the background
// service worker to call the API (it holds the user_id and isn't subject to
// the page's CSP/CORS), then re-verifies every returned locator against the
// live DOM. Anything that doesn't resolve to the clicked element — including
// AI hallucinations (in testing it invented `id: "Place order"` and emitted
// XPath that matched nothing) — is dropped, as is anything matching more than
// one node, so v3 never adds a locator v2 couldn't have validated itself. Any failure resolves to { error } and the v2 result stands.
(function () {
  if (window.enhanceLocatorsV3) return;

  const MAX_HTML = 100000; // server rejects snippets over 100KB
  const TIMEOUT_MS = 30000; // server AI chain is capped at ~28s

  const TYPE = {
    css: ["CSS", "css"],
    xpath: ["XPath", "xpath"],
    id: ["ID", "id"],
    name: ["Name", "name"],
    className: ["Class Name", "class name"],
    linkText: ["Link Text", "link text"],
    partialLinkText: ["Partial Link Text", "partial link text"],
    tagName: ["Tag Name", "tag name"],
    playwright: ["Playwright", "playwright"],
  };

  // XPath has no escape syntax — concat() when both quote kinds appear.
  function xpLit(s) {
    if (!s.includes("'")) return `'${s}'`;
    if (!s.includes('"')) return `"${s}"`;
    return `concat(${s.split("'").map((p) => `'${p}'`).join(`, "'", `)})`;
  }
  const cssAttr = (a, v) => `[${a}=${JSON.stringify(v)}]`;

  // First quoted argument and `name:` option of a Playwright getBy* call.
  function pwArgs(value) {
    const m = /^getBy(\w+)\(\s*(['"])((?:\\.|(?!\2).)*)\2/.exec(value);
    if (!m) return null;
    const unq = (s) => s.replace(/\\(.)/g, "$1");
    const name = /name:\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(value);
    return { method: m[1], arg: unq(m[3]), name: name ? unq(name[2]) : null };
  }

  // How to check a server/AI locator in this page. `approx` marks Playwright
  // accessors that resolve by accessible name, which the DOM can't query
  // exactly — same convention v2 uses for its own getByRole/getByLabel.
  function verifyFor(strategy, value) {
    switch (strategy) {
      case "css": return { kind: "css", expr: value };
      case "xpath": return { kind: "xpath", expr: value };
      case "id": return { kind: "css", expr: `#${CSS.escape(value)}` };
      case "name": return { kind: "css", expr: cssAttr("name", value) };
      case "className": return { kind: "css", expr: `.${CSS.escape(value)}` };
      case "tagName": return { kind: "css", expr: value };
      case "linkText": return { kind: "xpath", expr: `//a[normalize-space()=${xpLit(value)}]` };
      case "partialLinkText": return { kind: "xpath", expr: `//a[contains(normalize-space(), ${xpLit(value)})]` };
      case "playwright": {
        const p = pwArgs(value);
        if (!p) return null;
        const attr = { TestId: "data-testid", Placeholder: "placeholder", AltText: "alt", Title: "title" }[p.method];
        if (attr) return { kind: "css", expr: cssAttr(attr, p.arg) };
        const text = p.method === "Role" ? p.name : p.arg;
        if (!text || !["Role", "Text", "Label"].includes(p.method)) return null;
        const lit = xpLit(text);
        return { kind: "xpath", expr: `//*[@aria-label=${lit} or normalize-space()=${lit}]`, approx: true };
      }
      default: return null;
    }
  }

  function probe(kind, expr, target) {
    let nodes;
    try {
      if (kind === "xpath") {
        const r = document.evaluate(expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        nodes = [];
        for (let i = 0; i < r.snapshotLength; i++) nodes.push(r.snapshotItem(i));
      } else {
        nodes = Array.from(document.querySelectorAll(expr));
      }
    } catch {
      return null;
    }
    const idx = nodes.indexOf(target);
    return idx === -1 ? null : { matches: nodes.length, position: idx + 1 };
  }

  // Our own hover/selection outline must not leak into what the server sees.
  function cleanHtml(html) {
    return html
      .replace(/outline(-offset)?\s*:\s*[^;"]+;?/gi, "")
      .replace(/\sstyle="\s*;*\s*"/gi, "")
      .slice(0, MAX_HTML);
  }

  // Parent tag + its direct children's opening tags only: enough for the
  // server's parent-scoped and positional locators, without shipping (or
  // overflowing on) a whole <body>.
  function shallowParent(el) {
    const parent = el.parentElement;
    if (!parent || parent === document.documentElement) return null;
    const copy = parent.cloneNode(false);
    for (const child of parent.children) copy.appendChild(child.cloneNode(false));
    return cleanHtml(copy.outerHTML);
  }

  function callApi(payload) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
      try {
        chrome.runtime.sendMessage({ action: "generateLocatorV3", payload }, (res) => {
          clearTimeout(timer);
          resolve(chrome.runtime.lastError ? null : res);
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  const norm = (strategy, value) => `${strategy}|${String(value).replace(/"/g, "'").replace(/\s+/g, "")}`;

  // Convert server items into v2-shaped records, keeping only those that
  // resolve to `target` in this page.
  // `why` tallies each rejection so the panel can explain an empty result.
  function verifyAll(items, target, seen, extra, why) {
    const out = [];
    for (const it of items || []) {
      const t = TYPE[it && it.strategy];
      if (!t || typeof it.value !== "string" || !it.value.trim()) { why.invalid++; continue; }
      // v2 writes Playwright accessors as `page.getBy...`; match that so the
      // same locator isn't listed twice and copy-as formats stay consistent.
      const raw = it.value.trim().replace(/^page\./, "");
      const value = it.strategy === "playwright" ? `page.${raw}` : raw;
      const key = norm(t[1], value);
      if (seen.has(key)) { why.duplicate++; continue; }
      const verify = verifyFor(it.strategy, raw);
      const hit = verify && probe(verify.kind, verify.expr, target);
      // Extras must identify the element on their own; v2 already lists the
      // useful non-unique ones (repeated components) with match counts.
      if (!hit) { why.noMatch++; continue; }
      if (hit.matches !== 1) { why.notUnique++; continue; }
      seen.add(key);
      out.push(Object.assign({
        type: t[0],
        value,
        strategy: t[1],
        source: "server",
        category: "Attributes",
        score: typeof it.score === "number" ? it.score : 60,
        matches: hit.matches,
        position: hit.position,
        unique: hit.matches === 1,
        verifyKind: verify.kind,
        verifyExpr: verify.expr,
        approx: !!verify.approx,
      }, extra(it)));
    }
    return out;
  }

  // Annotate one API locator for display without filtering it: match count
  // here, whether it's unique, and a CSS/XPath equivalent for Validate.
  function annotate(it, target, extra) {
    const t = TYPE[it && it.strategy];
    if (!t || typeof it.value !== "string" || !it.value.trim()) return null;
    const raw = it.value.trim().replace(/^page\./, "");
    const verify = verifyFor(it.strategy, raw);
    let matches = 0, position = null, hitsTarget = false;
    if (verify) {
      let nodes = [];
      try {
        if (verify.kind === "xpath") {
          const r = document.evaluate(verify.expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < r.snapshotLength; i++) nodes.push(r.snapshotItem(i));
        } else {
          nodes = Array.from(document.querySelectorAll(verify.expr));
        }
      } catch { /* left at 0 matches */ }
      matches = nodes.length;
      const idx = nodes.indexOf(target);
      hitsTarget = idx !== -1;
      position = hitsTarget ? idx + 1 : null;
    }
    return Object.assign({
      type: t[0],
      value: it.strategy === "playwright" ? `page.${raw}` : raw,
      strategy: t[1],
      source: "server",
      category: "Attributes",
      score: typeof it.score === "number" ? it.score : 60,
      matches,
      position,
      unique: hitsTarget && matches === 1,
      verifyKind: verify ? verify.kind : null,
      verifyExpr: verify ? verify.expr : null,
      approx: !!(verify && verify.approx),
      advanced: true,
    }, extra(it));
  }

  // v4: resolves to a v2-shaped result built only from the API, or { error }.
  window.fetchLocatorsV4 = async function (element) {
    if (!element || element.nodeType !== 1) return { error: "no_element" };
    const style = getComputedStyle(element);
    const res = await callApi({
      html: cleanHtml(element.outerHTML || ""),
      parentHtml: shallowParent(element),
      css: { display: style.display, visibility: style.visibility, opacity: style.opacity },
    });
    if (!res || !res.ok || !res.data) {
      const error = (res && res.error) || "no_response";
      if (typeof window.sendLifecycleEvent === "function") {
        window.sendLifecycleEvent("v4_generate_failed", { error });
      }
      return { error };
    }
    const d = res.data;
    const locators = []
      .concat(
        (d.locators || []).map((it) => annotate(it, element, (x) => ({ reason: x.reason || x.note || null, note: x.note || null, aiReason: x.aiReason || null }))),
        (d.aiLocators || []).map((it) => annotate(it, element, (x) => ({
          source: "ai", category: "AI", score: 70,
          reason: typeof x.reason === "string" ? x.reason : null,
        })))
      )
      // The panel doesn't show Playwright accessors; drop them here so the
      // counts below match what's on screen.
      .filter((l) => l && l.strategy !== "playwright");
    const first = (strategy) => (locators.find((l) => l.unique && l.strategy === strategy) || {}).value || null;
    const attr = (a) => element.getAttribute(a) || null;
    const result = {
      _engine: "v4",
      _locatorCount: locators.length,
      _uniqueCount: locators.filter((l) => l.unique).length,
      _v4: {
        aiModel: d.aiModel || null,
        aiError: d.aiError || null,
        aiCount: locators.filter((l) => l.source === "ai").length,
        ruleCount: locators.filter((l) => l.source !== "ai").length,
      },
      locators,
      // Flat fields the popup, recorder codegen and "Optimize with AI" read.
      cssSelector: first("css"),
      relativeXPath: first("xpath"),
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      className: attr("class"),
      name: attr("name"),
      dataTestId: attr("data-testid") || attr("data-test-id"),
      ariaLabel: attr("aria-label"),
      role: (d.element && d.element.role) || attr("role"),
      linkText: element.innerText || null,
    };
    if (typeof window.sendLifecycleEvent === "function") {
      window.sendLifecycleEvent("v4_generate_completed", Object.assign({ locatorCount: locators.length }, result._v4));
    }
    return result;
  };

  // Resolves to the merged v3 result, or { error } (caller keeps the v2 result).
  window.enhanceLocatorsV3 = async function (element, base) {
    if (!element || element.nodeType !== 1 || !base || !Array.isArray(base.locators)) {
      return { error: "no_base_result" };
    }
    const style = getComputedStyle(element);
    const res = await callApi({
      html: cleanHtml(element.outerHTML || ""),
      parentHtml: shallowParent(element),
      css: { display: style.display, visibility: style.visibility, opacity: style.opacity },
    });
    if (!res || !res.ok || !res.data) {
      const error = (res && res.error) || "no_response";
      if (typeof window.sendLifecycleEvent === "function") {
        window.sendLifecycleEvent("v3_enhance_failed", { error });
      }
      return { error };
    }

    const seen = new Set(base.locators.map((l) => norm(l.strategy, l.value)));
    const why = { duplicate: 0, notUnique: 0, noMatch: 0, invalid: 0 };
    // `advanced` marks everything that came from the v3 pass; the panel gives
    // those rows the AI badge. `reason` is the model's / server's note.
    const ai = verifyAll(res.data.aiLocators, element, seen, (it) => ({
      source: "ai",
      category: "AI",
      advanced: true,
      reason: typeof it.reason === "string" ? it.reason : null,
    }), why);
    const server = verifyAll(res.data.locators, element, seen, (it) => ({
      source: "server",
      advanced: true,
      reason: it.reason || it.note || null,
      aiReason: it.aiReason || null,
    }), why);

    // v2's own ranking stays authoritative; extras go after it, and unique
    // ones before non-unique ones (stable sort keeps the order otherwise).
    const locators = base.locators.concat(ai, server)
      .map((l, i) => [l, i])
      .sort((a, b) => Number(b[0].unique) - Number(a[0].unique) || a[1] - b[1])
      .map(([l]) => l);

    const result = Object.assign({}, base, {
      _engine: "v3",
      _locatorCount: locators.length,
      _uniqueCount: locators.filter((l) => l.unique).length,
      _v3: {
        aiModel: res.data.aiModel || null,
        aiError: res.data.aiError || null,
        aiReturned: (res.data.aiLocators || []).length,
        aiAdded: ai.length,
        serverAdded: server.length,
        checked: (res.data.aiLocators || []).length + (res.data.locators || []).length,
        rejected: why,
      },
      locators,
    });
    if (typeof window.sendLifecycleEvent === "function") {
      window.sendLifecycleEvent("v3_enhance_completed", result._v3);
    }
    return result;
  };
})();
