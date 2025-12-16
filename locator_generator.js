window.generateLocators = function generateLocators(element) {
  if (!element || element.nodeType !== 1) return {};

  /** -----------------------------------------------------
   * Utilities
   * -----------------------------------------------------*/

  const escape = (str) => CSS.escape(str);

  const isUnique = (selector) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };

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

  const shouldIgnoreClass = (cls) =>
    /(^$|^ng-|^css-|^chakra-|^Mui|^ant-|^sc-|^[\d\-_]+$)/.test(cls);

  /** -----------------------------------------------------
   * CSS SELECTOR GENERATION
   * -----------------------------------------------------*/

  function getCssSelector(el) {
    // 1. ID
    if (el.id && isUnique(`#${escape(el.id)}`)) {
      return `#${escape(el.id)}`;
    }

    // 2. Unique Tag Name
    if (isUnique(el.tagName.toLowerCase())) {
      return el.tagName.toLowerCase();
    }

    // 3. Stable Attributes
    for (const attr of stableAttributes) {
      const val = el.getAttribute(attr);
      if (val) {
        const selector = `[${attr}="${escape(val)}"]`;
        if (isUnique(selector)) return selector;
        const tagSelector = `${el.tagName.toLowerCase()}${selector}`;
        if (isUnique(tagSelector)) return tagSelector;
      }
    }

    // 4. Other Data Attributes
    for (const attr of Array.from(el.attributes)) {
      if (
        attr.name.startsWith("data-") &&
        !stableAttributes.includes(attr.name)
      ) {
        const selector = `[${attr.name}="${escape(attr.value)}"]`;
        if (isUnique(selector)) return selector;
      }
    }

    // 5. Class List (Single or Combinations)
    const classes = Array.from(el.classList || []).filter(
      (cls) => !shouldIgnoreClass(cls)
    );

    if (classes.length > 0) {
      // Try single class + tag
      for (const cls of classes) {
        const selector = `${el.tagName.toLowerCase()}.${escape(cls)}`;
        if (isUnique(selector)) return selector;
      }

      // Try multiple classes if single didn't work
      if (classes.length > 1) {
        const classSelector = classes.map((c) => `.${escape(c)}`).join("");
        const fullClassSelector = `${el.tagName.toLowerCase()}${classSelector}`;
        if (isUnique(fullClassSelector)) return fullClassSelector;
      }
    }

    // 6. Optimized DOM Path (stops at ID or unique parent)
    return buildOptimizedDomPath(el);
  }

  function buildOptimizedDomPath(el) {
    const path = [];
    let current = el;

    while (current && current.nodeType === 1) {
      // If we hit an ID, use it as anchor
      if (current.id) {
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
    // 1. Unique ID
    if (el.id && isUnique(`#${escape(el.id)}`)) {
      return `//*[@id='${el.id}']`;
    }

    // 2. Unique Attribute
    for (const attr of stableAttributes) {
      const val = el.getAttribute(attr);
      if (val) {
        const xpath = `//${el.tagName.toLowerCase()}[@${attr}=${escapeXPath(val)}]`;
        if (indexIfNeeded(xpath, el) === xpath) return xpath;
      }
    }

    // 3. Hierarchical XPath
    return buildOptimizedXPath(el);
  }

  function buildOptimizedXPath(el) {
    if (!el || el.nodeType !== 1) return "";

    // Short circuit if ID acts as anchor
    if (el.id) {
      // Even if not unique globally, it acts as a strong start point
      // We handle global uniqueness check outside or via index
      const idPath = `//*[@id='${el.id}']`;
      return indexIfNeeded(idPath, el);
    }

    const parts = [];
    let current = el;

    while (current && current.nodeType === 1) {
      if (current.id) {
        parts.unshift(`*[@id='${current.id}']`);
        // If we hit an ID, we can stop and make it relative
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
    if (!el.className || typeof el.className !== 'string') return null;
    const xpath = `//${el.tagName.toLowerCase()}[@class=${escapeXPath(el.className)}]`;
    return indexIfNeeded(xpath, el);
  }

  function getXpathByTagName(el) {
    const xpath = `//${el.tagName.toLowerCase()}`;
    return indexIfNeeded(xpath, el);
  }

  /** -----------------------------------------------------
   * OUTPUT OBJ
   * -----------------------------------------------------*/

  const linkPaths = getLinkTextXPaths(element);

  return {
    cssSelector: getCssSelector(element),
    absoluteXPath: absoluteXPath(element),
    relativeXPath: getRelativeXPath(element),
    xpathByText: getXpathByText(element),
    // New fields demanded by user
    xpathByLinkText: linkPaths.link,
    xpathByPartialLinkText: linkPaths.partial,

    xpathByClassName: getXpathByClassName(element),
    xpathByTagName: getXpathByTagName(element),

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
  };
};