// Check if already injected to prevent duplicate execution
if (window.seleniumLocatorHelperInjected) {
    console.log('Selenium Locator Helper already injected');
} else {
    window.seleniumLocatorHelperInjected = true;
    console.log("Selenium Locator Helper content script loaded");

    // Main functionality wrapped in an IIFE to prevent global scope pollution
    (function () {
        let isLocatorModeActive = false;
        let highlightedElement = null;
        let hoveredElement = null;
        let contextCheckInterval = null;

        // Wrapper for sending messages with error handling
        function sendMessageToBackground(message, callback) {
            try {
                if (!chrome.runtime?.id) {
                    console.error('Extension context invalidated - cannot send message');
                    deactivateLocatorMode();
                    return;
                }

                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('Message sending error:', chrome.runtime.lastError.message);
                        deactivateLocatorMode();
                        if (callback) callback(null, chrome.runtime.lastError);
                        return;
                    }
                    if (callback) callback(response);
                });
            } catch (error) {
                console.error('Error in sendMessageToBackground:', error);
                deactivateLocatorMode();
                if (callback) callback(null, error);
            }
        }

        // Function to generate all possible locators for an element
        function generateLocators(element) {
            if (!element || !element.tagName) return {};

            // Generate CSS selector
            function getCssSelector(el) {
                if (!el || el === document.documentElement) return '';
                if (el.id) return `#${el.id}`;

                let path = [];
                while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.documentElement) {
                    let selector = el.nodeName.toLowerCase();

                    if (el.id) {
                        path.unshift(`#${el.id}`);
                        break;
                    } else {
                        if (el.parentNode && el.parentNode.children) {
                            let siblings = Array.from(el.parentNode.children);
                            let index = siblings.indexOf(el) + 1;

                            let sameTagSiblings = siblings.filter(s => s.tagName === el.tagName);
                            if (sameTagSiblings.length > 1) {
                                selector += `:nth-child(${index})`;
                            }
                        }
                    }

                    path.unshift(selector);
                    el = el.parentNode;
                }
                return path.join(' > ');
            }

            // Generate absolute XPath
            function getAbsoluteXPath(el) {
                if (!el || el.nodeType !== 1) return '';
                let segs = [];
                for (; el && el.nodeType === 1; el = el.parentNode) {
                    let i = 1;
                    for (let sib = el.previousSibling; sib; sib = sib.previousSibling) {
                        if (sib.nodeType === 1 && sib.nodeName === el.nodeName) i++;
                    }
                    segs.unshift(`${el.nodeName.toLowerCase()}[${i}]`);
                }
                return segs.length ? `/${segs.join('/')}` : '';
            }

            // Generate relative XPath
            function getRelativeXPath(el) {
                if (!el || el.nodeType !== 1) return '';
                let path = [];
                while (el && el.nodeType === 1 && el !== document.body) {
                    let selector = el.nodeName.toLowerCase();
                    if (el.id) {
                        path.unshift(`//*[@id="${el.id}"]`);
                        break;
                    } else {
                        let siblings = Array.from(el.parentNode.children);
                        let index = siblings.indexOf(el) + 1;
                        selector += `[${index}]`;
                    }
                    path.unshift(selector);
                    el = el.parentNode;
                }
                return path.length ? `/${path.join('/')}` : '';
            }

            // Generate XPath by text
            function getXPathByText(el) {
                if (!el || !el.textContent.trim()) return '';
                return `//*[text()='${el.textContent.trim()}']`;
            }

            // Generate partial text XPath
            function getPartialTextXPath(el) {
                if (!el || !el.textContent.trim()) return '';
                return `//*[contains(text(), '${el.textContent.trim()}')]`;
            }

            // Generate all possible XPaths
            function getAllXPaths(el) {
                if (!el) return [];

                const paths = [];

                if (el.id) {
                    paths.push(`//*[@id="${el.id}"]`);
                }

                if (el.className && typeof el.className === 'string') {
                    const classes = el.className.trim().split(/\s+/);
                    for (const cls of classes) {
                        if (cls) paths.push(`//${el.tagName.toLowerCase()}[contains(@class, '${cls}')]`);
                    }
                }

                if (el.getAttribute('name')) {
                    paths.push(`//${el.tagName.toLowerCase()}[@name='${el.getAttribute('name')}']`);
                }

                const tag = el.tagName.toLowerCase();
                const attributes = ['type', 'value', 'title', 'alt', 'placeholder', 'href', 'src'];
                for (const attr of attributes) {
                    const value = el.getAttribute(attr);
                    if (value) {
                        paths.push(`//${tag}[@${attr}='${value}']`);
                    }
                }

                // Generate accurate indexed XPath
                function getIndexedXPath(el) {
                    if (!el || el.nodeType !== 1) return '';
                    let segs = [];
                    for (; el && el.nodeType === 1; el = el.parentNode) {
                        let i = 1;
                        for (let sib = el.previousSibling; sib; sib = sib.previousSibling) {
                            if (sib.nodeType === 1 && sib.nodeName === el.nodeName) i++;
                        }
                        const siblings = Array.from(el.parentNode?.children || []).filter(s => s.nodeName === el.nodeName);
                        const needsIndex = siblings.length > 1;
                        segs.unshift(needsIndex ? `${el.nodeName.toLowerCase()}[${i}]` : el.nodeName.toLowerCase());
                    }
                    return segs.length ? `/${segs.join('/')}` : '';
                }

                paths.push(getIndexedXPath(el));
                paths.push(getAbsoluteXPath(el));
                paths.push(getRelativeXPath(el));
                paths.push(getXPathByText(el));
                paths.push(getPartialTextXPath(el));

                return [...new Set(paths)];
            }

            return {
                cssSelector: getCssSelector(element),
                absoluteXPath: getAbsoluteXPath(element),
                relativeXPath: getRelativeXPath(element),
                xpathByText: getXPathByText(element),
                partialTextXPath: getPartialTextXPath(element),
                allXPaths: getAllXPaths(element),
                tagName: element.tagName.toLowerCase(),
                id: element.id || null,
                className: element.className || null,
                name: element.getAttribute('name') || null,
                linkText: element.innerText || null,
                partialLinkText: element.innerText ? element.innerText.substring(0, 10) : null
            };
        }

        // Highlight element with a border
        function highlightElement(element) {
            if (!element || !element.style) return;

            if (highlightedElement) {
                highlightedElement.style.outline = '';
                highlightedElement.style.outlineOffset = '';
            }

            element.style.outline = '2px solid #4285F4';
            element.style.outlineOffset = '2px';
            highlightedElement = element;
        }

        // Remove highlight from element
        function removeHighlight() {
            if (highlightedElement && highlightedElement.style) {
                highlightedElement.style.outline = '';
                highlightedElement.style.outlineOffset = '';
                highlightedElement = null;
            }
        }

        // Handle mouseover events in locator mode
        function handleMouseOver(event) {
            if (!isLocatorModeActive) return;

            event.stopPropagation();
            event.preventDefault();

            hoveredElement = event.target;
            highlightElement(hoveredElement);

            const locators = generateLocators(hoveredElement);
            sendMessageToBackground({
                action: 'getLocators',
                locators: locators
            });
        }

        // Handle click events in locator mode
        function handleClick(event) {
            if (!isLocatorModeActive) return;

            event.stopPropagation();
            event.preventDefault();

            const clickedElement = event.target;
            const locators = generateLocators(clickedElement);

            sendMessageToBackground({
                action: 'saveLocator',
                locators: locators,
                url: window.location.href,
                timestamp: new Date().toISOString()
            });

            deactivateLocatorMode();
        }

        // Activate locator mode
        function activateLocatorMode() {
            if (isLocatorModeActive) return;

            console.log("Activating locator mode");
            isLocatorModeActive = true;
            document.addEventListener('mouseover', handleMouseOver, true);
            document.addEventListener('click', handleClick, true);
            document.body.style.cursor = 'crosshair';

            // Start context validity checks
            if (!contextCheckInterval) {
                contextCheckInterval = setInterval(checkContextValidity, 5000);
            }
        }

        // Deactivate locator mode
        function deactivateLocatorMode() {
            if (!isLocatorModeActive) return;

            console.log("Deactivating locator mode");
            isLocatorModeActive = false;
            document.removeEventListener('mouseover', handleMouseOver, true);
            document.removeEventListener('click', handleClick, true);
            document.body.style.cursor = '';
            removeHighlight();
            hoveredElement = null;

            // Clear context check interval
            if (contextCheckInterval) {
                clearInterval(contextCheckInterval);
                contextCheckInterval = null;
            }

            sendMessageToBackground({
                action: 'locatorModeDeactivated'
            });
        }

        // Check if extension context is still valid
        function checkContextValidity() {
            try {
                if (!chrome.runtime?.id) {
                    console.error('Extension context invalidated');
                    deactivateLocatorMode();
                    return;
                }

                // Simple ping to check if background is responsive
                sendMessageToBackground({ action: 'ping' }, (response, error) => {
                    if (error) {
                        console.error('Context check failed:', error);
                        deactivateLocatorMode();
                    }
                });
            } catch (error) {
                console.error('Error in context check:', error);
                deactivateLocatorMode();
            }
        }

        // Message listener with error handling
        function setupMessageListener() {
            try {
                chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
                    if (!chrome.runtime?.id) {
                        console.error('Extension context invalidated in listener');
                        deactivateLocatorMode();
                        return;
                    }

                    console.log("Content script received message:", request);

                    if (request.action === 'activateLocatorMode') {
                        if (request.isActive) {
                            activateLocatorMode();
                        } else {
                            deactivateLocatorMode();
                        }
                    }

                    return true;
                });
            } catch (error) {
                console.error('Failed to setup message listener:', error);
            }
        }

        // Initialize the content script
        function initialize() {
            try {
                setupMessageListener();
                checkContextValidity();

                sendMessageToBackground({
                    action: 'contentScriptReady',
                    url: window.location.href
                });

                console.log("Content script initialized successfully");
            } catch (error) {
                console.error("Content script initialization failed:", error);
            }
        }

        // Start the content script
        initialize();
    })();
}