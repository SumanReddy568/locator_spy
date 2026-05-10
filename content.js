function sendLifecycleEvent(eventName, data = {}) {
  try {
    if (chrome.runtime?.id) {
      chrome.runtime.sendMessage({
        action: "locatorLifecycle",
        eventName,
        data: { ...data, url: window.location.href },
      });
    }
  } catch (e) {
    // Ignore
  }
}
window.sendLifecycleEvent = sendLifecycleEvent;

// Mirror the user-selected engine (chrome.storage.local.locatorEngine) into
// window.LocatorSpyConfig so the v2 dispatcher routes calls correctly.
function applyEngineConfig(engine) {
  const e = engine === "v1" ? "v1" : "v2";
  window.LocatorSpyConfig = Object.assign({}, window.LocatorSpyConfig, { engine: e });
}
try {
  if (chrome.storage?.local) {
    chrome.storage.local.get("locatorEngine", (result) => {
      applyEngineConfig(result.locatorEngine || "v2");
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.locatorEngine) {
        applyEngineConfig(changes.locatorEngine.newValue);
      }
    });
  }
} catch (e) {
  // Ignore — fall back to dispatcher default (v2).
}

if (window.seleniumLocatorHelperInjected) {
  // Already injected, skip
} else {
  window.seleniumLocatorHelperInjected = true;

  // Function to inject and wait for helper script
  async function injectHelperScript() {
    try {
      if (window.LocatorHelper) {
        return window.LocatorHelper;
      }

      // Inject the helper script
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("locator_helper.js");
      const loadPromise = new Promise((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error("Failed to load helper script"));
      });
      document.head.appendChild(script);
      await loadPromise;

      // Wait for LocatorHelper to be available
      for (let i = 0; i < 50; i++) {
        // 5 second timeout
        if (window.LocatorHelper) {
          return window.LocatorHelper;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("LocatorHelper not found after injection");
    } catch (err) {
      console.error("[LocatorSpy] Failed to inject helper:", err);
      throw err;
    }
  }

  // Wait for both dependencies to be available
  async function waitForDependencies(maxWaitTime = 10000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitTime) {
      if (
        typeof window.generateLocators === "function" &&
        window.LocatorHelper
      ) {
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Timed out waiting for dependencies");
  }

  // Initialize with proper dependency handling
  injectHelperScript()
    .then(() => waitForDependencies())
    .then(() => {
      initializeContentScript();
    })
    .catch((error) => {
      console.error("[LocatorSpy] Failed to initialize:", error.message);
    });

  function initializeContentScript() {
    // Main functionality wrapped in an IIFE to prevent global scope pollution
    (function () {
      // Suppress repeated error logs
      let extensionContextInvalidated = false;
      let locatorGeneratorMissing = false;

      if (typeof window.generateLocators !== "function") {
        if (!locatorGeneratorMissing) {
          console.error(
            "[LocatorSpy] generateLocators is not defined. Ensure locator_generator.js is loaded before content.js."
          );
          locatorGeneratorMissing = true;
        }
        return;
      }

      // Utility Classes
      class DOMDiffer {
        constructor() {
          this.previousDOM = null;
          this.mutations = [];
          this.observer = null;
          this.isTracking = false;
        }

        startTracking() {
          if (this.isTracking) return;

          this.previousDOM = document.documentElement.cloneNode(true);
          this.mutations = [];

          this.observer = new MutationObserver((mutations) => {
            this.mutations = this.mutations.concat(
              Array.from(mutations).map((m) => ({
                type: m.type,
                target: m.target.nodeName,
                addedNodes: m.addedNodes.length,
                removedNodes: m.removedNodes.length,
                timestamp: Date.now(),
              }))
            );
          });

          this.observer.observe(document.documentElement, {
            childList: true,
            attributes: true,
            characterData: true,
            subtree: true,
          });

          this.isTracking = true;
        }

        stopTracking() {
          if (!this.isTracking)
            return { added: [], removed: [], modified: [], mutations: [] };

          this.isTracking = false;
          if (this.observer) {
            this.observer.disconnect();
          }

          const changes = this.getDOMChanges();
          this.mutations = [];
          this.previousDOM = null;
          return changes;
        }

        getDOMChanges() {
          const changes = {
            added: [],
            removed: [],
            modified: [],
            mutations: this.mutations,
          };

          if (!this.previousDOM) return changes;

          const currentDOM = document.documentElement;
          this._compareNodes(this.previousDOM, currentDOM, changes);

          return changes;
        }

        _compareNodes(oldNode, newNode, changes) {
          if (!oldNode || !newNode) return;

          if (oldNode.nodeType === Node.ELEMENT_NODE) {
            const oldAttrs = Array.from(oldNode.attributes || []);
            const newAttrs = Array.from(newNode.attributes || []);

            if (oldAttrs.length !== newAttrs.length) {
              changes.modified.push({
                element: newNode,
                type: "attributes",
              });
            } else {
              for (let i = 0; i < oldAttrs.length; i++) {
                if (oldAttrs[i].value !== newAttrs[i].value) {
                  changes.modified.push({
                    element: newNode,
                    type: "attributes",
                  });
                  break;
                }
              }
            }
          }

          const oldChildren = Array.from(oldNode.childNodes);
          const newChildren = Array.from(newNode.childNodes);

          const maxLength = Math.max(oldChildren.length, newChildren.length);
          for (let i = 0; i < maxLength; i++) {
            const oldChild = oldChildren[i];
            const newChild = newChildren[i];

            if (!oldChild && newChild) {
              changes.added.push(newChild);
            } else if (oldChild && !newChild) {
              changes.removed.push(oldChild);
            } else if (
              oldChild.nodeType === Node.ELEMENT_NODE &&
              newChild.nodeType === Node.ELEMENT_NODE
            ) {
              this._compareNodes(oldChild, newChild, changes);
            }
          }
        }
      }

      class PerformanceTracker {
        constructor() {
          this.metrics = new Map();
          this.marks = new Set();
        }

        startMeasure(locatorType, locatorValue) {
          const key = `${locatorType}:${locatorValue}`;
          const markName = `start_${key}`;

          performance.mark(markName);
          this.marks.add(markName);

          this.metrics.set(key, {
            start: performance.now(),
            type: locatorType,
            value: locatorValue,
          });
        }

        endMeasure(locatorType, locatorValue) {
          const key = `${locatorType}:${locatorValue}`;
          const metric = this.metrics.get(key);
          const markName = `start_${key}`;

          if (metric && this.marks.has(markName)) {
            const measureName = `measure_${key}`;
            performance.measure(measureName, markName);

            const measure = performance.getEntriesByName(measureName).pop();
            metric.duration = measure.duration;

            // Cleanup
            performance.clearMarks(markName);
            performance.clearMeasures(measureName);
            this.marks.delete(markName);

            return metric;
          }
          return null;
        }

        getMetrics() {
          return Array.from(this.metrics.values()).filter(
            (metric) => metric.duration !== undefined
          );
        }

        clearMetrics() {
          this.metrics.clear();
          this.marks.forEach((mark) => {
            performance.clearMarks(mark);
          });
          this.marks.clear();
        }
      }

      class NetworkRequestMapper {
        constructor() {
          this.requests = new Map();
          this.observer = null;
          this.startTime = null;
          this.isTracking = false;
        }

        startTracking() {
          if (this.isTracking) return;

          this.startTime = performance.now();
          this.requests.clear();

          try {
            this.observer = new PerformanceObserver((list) => {
              const entries = list.getEntries();
              entries.forEach((entry) => {
                if (entry.entryType === "resource") {
                  this.requests.set(entry.name, {
                    url: entry.name,
                    startTime: entry.startTime,
                    duration: entry.duration,
                    type: entry.initiatorType,
                    size: entry.transferSize || 0,
                  });
                }
              });
            });

            this.observer.observe({ entryTypes: ["resource"] });
            this.isTracking = true;
          } catch (error) {
            // PerformanceObserver may be unsupported in some contexts
          }
        }

        stopTracking() {
          if (!this.isTracking) return [];

          this.isTracking = false;
          if (this.observer) {
            this.observer.disconnect();
          }

          const requests = Array.from(this.requests.values())
            .filter((req) => req.startTime >= this.startTime)
            .map((req) => ({
              ...req,
              duration: Math.round(req.duration),
              size: Math.round(req.size / 1024), // Convert to KB
            }));

          this.requests.clear();
          return requests;
        }
      }

      let isLocatorModeActive = false;
      let highlightedElement = null;
      let hoveredElement = null;
      let contextCheckInterval = null;
      let lastValidatedElement = null;

      // Initialize utility instances
      const domDiffer = new DOMDiffer();
      const performanceTracker = new PerformanceTracker();
      const networkMapper = new NetworkRequestMapper();

      // Wrapper for sending messages with error handling
      function sendMessageToBackground(message, callback) {
        try {
          if (!chrome.runtime?.id) {
            if (!extensionContextInvalidated) {
              console.error("[LocatorSpy] Extension context invalidated - cannot send message");
              extensionContextInvalidated = true;
            }
            deactivateLocatorMode();
            return;
          }

          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              console.error("[LocatorSpy] Message error:", chrome.runtime.lastError.message);
              deactivateLocatorMode();
              if (callback) callback(null, chrome.runtime.lastError);
              return;
            }
            if (callback) callback(response);
          });
        } catch (error) {
          if (!extensionContextInvalidated) {
            console.error("[LocatorSpy] sendMessageToBackground error:", error);
            extensionContextInvalidated = true;
          }
          deactivateLocatorMode();
          if (callback) callback(null, error);
        }
      }

      // Import generateLocators from locator_generator.js
      // (Assume locator_generator.js is loaded as a content script before this file)
      // If using modules, you could use: import { generateLocators } from './locator_generator.js';
      // For now, assume generateLocators is available globally.

      // Debounce function for smoother highlighting
      function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
          const later = () => {
            clearTimeout(timeout);
            func(...args);
          };
          clearTimeout(timeout);
          timeout = setTimeout(later, wait);
        };
      }

      // Highlight element with a border (delegates to LocatorHelper).
      function highlightElement(element) {
        highlightedElement = LocatorHelper.highlightElement(
          element,
          highlightedElement
        );
      }

      function removeHighlight() {
        if (highlightedElement) {
          LocatorHelper.removeHighlight(highlightedElement);
          highlightedElement = null;
        }
      }

      // Handle mouseover events in locator mode with debounce
      const debouncedMouseOver = debounce((event) => {
        if (!isLocatorModeActive) return;

        // Ignore if same element
        if (hoveredElement === event.target) return;

        event.stopPropagation();
        event.preventDefault();

        hoveredElement = event.target;
        highlightElement(hoveredElement);

        const locators = generateLocators(hoveredElement);
        sendMessageToBackground({
          action: "getLocators",
          locators: locators,
          htmlContext: hoveredElement.outerHTML,
          trigger: "hover",
        });
      }, 50); // 50ms debounce

      // Handle click events in locator mode
      function handleClick(event) {
        if (!isLocatorModeActive) return;

        event.stopPropagation();
        event.preventDefault();

        const clickedElement = event.target;

        const elementDetails = {
          tagName: clickedElement.tagName?.toLowerCase(),
          id: clickedElement.id || null,
          className: (clickedElement.className && String(clickedElement.className).slice(0, 100)) || null,
          name: clickedElement.getAttribute("name") || null,
          dataTestId: clickedElement.getAttribute("data-testid") || clickedElement.getAttribute("data-test-id") || null,
          ariaLabel: clickedElement.getAttribute("aria-label") || null,
          role: clickedElement.getAttribute("role") || null,
          outerHTMLPreview: (clickedElement.outerHTML || "").slice(0, 300),
        };
        sendLifecycleEvent("element_sent_to_generation", { element: elementDetails });

        const locators = generateLocators(clickedElement);

        // Save locator info and deactivate mode
        sendMessageToBackground({
          action: "saveLocator",
          locators: locators,
          url: window.location.href,
          timestamp: new Date().toISOString(),
        });

        // Include metrics in the message to DevTools
        sendMessageToBackground({
          action: "getLocators",
          locators: locators,
          metadata: locators._metadata,
          htmlContext: clickedElement.outerHTML,
          trigger: "click",
        });

        sendLifecycleEvent("element_selected", {
          tagName: locators.tagName,
          generatedLocators: locators,
        });

        // Deactivate locator mode but keep the highlight briefly so the user
        // can still see the selection in the page.
        isLocatorModeActive = false;
        document.removeEventListener("mouseover", debouncedMouseOver, true);
        document.body.style.cursor = "";

        sendMessageToBackground({ action: "locatorSelected" });

        setTimeout(() => {
          removeHighlight();
          if (contextCheckInterval) {
            clearInterval(contextCheckInterval);
            contextCheckInterval = null;
          }
          sendLifecycleEvent("mode_deactivated", { trigger: "auto_cleanup" });
          sendMessageToBackground({ action: "locatorModeDeactivated" });
        }, 10000);
      }

      // Ensure DOMDiffer starts tracking properly
      function initializeDomDiffer() {
        try {
          domDiffer.startTracking();
        } catch (error) {
          // Ignore
        }
      }

      function initializeNetworkMapper() {
        try {
          networkMapper.startTracking();
        } catch (error) {
          // Ignore
        }
      }

      function captureDomAndNetworkChanges() {
        try {
          const domChanges = domDiffer.stopTracking();
          const networkRequests = networkMapper.stopTracking();
          sendMessageToBackground({
            action: "captureMetrics",
            domChanges,
            networkRequests,
          });
        } catch (error) {
          // Ignore
        }
      }

      // Activate locator mode
      function activateLocatorMode() {
        if (isLocatorModeActive) return;

        sendLifecycleEvent("mode_activated", { message: "select element" });
        isLocatorModeActive = true;

        initializeDomDiffer();
        initializeNetworkMapper();

        document.addEventListener("mouseover", debouncedMouseOver, {
          capture: true,
          passive: false,
        });
        document.addEventListener("click", handleClick, true);
        document.body.style.cursor = "crosshair";

        // Start context validity checks
        if (!contextCheckInterval) {
          contextCheckInterval = setInterval(checkContextValidity, 5000);
        }
      }

      // Deactivate locator mode
      function deactivateLocatorMode() {
        if (!isLocatorModeActive) return;

        sendLifecycleEvent("mode_deactivated", {});
        isLocatorModeActive = false;

        captureDomAndNetworkChanges();

        document.removeEventListener("mouseover", debouncedMouseOver, true);
        document.removeEventListener("click", handleClick, true);
        document.body.style.cursor = "";

        removeHighlight();
        hoveredElement = null;

        // Clear any remaining validation highlights
        if (lastValidatedElement) {
          lastValidatedElement.style.outline = "";
          lastValidatedElement.style.outlineOffset = "";
          lastValidatedElement.style.boxShadow = "";
          lastValidatedElement = null;
        }

        if (contextCheckInterval) {
          clearInterval(contextCheckInterval);
          contextCheckInterval = null;
        }

        sendMessageToBackground({
          action: "locatorModeDeactivated",
        });
      }

      // Check if extension context is still valid
      function checkContextValidity() {
        try {
          if (!chrome.runtime?.id) {
            if (!extensionContextInvalidated) {
              // Extension context invalidated - stopping retries
              extensionContextInvalidated = true;
            }
            deactivateLocatorMode(); // Stop locator mode if context is invalid
            return;
          }

          // Simple ping to check if background is responsive
          sendMessageToBackground({ action: "ping" }, (response, error) => {
            if (error) {
              console.error("[LocatorSpy] Context check failed:", error);
              deactivateLocatorMode();
            }
          });
        } catch (error) {
          if (!extensionContextInvalidated) {
            console.error("[LocatorSpy] Context check error:", error);
            extensionContextInvalidated = true;
          }
          deactivateLocatorMode();
        }
      }

      // Message listener with error handling
      function setupMessageListener() {
        try {
          chrome.runtime.onMessage.addListener(function (
            request,
            sender,
            sendResponse
          ) {
            if (!chrome.runtime?.id) {
              console.error("[LocatorSpy] Extension context invalidated in listener");
              deactivateLocatorMode();
              return;
            }

            if (request.action === "activateLocatorMode") {
              if (request.isActive) {
                activateLocatorMode();
              } else {
                deactivateLocatorMode();
              }
            }

            if (request.action === "validateLocator") {
              validateAndHighlightElement(
                request.locatorType,
                request.locatorValue
              );
            }

            return true; // Keep the message channel open for sendResponse
          });
        } catch (error) {
          console.error("[LocatorSpy] Failed to setup message listener:", error);
        }
      }

      // Add validation handling
      function validateAndHighlightElement(type, value) {
        // Clear previous validation highlight if exists
        if (lastValidatedElement) {
          lastValidatedElement.style.outline = "";
          lastValidatedElement.style.outlineOffset = "";
          lastValidatedElement.style.boxShadow = "";
          lastValidatedElement = null;
        }

        let element = null;
        const lowerType = type.toLowerCase();

        try {
          // 1. XPath Strategies
          if (
            lowerType.includes("xpath") ||
            value.startsWith("/") ||
            value.startsWith("(")
          ) {
            try {
              const result = document.evaluate(
                value,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
              );
              element = result.singleNodeValue;
            } catch (e) {
              // Invalid XPath - element remains null
            }
          }
          // 2. ID Strategy
          else if (lowerType === "id") {
            element = document.getElementById(value);
          }
          // 3. CSS Strategies (Explicit or detected)
          else if (
            lowerType.includes("css") ||
            lowerType.includes("selector")
          ) {
            try {
              element = document.querySelector(value);
            } catch (e) {
              // Invalid CSS selector
            }
          }
          // 4. Specific Strategies
          else if (lowerType === "class name") {
            element = document.getElementsByClassName(value)[0];
          } else if (lowerType === "tag name") {
            const elements = Array.from(document.getElementsByTagName(value));
            element = elements[0];
            // ... logic for index if multiple ...
            if (
              elements.length > 1 &&
              hoveredElement &&
              elements.includes(hoveredElement)
            ) {
              element = hoveredElement;
            }
          } else if (lowerType === "link text") {
            // ... existing link text logic ...
            const exactLinks = Array.from(
              document.getElementsByTagName("a")
            ).filter((link) => link.textContent.trim() === value);
            element = exactLinks[0];
            if (exactLinks.length > 1) {
              if (hoveredElement && exactLinks.includes(hoveredElement)) {
                element = hoveredElement;
              }
              chrome.runtime.sendMessage({
                action: "validationResult",
                success: true,
                locatorType: type,
                locatorValue: value,
                additionalInfo: `Found ${
                  exactLinks.length
                } matches. Using index ${exactLinks.indexOf(element) + 1}.`,
              });
            }
          } else if (lowerType === "partial link text") {
            // ... existing partial link text logic ...
            const partialLinks = Array.from(
              document.getElementsByTagName("a")
            ).filter((link) => link.textContent.includes(value));
            element = partialLinks[0];
            if (partialLinks.length > 1) {
              if (hoveredElement && partialLinks.includes(hoveredElement)) {
                element = hoveredElement;
              }
              chrome.runtime.sendMessage({
                action: "validationResult",
                success: true,
                locatorType: type,
                locatorValue: value,
                additionalInfo: `Found ${
                  partialLinks.length
                } matches. Using index ${partialLinks.indexOf(element) + 1}.`,
              });
            }
          }
          // 5. Default / Attribute Fallback
          else {
            // Try as a direct CSS selector first (e.g. if the user provided customized keys or AI output)
            try {
              element = document.querySelector(value);
            } catch (e) {
              // Not a valid selector, treat as Attribute selector (e.g. key="name", value="submit")
              try {
                const selector = `[${lowerType}="${value}"]`;
                element = document.querySelector(selector);
              } catch (e2) {
                // Not a valid attribute selector
              }
            }
          }

          if (element) {
            // Store reference to currently highlighted element
            lastValidatedElement = element;

            // Add validation highlight effect
            element.style.transition = "all 0.3s ease";
            element.style.outline = "2px solid #4CAF50";
            element.style.outlineOffset = "2px";
            element.style.boxShadow = "0 0 10px rgba(76, 175, 80, 0.5)";

            chrome.runtime.sendMessage({
              action: "validationResult",
              success: true,
              locatorType: type,
              locatorValue: value,
            });

            // Remove highlight after 2 seconds
            setTimeout(() => {
              if (lastValidatedElement === element) {
                element.style.outline = "";
                element.style.outlineOffset = "";
                element.style.boxShadow = "";
                lastValidatedElement = null;
              }
            }, 2000);
          } else {
            chrome.runtime.sendMessage({
              action: "validationResult",
              success: false,
              locatorType: type,
              locatorValue: value,
            });
          }
        } catch (error) {
          chrome.runtime.sendMessage({
            action: "validationResult",
            success: false,
            locatorType: type,
            locatorValue: value,
          });
        }
      }

      // -------- Recorder mode --------
      // Independent of locator mode. While `recorderActive` is true in
      // chrome.storage.local, every interaction (clicks, typing into text
      // fields, select changes, scroll) is observed in the capture phase
      // (no preventDefault — the page still navigates / submits / etc.)
      // and forwarded to the background, which appends to
      // `recorderInteractions`. The Recorder view in the panel reads that
      // list and re-renders live.
      let isRecordingActive = false;

      function recIdNew() {
        return Date.now() + ":" + Math.random().toString(36).slice(2, 8);
      }

      function recSend(interaction) {
        try {
          chrome.runtime.sendMessage({
            action: "recorderAppend",
            interaction: interaction,
          });
        } catch (e) { /* extension context invalidated; user will reload */ }
      }

      function recGenerateLocatorsSafe(el) {
        try {
          if (typeof window.generateLocators === "function") {
            return window.generateLocators(el);
          }
        } catch (e) { /* ignore */ }
        return null;
      }

      // Text inputs, textareas: capture *value* via the `change` event (fires
      // on blur), not via `click`, so we don't end up with a noisy click step
      // followed by an input step for the same field. Checkboxes / radios /
      // file inputs / buttons are still treated as clicks since their
      // change/click semantics line up with `.click()` in test code.
      function recIsTextInput(target) {
        if (!target || target.nodeType !== 1) return false;
        const tag = target.tagName ? target.tagName.toLowerCase() : "";
        if (tag === "textarea") return true;
        if (tag !== "input") return false;
        const type = (target.getAttribute("type") || "text").toLowerCase();
        return /^(text|email|password|search|tel|url|number|date|datetime-local|month|time|week)$/.test(type);
      }

      function recorderClickHandler(event) {
        if (!isRecordingActive) return;
        if (event.button !== 0) return; // primary button only
        const target = event.target;
        if (!target || target.nodeType !== 1) return;
        // Suppress clicks on text inputs / textareas — recorderInputHandler
        // will record the typed value when the user blurs the field.
        if (recIsTextInput(target)) return;

        const locators = recGenerateLocatorsSafe(target);
        if (!locators) return;

        recSend({
          id: recIdNew(),
          ts: Date.now(),
          action: "click",
          url: window.location.href,
          locators: locators,
          element: {
            tag: target.tagName ? target.tagName.toLowerCase() : null,
            text: ((target.innerText || target.textContent || "").trim() || "").slice(0, 80),
            role: target.getAttribute("role") || null,
          },
        });
      }

      function recorderChangeHandler(event) {
        if (!isRecordingActive) return;
        const target = event.target;
        if (!target || target.nodeType !== 1) return;
        const tag = target.tagName ? target.tagName.toLowerCase() : "";
        const type = (target.getAttribute("type") || "").toLowerCase();

        // Drop interactions whose semantics are already covered by the click
        // handler (checkbox / radio / button / submit / reset / file).
        if (tag === "input" && /^(checkbox|radio|button|submit|reset|file|hidden)$/.test(type)) return;
        if (tag !== "input" && tag !== "textarea" && tag !== "select") return;

        const locators = recGenerateLocatorsSafe(target);
        if (!locators) return;

        const isPassword = tag === "input" && type === "password";
        const rawValue = target.value == null ? "" : String(target.value);
        // Don't ship password values through chrome.storage.local — redact
        // at the source. Tests will need a real password injected by the
        // user; this gives them a placeholder to find-and-replace.
        const value = isPassword ? "<REDACTED_PASSWORD>" : rawValue;

        recSend({
          id: recIdNew(),
          ts: Date.now(),
          action: tag === "select" ? "select" : "input",
          value: value,
          isPassword: isPassword,
          url: window.location.href,
          locators: locators,
          element: {
            tag: tag,
            type: type || null,
            name: target.getAttribute("name") || null,
            text: (target.getAttribute("placeholder") || target.getAttribute("name") || "").slice(0, 80),
          },
        });
      }

      // Scroll capture: debounced so we emit a single step per "scroll
      // session" rather than one per scroll event. Window-level only — the
      // user's scroll position is what the test needs to reproduce visibility,
      // not which container scrolled.
      let recScrollTimer = null;
      function recorderScrollHandler() {
        if (!isRecordingActive) return;
        if (recScrollTimer) clearTimeout(recScrollTimer);
        recScrollTimer = setTimeout(() => {
          recScrollTimer = null;
          recSend({
            id: recIdNew(),
            ts: Date.now(),
            action: "scroll",
            x: Math.round(window.scrollX || 0),
            y: Math.round(window.scrollY || 0),
            url: window.location.href,
          });
        }, 350);
      }

      // Always-on listeners; cheap when recording is off (each guards on
      // isRecordingActive). Capture phase for click so we see it before the
      // page handles it; bubble for change (it's what change supports);
      // passive scroll so we never interfere with the page.
      document.addEventListener("click", recorderClickHandler, true);
      document.addEventListener("change", recorderChangeHandler, true);
      window.addEventListener("scroll", recorderScrollHandler, { passive: true });

      try {
        chrome.storage.local.get("recorderActive", (r) => {
          isRecordingActive = !!(r && r.recorderActive);
        });
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === "local" && changes.recorderActive) {
            isRecordingActive = !!changes.recorderActive.newValue;
          }
        });
      } catch (e) { /* ignore */ }

      // Initialize the content script
      function initialize() {
        try {
          setupMessageListener();
          checkContextValidity();

          sendMessageToBackground({
            action: "contentScriptReady",
            url: window.location.href,
            iconUrl: chrome.runtime.getURL("popup/icons/icon48.png"),
          });
        } catch (error) {
          console.error("[LocatorSpy] Content script initialization failed:", error);
        }
      }

      // Start the content script
      initialize();
    })();
  }
}
