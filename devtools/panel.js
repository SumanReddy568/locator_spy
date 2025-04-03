document.addEventListener('DOMContentLoaded', function () {
  const locatorModeBtn = document.getElementById('locatorModeBtn');
  const locatorResults = document.getElementById('locatorResults');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const menuBtn = document.getElementById('menuBtn');
  const dropdownContent = document.querySelector('.dropdown-content');
  const copyNotification = document.getElementById('copyNotification');
  const searchBoxInput = document.querySelector('.search-box input');
  const expandAllBtn = document.querySelector('.section-actions button[title="Expand All"]');
  const copyAllBtn = document.querySelector('.section-actions .action-btn[title="Copy All"]');

  let isLocatorModeActive = false;

  // Initialize theme from local storage
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-mode');
    document.body.classList.remove('light-mode');
  } else {
    document.body.classList.add('light-mode');
    document.body.classList.remove('dark-mode');
  }

  // Create a connection to the background page
  const backgroundPageConnection = chrome.runtime.connect({
    name: "panel-page"
  });

  // Relay the tab ID to the background page
  backgroundPageConnection.postMessage({
    name: 'init',
    tabId: chrome.devtools.inspectedWindow.tabId
  });

  // Toggle locator mode with animation
  locatorModeBtn.addEventListener('click', function () {
    isLocatorModeActive = !isLocatorModeActive;

    if (isLocatorModeActive) {
      locatorModeBtn.classList.add('active-mode');
      locatorModeBtn.classList.remove('pulse-animation');
      locatorModeBtn.innerHTML = `
        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
        </svg>
        Locator Mode (Active)
      `;
    } else {
      locatorModeBtn.classList.remove('active-mode');
      locatorModeBtn.innerHTML = `
        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
        </svg>
        Locator Mode
      `;
    }

    // Send message to background script
    backgroundPageConnection.postMessage({
      action: 'activateLocatorMode',
      isActive: isLocatorModeActive,
      tabId: chrome.devtools.inspectedWindow.tabId
    });
  });

  // Toggle theme
  themeToggleBtn.addEventListener('click', function () {
    if (document.body.classList.contains('light-mode')) {
      document.body.classList.remove('light-mode');
      document.body.classList.add('dark-mode');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.remove('dark-mode');
      document.body.classList.add('light-mode');
      localStorage.setItem('theme', 'light');
    }
  });

  // Toggle dropdown menu
  menuBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    dropdownContent.classList.toggle('show');
  });

  // Close dropdown when clicking elsewhere
  document.addEventListener('click', function () {
    if (dropdownContent.classList.contains('show')) {
      dropdownContent.classList.remove('show');
    }
  });

  // Listen for messages from the background page
  backgroundPageConnection.onMessage.addListener(function (message) {
    console.log("Received message in panel:", message);

    if (message.action === 'getLocators') {
      displayLocators(message.locators);
    }

    if (message.action === 'locatorModeDeactivated') {
      isLocatorModeActive = false;
      locatorModeBtn.classList.remove('active-mode');
      locatorModeBtn.innerHTML = `
        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
        </svg>
        Locator Mode
      `;
    }
  });

  // Display locators in the devtools panel
  function displayLocators(locators) {
    if (!locators || Object.keys(locators).length === 0) {
      locatorResults.innerHTML = '<p class="placeholder">No locators found for this element</p>';
      return;
    }

    let html = '';

    // Create table structure
    html += '<div class="locators-table">';

    // Display CSS Selector
    if (locators.cssSelector) {
      html += createLocatorItem('CSS Selector', locators.cssSelector);
    }

    // Display XPath
    if (locators.xpath) {
      html += createLocatorItem('XPath', locators.xpath);
    }

    // Display other locators
    const otherTypes = [
      { key: 'id', label: 'ID' },
      { key: 'className', label: 'Class Name' },
      { key: 'name', label: 'Name' },
      { key: 'tagName', label: 'Tag Name' },
      { key: 'linkText', label: 'Link Text' },
      { key: 'partialLinkText', label: 'Partial Link Text' }
    ];

    otherTypes.forEach(type => {
      if (locators[type.key]) {
        html += createLocatorItem(type.label, locators[type.key]);
      }
    });

    // Display All XPaths
    if (locators.allXPaths && locators.allXPaths.length > 0) {
      html += `<div class="locator-item"><span class="locator-type">All XPaths:</span></div>`;
      locators.allXPaths.forEach(xpath => {
        html += `
          <div class="locator-item">
            <span class="locator-value">${xpath}</span>
            <button class="copy-btn" data-value="${escapeHtml(xpath)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1-2-2h9a2 2 0 0 1-2 2v1"></path>
              </svg>
              Copy
            </button>
          </div>
        `;
      });
    }

    html += '</div>';

    locatorResults.innerHTML = html;

    // Add event listeners to copy buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const value = this.getAttribute('data-value');
        copyToClipboard(value, this);
      });
    });
  }

  // Helper function to create locator item
  function createLocatorItem(type, value) {
    return `
      <div class="locator-item">
        <span class="locator-type">${type}:</span>
        <span class="locator-value">${value}</span>
        <button class="copy-btn" data-value="${escapeHtml(value)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1-2-2h9a2 2 0 0 1-2 2v1"></path>
          </svg>
          Copy
        </button>
      </div>
    `;
  }

  // Replace your current refresh button code with this:
  const refreshBtn = document.getElementById('refreshBtn');

  refreshBtn.addEventListener('click', () => {
    console.log('Refresh button clicked. Clearing locators...');

    // Clear selected locators
    locatorResults.innerHTML = '<p class="placeholder">Activate locator mode and hover over elements to see locators</p>';

    // Reset locator mode if it's active
    if (isLocatorModeActive) {
      isLocatorModeActive = false;
      locatorModeBtn.classList.remove('active-mode');
      locatorModeBtn.innerHTML = `
      <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
      </svg>
      Locator Mode
    `;

      // Notify background script to deactivate locator mode
      backgroundPageConnection.postMessage({
        action: 'activateLocatorMode',
        isActive: false,
        tabId: chrome.devtools.inspectedWindow.tabId
      });
    }
  });

  // Filter locators based on search input
  searchBoxInput.addEventListener('input', function () {
    const filterText = this.value.toLowerCase();
    const locatorItems = document.querySelectorAll('#locatorResults .locator-item');
    locatorItems.forEach(item => {
      const locatorTypeElement = item.querySelector('.locator-type');
      const locatorValueElement = item.querySelector('.locator-value');

      // Add null checks for child elements
      if (locatorTypeElement && locatorValueElement) {
        const locatorType = locatorTypeElement.textContent.toLowerCase();
        const locatorValue = locatorValueElement.textContent.toLowerCase();
        if (locatorType.includes(filterText) || locatorValue.includes(filterText)) {
          item.style.display = '';
        } else {
          item.style.display = 'none';
        }
      }
    });
  });

  // Copy all visible locators
  copyAllBtn.addEventListener('click', function () {
    const allLocatorTexts = [];
    const locatorItems = document.querySelectorAll('#locatorResults .locator-item');

    locatorItems.forEach(item => {
      const locatorTypeElement = item.querySelector('.locator-type');
      const locatorValueElement = item.querySelector('.locator-value');

      // Only process items that have both type and value elements
      if (locatorTypeElement && locatorValueElement) {
        const isHidden = item.style.display === 'none' || window.getComputedStyle(item).display === 'none';
        const type = locatorTypeElement.textContent.replace(':', '').trim();

        // Skip items that are hidden or only contain header text (like "All XPaths:")
        if (!isHidden && type !== 'All XPaths') {
          const value = locatorValueElement.textContent.trim();
          allLocatorTexts.push(`${type}: ${value}`);
        }
      }
    });

    if (allLocatorTexts.length > 0) {
      const textToCopy = allLocatorTexts.join('\n\n');
      copyToClipboard(textToCopy);
      showCopyNotification('Locators copied to clipboard!');
    } else {
      showCopyNotification('No locators available to copy');
    }
  });
  
  // Helper function to copy to clipboard that works in Chrome extensions
  function copyToClipboard(text, buttonElement = null) {
    if (!text) {
      showCopyNotification('No locator available to copy');
      return;
    }

    // Use the newer navigator.clipboard API when available
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          showCopyNotification('Locator copied to clipboard!');
          if (buttonElement) {
            buttonElement.classList.add('copied');
            setTimeout(() => {
              buttonElement.classList.remove('copied');
            }, 1000);
          }
        })
        .catch(err => {
          console.error('Failed to copy: ', err);
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
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);

    try {
      textarea.select();
      const success = document.execCommand('copy');
      if (success) {
        showCopyNotification('Locator copied to clipboard!');
        if (buttonElement) {
          buttonElement.classList.add('copied');
          setTimeout(() => {
            buttonElement.classList.remove('copied');
          }, 1000);
        }
      } else {
        showCopyNotification('Failed to copy to clipboard');
      }
    } catch (err) {
      console.error('Failed to copy: ', err);
      showCopyNotification('Failed to copy to clipboard');
    } finally {
      document.body.removeChild(textarea);
    }
  }

  // Helper function to show copy notification
  function showCopyNotification(message) {
    copyNotification.textContent = message; // Set the notification message
    copyNotification.classList.add('show');
    setTimeout(() => {
      copyNotification.classList.remove('show');
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
});

