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

            // Generate CSS selector with improved specificity
            function getCssSelector(el) {
                if (!el || el === document.documentElement) return '';
                if (el.id) return `#${CSS.escape(el.id)}`;

                let path = [];
                while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.documentElement) {
                    let selector = el.nodeName.toLowerCase();

                    if (el.id) {
                        path.unshift(`#${CSS.escape(el.id)}`);
                        break;
                    } else {
                        // Add class information for better specificity
                        if (el.className && typeof el.className === 'string') {
                            const classes = el.className.trim().split(/\s+/).filter(Boolean);
                            if (classes.length) {
                                selector += classes.map(c => `.${CSS.escape(c)}`).join('');
                            }
                        }

                        // Add attributes for better uniqueness
                        const uniqueAttributes = ['name', 'data-testid', 'aria-label', 'role'];
                        for (const attr of uniqueAttributes) {
                            const value = el.getAttribute(attr);
                            if (value) {
                                selector += `[${attr}="${CSS.escape(value)}"]`;
                                break; // One unique attribute is enough
                            }
                        }

                        // Position among siblings for absolute precision
                        if (el.parentNode && el.parentNode.children) {
                            let siblings = Array.from(el.parentNode.children);
                            let index = siblings.indexOf(el) + 1;

                            // Only add nth-child if we haven't added more specific selectors
                            if (!selector.includes('[') && !selector.includes('.')) {
                                let sameTagSiblings = siblings.filter(s => s.tagName === el.tagName);
                                if (sameTagSiblings.length > 1) {
                                    selector += `:nth-child(${index})`;
                                }
                            }
                        }
                    }

                    path.unshift(selector);
                    el = el.parentNode;
                }
                return path.join(' > ');
            }

            // Generate absolute XPath with improved precision
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

            // Generate relative XPath with better consideration of unique attributes
            function getRelativeXPath(el) {
                if (!el || el.nodeType !== 1) return '';
                
                // If element has id, use that immediately
                if (el.id) {
                    return `//*[@id="${el.id}"]`;
                }
                
                const uniqueAttributes = ['data-testid', 'name', 'aria-label', 'role', 'title'];
                for (const attr of uniqueAttributes) {
                    const value = el.getAttribute(attr);
                    if (value) {
                        return `//${el.nodeName.toLowerCase()}[@${attr}="${value}"]`;
                    }
                }
                
                // If no unique attributes, build path
                let path = [];
                while (el && el.nodeType === 1 && el !== document.body) {
                    let selector = el.nodeName.toLowerCase();
                    
                    if (el.id) {
                        path.unshift(`//*[@id="${el.id}"]`);
                        break;
                    } else {
                        // Try to find unique attributes for this element
                        let foundUniqueAttr = false;
                        for (const attr of uniqueAttributes) {
                            const value = el.getAttribute(attr);
                            if (value) {
                                selector = `${el.nodeName.toLowerCase()}[@${attr}="${value}"]`;
                                foundUniqueAttr = true;
                                break;
                            }
                        }
                        
                        // If no unique attributes, use position
                        if (!foundUniqueAttr) {
                            let siblings = Array.from(el.parentNode.children);
                            let index = siblings.indexOf(el) + 1;
                            selector += `[${index}]`;
                        }
                    }
                    
                    path.unshift(selector);
                    el = el.parentNode;
                }
                
                return path.length ? `/${path.join('/')}` : '';
            }

            // Generate XPath by text with escaping for quotes
            function getXPathByText(el) {
                const text = el?.textContent?.trim();
                if (!el || !text) return '';
                
                // Handle quotes in text content by using concat() if needed
                if (text.includes('"') && text.includes("'")) {
                    const parts = text.split('"').map(part => `concat("${part}", '"')`).join(',');
                    return `//*[text()=${parts}]`;
                } else if (text.includes('"')) {
                    return `//*[text()='${text}']`;
                } else {
                    return `//*[text()="${text}"]`;
                }
            }

            // Generate partial text XPath with better text handling
            function getPartialTextXPath(el) {
                const text = el?.textContent?.trim();
                if (!el || !text) return '';
                
                // Use a meaningful substring, not just first 10 chars
                const cleanText = text.replace(/\s+/g, ' ');
                const partialText = cleanText.length > 20 ? 
                    cleanText.substring(0, 20) : cleanText;
                
                // Handle quotes in text appropriately
                if (partialText.includes('"') && partialText.includes("'")) {
                    const parts = partialText.split('"').map(part => `concat("${part}", '"')`).join(',');
                    return `//${el.nodeName.toLowerCase()}[contains(text(), ${parts})]`;
                } else if (partialText.includes('"')) {
                    return `//${el.nodeName.toLowerCase()}[contains(text(), '${partialText}')]`;
                } else {
                    return `//${el.nodeName.toLowerCase()}[contains(text(), "${partialText}")]`;
                }
            }

            // Generate more precise and reliable XPaths
            function getAllXPaths(el) {
                if (!el) return [];

                const paths = [];
                const tag = el.tagName.toLowerCase();

                // ID-based XPath (most reliable)
                if (el.id) {
                    paths.push(`//*[@id="${el.id}"]`);
                    paths.push(`//${tag}[@id="${el.id}"]`);
                }

                // Class-based XPaths with better specificity
                if (el.className && typeof el.className === 'string') {
                    const classes = el.className.trim().split(/\s+/).filter(Boolean);
                    if (classes.length) {
                        // For single classes
                        for (const cls of classes) {
                            paths.push(`//${tag}[contains(@class, "${cls}")]`);
                        }
                        
                        // For multiple classes (more specific)
                        if (classes.length > 1) {
                            const classXpath = classes.map(c => `contains(@class, "${c}")`).join(" and ");
                            paths.push(`//${tag}[${classXpath}]`);
                        }
                    }
                }

                // Attribute-based XPaths
                const attributes = [
                    'name', 'data-testid', 'data-test', 'data-automation', 
                    'type', 'value', 'title', 'alt', 'placeholder', 
                    'href', 'src', 'for', 'aria-label', 'role'
                ];
                
                for (const attr of attributes) {
                    const value = el.getAttribute(attr);
                    if (value) {
                        paths.push(`//${tag}[@${attr}="${value}"]`);
                        
                        // For partial matches on longer attributes
                        if (value.length > 20) {
                            paths.push(`//${tag}[contains(@${attr}, "${value.substring(0, 20)}")]`);
                        }
                    }
                }

                // Text-based XPaths
                const textContent = el.textContent.trim();
                if (textContent) {
                    // Handle quotes properly
                    const quoteSafeText = textContent.includes('"') ? 
                        `'${textContent}'` : `"${textContent}"`;
                    
                    paths.push(`//${tag}[text()=${quoteSafeText}]`);
                    
                    // For longer text, use contains
                    if (textContent.length > 20) {
                        const partialText = textContent.substring(0, 20);
                        const quoteSafePartialText = partialText.includes('"') ? 
                            `'${partialText}'` : `"${partialText}"`;
                        
                        paths.push(`//${tag}[contains(text(), ${quoteSafePartialText})]`);
                    }
                }

                // Position-based XPaths (absolute and relative)
                paths.push(getIndexedXPath(el));
                paths.push(getAbsoluteXPath(el));
                paths.push(getRelativeXPath(el));

                // Hybrid XPaths (combine attributes for more precision)
                const hybridAttributes = [];
                for (const attr of ['id', 'name', 'class', 'type']) {
                    let value;
                    if (attr === 'class' && el.className) {
                        value = el.className.trim().split(/\s+/)[0]; // First class
                    } else {
                        value = el.getAttribute(attr);
                    }
                    
                    if (value) {
                        hybridAttributes.push(`@${attr}="${value}"`);
                    }
                }
                
                if (hybridAttributes.length > 1) {
                    paths.push(`//${tag}[${hybridAttributes.join(' and ')}]`);
                }

                // Generate accurate indexed XPath
                function getIndexedXPath(el) {
                    if (!el || el.nodeType !== 1) return '';
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
                        
                        const siblings = Array.from(el.parentNode?.children || [])
                            .filter(s => s.nodeName === el.nodeName);
                        const needsIndex = siblings.length > 1;
                        
                        segs.unshift(needsIndex ? 
                            `${el.nodeName.toLowerCase()}[${i}]` : 
                            el.nodeName.toLowerCase());
                    }
                    
                    return segs.length ? `/${segs.join('/')}` : '';
                }

                // Filter out duplicate paths and empty ones
                return [...new Set(paths.filter(Boolean))];
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
                partialLinkText: element.innerText ? 
                    (element.innerText.length > 10 ? element.innerText.substring(0, 10) + '...' : element.innerText) 
                    : null,
                // Add data attributes that are commonly used for testing
                dataTestId: element.getAttribute('data-testid') || element.getAttribute('data-test-id') || null,
                ariaLabel: element.getAttribute('aria-label') || null,
                role: element.getAttribute('role') || null
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