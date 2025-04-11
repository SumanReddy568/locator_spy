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
  const bestLocatorToggle = document.getElementById('bestLocatorToggle');

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

    // Sanitize XPath values
    if (locators.xpath) {
      locators.xpath = sanitizeXPath(locators.xpath);
    }
    
    if (locators.allXPaths) {
      locators.allXPaths = locators.allXPaths.map(xpath => sanitizeXPath(xpath));
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

    // Update metrics panel
    const metricsPanel = document.querySelector('.metrics-panel');
    const generationTime = document.getElementById('generationTime');
    const domChanges = document.getElementById('domChanges');
    const networkRequests = document.getElementById('networkRequests');
    const networkList = document.getElementById('networkRequestsList');
    const requestsContainer = document.getElementById('requestsContainer');

    if (locators._metadata) {
      metricsPanel.style.display = 'block';
      
      // Performance metrics
      if (locators._metadata.performance) {
        const duration = locators._metadata.performance.duration?.toFixed(2) || 0;
        generationTime.textContent = `${duration}ms`;
      }

      // DOM changes
      if (locators._metadata.domChanges) {
        const changes = locators._metadata.domChanges;
        const totalChanges = (changes.added?.length || 0) + (changes.removed?.length || 0) + (changes.modified?.length || 0);
        domChanges.textContent = totalChanges > 0 ? `${totalChanges} changes` : 'No changes';

        if (changes.mutations?.length > 0) {
          console.log('DOM Mutations:', changes.mutations.length);
        }
      }

      // Network requests
      if (locators._metadata.networkRequests) {
        const requests = locators._metadata.networkRequests;
        if (Array.isArray(requests) && requests.length > 0) {
          networkRequests.textContent = `${requests.length} requests`;
          
          // Display network requests list
          networkList.style.display = 'block';
          requestsContainer.innerHTML = requests.map(req => `
            <div class="network-request">
              <div class="request-url">${req.url || 'Unknown URL'}</div>
              ${req.duration ? `<div class="request-timing">Duration: ${req.duration.toFixed(2)}ms</div>` : ''}
            </div>
          `).join('');
        } else {
          networkList.style.display = 'none';
          networkRequests.textContent = '0 requests';
        }
      } else {
        networkList.style.display = 'none';
        networkRequests.textContent = '0 requests';
      }
    } else {
      metricsPanel.style.display = 'none';
    }

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

  // Add this function near the other helper functions
  function sanitizeXPath(xpath) {
    // Remove invalid triple slashes
    xpath = xpath.replace(/^\/\/\//, '//');
    
    // Remove any invalid characters
    xpath = xpath.replace(/[^\w\s\-\[\]@\(\)\.\/\*='"]/g, '');
    
    return xpath;
  }

  chrome.storage.local.get('isBestLocatorEnabled', (result) => {
    const isEnabled = result.hasOwnProperty('isBestLocatorEnabled') ? result.isBestLocatorEnabled : true;
    chrome.storage.local.set({ 'isBestLocatorEnabled': isEnabled }); // Ensure default is true
    bestLocatorToggle.checked = isEnabled;
  });
  
  bestLocatorToggle.addEventListener('change', (event) => {
    const isEnabled = event.target.checked;
    chrome.storage.local.set({ 'isBestLocatorEnabled': isEnabled }, () => {
      console.log("Best locator setting updated in storage:", isEnabled);
      backgroundPageConnection.postMessage({
        action: 'toggleBestLocator',
        enable: isEnabled,
        tabId: chrome.devtools.inspectedWindow.tabId
      });
    });
  });

  chrome.storage.local.get('isBestLocatorEnabled', (result) => {
    bestLocatorToggle.checked = result.isBestLocatorEnabled ?? true;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.isBestLocatorEnabled) {
      bestLocatorToggle.checked = changes.isBestLocatorEnabled.newValue;
    }
  });

  // Add metrics panel collapse/expand functionality
  const metricsHeader = document.querySelector('.metrics-header');
  const metricsToggle = document.querySelector('.metrics-toggle');
  const metricsContent = document.querySelector('.metrics-content');

  // Start collapsed
  metricsContent.classList.add('collapsed');
  metricsToggle.classList.add('collapsed');

  metricsHeader.addEventListener('click', () => {
    metricsContent.classList.toggle('collapsed');
    metricsToggle.classList.toggle('collapsed');
  });

  // Release notes panel functionality
  const releaseNotesBtn = document.getElementById('releaseNotesBtn');
  const releaseNotesPanel = document.querySelector('.release-notes-panel');
  const closeReleaseNotesBtn = document.querySelector('.close-release-notes');

  releaseNotesBtn.addEventListener('click', () => {
    releaseNotesPanel.classList.add('show');
    dropdownContent.classList.remove('show');
  });

  closeReleaseNotesBtn.addEventListener('click', () => {
    releaseNotesPanel.classList.remove('show');
  });

  // Close release notes panel when clicking outside
  document.addEventListener('click', (e) => {
    if (!releaseNotesPanel.contains(e.target) && 
        !releaseNotesBtn.contains(e.target) &&
        releaseNotesPanel.classList.contains('show')) {
      releaseNotesPanel.classList.remove('show');
    }
  });
});

document.addEventListener('DOMContentLoaded', function() {
  // Check if opened from notification
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('showReleaseNotes') === 'true') {
    const releaseNotesPanel = document.querySelector('.release-notes-panel');
    releaseNotesPanel.classList.add('show');
  }
  // Get metrics panel elements
  const metricsPanel = document.querySelector('.metrics-panel');
  const metricsHeader = document.querySelector('.metrics-header');
  const metricsToggle = document.querySelector('.metrics-toggle');
  const metricsContent = document.querySelector('.metrics-content');
  
  // Set initial state - metrics panel visible but collapsed
  metricsPanel.style.display = 'block';
  metricsToggle.classList.add('collapsed');
  
  // Toggle metrics panel expansion
  metricsHeader.addEventListener('click', function() {
    metricsToggle.classList.toggle('collapsed');
    metricsContent.classList.toggle('expanded');
    metricsPanel.classList.toggle('expanded');
  });
  
  // Additional functionality to ensure element locator section gets focus
  const locatorModeBtn = document.getElementById('locatorModeBtn');
  if (locatorModeBtn) {
    locatorModeBtn.addEventListener('click', function() {
      // When locator mode is activated, ensure focus on the results section
      const locatorResults = document.getElementById('locatorResults');
      if (locatorResults) {
        // Ensure metrics panel is collapsed when locator mode is activated
        metricsToggle.classList.add('collapsed');
        metricsContent.classList.remove('expanded');
        metricsPanel.classList.remove('expanded');
        
        // Small delay to let UI update before scrolling
        setTimeout(() => {
          locatorResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    });
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