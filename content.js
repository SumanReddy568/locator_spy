if (window.seleniumLocatorHelperInjected) {
  console.log("Selenium Locator Helper already injected");
} else {
  window.seleniumLocatorHelperInjected = true;
  console.log("Selenium Locator Helper content script loaded");

  // Function to inject and wait for helper script
  async function injectHelperScript() {
    try {
      if (window.LocatorHelper) {
        return window.LocatorHelper;
      }

      // Inject the helper script
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('locator_helper.js');
      const loadPromise = new Promise((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load helper script'));
      });
      document.head.appendChild(script);
      await loadPromise;

      // Wait for LocatorHelper to be available
      for (let i = 0; i < 50; i++) { // 5 second timeout
        if (window.LocatorHelper) {
          return window.LocatorHelper;
        }
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error('LocatorHelper not found after injection');
    } catch (err) {
      console.error('Failed to inject helper:', err);
      throw err;
    }
  }

  // Wait for both dependencies to be available
  async function waitForDependencies(maxWaitTime = 10000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitTime) {
      if (typeof window.generateLocators === "function" && window.LocatorHelper) {
        console.log("All dependencies found");
        return;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error("Timed out waiting for dependencies");
  }

  // Initialize with proper dependency handling
  injectHelperScript()
    .then(() => waitForDependencies())
    .then(() => {
      // Start main functionality
      loadBestLocatorPreference(initializeContentScript);
    })
    .catch((error) => {
      console.error("Failed to initialize:", error.message);
    });

  function loadBestLocatorPreference(callback) {
    try {
      chrome.storage.local.get("isBestLocatorEnabled", (result) => {
        isBestLocatorEnabled = result.hasOwnProperty("isBestLocatorEnabled")
          ? result.isBestLocatorEnabled
          : true;
        console.log("Loaded best locator preference:", isBestLocatorEnabled);

        // Force immediate banner cleanup if disabled
        if (!isBestLocatorEnabled) {
          if (typeof hideBestLocatorBanner === "function") {
            hideBestLocatorBanner();
          }
          if (typeof removeHighlight === "function") {
            removeHighlight();
          }
          if (typeof bestLocatorBanner !== "undefined" && bestLocatorBanner) {
            bestLocatorBanner.remove(); // Completely remove the banner element
            bestLocatorBanner = null;
          }
        }

        if (callback && typeof callback === "function") {
          callback();
        }
      });
    } catch (error) {
      console.error("Error loading locator preference:", error);
      if (callback && typeof callback === "function") {
        callback();
      }
    }
  }

  function initializeContentScript() {
    // Main functionality wrapped in an IIFE to prevent global scope pollution
    (function () {
      // Suppress repeated error logs
      let extensionContextInvalidated = false;
      let locatorGeneratorMissing = false;

      if (typeof window.generateLocators !== "function") {
        if (!locatorGeneratorMissing) {
          console.error(
            "generateLocators is not defined. Make sure locator_generator.js is loaded before content.js."
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
            console.warn("PerformanceObserver not supported:", error);
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
      let bestLocatorBanner = null;
      let isBestLocatorEnabled = true;
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
              console.error("Extension context invalidated - cannot send message");
              extensionContextInvalidated = true;
            }
            deactivateLocatorMode();
            return;
          }

          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Message sending error:",
                chrome.runtime.lastError.message
              );
              deactivateLocatorMode();
              if (callback) callback(null, chrome.runtime.lastError);
              return;
            }
            if (callback) callback(response);
          });
        } catch (error) {
          if (!extensionContextInvalidated) {
            console.error("Error in sendMessageToBackground:", error);
            extensionContextInvalidated = true;
          }
          deactivateLocatorMode();
          if (callback) callback(null, error);
        }
      }

      // Hide the best locator banner
      function hideBestLocatorBanner() {
        if (bestLocatorBanner) {
          bestLocatorBanner.style.display = "none";
        }
      }

      // Analyze and determine the best locator with improved accuracy
      function determineBestLocator(locators) {
        if (!locators) return null;

        // First, test each locator for uniqueness and reliability
        const testedLocators = [];

        // Test function to check if a locator uniquely identifies an element
        function testLocatorUniqueness(type, value) {
          if (!value || value.trim() === "") return false;

          try {
            let elements = [];
            if (type.toLowerCase().includes("xpath")) {
              const result = document.evaluate(
                value,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
              );
              for (let i = 0; i < result.snapshotLength; i++) {
                elements.push(result.snapshotItem(i));
              }
            } else if (type.toLowerCase().includes("css")) {
              elements = Array.from(document.querySelectorAll(value));
            } else {
              const selector =
                type === "ID"
                  ? `#${value}`
                  : `[${type.toLowerCase()}="${value}"]`;
              elements = Array.from(document.querySelectorAll(selector));
            }

            return {
              isUnique: elements.length === 1,
              count: elements.length,
              complexity: value.length,
              value: value,
              type: type,
            };
          } catch (e) {
            if (e instanceof DOMException) {
              console.warn(`Error testing locator ${type}: ${value}`, e.message);
            } else {
              console.error(
                `Unexpected error testing locator ${type}: ${value}`,
                e
              );
            }
            return false;
          }
        }

        // Test each locator type
        if (locators.id) {
          const test = testLocatorUniqueness("ID", locators.id);
          if (test && test.isUnique) {
            testedLocators.push({ ...test, score: 100 }); // ID is highest priority if unique
          }
        }

        if (locators.dataTestId) {
          const test = testLocatorUniqueness("data-testid", locators.dataTestId);
          if (test && test.isUnique) {
            testedLocators.push({ ...test, score: 95 }); // data-testid is second highest
          }
        }

        if (locators.ariaLabel) {
          const test = testLocatorUniqueness("aria-label", locators.ariaLabel);
          if (test && test.isUnique) {
            testedLocators.push({ ...test, score: 90 });
          }
        }

        if (locators.name) {
          const test = testLocatorUniqueness("name", locators.name);
          if (test && test.isUnique) {
            testedLocators.push({ ...test, score: 85 });
          }
        }

        if (locators.cssSelector) {
          const test = testLocatorUniqueness(
            "CSS Selector",
            locators.cssSelector
          );
          if (test && test.isUnique) {
            const score = test.complexity < 100 ? 80 : 0; // Penalize long CSS selectors
            testedLocators.push({ ...test, score });
          }
        }

        if (locators.xpathByName) {
          const test = testLocatorUniqueness(
            "XPath by Name",
            locators.xpathByName
          );
          if (test) {
            const uniquenessScore = test.isUnique ? 75 : (1 / test.count) * 45;
            const complexityScore = Math.max(0, 25 - test.complexity / 10);
            testedLocators.push({
              ...test,
              score: uniquenessScore + complexityScore,
            });
          }
        }

        if (locators.xpathByLinkText && locators.tagName === "a") {
          const test = testLocatorUniqueness(
            "XPath by Link Text",
            locators.xpathByLinkText
          );
          if (test) {
            const uniquenessScore = test.isUnique ? 70 : (1 / test.count) * 40;
            const complexityScore = Math.max(0, 20 - test.complexity / 10);
            testedLocators.push({
              ...test,
              score: uniquenessScore + complexityScore,
            });
          }
        }

        if (locators.xpathByPartialLinkText && locators.tagName === "a") {
          const test = testLocatorUniqueness(
            "XPath by Partial Link Text",
            locators.xpathByPartialLinkText
          );
          if (test) {
            const uniquenessScore = test.isUnique ? 65 : (1 / test.count) * 35;
            const complexityScore = Math.max(0, 15 - test.complexity / 10);
            testedLocators.push({
              ...test,
              score: uniquenessScore + complexityScore,
            });
          }
        }

        if (locators.relativeXPath) {
          const test = testLocatorUniqueness(
            "Relative XPath",
            locators.relativeXPath
          );
          if (test) {
            const uniquenessScore = test.isUnique ? 60 : (1 / test.count) * 30;
            const complexityScore = Math.max(0, 20 - test.complexity / 15);
            testedLocators.push({
              ...test,
              score: uniquenessScore + complexityScore,
            });
          }
        }

        // Test more complex XPaths as a last resort
        if (locators.allXPaths && locators.allXPaths.length) {
          // Test first few XPaths (most likely to be good)
          const xpathsToTest = locators.allXPaths.slice(0, 3);
          for (let i = 0; i < xpathsToTest.length; i++) {
            const xpath = xpathsToTest[i];
            const test = testLocatorUniqueness("XPath", xpath);
            if (test && test.isUnique) {
              const baseScore = 55 - i * 5; // Decreasing score for each subsequent XPath
              const complexityScore = Math.max(0, 20 - test.complexity / 15);
              testedLocators.push({
                ...test,
                score: baseScore + complexityScore,
              });
            }
          }
        }

        // Sort by score (highest first)
        testedLocators.sort((a, b) => b.score - a.score);

        // Adjust star rating based on score
        if (testedLocators.length > 0) {
          const bestLocator = testedLocators[0];
          let stars = 1;
          if (bestLocator.score >= 90) stars = 5;
          else if (bestLocator.score >= 70) stars = 4;
          else if (bestLocator.score >= 50) stars = 3;
          else if (bestLocator.score >= 30) stars = 2;

          return {
            type: bestLocator.type,
            value: bestLocator.value,
            score: bestLocator.score,
            stars,
          };
        }

        // If the best locator is a long CSS selector, fallback to the second-best
        if (
          testedLocators.length > 1 &&
          testedLocators[0].type === "CSS Selector" &&
          testedLocators[0].complexity >= 100
        ) {
          return {
            type: testedLocators[1].type,
            value: testedLocators[1].value,
            score: testedLocators[1].score,
          };
        }

        // Return the highest scoring locator
        if (testedLocators.length > 0) {
          return {
            type: testedLocators[0].type,
            value: testedLocators[0].value,
            score: testedLocators[0].score.toFixed(1), // Include the score for debugging
          };
        }

        // Fallback to original priority-based selection if testing didn't work
        const priorityOrder = [
          { key: "id", type: "ID" },
          { key: "dataTestId", type: "Data Test ID" },
          { key: "ariaLabel", type: "ARIA Label" },
          { key: "cssSelector", type: "CSS Selector" },
          { key: "xpathByName", type: "XPath by Name" },
          { key: "xpathByLinkText", type: "XPath by Link Text" },
          { key: "xpathByPartialLinkText", type: "XPath by Partial Link Text" },
          { key: "relativeXPath", type: "Relative XPath" },
          { key: "absoluteXPath", type: "Absolute XPath" },
        ];

        // Find the first available locator in priority order
        for (const { key, type } of priorityOrder) {
          if (locators[key] && locators[key].trim()) {
            return { type, value: locators[key] };
          }
        }

        // If no prioritized locator found, try to find a good CSS selector
        if (locators.cssSelector) {
          return { type: "CSS Selector", value: locators.cssSelector };
        }

        // Fallback to first available XPath
        if (locators.allXPaths && locators.allXPaths.length > 0) {
          return { type: "XPath", value: locators.allXPaths[0] };
        }

        return null;
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

      // Highlight element with a border using transform for better performance
      function highlightElement(element) {
        if (!element || !element.style) return;

        // Remove previous highlight with RAF
        requestAnimationFrame(() => {
          if (highlightedElement) {
            highlightedElement.style.outline = "";
            highlightedElement.style.outlineOffset = "";
          }

          // Add new highlight
          element.style.outline = "2px solid #4285F4";
          element.style.outlineOffset = "2px";
          highlightedElement = element;
        });
      }

      // Remove highlight from element
      function removeHighlight() {
        if (highlightedElement) {
          LocatorHelper.removeHighlight(highlightedElement);
          highlightedElement = null;
        }
      }

      function highlightElement(element) {
        highlightedElement = LocatorHelper.highlightElement(element, highlightedElement);
      }

      function showBestLocator(type, value, score) {
        if (!LocatorHelper.isEnabled) return;
        LocatorHelper.showBestLocator(type, value, score);
      }

      function hideBestLocatorBanner() {
        LocatorHelper.hideBestLocatorBanner();
      }

      function toggleBestLocator(enable) {
        LocatorHelper.setBannerEnabled(enable);
        // ...rest of toggle logic...
      }

      // Handle mouseover events in locator mode with debounce
      const debouncedMouseOver = debounce((event) => {
        if (!isLocatorModeActive) return;

        // Ignore if same element
        if (hoveredElement === event.target) return;

        // Always ignore banner events
        if (event.target.closest("#best-locator-banner")) return;

        event.stopPropagation();
        event.preventDefault();

        hoveredElement = event.target;
        highlightElement(hoveredElement);

        // Hide banner immediately if feature is disabled
        if (!isBestLocatorEnabled) {
          hideBestLocatorBanner();
          // Still send locators to background for other features
          sendMessageToBackground({
            action: "getLocators",
            locators: generateLocators(hoveredElement),
          });
          return;
        }

        const locators = generateLocators(hoveredElement);
        const bestLocator = determineBestLocator(locators);
        if (bestLocator) {
          showBestLocator(bestLocator.type, bestLocator.value);
        } else {
          hideBestLocatorBanner();
        }

        // Send locators to background
        sendMessageToBackground({
          action: "getLocators",
          locators: locators,
          htmlContext: hoveredElement.outerHTML,
          trigger: "hover"
        });
      }, 50); // 50ms debounce

      // Handle click events in locator mode
      function handleClick(event) {
        if (!isLocatorModeActive) return;

        // Always ignore banner events
        if (event.target.closest("#best-locator-banner")) return;

        event.stopPropagation();
        event.preventDefault();

        const clickedElement = event.target;
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
          trigger: "click"
        });

        // Deactivate locator mode but keep the highlight and banner if enabled
        isLocatorModeActive = false;
        document.removeEventListener("mouseover", debouncedMouseOver, true);
        document.body.style.cursor = "";

        // Signal completion
        sendMessageToBackground({
          action: "locatorSelected",
          keepBannerVisible: isBestLocatorEnabled,
        });

        // Don't remove highlight or banner immediately to allow copying
        if (!isBestLocatorEnabled) {
          // If banner is disabled, clean up immediately
          removeHighlight();
          hideBestLocatorBanner();
        } else {
          // Auto-cleanup after delay if banner is enabled
          setTimeout(() => {
            removeHighlight();
            hideBestLocatorBanner();
            if (contextCheckInterval) {
              clearInterval(contextCheckInterval);
              contextCheckInterval = null;
            }
            sendMessageToBackground({
              action: "locatorModeDeactivated",
            });
          }, 10000); // 10 seconds delay
        }
      }

      // Ensure DOMDiffer starts tracking properly
      function initializeDomDiffer() {
        try {
          domDiffer.startTracking();
          console.log("DOMDiffer started tracking.");
        } catch (error) {
          console.error("Error initializing DOMDiffer:", error);
        }
      }

      // Ensure NetworkRequestMapper starts tracking properly
      function initializeNetworkMapper() {
        try {
          networkMapper.startTracking();
          console.log("NetworkRequestMapper started tracking.");
        } catch (error) {
          console.error("Error initializing NetworkRequestMapper:", error);
        }
      }

      // Ensure DOM changes and network requests are captured
      function captureDomAndNetworkChanges() {
        try {
          const domChanges = domDiffer.stopTracking();
          const networkRequests = networkMapper.stopTracking();

          console.log("Captured DOM changes:", domChanges);
          console.log("Captured network requests:", networkRequests);

          sendMessageToBackground({
            action: "captureMetrics",
            domChanges,
            networkRequests,
          });
        } catch (error) {
          console.error("Error capturing DOM and network changes:", error);
        }
      }

      // Activate locator mode
      function activateLocatorMode() {
        if (isLocatorModeActive) return;

        console.log(
          "Activating locator mode, best locator enabled:",
          isBestLocatorEnabled
        );
        isLocatorModeActive = true;

        initializeDomDiffer();
        initializeNetworkMapper();

        document.addEventListener("mouseover", debouncedMouseOver, {
          capture: true,
          passive: false,
        });
        document.addEventListener("click", handleClick, true);
        document.body.style.cursor = "crosshair";

        // If best locator is disabled, ensure the banner is hidden
        if (!isBestLocatorEnabled) {
          hideBestLocatorBanner();
        }

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

        captureDomAndNetworkChanges();

        document.removeEventListener("mouseover", debouncedMouseOver, true);
        document.removeEventListener("click", handleClick, true);
        document.body.style.cursor = "";

        // Always clean up banner and highlight
        removeHighlight();
        hideBestLocatorBanner();
        if (!isBestLocatorEnabled && bestLocatorBanner) {
          bestLocatorBanner.remove();
          bestLocatorBanner = null;
        }

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
              console.warn("Extension context invalidated - stopping retries");
              extensionContextInvalidated = true;
            }
            deactivateLocatorMode(); // Stop locator mode if context is invalid
            return;
          }

          // Simple ping to check if background is responsive
          sendMessageToBackground({ action: "ping" }, (response, error) => {
            if (error) {
              console.error("Context check failed:", error);
              deactivateLocatorMode();
            }
          });
        } catch (error) {
          if (!extensionContextInvalidated) {
            console.error("Error in context check:", error);
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
              console.error("Extension context invalidated in listener");
              deactivateLocatorMode();
              return;
            }

            console.log("Content script received message:", request);

            if (request.action === "activateLocatorMode") {
              if (request.isActive) {
                activateLocatorMode();
              } else {
                deactivateLocatorMode();
              }
            }

            if (request.action === "toggleBestLocator") {
              toggleBestLocator(request.enable);
              sendResponse({ success: true }); // Add response to ensure message is handled
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
          console.error("Failed to setup message listener:", error);
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
        console.log(`[LocatorSpy] Validating locator - Type: "${type}", Value: "${value}"`);
        const lowerType = type.toLowerCase();

        try {

          // 1. XPath Strategies
          if (lowerType.includes("xpath") || value.startsWith("/") || value.startsWith("(")) {
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
              console.warn("Invalid XPath execution:", e);
              // Fallback: maybe it wasn't an xpath but the value started with /? Unlikely but possible.
            }
          }
          // 2. ID Strategy
          else if (lowerType === "id") {
            element = document.getElementById(value);
          }
          // 3. CSS Strategies (Explicit or detected)
          else if (lowerType.includes("css") || lowerType.includes("selector")) {
            try {
              element = document.querySelector(value);
            } catch (e) {
              console.warn("Invalid CSS Selector:", e);
            }
          }
          // 4. Specific Strategies
          else if (lowerType === "class name") {
            element = document.getElementsByClassName(value)[0];
          }
          else if (lowerType === "tag name") {
            const elements = Array.from(document.getElementsByTagName(value));
            element = elements[0];
            // ... logic for index if multiple ...
            if (elements.length > 1 && hoveredElement && elements.includes(hoveredElement)) {
              element = hoveredElement;
            }
          }
          else if (lowerType === "link text") {
            // ... existing link text logic ...
            const exactLinks = Array.from(document.getElementsByTagName("a"))
              .filter(link => link.textContent.trim() === value);
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
                additionalInfo: `Found ${exactLinks.length} matches. Using index ${exactLinks.indexOf(element) + 1}.`,
              });
            }
          }
          else if (lowerType === "partial link text") {
            // ... existing partial link text logic ...
            const partialLinks = Array.from(document.getElementsByTagName("a"))
              .filter(link => link.textContent.includes(value));
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
                additionalInfo: `Found ${partialLinks.length} matches. Using index ${partialLinks.indexOf(element) + 1}.`,
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
                console.warn("Failed to construct attribute selector:", e2);
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
          console.log(
            "Content script initialized successfully with preferences loaded"
          );
        } catch (error) {
          console.error("Content script initialization failed:", error);
        }
      }

      // Start the content script
      initialize();

      // Listen for storage changes to update the state in real-time
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.isBestLocatorEnabled) {
          const isEnabled = changes.isBestLocatorEnabled.newValue;
          isBestLocatorEnabled = isEnabled;

          if (!isEnabled) {
            hideBestLocatorBanner();
            if (bestLocatorBanner) {
              bestLocatorBanner.remove();
              bestLocatorBanner = null;
            }
          }
        }
      });

      if (typeof hideBestLocatorBanner === 'function') {
        hideBestLocatorBanner();
      }


      // Initialize the best locator setting on script load
      function initializeBestLocatorSetting() {
        chrome.storage.local.get("isBestLocatorEnabled", (result) => {
          isBestLocatorEnabled = result.isBestLocatorEnabled ?? true;
          if (!isBestLocatorEnabled) {
            hideBestLocatorBanner();
            if (bestLocatorBanner) {
              bestLocatorBanner.remove();
              bestLocatorBanner = null;
            }
          }
        });
      }

      initializeBestLocatorSetting();
    })();
  }
}
