// Store connections from devtools panels
const connections = {};
let pendingResponses = new Map();

// Listen for connections from the devtools page
chrome.runtime.onConnect.addListener(function(port) {
  if (port.name !== "panel-page") return;
  
  console.log("DevTools panel connected");
  
  const devToolsListener = async (message, sender, sendResponse) => {
    try {
      // Initialize the connection
      if (message.name === 'init') {
        const tabId = message.tabId;
        connections[tabId] = port;
        
        console.log("Initialized connection with DevTools for tab:", tabId);
        
        port.onDisconnect.addListener(() => {
          console.log("DevTools disconnected from tab:", tabId);
          delete connections[tabId];
          pendingResponses.delete(tabId);
        });
        
        if (typeof sendResponse === 'function') {
          sendResponse({status: 'connected'});
        }
        return;
      }
      
      // Handle activating locator mode
      if (message.action === 'activateLocatorMode') {
        const tabId = message.tabId;
        console.log("Activating locator mode for tab:", tabId, "isActive:", message.isActive);
        
        // Store the sendResponse function
        pendingResponses.set(tabId, sendResponse);
        
        try {
          // First inject the content script
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
          });
          
          // Then send the activation message
          await chrome.tabs.sendMessage(tabId, {
            action: 'activateLocatorMode',
            isActive: message.isActive
          });
          
          // Respond to DevTools
          const responseFn = pendingResponses.get(tabId);
          if (typeof responseFn === 'function') {
            responseFn({status: 'success'});
          }
          pendingResponses.delete(tabId);
        } catch (err) {
          console.error("Error in locator mode activation:", err);
          const responseFn = pendingResponses.get(tabId);
          if (typeof responseFn === 'function') {
            responseFn({status: 'error', error: err.message});
          }
          pendingResponses.delete(tabId);
        }
        
        return true; // Indicate async response
      }
    } catch (err) {
      console.error("Error in devToolsListener:", err);
      if (typeof sendResponse === 'function') {
        sendResponse({status: 'error', error: err.message});
      }
    }
  };
  
  port.onMessage.addListener(devToolsListener);
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  try {
    if (!sender.tab) return;
    
    const tabId = sender.tab.id;
    
    // Forward messages to DevTools panel
    if (tabId in connections) {
      console.log("Forwarding message to DevTools panel:", message);
      connections[tabId].postMessage(message);
    }
    
    // Handle locator saving
    if (message.action === 'saveLocator') {
      chrome.storage.local.get({locators: []}, (result) => {
        const locators = result.locators;
        locators.push({
          url: message.url,
          timestamp: message.timestamp,
          locators: message.locators
        });
        
        chrome.storage.local.set({locators: locators}, () => {
          if (chrome.runtime.lastError) {
            console.error("Storage error:", chrome.runtime.lastError);
            if (typeof sendResponse === 'function') {
              sendResponse({status: 'error', error: chrome.runtime.lastError.message});
            }
          } else if (typeof sendResponse === 'function') {
            sendResponse({status: 'success'});
          }
        });
      });
      
      return true; // Indicate async response
    }

    // Handle activating locator mode
    if (message.action === 'activateLocatorMode') {
      try {
        // Perform the necessary operations for locator mode activation
        console.log('Activating locator mode:', message.isActive);

        // If asynchronous operations are needed, ensure sendResponse is called
        if (message.isActive) {
          // Example: Simulate async operation
          setTimeout(() => {
            console.log('Locator mode activated successfully');
            sendResponse({ success: true });
          }, 100);
          return true; // Indicate async response
        } else {
          sendResponse({ success: true });
        }
      } catch (error) {
        console.error('Error in locator mode activation:', error);
        sendResponse({ success: false, error: error.message });
      }
    }
    
    // For other messages
    if (typeof sendResponse === 'function') {
      sendResponse({status: 'received'});
    }
  } catch (err) {
    console.error("Error in message handler:", err);
    if (typeof sendResponse === 'function') {
      sendResponse({status: 'error', error: err.message});
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("Selenium Locator Helper installed");
});


chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open the welcome page on installation
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

// Set the URL to open when the extension is uninstalled
chrome.runtime.setUninstallURL(chrome.runtime.getURL('goodbye.html'), function() {
  if (chrome.runtime.lastError) {
    console.error('Error setting uninstall URL:', chrome.runtime.lastError.message);
  }
});
