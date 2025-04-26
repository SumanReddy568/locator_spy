document.addEventListener("DOMContentLoaded", function () {
  const locatorModeBtn = document.getElementById("locatorModeBtn");
  const locatorResults = document.getElementById("locatorResults");
  const savedLocators = document.getElementById("savedLocators");
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const copyNotification = document.getElementById("copyNotification");

  let isLocatorModeActive = false;

  // Initialize theme from local storage
  if (localStorage.getItem("theme") === "dark") {
    document.body.classList.add("dark-mode");
    document.body.classList.remove("light-mode");
  } else {
    document.body.classList.add("light-mode");
    document.body.classList.remove("dark-mode");
  }

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
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const tabId = tabs[0].id;

      // Check if content.js is already injected
      chrome.scripting.executeScript(
        {
          target: { tabId: tabId },
          files: ["content.js"],
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error(
              "Failed to inject content script:",
              chrome.runtime.lastError.message
            );
          } else {
            console.log("Content script injected successfully");
            // Send a message to activate locator mode
            chrome.tabs.sendMessage(tabId, {
              action: "activateLocatorMode",
              isActive: true,
            });
          }
        }
      );
    });

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: "activateLocatorMode" },
        function (response) {
          if (chrome.runtime.lastError) {
            console.error(
              "Error activating locator mode:",
              chrome.runtime.lastError.message
            );
          } else {
            console.log("Locator mode activated");
          }
        }
      );

      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: "ping" },
          function (response) {
            if (chrome.runtime.lastError) {
              console.error(
                "Content script not available:",
                chrome.runtime.lastError.message
              );
              alert(
                "Please open the DevTools panel or reload the page to activate the extension."
              );
            } else {
              console.log("Content script is available");
            }
          }
        );
      });
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

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener(function (
    request,
    sender,
    sendResponse
  ) {
    if (request.action === "getLocators") {
      displayLocators(request.locators);
    }

    if (request.action === "locatorModeDeactivated") {
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

  // Display locators in the popup
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
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1-2-2h9a2 2 0 0 1 2 2v1"></path>
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
          <button class="validate-btn" data-type="${type}" data-value="${escapeHtml(value)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
            Validate
          </button>
          <button class="copy-btn" data-value="${escapeHtml(value)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1-2-2h9a2 2 0 0 1-2 2v1"></path>
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

  // Add listener for validation results
  chrome.runtime.onMessage.addListener(function (message) {
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

          // Reset after 3 seconds
          setTimeout(() => {
            if (!btn.classList.contains("validating")) {
              btn.classList.remove("validation-success", "validation-failed");
              btn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
                Validate
              `;
            }
          }, 3000);
        }
      });
    }
  });

  // Helper function to copy to clipboard
  function copyToClipboard(text, buttonElement) {
    // Create a temporary textarea element
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);

    // Select the text and copy
    textarea.select();
    document.execCommand("copy");

    // Remove the textarea
    document.body.removeChild(textarea);

    // Change button text temporarily
    const originalHTML = buttonElement.innerHTML;
    buttonElement.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      Copied!
    `;

    // Show global notification
    copyNotification.classList.add("show");

    // Reset after 2 seconds
    setTimeout(() => {
      buttonElement.innerHTML = originalHTML;
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

  // Load saved locators
  function loadSavedLocators() {
    chrome.storage.local.get(["savedLocators"], function (result) {
      if (result.savedLocators && result.savedLocators.length > 0) {
        let html = "";
        result.savedLocators.forEach((item, index) => {
          html += `
            <div class="locator-item">
              <div><strong>${new Date(
                item.timestamp
              ).toLocaleString()}</strong></div>
              <div>${item.url}</div>
              <div class="locator-value">${
                item.locators.cssSelector || item.locators.xpath
              }</div>
              <button class="copy-btn" data-value="${escapeHtml(
                item.locators.cssSelector || item.locators.xpath
              )}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1-2-2h9a2 2 0 0 1-2 2v1"></path>
                </svg>
                Copy
              </button>
            </div>
          `;
        });
        savedLocators.innerHTML = html;

        // Add event listeners to copy buttons
        document.querySelectorAll("#savedLocators .copy-btn").forEach((btn) => {
          btn.addEventListener("click", function () {
            const value = this.getAttribute("data-value");
            copyToClipboard(value, this);
          });
        });
      } else {
        savedLocators.innerHTML =
          '<p class="placeholder">No saved locators yet</p>';
      }
    });
  }

  // Initial load of saved locators
  // loadSavedLocators();
});

// Dropdown menu functionality
document.addEventListener("DOMContentLoaded", () => {
  const menuBtn = document.getElementById("menuBtn");
  const dropdownMenu = document.getElementById("dropdownMenu");

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle("show");
    menuBtn.setAttribute(
      "aria-expanded",
      dropdownMenu.classList.contains("show")
    );
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!menuBtn.contains(e.target)) {
      dropdownMenu.classList.remove("show");
      menuBtn.setAttribute("aria-expanded", "false");
    }
  });

  // Prevent dropdown from closing when clicking inside
  dropdownMenu.addEventListener("click", (e) => {
    e.stopPropagation();
  });
});
