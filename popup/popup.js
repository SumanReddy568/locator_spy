document.addEventListener('DOMContentLoaded', function() {
  const locatorModeBtn = document.getElementById('locatorModeBtn');
  const locatorResults = document.getElementById('locatorResults');
  const savedLocators = document.getElementById('savedLocators');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const copyNotification = document.getElementById('copyNotification');
  
  let isLocatorModeActive = false;
  
  // Initialize theme from local storage
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-mode');
    document.body.classList.remove('light-mode');
  } else {
    document.body.classList.add('light-mode');
    document.body.classList.remove('dark-mode');
  }
  
  // Toggle locator mode with animation
  locatorModeBtn.addEventListener('click', function() {
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
    
    // Send message to content script to toggle locator mode
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'activateLocatorMode',
        isActive: isLocatorModeActive
      });
    });
  });
  
  // Toggle theme
  themeToggleBtn.addEventListener('click', function() {
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
  
  // Listen for messages from content script
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'getLocators') {
      displayLocators(request.locators);
    }
    
    if (request.action === 'locatorModeDeactivated') {
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
  
  // Display locators in the popup
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
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
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
      btn.addEventListener('click', function() {
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
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy
        </button>
      </div>
    `;
  }
  
  // Helper function to copy to clipboard
  function copyToClipboard(text, buttonElement) {
    // Create a temporary textarea element
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    
    // Select the text and copy
    textarea.select();
    document.execCommand('copy');
    
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
    copyNotification.classList.add('show');
    
    // Reset after 2 seconds
    setTimeout(() => {
      buttonElement.innerHTML = originalHTML;
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
  
  // Load saved locators
  function loadSavedLocators() {
    chrome.storage.local.get(['savedLocators'], function(result) {
      if (result.savedLocators && result.savedLocators.length > 0) {
        let html = '';
        result.savedLocators.forEach((item, index) => {
          html += `
            <div class="locator-item">
              <div><strong>${new Date(item.timestamp).toLocaleString()}</strong></div>
              <div>${item.url}</div>
              <div class="locator-value">${item.locators.cssSelector || item.locators.xpath}</div>
              <button class="copy-btn" data-value="${escapeHtml(item.locators.cssSelector || item.locators.xpath)}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                Copy
              </button>
            </div>
          `;
        });
        savedLocators.innerHTML = html;
        
        // Add event listeners to copy buttons
        document.querySelectorAll('#savedLocators .copy-btn').forEach(btn => {
          btn.addEventListener('click', function() {
            const value = this.getAttribute('data-value');
            copyToClipboard(value, this);
          });
        });
      } else {
        savedLocators.innerHTML = '<p class="placeholder">No saved locators yet</p>';
      }
    });
  }
  
  // Initial load of saved locators
  loadSavedLocators();
});