// Locator generation logic extracted from content.js

window.generateLocators = function generateLocators(element) {
    if (!element || !element.tagName) return {};

    function getCssSelector(el) {
        if (!el || el === document.documentElement) return "";

        if (el.id) {
            return `#${CSS.escape(el.id)}`;
        }

        const testId =
            el.getAttribute("data-testid") || el.getAttribute("data-test-id");
        if (testId) {
            const selector = `[data-testid="${CSS.escape(testId)}"]`;
            if (isUnique(selector)) return selector;
        }

        const uniqueAttrSelector = getUniqueAttributeSelector(el);
        if (uniqueAttrSelector) return uniqueAttrSelector;

        const classSelector = getUniqueClassSelector(el);
        if (classSelector) return classSelector;

        return buildPath(el);
    }

    function isUnique(selector) {
        try {
            return document.querySelectorAll(selector).length === 1;
        } catch (e) {
            return false;
        }
    }

    function getUniqueAttributeSelector(el) {
        const priorityAttrs = [
            "name",
            "aria-label",
            "title",
            "role",
            "placeholder",
            "data-*",
            "id",
            "class",
            "type",
            "value",
            "href",
            "src",
            "alt",
        ];

        const dataAttrs = Array.from(el.attributes).filter((attr) =>
            attr.name.startsWith("data-")
        );

        for (const attr of dataAttrs) {
            const value = attr.value.trim();
            if (value) {
                const selector = `${el.tagName.toLowerCase()}[${attr.name}=${JSON.stringify(value)}]`;
                if (isUnique(selector)) return selector;
            }
        }

        for (const attr of el.attributes) {
            if (
                priorityAttrs.some((pa) =>
                    pa === "*" ? attr.name.startsWith("data-") : attr.name === pa
                )
            ) {
                const value = attr.value.trim();
                if (value) {
                    const selector = `${el.tagName.toLowerCase()}[${attr.name}=${JSON.stringify(value)}]`;
                    if (isUnique(selector)) return selector;

                    const selectorI = `${el.tagName.toLowerCase()}[${attr.name}=${JSON.stringify(value)} i]`;
                    if (isUnique(selectorI)) return selectorI;

                    if (value.length > 10) {
                        const partialValue = value.substring(0, 10);
                        const containsSelector = `${el.tagName.toLowerCase()}[${attr.name}*=${JSON.stringify(partialValue)}]`;
                        if (isUnique(containsSelector)) return containsSelector;
                    }
                }
            }
        }

        const validAttrs = Array.from(el.attributes)
            .filter((attr) => attr.value && attr.value.trim())
            .slice(0, 3);

        for (let i = 0; i < validAttrs.length - 1; i++) {
            for (let j = i + 1; j < validAttrs.length; j++) {
                const selector = `${el.tagName.toLowerCase()}[${validAttrs[i].name}=${JSON.stringify(validAttrs[i].value.trim())}][${validAttrs[j].name}=${JSON.stringify(validAttrs[j].value.trim())}]`;
                if (isUnique(selector)) return selector;
            }
        }

        return null;
    }

    function getUniqueClassSelector(el) {
        if (!el.className || typeof el.className !== "string") return null;

        const classes = el.className.trim().split(/\s+/);
        if (!classes.length) return null;

        for (const className of classes) {
            const selector = `${el.tagName.toLowerCase()}.${CSS.escape(className)}`;
            if (isUnique(selector)) return selector;
        }

        for (let i = 0; i < classes.length - 1; i++) {
            for (let j = i + 1; j < classes.length; j++) {
                const selector = `${el.tagName.toLowerCase()}.${CSS.escape(classes[i])}.${CSS.escape(classes[j])}`;
                if (isUnique(selector)) return selector;
            }
        }

        return null;
    }

    function buildPath(el) {
        const path = [];
        let current = el;

        while (current && current !== document.documentElement) {
            let selector = current.tagName.toLowerCase();

            const parent = current.parentNode;
            if (parent) {
                const siblings = Array.from(parent.children);
                const sameTagSiblings = siblings.filter(
                    (el) => el.tagName === current.tagName
                );

                if (sameTagSiblings.length > 1) {
                    const index = siblings.indexOf(current) + 1;
                    selector += `:nth-child(${index})`;
                }
            }

            path.unshift(selector);

            const fullPath = path.join(" > ");
            if (isUnique(fullPath)) return fullPath;

            current = current.parentNode;
        }

        return path.join(" > ");
    }

    function getAbsoluteXPath(el) {
        if (!el || el.nodeType !== 1) return "";
        let segs = [];
        for (; el && el.nodeType === 1; el = el.parentNode) {
            let i = 1;
            for (let sib = el.previousSibling; sib; sib = sib.previousSibling) {
                if (sib.nodeType === 1 && sib.nodeName === el.nodeName) i++;
            }
            segs.unshift(`${el.nodeName.toLowerCase()}[${i}]`);
        }
        return segs.length ? `/${segs.join("/")}` : "";
    }

    function getRelativeXPath(el) {
        if (!el || el.nodeType !== 1) return "";

        if (el.id) {
            return `//*[@id="${el.id}"]`;
        }

        let path = [];
        let current = el;

        while (current && current !== document.documentElement) {
            let currentTag = current.tagName.toLowerCase();
            let index = 1;
            let sibling = current;

            while ((sibling = sibling.previousElementSibling)) {
                if (sibling.tagName.toLowerCase() === currentTag) {
                    index++;
                }
            }

            let uniqueIdentifier = "";

            const attributes = [
                "data-testid",
                "name",
                "aria-label",
                "title",
                "placeholder",
                "role",
            ];
            for (const attr of attributes) {
                const value = current.getAttribute(attr);
                if (value) {
                    uniqueIdentifier = `[@${attr}="${value}"]`;
                    index = null;
                    break;
                }
            }

            if (
                !uniqueIdentifier &&
                current.className &&
                typeof current.className === "string"
            ) {
                const classes = current.className.trim().split(/\s+/);
                if (classes.length) {
                    uniqueIdentifier = `[contains(@class, "${classes[0]}")]`;
                }
            }

            let pathSegment =
                currentTag + (uniqueIdentifier || (index > 1 ? `[${index}]` : ""));
            path.unshift(pathSegment);

            const testPath = "//" + path.join("/");
            const results = document.evaluate(
                testPath,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );

            if (results.snapshotLength === 1) {
                return testPath;
            }

            current = current.parentElement;
        }

        return "//" + path.join("/");
    }

    function getXPathByText(el) {
        const text = el?.textContent?.trim();
        if (!el || !text) return "";

        let xpathText;
        if (text.includes('"') && text.includes("'")) {
            const parts = text
                .split('"')
                .map((part) => `concat("${part}", '"')`)
                .join(",");
            xpathText = `//*[text()=${parts}]`;
        } else if (text.includes('"')) {
            xpathText = `//*[text()='${text}']`;
        } else {
            xpathText = `//*[text()="${text}"]`;
        }

        const matchingElements = document.evaluate(
            xpathText,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
        );
        if (matchingElements.snapshotLength > 1) {
            let elementIndex = -1;
            for (let i = 0; i < matchingElements.snapshotLength; i++) {
                if (matchingElements.snapshotItem(i) === el) {
                    elementIndex = i + 1;
                    break;
                }
            }
            if (elementIndex > 0) {
                xpathText = `(${xpathText})[${elementIndex}]`;
            }
        }

        return xpathText;
    }

    function getPartialTextXPath(el) {
        const text = el?.textContent?.trim();
        if (!el || !text) return "";

        const cleanText = text.replace(/\s+/g, " ");
        const partialText =
            cleanText.length > 20 ? cleanText.substring(0, 20) : cleanText;

        let xpathText;
        if (partialText.includes('"') && partialText.includes("'")) {
            const parts = partialText
                .split('"')
                .map((part) => `concat("${part}", '"')`)
                .join(",");
            xpathText = `//${el.nodeName.toLowerCase()}[contains(text(), ${parts})]`;
        } else if (partialText.includes('"')) {
            xpathText = `//${el.nodeName.toLowerCase()}[contains(text(), '${partialText}')]`;
        } else {
            xpathText = `//${el.nodeName.toLowerCase()}[contains(text(), "${partialText}")]`;
        }

        const matchingElements = document.evaluate(
            xpathText,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
        );
        if (matchingElements.snapshotLength > 1) {
            let elementIndex = -1;
            for (let i = 0; i < matchingElements.snapshotLength; i++) {
                if (matchingElements.snapshotItem(i) === el) {
                    elementIndex = i + 1;
                    break;
                }
            }
            if (elementIndex > 0) {
                xpathText = `(${xpathText})[${elementIndex}]`;
            }
        }

        return xpathText;
    }

    function getXPathByName(el) {
        const name = el?.getAttribute("name");
        if (!el || !name) return "";

        const xpath = `//${el.nodeName.toLowerCase()}[@name="${name}"]`;

        const matchingElements = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
        );

        if (matchingElements.snapshotLength > 1) {
            let elementIndex = -1;
            for (let i = 0; i < matchingElements.snapshotLength; i++) {
                if (matchingElements.snapshotItem(i) === el) {
                    elementIndex = i + 1;
                    break;
                }
            }
            if (elementIndex > 0) {
                return `(${xpath})[${elementIndex}]`;
            }
        }

        return xpath;
    }

    function getXPathByLinkText(el) {
        if (!el || el.nodeName.toLowerCase() !== "a") return "";
        const text = el.textContent?.trim();
        if (!text) return "";

        let xpathText;
        if (text.includes('"') && text.includes("'")) {
            const parts = text
                .split('"')
                .map((part) => `concat("${part}", '"')`)
                .join(",");
            xpathText = `//a[text()=${parts}]`;
        } else if (text.includes('"')) {
            xpathText = `//a[text()='${text}']`;
        } else {
            xpathText = `//a[text()="${text}"]`;
        }

        const matchingElements = document.evaluate(
            xpathText,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
        );

        if (matchingElements.snapshotLength > 1) {
            let elementIndex = -1;
            for (let i = 0; i < matchingElements.snapshotLength; i++) {
                if (matchingElements.snapshotItem(i) === el) {
                    elementIndex = i + 1;
                    break;
                }
            }
            if (elementIndex > 0) {
                return `(${xpathText})[${elementIndex}]`;
            }
        }

        return xpathText;
    }

    function getXPathByPartialLinkText(el) {
        if (!el || el.nodeName.toLowerCase() !== "a") return "";
        const text = el.textContent?.trim();
        if (!text) return "";

        const partialText = text.length > 15 ? text.substring(0, 15) : text;

        let xpathText;
        if (partialText.includes('"') && partialText.includes("'")) {
            const parts = partialText
                .split('"')
                .map((part) => `concat("${part}", '"')`)
                .join(",");
            xpathText = `//a[contains(text(), ${parts})]`;
        } else if (partialText.includes('"')) {
            xpathText = `//a[contains(text(), '${partialText}')]`;
        } else {
            xpathText = `//a[contains(text(), "${partialText}")]`;
        }

        const matchingElements = document.evaluate(
            xpathText,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
        );

        if (matchingElements.snapshotLength > 1) {
            let elementIndex = -1;
            for (let i = 0; i < matchingElements.snapshotLength; i++) {
                if (matchingElements.snapshotItem(i) === el) {
                    elementIndex = i + 1;
                    break;
                }
            }
            if (elementIndex > 0) {
                return `(${xpathText})[${elementIndex}]`;
            }
        }

        return xpathText;
    }

    function getAllXPaths(el) {
        if (!el) return [];

        const paths = [];
        const tag = el.tagName.toLowerCase();

        if (el.id) {
            paths.push(`//*[@id="${el.id}"]`);
            paths.push(`//${tag}[@id="${el.id}"]`);
        }

        if (el.className && typeof el.className === "string") {
            const classes = el.className.trim().split(/\s+/).filter(Boolean);
            if (classes.length) {
                for (const cls of classes) {
                    const xpath = `//${tag}[contains(@class, "${cls}")]`;
                    const matchingElements = document.evaluate(
                        xpath,
                        document,
                        null,
                        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                        null
                    );
                    if (matchingElements.snapshotLength > 1) {
                        let elementIndex = -1;
                        for (let i = 0; i < matchingElements.snapshotLength; i++) {
                            if (matchingElements.snapshotItem(i) === el) {
                                elementIndex = i + 1;
                                break;
                            }
                        }
                        if (elementIndex > 0) {
                            paths.push(`(${xpath})[${elementIndex}]`);
                        }
                    } else {
                        paths.push(xpath);
                    }
                }

                if (classes.length > 1) {
                    const classXpath = classes
                        .map((c) => `contains(@class, "${c}")`)
                        .join(" and ");
                    const xpath = `//${tag}[${classXpath}]`;
                    const matchingElements = document.evaluate(
                        xpath,
                        document,
                        null,
                        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                        null
                    );
                    if (matchingElements.snapshotLength > 1) {
                        let elementIndex = -1;
                        for (let i = 0; i < matchingElements.snapshotLength; i++) {
                            if (matchingElements.snapshotItem(i) === el) {
                                elementIndex = i + 1;
                                break;
                            }
                        }
                        if (elementIndex > 0) {
                            paths.push(`(${xpath})[${elementIndex}]`);
                        }
                    } else {
                        paths.push(xpath);
                    }
                }
            }
        }

        const attributes = [
            "name",
            "data-testid",
            "data-test",
            "data-automation",
            "type",
            "value",
            "title",
            "alt",
            "placeholder",
            "href",
            "src",
            "for",
            "aria-label",
            "role",
        ];

        for (const attr of attributes) {
            const value = el.getAttribute(attr);
            if (value) {
                const xpath = `//${tag}[@${attr}="${value}"]`;
                const matchingElements = document.evaluate(
                    xpath,
                    document,
                    null,
                    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                    null
                );
                if (matchingElements.snapshotLength > 1) {
                    let elementIndex = -1;
                    for (let i = 0; i < matchingElements.snapshotLength; i++) {
                        if (matchingElements.snapshotItem(i) === el) {
                            elementIndex = i + 1;
                            break;
                        }
                    }
                    if (elementIndex > 0) {
                        paths.push(`(${xpath})[${elementIndex}]`);
                    }
                } else {
                    paths.push(xpath);
                }

                if (value.length > 20) {
                    const partialXpath = `//${tag}[contains(@${attr}, "${value.substring(
                        0,
                        20
                    )}")]`;
                    const matchingElements = document.evaluate(
                        partialXpath,
                        document,
                        null,
                        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                        null
                    );
                    if (matchingElements.snapshotLength > 1) {
                        let elementIndex = -1;
                        for (let i = 0; i < matchingElements.snapshotLength; i++) {
                            if (matchingElements.snapshotItem(i) === el) {
                                elementIndex = i + 1;
                                break;
                            }
                        }
                        if (elementIndex > 0) {
                            paths.push(`(${partialXpath})[${elementIndex}]`);
                        }
                    } else {
                        paths.push(partialXpath);
                    }
                }
            }
        }

        const textContent = el.textContent.trim();
        if (textContent) {
            let textXpath;
            if (textContent.includes('"') && textContent.includes("'")) {
                const parts = textContent
                    .split('"')
                    .map((part) => `concat("${part}", '"')`)
                    .join(",");
                textXpath = `//${tag}[text()=${parts}]`;
            } else if (textContent.includes('"')) {
                textXpath = `//${tag}[text()='${textContent}']`;
            } else {
                textXpath = `//${tag}[text()="${textContent}"]`;
            }

            const matchingElements = document.evaluate(
                textXpath,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );
            if (matchingElements.snapshotLength > 1) {
                let elementIndex = -1;
                for (let i = 0; i < matchingElements.snapshotLength; i++) {
                    if (matchingElements.snapshotItem(i) === el) {
                        elementIndex = i + 1;
                        break;
                    }
                }
                if (elementIndex > 0) {
                    paths.push(`(${textXpath})[${elementIndex}]`);
                }
            } else {
                paths.push(textXpath);
            }

            if (textContent.length > 20) {
                const partialText = textContent.substring(0, 20);
                let partialTextXpath;
                if (partialText.includes('"') && partialText.includes("'")) {
                    const parts = partialText
                        .split('"')
                        .map((part) => `concat("${part}", '"')`)
                        .join(",");
                    partialTextXpath = `//${tag}[contains(text(), ${parts})]`;
                } else if (partialText.includes('"')) {
                    partialTextXpath = `//${tag}[contains(text(), '${partialText}')]`;
                } else {
                    partialTextXpath = `//${tag}[contains(text(), "${partialText}")]`;
                }

                const matchingElements = document.evaluate(
                    partialTextXpath,
                    document,
                    null,
                    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                    null
                );
                if (matchingElements.snapshotLength > 1) {
                    let elementIndex = -1;
                    for (let i = 0; i < matchingElements.snapshotLength; i++) {
                        if (matchingElements.snapshotItem(i) === el) {
                            elementIndex = i + 1;
                            break;
                        }
                    }
                    if (elementIndex > 0) {
                        paths.push(`(${partialTextXpath})[${elementIndex}]`);
                    }
                } else {
                    paths.push(partialTextXpath);
                }
            }
        }

        paths.push(getIndexedXPath(el));
        paths.push(getAbsoluteXPath(el));
        paths.push(getRelativeXPath(el));

        const hybridAttributes = [];
        for (const attr of ["id", "name", "class", "type"]) {
            let value;
            if (attr === "class" && el.className) {
                value = el.className.trim().split(/\s+/)[0];
            } else {
                value = el.getAttribute(attr);
            }

            if (value) {
                hybridAttributes.push(`@${attr}="${value}"`);
            }
        }

        if (hybridAttributes.length > 1) {
            const hybridXpath = `//${tag}[${hybridAttributes.join(" and ")}]`;
            const matchingElements = document.evaluate(
                hybridXpath,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );
            if (matchingElements.snapshotLength > 1) {
                let elementIndex = -1;
                for (let i = 0; i < matchingElements.snapshotLength; i++) {
                    if (matchingElements.snapshotItem(i) === el) {
                        elementIndex = i + 1;
                        break;
                    }
                }
                if (elementIndex > 0) {
                    paths.push(`(${hybridXpath})[${elementIndex}]`);
                }
            } else {
                paths.push(hybridXpath);
            }
        }

        function getIndexedXPath(el) {
            if (!el || el.nodeType !== 1) return "";
            let segs = [];
            for (; el && el.nodeType === 1; el = el.parentNode) {
                if (el.id) {
                    segs.unshift(`//*[@id="${el.id}"]`);
                    break;
                }

                let i = 1;
                for (let sib = el.previousSibling; sib; sib = sib.previousSibling) {
                    if (sib.nodeType === 1 && sib.nodeName === el.nodeName) i++;
                }

                const siblings = Array.from(el.parentNode?.children || []).filter(
                    (s) => s.nodeName === el.nodeName
                );
                const needsIndex = siblings.length > 1;

                segs.unshift(
                    needsIndex
                        ? `${el.nodeName.toLowerCase()}[${i}]`
                        : el.nodeName.toLowerCase()
                );
            }

            return segs.length ? `/${segs.join("/")}` : "";
        }

        return [...new Set(paths.filter(Boolean))];
    }

    return {
        cssSelector: getCssSelector(element),
        absoluteXPath: getAbsoluteXPath(element),
        relativeXPath: getRelativeXPath(element),
        xpathByText: getXPathByText(element),
        partialTextXPath: getPartialTextXPath(element),
        xpathByName: getXPathByName(element),
        xpathByLinkText: getXPathByLinkText(element),
        xpathByPartialLinkText: getXPathByPartialLinkText(element),
        allXPaths: getAllXPaths(element),
        tagName: element.tagName.toLowerCase(),
        id: element.id || null,
        className: element.className || null,
        name: element.getAttribute("name") || null,
        linkText: element.innerText || null,
        partialLinkText: element.innerText
            ? element.innerText.length > 10
                ? element.innerText.substring(0, 10) + "..."
                : element.innerText
            : null,
        dataTestId:
            element.getAttribute("data-testid") ||
            element.getAttribute("data-test-id") ||
            null,
        ariaLabel: element.getAttribute("aria-label") || null,
        role: element.getAttribute("role") || null,
    };
};
