// v1 engine. Exported under `generateLocatorsV1`; the dispatcher in
// locator_engine_v2.js owns `window.generateLocators` and routes by config.
window.generateLocatorsV1 = function generateLocatorsV1(element) {
  if (!element || element.nodeType !== 1) return {};

  // If the user picked a non-interactive icon/decoration, escalate to the
  // closest semantic interactive ancestor so the locator targets something
  // an automation script would actually act on.
  const NON_SEMANTIC_TAGS = new Set([
    "svg", "path", "g", "use", "circle", "rect", "polygon", "polyline",
    "line", "ellipse", "defs", "symbol", "title", "desc"
  ]);
  let escalatedFrom = null;
  if (NON_SEMANTIC_TAGS.has(element.tagName.toLowerCase())) {
    const interactive = element.closest(
      'button, a, [role="button"], [role="link"], [onclick], input, select, textarea, label, summary'
    );
    if (interactive && interactive !== element) {
      escalatedFrom = element.tagName.toLowerCase();
      element = interactive;
    }
  }

  const elementForLog = element
    ? {
        tagName: element.tagName?.toLowerCase(),
        id: element.id || null,
        className: (element.className && String(element.className).slice(0, 100)) || null,
        name: element.getAttribute("name") || null,
        dataTestId: element.getAttribute("data-testid") || element.getAttribute("data-test-id") || null,
      }
    : null;
  if (typeof window.sendLifecycleEvent === "function") {
    window.sendLifecycleEvent("generation_started", { element: elementForLog });
  }

  /** -----------------------------------------------------
   * Utilities
   * -----------------------------------------------------*/

  const escape = (str) => CSS.escape(str);

  // Length caps used as a *preference* during generation: short candidates are
  // tried first and overly long anchored candidates are skipped so we keep
  // looking. The validators below DO NOT enforce length — if the only path
  // that uniquely identifies the element is long, the user still sees it.
  const CSS_MAX_LEN = 120;
  const XPATH_MAX_LEN = 180;

  const isUnique = (selector) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };

  // Pre-validators: confirm a selector resolves to exactly the target element.
  const cssMatchesElement = (selector, el) => {
    if (!selector) return false;
    try {
      const list = document.querySelectorAll(selector);
      return list.length === 1 && list[0] === el;
    } catch {
      return false;
    }
  };

  const xpathMatchesElement = (xpath, el) => {
    if (!xpath) return false;
    try {
      const all = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      return all.snapshotLength === 1 && all.snapshotItem(0) === el;
    } catch {
      return false;
    }
  };

  // Validators only check correctness: must resolve uniquely to the target.
  // Length is handled inside generation, so any selector that passes here is
  // both unique and accurate, regardless of length.
  const validateCss = (selector, el) =>
    cssMatchesElement(selector, el) ? selector : null;

  const validateXPath = (xpath, el) =>
    xpathMatchesElement(xpath, el) ? xpath : null;

  const escapeXPath = (text) => {
    if (!text.includes("'")) return `'${text}'`;
    if (!text.includes('"')) return `"${text}"`;
    return `concat('${text.replace(/'/g, "',\"'\",'")}')`;
  };

  // Helper to add index if XPath finds multiple elements
  function indexIfNeeded(xpath, el) {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      if (result.snapshotLength <= 1) return xpath;

      for (let i = 0; i < result.snapshotLength; i++) {
        if (result.snapshotItem(i) === el) {
          return `(${xpath})[${i + 1}]`;
        }
      }
      return xpath;
    } catch (e) {
      return xpath;
    }
  }

  const stableAttributes = [
    "data-testid",
    "data-test-id",
    "data-test",
    "data-qa",
    "data-automation",
    "name",
    "aria-label",
    "placeholder",
    "title",
    "role",
    "for",
    "href",
    "src"
  ];

  // Reject framework-generated and pseudo-variant classes. Tailwind variant
  // prefixes (`hover:`, `focus:`, `md:`, `dark:`, etc.) only fire in pseudo
  // states; using them as locator atoms produces ugly escaped selectors that
  // never improve uniqueness, so we drop anything containing a `:`.
  const shouldIgnoreClass = (cls) =>
    /(^$|^ng-|^css-|^chakra-|^Mui|^ant-|^sc-|^[\d\-_]+$|:)/.test(cls);

  // Reject framework-generated IDs that change on every mount/render.
  // Headless UI / React 18 useId → ":r87:", "headlessui-disclosure-button-:r87:"
  // Radix UI → "radix-:R1:", Reach UI → "reach-:R1:", MUI → "mui-12345"
  // Also rejects UUID-shaped IDs and pure-numeric IDs.
  const isUnstableId = (id) => {
    if (!id || typeof id !== "string") return true;
    if (/:[a-z0-9]+:/i.test(id)) return true;
    if (/^(headlessui-|radix-|reach-|mui-|chakra-|emotion-|fluent-)/i.test(id))
      return true;
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
      return true;
    if (/^[a-f0-9]{16,}$/i.test(id)) return true;
    if (/^\d+$/.test(id)) return true;
    return false;
  };

  const hasStableId = (el) => el && el.id && !isUnstableId(el.id);

  /** -----------------------------------------------------
   * CSS SELECTOR GENERATION
   * -----------------------------------------------------*/

  function getCssSelector(el) {
    const tag = el.tagName.toLowerCase();

    // 1. ID (skip framework-generated unstable IDs)
    if (hasStableId(el) && isUnique(`#${escape(el.id)}`)) {
      return `#${escape(el.id)}`;
    }

    // 2. Unique Tag Name
    if (isUnique(tag)) return tag;

    // 3. Stable Attributes
    for (const attr of stableAttributes) {
      const val = el.getAttribute(attr);
      if (val) {
        const selector = `[${attr}="${escape(val)}"]`;
        if (cssMatchesElement(selector, el)) return selector;
        const tagSelector = `${tag}${selector}`;
        if (cssMatchesElement(tagSelector, el)) return tagSelector;
      }
    }

    // 4. Other Data Attributes
    for (const attr of Array.from(el.attributes)) {
      if (
        attr.name.startsWith("data-") &&
        !stableAttributes.includes(attr.name)
      ) {
        const selector = `[${attr.name}="${escape(attr.value)}"]`;
        if (cssMatchesElement(selector, el)) return selector;
      }
    }

    // 5. Class List — favour the SHORTEST unique form.
    const classes = Array.from(el.classList || []).filter(
      (cls) => !shouldIgnoreClass(cls)
    );

    if (classes.length > 0) {
      // 5a. Single class alone (rarely unique, but cheapest when it is).
      for (const cls of classes) {
        const sel = `.${escape(cls)}`;
        if (cssMatchesElement(sel, el)) return sel;
      }
      // 5b. Tag + single class.
      for (const cls of classes) {
        const sel = `${tag}.${escape(cls)}`;
        if (cssMatchesElement(sel, el)) return sel;
      }
      // 5c. Tag + pair of classes (try shortest pairs first).
      const pairCandidates = [];
      for (let i = 0; i < classes.length; i++) {
        for (let j = i + 1; j < classes.length; j++) {
          pairCandidates.push(
            `${tag}.${escape(classes[i])}.${escape(classes[j])}`
          );
        }
      }
      pairCandidates.sort((a, b) => a.length - b.length);
      for (const sel of pairCandidates) {
        if (sel.length > CSS_MAX_LEN) continue;
        if (cssMatchesElement(sel, el)) return sel;
      }
    }

    // 6. Anchor at the nearest stable-ID ancestor with a short inner selector.
    const anchored = buildAnchoredCss(el);
    if (anchored) return anchored;

    // 7. Optimized DOM Path (stops at ID or unique parent)
    return buildOptimizedDomPath(el);
  }

  // Build `#stableAncestor <short-inner>` style selector. The short-inner is
  // the cheapest of: single distinctive class, tag + nth-of-type, or bare tag.
  function buildAnchoredCss(el) {
    let anchor = el.parentElement;
    while (anchor && !hasStableId(anchor)) anchor = anchor.parentElement;
    if (!anchor) return null;

    const anchorSel = `#${escape(anchor.id)}`;
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList || []).filter(
      (c) => !shouldIgnoreClass(c)
    );

    const candidates = [];
    for (const cls of classes) {
      candidates.push(`${anchorSel} ${tag}.${escape(cls)}`);
    }
    if (el.parentElement) {
      const sameTag = Array.from(el.parentElement.children).filter(
        (s) => s.tagName === el.tagName
      );
      if (sameTag.length > 1) {
        const idx = sameTag.indexOf(el) + 1;
        candidates.push(`${anchorSel} ${tag}:nth-of-type(${idx})`);
      }
    }
    candidates.push(`${anchorSel} ${tag}`);

    candidates.sort((a, b) => a.length - b.length);
    for (const sel of candidates) {
      if (sel.length > CSS_MAX_LEN) continue;
      if (cssMatchesElement(sel, el)) return sel;
    }
    return null;
  }

  function buildOptimizedDomPath(el) {
    const path = [];
    let current = el;

    while (current && current.nodeType === 1) {
      // If we hit a stable ID, use it as anchor
      if (hasStableId(current)) {
        const idSelector = `#${escape(current.id)}`;
        path.unshift(idSelector);
        const fullPath = path.join(" > ");
        if (isUnique(fullPath)) return fullPath;
        // If not unique, continue but keep ID in path
      } else {
        // Try unique class or fallback to nth-type
        let selector = current.tagName.toLowerCase();
        const classes = Array.from(current.classList || []).filter(c => !shouldIgnoreClass(c));

        let addedClass = false;
        // Try to append a class if it helps uniqueness
        if (classes.length > 0) {
          selector += `.${escape(classes[0])}`;
          addedClass = true;
        }

        if (!addedClass) {
          const siblings = Array.from(current.parentNode?.children || []).filter(
            (s) => s.tagName === current.tagName
          );

          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }

        path.unshift(selector);
      }

      // Check current path uniqueness
      const currentSelector = path.join(" > ");
      if (isUnique(currentSelector)) return currentSelector;

      if (current.tagName.toLowerCase() === "html") break;
      current = current.parentNode;

      // Prevent infinite loops / too deep
      if (path.length > 15) break;
    }
    return path.join(" > ");
  }

  /** -----------------------------------------------------
   * XPATH GENERATION
   * -----------------------------------------------------*/

  function getRelativeXPath(el) {
    const tag = el.tagName.toLowerCase();

    // 1. Unique stable ID (reject framework-generated IDs that mutate)
    if (hasStableId(el) && isUnique(`#${escape(el.id)}`)) {
      return `//*[@id='${el.id}']`;
    }

    // 2. Unique stable attribute on the element itself.
    for (const attr of stableAttributes) {
      const val = el.getAttribute(attr);
      if (!val) continue;
      const xpath = `//${tag}[@${attr}=${escapeXPath(val)}]`;
      if (xpathMatchesElement(xpath, el)) return xpath;
    }

    // 3. Distinctive trimmed text — short, single-line text often produces
    // the shortest reliable locator (e.g. breadcrumb leaf labels).
    const text = (el.textContent || "").trim();
    if (text && text.length <= 60 && !/[\n\t]/.test(text)) {
      const byText = `//${tag}[normalize-space()=${escapeXPath(text)}]`;
      if (xpathMatchesElement(byText, el)) return byText;
    }

    // 4. Anchor at nearest stable-ID ancestor, then descend with the cheapest
    // discriminator (single class, distinctive text, or indexed tag).
    const anchored = buildAnchoredXPath(el);
    if (anchored) return anchored;

    // 5. Hierarchical XPath fallback.
    return buildOptimizedXPath(el);
  }

  function buildAnchoredXPath(el) {
    let anchor = el.parentElement;
    while (anchor && !hasStableId(anchor)) anchor = anchor.parentElement;
    if (!anchor) return null;

    const anchorXP = `//*[@id='${anchor.id}']`;
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList || []).filter(
      (c) => !shouldIgnoreClass(c)
    );

    const candidates = [];
    for (const cls of classes) {
      candidates.push(
        `${anchorXP}//${tag}[contains(@class, ${escapeXPath(cls)})]`
      );
    }
    const text = (el.textContent || "").trim();
    if (text && text.length <= 60 && !/[\n\t]/.test(text)) {
      candidates.push(
        `${anchorXP}//${tag}[normalize-space()=${escapeXPath(text)}]`
      );
    }

    candidates.sort((a, b) => a.length - b.length);
    for (const xp of candidates) {
      if (xp.length > XPATH_MAX_LEN) continue;
      if (xpathMatchesElement(xp, el)) return xp;
    }

    // Last-resort indexed descendant tag under the anchor.
    const xpAll = `${anchorXP}//${tag}`;
    try {
      const all = document.evaluate(
        xpAll,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      for (let i = 0; i < all.snapshotLength; i++) {
        if (all.snapshotItem(i) === el) {
          const indexed = `(${xpAll})[${i + 1}]`;
          return indexed.length <= XPATH_MAX_LEN ? indexed : null;
        }
      }
    } catch {}
    return null;
  }

  function buildOptimizedXPath(el) {
    if (!el || el.nodeType !== 1) return "";

    // Short circuit only if a STABLE ID acts as anchor
    if (hasStableId(el)) {
      const idPath = `//*[@id='${el.id}']`;
      return indexIfNeeded(idPath, el);
    }

    const parts = [];
    let current = el;

    while (current && current.nodeType === 1) {
      if (hasStableId(current)) {
        parts.unshift(`*[@id='${current.id}']`);
        // If we hit a stable ID, we can stop and make it relative
        const fullPath = "//" + parts.join("/");
        return indexIfNeeded(fullPath, el);
      }

      let segment = current.tagName.toLowerCase();

      // Add index if needed
      // Check previous siblings of same tag
      let prevIndex = 0;
      let sib = current.previousElementSibling;
      while (sib) {
        if (sib.tagName === current.tagName) prevIndex++;
        sib = sib.previousElementSibling;
      }

      // Check next siblings to see if index 1 is implicitly needed vs just "tag"
      // If there are ANY siblings of same tag, we should probably add index for stability
      let hasSiblings = prevIndex > 0;
      if (!hasSiblings) {
        let next = current.nextElementSibling;
        while (next) {
          if (next.tagName === current.tagName) { hasSiblings = true; break; }
          next = next.nextElementSibling;
        }
      }

      if (hasSiblings) {
        segment += `[${prevIndex + 1}]`;
      }

      parts.unshift(segment);
      if (current.tagName.toLowerCase() === 'html') {
        return "/" + parts.join("/"); // Reached root, make absolute
      }
      current = current.parentNode;
    }

    return "//" + parts.join("/");
  }

  function absoluteXPath(el) {
    const segs = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      let tag = cur.tagName.toLowerCase();
      let index = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName.toLowerCase() === tag) index++;
        sib = sib.previousElementSibling;
      }
      segs.unshift(`${tag}[${index}]`);
      cur = cur.parentNode;
    }
    return '/' + segs.join('/');
  }

  function getXpathByText(el) {
    const text = el.innerText || el.textContent;
    // Don't use text matching for very long text
    if (!text || text.length > 60 || !text.trim()) return null;

    const trimmed = text.trim();
    const xpath = `//${el.tagName.toLowerCase()}[text()=${escapeXPath(trimmed)}]`;

    // Validate it finds the element
    return indexIfNeeded(xpath, el);
  }

  function getLinkTextXPaths(el) {
    if (el.tagName.toLowerCase() !== 'a') return { link: null, partial: null };

    const text = el.innerText || el.textContent;
    if (!text || !text.trim()) return { link: null, partial: null };

    const trimmed = text.trim();
    const linkXpath = `//a[text()=${escapeXPath(trimmed)}]`;

    // For partial, allow slightly longer text, but slice it
    const partialText = trimmed.length > 20 ? trimmed.substring(0, 20) : trimmed;
    const partialXpath = `//a[contains(text(), ${escapeXPath(partialText)})]`;

    return {
      link: indexIfNeeded(linkXpath, el),
      partial: indexIfNeeded(partialXpath, el)
    };
  }

  function getXpathByClassName(el) {
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList || []).filter(
      (c) => !shouldIgnoreClass(c)
    );
    if (!classes.length) return null;

    // Try each single class with `contains(@class, ...)` — picks the shortest
    // unique form. Prefer non-indexed; fall back to indexed if necessary.
    let indexedFallback = null;
    for (const cls of classes) {
      const xp = `//${tag}[contains(@class, ${escapeXPath(cls)})]`;
      if (xpathMatchesElement(xp, el)) return xp;
      if (indexedFallback) continue;
      try {
        const all = document.evaluate(
          xp,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        for (let i = 0; i < all.snapshotLength; i++) {
          if (all.snapshotItem(i) === el) {
            const indexed = `(${xp})[${i + 1}]`;
            if (indexed.length <= XPATH_MAX_LEN) indexedFallback = indexed;
            break;
          }
        }
      } catch {}
    }
    return indexedFallback;
  }

  function getXpathByTagName(el) {
    const tag = el.tagName.toLowerCase();
    const xpath = `//${tag}`;
    try {
      const matches = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      ).snapshotLength;
      // Only emit when it's actually a useful locator. A bare `//path` or
      // `//div` matching dozens of nodes is noise, so suppress it.
      if (matches === 1) return xpath;
    } catch {}
    return null;
  }

  /** -----------------------------------------------------
   * OUTPUT OBJ
   * -----------------------------------------------------*/

  const linkPaths = getLinkTextXPaths(element);

  // Pre-validate every selector-style field for correctness — must resolve
  // uniquely to the target element. Anything that fails becomes null so the
  // UI's `if (locators.foo)` guards hide it. Length is handled during
  // generation, not here, so a long-but-unique fallback is still shown.
  const xpathByTextValidated = validateXPath(getXpathByText(element), element);
  const xpathByLinkTextValidated = validateXPath(linkPaths.link, element);
  const xpathByPartialLinkTextValidated = validateXPath(linkPaths.partial, element);
  // For <a> elements, getXpathByText and linkPaths.link both emit
  // `//a[text()='X']`, so the panel renders two visually identical rows.
  // Drop the generic xpathByText when it collides with the link-text form.
  const xpathByTextOut =
    xpathByLinkTextValidated && xpathByLinkTextValidated === xpathByTextValidated
      ? null
      : xpathByTextValidated;

  const result = {
    cssSelector: validateCss(getCssSelector(element), element),
    absoluteXPath: validateXPath(absoluteXPath(element), element),
    relativeXPath: validateXPath(getRelativeXPath(element), element),
    xpathByText: xpathByTextOut,
    xpathByLinkText: xpathByLinkTextValidated,
    xpathByPartialLinkText: xpathByPartialLinkTextValidated,

    xpathByClassName: validateXPath(getXpathByClassName(element), element),
    xpathByTagName: validateXPath(getXpathByTagName(element), element),

    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    className: element.className || null,
    name: element.getAttribute("name") || null,
    dataTestId:
      element.getAttribute("data-testid") ||
      element.getAttribute("data-test-id") ||
      null,
    ariaLabel: element.getAttribute("aria-label") || null,
    role: element.getAttribute("role") || null,
    // Keep internal text values for reference if needed, but not primary locators
    linkText: element.innerText || null,
    partialLinkText: element.innerText
      ? element.innerText.slice(0, 15) + "..."
      : null,
    escalatedFrom,
  };

  if (typeof window.sendLifecycleEvent === "function") {
    window.sendLifecycleEvent("generation_completed", {
      generatedLocators: result,
      element: elementForLog,
    });
  }

  return result;
};