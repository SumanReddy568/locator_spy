document.addEventListener("DOMContentLoaded", function () {
  const locatorModeBtn = document.getElementById("locatorModeBtn");
  const locatorResults = document.getElementById("locatorResults");
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const menuBtn = document.getElementById("menuBtn");
  const dropdownContent = document.querySelector(".dropdown-content");
  const copyNotification = document.getElementById("copyNotification");
  const searchBoxInput = document.querySelector(".search-box input");
  const expandAllBtn = document.querySelector(
    '.section-actions button[title="Expand All"]'
  );
  const copyAllBtn = document.querySelector(
    '.section-actions .action-btn[title="Copy All"]'
  );
  const bestLocatorToggle = document.getElementById("bestLocatorToggle");
  const autoValidatorToggle = document.getElementById("autoValidatorToggle");

  let isLocatorModeActive = false;

  // Initialize theme from local storage
  if (localStorage.getItem("theme") === "dark") {
    document.body.classList.add("dark-mode");
    document.body.classList.remove("light-mode");
  } else {
    document.body.classList.add("light-mode");
    document.body.classList.remove("dark-mode");
  }

  // Create a connection to the background page
  const backgroundPageConnection = chrome.runtime.connect({
    name: "panel-page",
  });

  // Relay the tab ID to the background page
  backgroundPageConnection.postMessage({
    name: "init",
    tabId: chrome.devtools.inspectedWindow.tabId,
  });

  // Toggle locator mode with animation
  locatorModeBtn.addEventListener("click", function () {
    isLocatorModeActive = !isLocatorModeActive;

    if (isLocatorModeActive) {
      locatorModeBtn.classList.add("active-mode");
      locatorModeBtn.classList.remove("pulse-animation");
      locatorModeBtn.innerHTML = `
        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
        </svg>
        Locator Mode (Active)
      `;
    } else {
      locatorModeBtn.classList.remove("active-mode");
      locatorModeBtn.innerHTML = `
        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
        </svg>
        Locator Mode
      `;
    }

    // Send message to background script
    backgroundPageConnection.postMessage({
      action: "activateLocatorMode",
      isActive: isLocatorModeActive,
      tabId: chrome.devtools.inspectedWindow.tabId,
    });
  });

  // Toggle theme
  themeToggleBtn.addEventListener("click", function () {
    if (document.body.classList.contains("light-mode")) {
      document.body.classList.remove("light-mode");
      document.body.classList.add("dark-mode");
      localStorage.setItem("theme", "dark");
    } else {
      document.body.classList.remove("dark-mode");
      document.body.classList.add("light-mode");
      localStorage.setItem("theme", "light");
    }
  });

  // Toggle dropdown menu
  menuBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    dropdownContent.classList.toggle("show");
  });

  // Close dropdown when clicking elsewhere
  document.addEventListener("click", function () {
    if (dropdownContent.classList.contains("show")) {
      dropdownContent.classList.remove("show");
    }
  });

  // Listen for messages from the background page
  backgroundPageConnection.onMessage.addListener(function (message) {
    console.log("Received message in panel:", message);

    if (message.action === "getLocators") {
      displayLocators(message.locators);
    }

    if (message.action === "locatorModeDeactivated") {
      isLocatorModeActive = false;
      locatorModeBtn.classList.remove("active-mode");
      locatorModeBtn.innerHTML = `
        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
        </svg>
        Locator Mode
      `;
    }
  });

  // Add validation listener
  backgroundPageConnection.onMessage.addListener(function (message) {
    if (message.action === "validationResult") {
      const btns = document.querySelectorAll(".validate-btn");
      btns.forEach((btn) => {
        if (
          btn.dataset.type === message.locatorType &&
          btn.dataset.value === message.locatorValue
        ) {
          btn.classList.remove("validating");

          if (message.success) {
            btn.classList.remove("validation-failed");
            btn.classList.add("validation-success");
            btn.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
              Valid
            `;
          } else {
            btn.classList.remove("validation-success");
            btn.classList.add("validation-failed");
            btn.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              Failed
            `;
          }
        }
      });
    }
  });

  // Update displayLocators function to include validation for all XPath locators
  function displayLocators(locators) {
    // Reset validation states
    document.querySelectorAll('.validate-btn').forEach(btn => {
      btn.classList.remove('validation-success', 'validation-failed', 'validating');
      btn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1-7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
        </svg>
        Validate
      `;
    });

    if (!locators || Object.keys(locators).length === 0) {
      locatorResults.innerHTML =
        '<p class="placeholder">No locators found for this element</p>';
      return;
    }

    // Sanitize XPath values
    if (locators.xpath) {
      locators.xpath = sanitizeXPath(locators.xpath);
    }

    if (locators.allXPaths) {
      locators.allXPaths = locators.allXPaths.map((xpath) =>
        sanitizeXPath(xpath)
      );
    }

    let html = "";
    html += '<div class="locators-table">';

    // Display high priority locators first
    if (locators.id) {
      html += createLocatorItem("ID", locators.id);
    }

    if (locators.dataTestId) {
      html += createLocatorItem("Data Test ID", locators.dataTestId);
    }

    if (locators.cssSelector) {
      html += createLocatorItem("CSS Selector", locators.cssSelector);
    }

    // Display all XPath related locators
    if (locators.relativeXPath) {
      html += createLocatorItem("Relative XPath", locators.relativeXPath);
    }

    if (locators.absoluteXPath) {
      html += createLocatorItem("Absolute XPath", locators.absoluteXPath);
    }

    if (locators.xpathByName) {
      html += createLocatorItem("XPath by Name", locators.xpathByName);
    }

    if (locators.xpathByText) {
      html += createLocatorItem("XPath by Text", locators.xpathByText);
    }

    if (locators.partialTextXPath) {
      html += createLocatorItem(
        "XPath by Partial Text",
        locators.partialTextXPath
      );
    }

    // Display All XPaths section with validation
    if (locators.allXPaths && locators.allXPaths.length > 0) {
      html += `<div class="locator-item"><span class="locator-type">All XPaths:</span></div>`;
      locators.allXPaths.forEach((xpath) => {
        html += `
          <div class="locator-item">
            <span class="locator-value">${xpath}</span>
            <div class="locator-actions">
              <button class="validate-btn" data-type="XPath" data-value="${escapeHtml(
                xpath
              )}" title="Validate locator">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1-7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                </svg>
                Validate
              </button>
              <button class="copy-btn" data-value="${escapeHtml(xpath)}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                Copy
              </button>
            </div>
          </div>
        `;
      });
    }

    // Display lower priority locators at the bottom
    if (locators.className) {
      html += createLocatorItem("Class Name", locators.className);
    }

    if (locators.tagName) {
      html += createLocatorItem("Tag Name", locators.tagName);
    }

    if (locators.linkText) {
      html += createLocatorItem("Link Text", locators.linkText);
    }

    if (locators.partialLinkText) {
      html += createLocatorItem("Partial Link Text", locators.partialLinkText);
    }

    html += "</div>";
    locatorResults.innerHTML = html;

    // Add event listeners to copy and validate buttons
    document.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        const value = this.getAttribute("data-value");
        copyToClipboard(value, this);
      });
    });

    addValidationListeners();
    autoValidateLocators(locators); // Trigger auto-validation if enabled
  }

  // Helper function to create locator item
  function createLocatorItem(type, value) {
    return `
      <div class="locator-item">
        <span class="locator-type">${type}:</span>
        <span class="locator-value">${value}</span>
        <div class="locator-actions">
          <button class="validate-btn" data-type="${type}" data-value="${escapeHtml(value)}" title="Validate locator">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1-7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
            </svg>
            Validate
          </button>
          <button class="copy-btn" data-value="${escapeHtml(value)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy
          </button>
        </div>
      </div>
    `;
  }

  // Add event listener for validate buttons
  function addValidationListeners() {
    document.querySelectorAll(".validate-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        const type = this.getAttribute("data-type");
        const value = this.getAttribute("data-value");

        // Send validation request to content script
        chrome.tabs.query(
          { active: true, currentWindow: true },
          function (tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "validateLocator",
              locatorType: type,
              locatorValue: value,
            });
          }
        );

        // Add visual feedback
        this.classList.add("validating");
        setTimeout(() => {
          this.classList.remove("validating");
        }, 2000);
      });
    });
  }

  // Replace your current refresh button code with this:
  const refreshBtn = document.getElementById("refreshBtn");

  refreshBtn.addEventListener("click", () => {
    console.log("Refresh button clicked. Clearing locators...");

    // Clear selected locators
    locatorResults.innerHTML =
      '<p class="placeholder">Activate locator mode and hover over elements to see locators</p>';

    // Reset locator mode if it's active
    if (isLocatorModeActive) {
      isLocatorModeActive = false;
      locatorModeBtn.classList.remove("active-mode");
      locatorModeBtn.innerHTML = `
      <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
      </svg>
      Locator Mode
    `;

      // Notify background script to deactivate locator mode
      backgroundPageConnection.postMessage({
        action: "activateLocatorMode",
        isActive: false,
        tabId: chrome.devtools.inspectedWindow.tabId,
      });
    }
  });

  // Filter locators based on search input
  searchBoxInput.addEventListener("input", function () {
    const filterText = this.value.toLowerCase();
    const locatorItems = document.querySelectorAll(
      "#locatorResults .locator-item"
    );
    locatorItems.forEach((item) => {
      const locatorTypeElement = item.querySelector(".locator-type");
      const locatorValueElement = item.querySelector(".locator-value");

      // Add null checks for child elements
      if (locatorTypeElement && locatorValueElement) {
        const locatorType = locatorTypeElement.textContent.toLowerCase();
        const locatorValue = locatorValueElement.textContent.toLowerCase();
        if (
          locatorType.includes(filterText) ||
          locatorValue.includes(filterText)
        ) {
          item.style.display = "";
        } else {
          item.style.display = "none";
        }
      }
    });
  });

  // Copy all visible locators
  copyAllBtn.addEventListener("click", function () {
    const allLocatorTexts = [];
    const locatorItems = document.querySelectorAll(
      "#locatorResults .locator-item"
    );

    locatorItems.forEach((item) => {
      const locatorTypeElement = item.querySelector(".locator-type");
      const locatorValueElement = item.querySelector(".locator-value");

      // Only process items that have both type and value elements
      if (locatorTypeElement && locatorValueElement) {
        const isHidden =
          item.style.display === "none" ||
          window.getComputedStyle(item).display === "none";
        const type = locatorTypeElement.textContent.replace(":", "").trim();

        // Skip items that are hidden or only contain header text (like "All XPaths:")
        if (!isHidden && type !== "All XPaths") {
          const value = locatorValueElement.textContent.trim();
          allLocatorTexts.push(`${type}: ${value}`);
        }
      }
    });

    if (allLocatorTexts.length > 0) {
      const textToCopy = allLocatorTexts.join("\n\n");
      copyToClipboard(textToCopy);
      showCopyNotification("Locators copied to clipboard!");
    } else {
      showCopyNotification("No locators available to copy");
    }
  });

  // Helper function to copy to clipboard that works in Chrome extensions
  function copyToClipboard(text, buttonElement = null) {
    if (!text) {
      showCopyNotification("No locator available to copy");
      return;
    }

    // Use the newer navigator.clipboard API when available
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          showCopyNotification("Locator copied to clipboard!");
          if (buttonElement) {
            buttonElement.classList.add("copied");
            setTimeout(() => {
              buttonElement.classList.remove("copied");
            }, 1000);
          }
        })
        .catch((err) => {
          console.error("Failed to copy: ", err);
          // Fall back to the older method
          fallbackCopyToClipboard(text, buttonElement);
        });
    } else {
      // Use the older method as fallback
      fallbackCopyToClipboard(text, buttonElement);
    }
  }

  // Add this helper function for fallback copying
  function fallbackCopyToClipboard(text, buttonElement) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);

    try {
      textarea.select();
      const success = document.execCommand("copy");
      if (success) {
        showCopyNotification("Locator copied to clipboard!");
        if (buttonElement) {
          buttonElement.classList.add("copied");
          setTimeout(() => {
            buttonElement.classList.remove("copied");
          }, 1000);
        }
      } else {
        showCopyNotification("Failed to copy to clipboard");
      }
    } catch (err) {
      console.error("Failed to copy: ", err);
      showCopyNotification("Failed to copy to clipboard");
    } finally {
      document.body.removeChild(textarea);
    }
  }

  // Helper function to show copy notification
  function showCopyNotification(message) {
    copyNotification.textContent = message; // Set the notification message
    copyNotification.classList.add("show");
    setTimeout(() => {
      copyNotification.classList.remove("show");
    }, 2000);
  }

  // Helper function to escape HTML
  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Add this function near the other helper functions
  function sanitizeXPath(xpath) {
    // Remove invalid triple slashes
    xpath = xpath.replace(/^\/\/\//, "//");

    // Remove any invalid characters
    xpath = xpath.replace(/[^\w\s\-\[\]@\(\)\.\/\*='"]/g, "");

    return xpath;
  }

  chrome.storage.local.get("isBestLocatorEnabled", (result) => {
    const isEnabled = result.hasOwnProperty("isBestLocatorEnabled")
      ? result.isBestLocatorEnabled
      : true;
    chrome.storage.local.set({ isBestLocatorEnabled: isEnabled }); // Ensure default is true
    bestLocatorToggle.checked = isEnabled;
  });

  bestLocatorToggle.addEventListener("change", (event) => {
    const isEnabled = event.target.checked;
    chrome.storage.local.set({ isBestLocatorEnabled: isEnabled }, () => {
      console.log("Best locator setting updated in storage:", isEnabled);
      backgroundPageConnection.postMessage({
        action: "toggleBestLocator",
        enable: isEnabled,
        tabId: chrome.devtools.inspectedWindow.tabId,
      });
    });
  });

  chrome.storage.local.get("isBestLocatorEnabled", (result) => {
    bestLocatorToggle.checked = result.isBestLocatorEnabled ?? true;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.isBestLocatorEnabled) {
      bestLocatorToggle.checked = changes.isBestLocatorEnabled.newValue;
    }
  });

  // Release notes panel functionality
  const releaseNotesBtn = document.getElementById("releaseNotesBtn");
  const releaseNotesPanel = document.querySelector(".release-notes-panel");
  const closeReleaseNotesBtn = document.querySelector(".close-release-notes");

  releaseNotesBtn.addEventListener("click", () => {
    releaseNotesPanel.classList.add("show");
    dropdownContent.classList.remove("show");
  });

  closeReleaseNotesBtn.addEventListener("click", () => {
    releaseNotesPanel.classList.remove("show");
  });

  // Close release notes panel when clicking outside
  document.addEventListener("click", (e) => {
    if (
      !releaseNotesPanel.contains(e.target) &&
      !releaseNotesBtn.contains(e.target) &&
      releaseNotesPanel.classList.contains("show")
    ) {
      releaseNotesPanel.classList.remove("show");
    }
  });

  // Initialize "Auto Validator" toggle state from storage
  chrome.storage.local.get("isAutoValidatorEnabled", (result) => {
    const isEnabled = result.hasOwnProperty("isAutoValidatorEnabled")
      ? result.isAutoValidatorEnabled
      : false;
    chrome.storage.local.set({ isAutoValidatorEnabled: isEnabled }); // Ensure default is false
    autoValidatorToggle.checked = isEnabled;
  });

  // Update storage and behavior when "Auto Validator" toggle changes
  autoValidatorToggle.addEventListener("change", (event) => {
    const isEnabled = event.target.checked;
    chrome.storage.local.set({ isAutoValidatorEnabled: isEnabled }, () => {
      console.log("Auto Validator setting updated in storage:", isEnabled);
    });
  });

  // Automatically validate locators if "Auto Validator" is enabled
  function autoValidateLocators(locators) {
    chrome.storage.local.get("isAutoValidatorEnabled", (result) => {
      const allLocators = [];
      
      // Collect all available locators with their types
      if (locators.id) allLocators.push({ type: 'ID', value: locators.id });
      if (locators.dataTestId) allLocators.push({ type: 'Data Test ID', value: locators.dataTestId });
      if (locators.cssSelector) allLocators.push({ type: 'CSS Selector', value: locators.cssSelector });
      if (locators.relativeXPath) allLocators.push({ type: 'Relative XPath', value: locators.relativeXPath });
      if (locators.absoluteXPath) allLocators.push({ type: 'Absolute XPath', value: locators.absoluteXPath });
      if (locators.xpathByName) allLocators.push({ type: 'XPath by Name', value: locators.xpathByName });
      if (locators.xpathByText) allLocators.push({ type: 'XPath by Text', value: locators.xpathByText });
      if (locators.partialTextXPath) allLocators.push({ type: 'XPath by Partial Text', value: locators.partialTextXPath });
      // Add lower priority locators
      if (locators.className) allLocators.push({ type: 'Class Name', value: locators.className });
      if (locators.tagName) allLocators.push({ type: 'Tag Name', value: locators.tagName });
      if (locators.linkText) allLocators.push({ type: 'Link Text', value: locators.linkText });
      if (locators.partialLinkText) allLocators.push({ type: 'Partial Link Text', value: locators.partialLinkText });
      if (locators.allXPaths) {
        locators.allXPaths.forEach(xpath => allLocators.push({ type: 'XPath', value: xpath }));
      }

      if (result.isAutoValidatorEnabled) {
        // Auto validate all locators
        allLocators.forEach(({ type, value }) => {
          // Find and update the button state before validation
          const buttons = document.querySelectorAll('.validate-btn');
          buttons.forEach(btn => {
            if (btn.dataset.type === type && btn.dataset.value === value) {
              btn.classList.add('validating');
              btn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
                Validating...
              `;
            }
          });

          // Send validation request
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "validateLocator",
              locatorType: type,
              locatorValue: value
            });
          });
        });
      }
    });
  }

  // Listen for storage changes to update the toggle state dynamically
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.isAutoValidatorEnabled) {
      autoValidatorToggle.checked = changes.isAutoValidatorEnabled.newValue;
    }
  });

  // Add dock position detection
  const dockWarning = document.getElementById("dockWarning");
  
  function checkDockPosition() {
    const rect = document.body.getBoundingClientRect();
    const isNotBottomDocked = rect.height > rect.width;
    
    if (isNotBottomDocked) {
      dockWarning.style.display = "flex";
    } else {
      dockWarning.style.display = "none";
    }
  }

  // Check dock position on load and window resize
  checkDockPosition();
  window.addEventListener("resize", checkDockPosition);
});

document.addEventListener("DOMContentLoaded", function () {
  // Check if opened from notification
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("showReleaseNotes") === "true") {
    const releaseNotesPanel = document.querySelector(".release-notes-panel");
    releaseNotesPanel.classList.add("show");
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const scrollDownBtn = document.getElementById("scrollDownBtn");
  if (scrollDownBtn) {
    scrollDownBtn.addEventListener("click", () => {
      const targetSelector = scrollDownBtn.getAttribute("data-target");
      const targetElement = document.querySelector(targetSelector);
      if (targetElement) {
        targetElement.scrollBy({ top: 100, behavior: "smooth" });
      }
    });
  }
});