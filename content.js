// Check if already injected to prevent duplicate execution
if (window.seleniumLocatorHelperInjected) {
  console.log("Selenium Locator Helper already injected");
} else {
  window.seleniumLocatorHelperInjected = true;
  console.log("Selenium Locator Helper content script loaded");

  function loadBestLocatorPreference(callback) {
    try {
      chrome.storage.local.get("isBestLocatorEnabled", (result) => {
        isBestLocatorEnabled = result.hasOwnProperty("isBestLocatorEnabled")
          ? result.isBestLocatorEnabled
          : true;
        console.log("Loaded best locator preference:", isBestLocatorEnabled);

        // Force immediate banner cleanup if disabled
        if (!isBestLocatorEnabled) {
          hideBestLocatorBanner();
          removeHighlight();
          if (bestLocatorBanner) {
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

  // Main functionality wrapped in an IIFE to prevent global scope pollution
  (function () {
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
          console.error("Extension context invalidated - cannot send message");
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
        console.error("Error in sendMessageToBackground:", error);
        deactivateLocatorMode();
        if (callback) callback(null, error);
      }
    }

    // Create the best locator banner
    function createBestLocatorBanner() {
      if (bestLocatorBanner) return bestLocatorBanner;

      const banner = document.createElement("div");
      banner.id = "best-locator-banner";
      banner.style.position = "fixed";
      banner.style.bottom = "20px";
      banner.style.left = "50%";
      banner.style.transform = "translateX(-50%)";
      banner.style.backgroundColor = "#4285F4";
      banner.style.color = "white";
      banner.style.padding = "12px 20px";
      banner.style.borderRadius = "8px";
      banner.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.2)";
      banner.style.zIndex = "999999";
      banner.style.display = "flex";
      banner.style.flexDirection = "column"; // Changed to column layout
      banner.style.gap = "8px";
      banner.style.maxWidth = "90%";
      banner.style.minWidth = "300px";
      banner.style.fontFamily = "Arial, sans-serif";
      banner.style.fontSize = "14px";
      banner.style.transition = "all 0.3s ease";

      // Header section with title and close button
      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.justifyContent = "space-between";
      header.style.alignItems = "center";
      header.style.width = "100%";

      const title = document.createElement("div");
      title.textContent = "Best Element Locator";
      title.style.fontWeight = "bold";

      const closeBtn = document.createElement("button");
      closeBtn.innerHTML = "&times;";
      closeBtn.style.background = "none";
      closeBtn.style.border = "none";
      closeBtn.style.color = "white";
      closeBtn.style.fontSize = "18px";
      closeBtn.style.cursor = "pointer";
      closeBtn.style.padding = "0";
      closeBtn.addEventListener("click", () => {
        banner.style.display = "none";
      });

      header.appendChild(title);
      header.appendChild(closeBtn);

      // Content section for locator value
      const content = document.createElement("div");
      content.style.padding = "6px 8px";
      content.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
      content.style.borderRadius = "4px";
      content.style.fontFamily = "monospace";
      content.style.fontSize = "13px";
      content.style.width = "100%";
      content.style.wordBreak = "break-all";
      content.style.boxSizing = "border-box";

      // Button row
      const buttonRow = document.createElement("div");
      buttonRow.style.display = "flex";
      buttonRow.style.gap = "8px";
      buttonRow.style.marginTop = "4px";

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy";
      copyBtn.style.background = "rgba(255, 255, 255, 0.2)";
      copyBtn.style.border = "none";
      copyBtn.style.color = "white";
      copyBtn.style.padding = "4px 12px";
      copyBtn.style.borderRadius = "4px";
      copyBtn.style.cursor = "pointer";
      copyBtn.style.fontSize = "12px";
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const locatorText = content.textContent.split(": ").pop(); // Extract only the locator value
        navigator.clipboard.writeText(locatorText).then(() => {
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = "Copy";
          }, 2000);
        });
      });

      const accuracyMeter = document.createElement("div");
      accuracyMeter.style.marginLeft = "auto";
      accuracyMeter.style.fontSize = "12px";
      accuracyMeter.textContent = "Accuracy: ⭐⭐⭐⭐⭐"; // Default value

      buttonRow.appendChild(copyBtn);
      buttonRow.appendChild(accuracyMeter);

      // Info section (optional, can be shown/hidden)
      const infoSection = document.createElement("div");
      infoSection.style.fontSize = "11px";
      infoSection.style.color = "rgba(255, 255, 255, 0.8)";
      infoSection.style.marginTop = "4px";
      infoSection.style.display = "none"; // Hidden by default

      // Prevent banner interactions from propagating
      banner.addEventListener("mouseover", (e) => e.stopPropagation());
      banner.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault(); // Prevent default click behavior
      });

      banner.appendChild(header);
      banner.appendChild(content);
      banner.appendChild(buttonRow);
      banner.appendChild(infoSection);
      document.body.appendChild(banner);
      bestLocatorBanner = banner;
      return banner;
    }

    // Show the best locator banner with improved information
    function showBestLocator(locatorType, locatorValue, score) {
      // Early return if feature is disabled
      if (!isBestLocatorEnabled) {
        hideBestLocatorBanner();
        return;
      }

      const banner = createBestLocatorBanner();
      const content = banner.querySelector("div:nth-child(2)"); // Content is the second div
      content.textContent = `${locatorType}: ${locatorValue}`;
      banner.style.display = "flex";

      // Update accuracy meter based on score
      const accuracyMeter = banner.querySelector(
        "div:nth-child(3) div:nth-child(2)"
      ); // Button row -> accuracy meter
      if (score) {
        let stars = "";
        if (score >= 90) {
          stars = "⭐⭐⭐⭐⭐";
          accuracyMeter.style.color = "#FFEB3B"; // Yellow for high accuracy
        } else if (score >= 70) {
          stars = "⭐⭐⭐⭐";
          accuracyMeter.style.color = "#FFEB3B";
        } else if (score >= 50) {
          stars = "⭐⭐⭐";
          accuracyMeter.style.color = "#FFFFFF";
        } else if (score >= 30) {
          stars = "⭐⭐";
          accuracyMeter.style.color = "#FFFFFF";
        } else {
          stars = "⭐";
          accuracyMeter.style.color = "#FFFFFF";
        }
        accuracyMeter.textContent = `Accuracy: ${stars}`;
      }

      // Show additional info for certain types
      const infoSection = banner.querySelector("div:nth-child(4)"); // Info section is the fourth div
      if (locatorType === "XPath") {
        infoSection.textContent =
          "XPath may be brittle if page structure changes";
        infoSection.style.display = "block";
      } else if (locatorType === "ID") {
        infoSection.textContent =
          "ID selectors are typically the most reliable";
        infoSection.style.display = "block";
      } else if (locatorType === "CSS Selector") {
        infoSection.textContent =
          "CSS selectors balance specificity and readability";
        infoSection.style.display = "block";
      } else {
        infoSection.style.display = "none";
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

    // Function to generate all possible locators for an element
    function generateLocators(element) {
      if (!element || !element.tagName) return {};

      // Start tracking before generating locators
      domDiffer.startTracking();
      networkMapper.startTracking();
      performanceTracker.startMeasure("generation", "all");

      // Generate CSS selector with improved specificity
      function getCssSelector(el) {
        if (!el || el === document.documentElement) return "";

        // Unique ID - Most specific
        if (el.id) {
          return `#${CSS.escape(el.id)}`;
        }

        // Try data-testid first - Good for testing
        const testId =
          el.getAttribute("data-testid") || el.getAttribute("data-test-id");
        if (testId) {
          const selector = `[data-testid="${CSS.escape(testId)}"]`;
          if (isUnique(selector)) return selector;
        }

        // Try getting a unique selector based on attributes
        const uniqueAttrSelector = getUniqueAttributeSelector(el);
        if (uniqueAttrSelector) return uniqueAttrSelector;

        // Try class combinations
        const classSelector = getUniqueClassSelector(el);
        if (classSelector) return classSelector;

        // If we reach here, build path with nth-child
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

        // Try data attributes first as they're most reliable
        const dataAttrs = Array.from(el.attributes).filter((attr) =>
          attr.name.startsWith("data-")
        );

        for (const attr of dataAttrs) {
          const value = attr.value.trim();
          if (value) {
            const selector = `${el.tagName.toLowerCase()}[${attr.name
              }=${JSON.stringify(value)}]`;
            if (isUnique(selector)) return selector;
          }
        }

        // Then try other priority attributes
        for (const attr of el.attributes) {
          if (
            priorityAttrs.some((pa) =>
              pa === "*" ? attr.name.startsWith("data-") : attr.name === pa
            )
          ) {
            const value = attr.value.trim();
            if (value) {
              // Handle different quote scenarios
              const selector = `${el.tagName.toLowerCase()}[${attr.name
                }=${JSON.stringify(value)}]`;
              if (isUnique(selector)) return selector;

              // Try case-insensitive match
              const selectorI = `${el.tagName.toLowerCase()}[${attr.name
                }=${JSON.stringify(value)} i]`;
              if (isUnique(selectorI)) return selectorI;

              // Try contains for longer values
              if (value.length > 10) {
                const partialValue = value.substring(0, 10);
                const containsSelector = `${el.tagName.toLowerCase()}[${attr.name
                  }*=${JSON.stringify(partialValue)}]`;
                if (isUnique(containsSelector)) return containsSelector;
              }
            }
          }
        }

        // Try combinations of attributes if single attribute fails
        const validAttrs = Array.from(el.attributes)
          .filter((attr) => attr.value && attr.value.trim())
          .slice(0, 3); // Limit to 3 attributes to avoid overly complex selectors

        for (let i = 0; i < validAttrs.length - 1; i++) {
          for (let j = i + 1; j < validAttrs.length; j++) {
            const selector = `${el.tagName.toLowerCase()}[${validAttrs[i].name
              }=${JSON.stringify(validAttrs[i].value.trim())}][${validAttrs[j].name
              }=${JSON.stringify(validAttrs[j].value.trim())}]`;
            if (isUnique(selector)) return selector;
          }
        }

        return null;
      }

      function getUniqueClassSelector(el) {
        if (!el.className || typeof el.className !== "string") return null;

        const classes = el.className.trim().split(/\s+/);
        if (!classes.length) return null;

        // Try single classes first
        for (const className of classes) {
          const selector = `${el.tagName.toLowerCase()}.${CSS.escape(
            className
          )}`;
          if (isUnique(selector)) return selector;
        }

        // Try combinations of classes
        for (let i = 0; i < classes.length - 1; i++) {
          for (let j = i + 1; j < classes.length; j++) {
            const selector = `${el.tagName.toLowerCase()}.${CSS.escape(
              classes[i]
            )}.${CSS.escape(classes[j])}`;
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

          // Add nth-child only if necessary
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

          // Check if current path is unique
          const fullPath = path.join(" > ");
          if (isUnique(fullPath)) return fullPath;

          current = current.parentNode;
        }

        return path.join(" > ");
      }

      // Generate absolute XPath with improved precision
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

      // Generate relative XPath with better consideration of unique attributes
      function getRelativeXPath(el) {
        if (!el || el.nodeType !== 1) return "";

        // Handle elements with ID first
        if (el.id) {
          return `//*[@id="${el.id}"]`;
        }

        let path = [];
        let current = el;

        while (current && current !== document.documentElement) {
          let currentTag = current.tagName.toLowerCase();
          let index = 1;
          let sibling = current;

          // Count previous siblings with same tag
          while ((sibling = sibling.previousElementSibling)) {
            if (sibling.tagName.toLowerCase() === currentTag) {
              index++;
            }
          }

          // Try to create a unique identifier
          let uniqueIdentifier = "";

          // Check for useful attributes in priority order
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
              index = null; // Don't need position if we have a unique attribute
              break;
            }
          }

          // If no unique attribute found, try class
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

          // Construct the path segment
          let pathSegment =
            currentTag + (uniqueIdentifier || (index > 1 ? `[${index}]` : ""));
          path.unshift(pathSegment);

          // Try the current path to see if it's unique
          const testPath = "//" + path.join("/");
          const results = document.evaluate(
            testPath,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
          );

          // If we found a unique path, return it
          if (results.snapshotLength === 1) {
            return testPath;
          }

          current = current.parentElement;
        }

        // Return the full path if no unique shorter path was found
        return "//" + path.join("/");
      }

      // Generate XPath by text with escaping for quotes
      function getXPathByText(el) {
        const text = el?.textContent?.trim();
        if (!el || !text) return "";

        // Handle quotes in text content by using concat() if needed
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

        // Check if this xpath is unique, if not, add index
        const matchingElements = document.evaluate(
          xpathText,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        if (matchingElements.snapshotLength > 1) {
          // Find the index of our element
          let elementIndex = -1;
          for (let i = 0; i < matchingElements.snapshotLength; i++) {
            if (matchingElements.snapshotItem(i) === el) {
              elementIndex = i + 1; // XPath indexes start at 1
              break;
            }
          }
          if (elementIndex > 0) {
            xpathText = `(${xpathText})[${elementIndex}]`;
          }
        }

        return xpathText;
      }

      // Generate partial text XPath with better text handling
      function getPartialTextXPath(el) {
        const text = el?.textContent?.trim();
        if (!el || !text) return "";

        // Use a meaningful substring, not just first 10 chars
        const cleanText = text.replace(/\s+/g, " ");
        const partialText =
          cleanText.length > 20 ? cleanText.substring(0, 20) : cleanText;

        // Handle quotes in text appropriately
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

        // Check if this xpath is unique, if not, add index
        const matchingElements = document.evaluate(
          xpathText,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        if (matchingElements.snapshotLength > 1) {
          // Find the index of our element
          let elementIndex = -1;
          for (let i = 0; i < matchingElements.snapshotLength; i++) {
            if (matchingElements.snapshotItem(i) === el) {
              elementIndex = i + 1; // XPath indexes start at 1
              break;
            }
          }
          if (elementIndex > 0) {
            xpathText = `(${xpathText})[${elementIndex}]`;
          }
        }

        return xpathText;
      }

      // NEW: Generate XPath by name attribute
      function getXPathByName(el) {
        const name = el?.getAttribute("name");
        if (!el || !name) return "";

        const xpath = `//${el.nodeName.toLowerCase()}[@name="${name}"]`;

        // Check if this xpath is unique, if not, add index
        const matchingElements = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );

        if (matchingElements.snapshotLength > 1) {
          // Find the index of our element
          let elementIndex = -1;
          for (let i = 0; i < matchingElements.snapshotLength; i++) {
            if (matchingElements.snapshotItem(i) === el) {
              elementIndex = i + 1; // XPath indexes start at 1
              break;
            }
          }
          if (elementIndex > 0) {
            return `(${xpath})[${elementIndex}]`;
          }
        }

        return xpath;
      }

      // NEW: Generate XPath by link text (for anchor elements)
      function getXPathByLinkText(el) {
        if (!el || el.nodeName.toLowerCase() !== "a") return "";
        const text = el.textContent?.trim();
        if (!text) return "";

        // Handle quotes in text
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

        // Check if this xpath is unique, if not, add index
        const matchingElements = document.evaluate(
          xpathText,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );

        if (matchingElements.snapshotLength > 1) {
          // Find the index of our element
          let elementIndex = -1;
          for (let i = 0; i < matchingElements.snapshotLength; i++) {
            if (matchingElements.snapshotItem(i) === el) {
              elementIndex = i + 1; // XPath indexes start at 1
              break;
            }
          }
          if (elementIndex > 0) {
            return `(${xpathText})[${elementIndex}]`;
          }
        }

        return xpathText;
      }

      // NEW: Generate XPath by partial link text (for anchor elements)
      function getXPathByPartialLinkText(el) {
        if (!el || el.nodeName.toLowerCase() !== "a") return "";
        const text = el.textContent?.trim();
        if (!text) return "";

        // Use partial text for longer content
        const partialText = text.length > 15 ? text.substring(0, 15) : text;

        // Handle quotes in text
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

        // Check if this xpath is unique, if not, add index
        const matchingElements = document.evaluate(
          xpathText,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );

        if (matchingElements.snapshotLength > 1) {
          // Find the index of our element
          let elementIndex = -1;
          for (let i = 0; i < matchingElements.snapshotLength; i++) {
            if (matchingElements.snapshotItem(i) === el) {
              elementIndex = i + 1; // XPath indexes start at 1
              break;
            }
          }
          if (elementIndex > 0) {
            return `(${xpathText})[${elementIndex}]`;
          }
        }

        return xpathText;
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
        if (el.className && typeof el.className === "string") {
          const classes = el.className.trim().split(/\s+/).filter(Boolean);
          if (classes.length) {
            // For single classes with index if needed
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
                // Find the index of our element
                let elementIndex = -1;
                for (let i = 0; i < matchingElements.snapshotLength; i++) {
                  if (matchingElements.snapshotItem(i) === el) {
                    elementIndex = i + 1; // XPath indexes start at 1
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

            // For multiple classes (more specific)
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
                // Find the index of our element
                let elementIndex = -1;
                for (let i = 0; i < matchingElements.snapshotLength; i++) {
                  if (matchingElements.snapshotItem(i) === el) {
                    elementIndex = i + 1; // XPath indexes start at 1
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

        // Attribute-based XPaths
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
              // Find the index of our element
              let elementIndex = -1;
              for (let i = 0; i < matchingElements.snapshotLength; i++) {
                if (matchingElements.snapshotItem(i) === el) {
                  elementIndex = i + 1; // XPath indexes start at 1
                  break;
                }
              }
              if (elementIndex > 0) {
                paths.push(`(${xpath})[${elementIndex}]`);
              }
            } else {
              paths.push(xpath);
            }

            // For partial matches on longer attributes
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
                // Find the index of our element
                let elementIndex = -1;
                for (let i = 0; i < matchingElements.snapshotLength; i++) {
                  if (matchingElements.snapshotItem(i) === el) {
                    elementIndex = i + 1; // XPath indexes start at 1
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

        // Text-based XPaths
        const textContent = el.textContent.trim();
        if (textContent) {
          // Handle quotes properly
          let quoteSafeText, textXpath;
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
            // Find the index of our element
            let elementIndex = -1;
            for (let i = 0; i < matchingElements.snapshotLength; i++) {
              if (matchingElements.snapshotItem(i) === el) {
                elementIndex = i + 1; // XPath indexes start at 1
                break;
              }
            }
            if (elementIndex > 0) {
              paths.push(`(${textXpath})[${elementIndex}]`);
            }
          } else {
            paths.push(textXpath);
          }

          // For longer text, use contains
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
              // Find the index of our element
              let elementIndex = -1;
              for (let i = 0; i < matchingElements.snapshotLength; i++) {
                if (matchingElements.snapshotItem(i) === el) {
                  elementIndex = i + 1; // XPath indexes start at 1
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

        // Position-based XPaths (absolute and relative)
        paths.push(getIndexedXPath(el));
        paths.push(getAbsoluteXPath(el));
        paths.push(getRelativeXPath(el));

        // Hybrid XPaths (combine attributes for more precision)
        const hybridAttributes = [];
        for (const attr of ["id", "name", "class", "type"]) {
          let value;
          if (attr === "class" && el.className) {
            value = el.className.trim().split(/\s+/)[0]; // First class
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
            // Find the index of our element
            let elementIndex = -1;
            for (let i = 0; i < matchingElements.snapshotLength; i++) {
              if (matchingElements.snapshotItem(i) === el) {
                elementIndex = i + 1; // XPath indexes start at 1
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

        // Generate accurate indexed XPath
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

        // Filter out duplicate paths and empty ones
        return [...new Set(paths.filter(Boolean))];
      }

      // Get DOM changes and network requests
      const domChanges = domDiffer.stopTracking();
      const networkRequests = networkMapper.stopTracking();
      const performanceMetrics = performanceTracker.endMeasure(
        "generation",
        "all"
      );

      // Add metrics to the locators object
      return {
        cssSelector: getCssSelector(element),
        absoluteXPath: getAbsoluteXPath(element),
        relativeXPath: getRelativeXPath(element),
        xpathByText: getXPathByText(element),
        partialTextXPath: getPartialTextXPath(element),
        // New locator types
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
        // Add data attributes that are commonly used for testing
        dataTestId:
          element.getAttribute("data-testid") ||
          element.getAttribute("data-test-id") ||
          null,
        ariaLabel: element.getAttribute("aria-label") || null,
        role: element.getAttribute("role") || null,
        _metadata: {
          domChanges: {
            mutations: domChanges.mutations,
            added: domChanges.added.length,
            removed: domChanges.removed.length,
            modified: domChanges.modified.length,
            total: domChanges.mutations.length,
          },
          networkRequests: networkRequests,
          performance: {
            duration: performanceMetrics?.duration || 0,
          },
        },
      };
    }

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
      if (highlightedElement && highlightedElement.style) {
        highlightedElement.style.outline = "";
        highlightedElement.style.outlineOffset = "";
        highlightedElement = null;
      }
      hideBestLocatorBanner();
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
          console.warn("Extension context invalidated - stopping retries");
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
        console.error("Error in context check:", error);
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

      try {
        switch (type.toLowerCase()) {
          case "xpath":
          case "relative xpath":
          case "absolute xpath":
          case "xpath by name":
          case "xpath by text":
          case "xpath by partial text":
            const result = document.evaluate(
              value,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            element = result.singleNodeValue;
            break;

          case "id":
            element = document.getElementById(value);
            break;

          case "css selector":
            element = document.querySelector(value);
            break;

          case "class name":
            element = document.getElementsByClassName(value)[0];
            break;

          case "tag name":
            const elements = Array.from(document.getElementsByTagName(value));
            element = elements[0]; // Get first matching element
            if (elements.length > 1) {
              // If hovering over an element, find its index
              if (hoveredElement && elements.includes(hoveredElement)) {
                element = hoveredElement;
              }
            }
            break;

          case "link text":
            const exactLinks = Array.from(
              document.getElementsByTagName("a")
            ).filter((link) => link.textContent.trim() === value);
            element = exactLinks[0];
            if (exactLinks.length > 1) {
              // If hovering over a link, use that one
              if (hoveredElement && exactLinks.includes(hoveredElement)) {
                element = hoveredElement;
              }
              // Add index information to the validation result
              chrome.runtime.sendMessage({
                action: "validationResult",
                success: true,
                locatorType: type,
                locatorValue: value,
                additionalInfo: `Found ${exactLinks.length
                  } matches. Using index ${exactLinks.indexOf(element) + 1}.`,
              });
            }
            break;

          case "partial link text":
            const partialLinks = Array.from(
              document.getElementsByTagName("a")
            ).filter((link) => link.textContent.includes(value));
            element = partialLinks[0];
            if (partialLinks.length > 1) {
              // If hovering over a link, use that one
              if (hoveredElement && partialLinks.includes(hoveredElement)) {
                element = hoveredElement;
              }
              // Add index information to the validation result
              chrome.runtime.sendMessage({
                action: "validationResult",
                success: true,
                locatorType: type,
                locatorValue: value,
                additionalInfo: `Found ${partialLinks.length
                  } matches. Using index ${partialLinks.indexOf(element) + 1}.`,
              });
            }
            break;

          default:
            // For other attribute-based selectors
            const selector = `[${type.toLowerCase()}="${value}"]`;
            element = document.querySelector(selector);
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

    // Add a function to toggle the best locator banner
    function toggleBestLocator(enable) {
      isBestLocatorEnabled = enable;
      console.log("Best locator toggled:", enable);

      if (!enable) {
        hideBestLocatorBanner();
        if (bestLocatorBanner) {
          bestLocatorBanner.remove();
          bestLocatorBanner = null;
        }
      }

      chrome.storage.local.set({ isBestLocatorEnabled: enable }, () => {
        console.log("Best locator preference saved:", enable);
      });
    }

    // Initialize the content script
    function initialize() {
      try {
        setupMessageListener();
        checkContextValidity();

        // Wait for preferences to load before continuing initialization
        loadBestLocatorPreference(() => {
          sendMessageToBackground({
            action: "contentScriptReady",
            url: window.location.href,
            iconUrl: chrome.runtime.getURL("popup/icons/icon48.png"),
          });
          console.log(
            "Content script initialized successfully with preferences loaded"
          );
        });
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
