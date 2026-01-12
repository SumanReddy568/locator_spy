import { logger } from './utils/analytics.js';

// Add export statement at the start
export const initializeServiceWorker = () => {
  // Store connections from devtools panels
  const connections = {};
  let pendingResponses = new Map();

  // Keep-alive mechanism
  const KEEP_ALIVE_INTERVAL = 20; // seconds

  // Set up periodic alarm
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });

  // Listen for alarm
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
      pingConnections();
    }
  });

  // Ping all connections to keep them alive
  function pingConnections() {
    // logger.info("pingConnections called");
    for (const tabId in connections) {
      try {
        connections[tabId].postMessage({ type: 'ping' });

      } catch (err) {
        logger.warn('Connection to tab lost', { tabId, error: err.message });
        console.warn('Connection to tab lost:', tabId);
        delete connections[tabId];
      }
    }
  }

  // Listen for runtime suspend
  chrome.runtime.onSuspend.addListener(() => {
    logger.info('Service worker suspending, attempting to preserve state...');
    chrome.storage.local.set({ connectionState: connections });
  });

  // Handle wake-up
  chrome.runtime.onStartup.addListener(async () => {
    logger.info('Service worker starting up, restoring state...');
    const state = await chrome.storage.local.get('connectionState');
    if (state.connectionState) {
      Object.keys(state.connectionState).forEach(tabId => {
        chrome.tabs.get(parseInt(tabId), (tab) => {
          if (chrome.runtime.lastError) {
            console.log('Tab no longer exists:', tabId);
            return;
          }
          // Re-establish connection if tab still exists
          chrome.tabs.sendMessage(parseInt(tabId), { action: 'reconnect' });
        });
      });
    }
  });

  // Add this helper function near the top
  function isValidXPath(xpath) {
    try {
      if (!xpath || typeof xpath !== 'string') return false;
      // Remove triple slashes
      xpath = xpath.replace(/^\/\/\//, '//');
      // Basic XPath validation using regex
      const isValid = /^\/\/.*/.test(xpath) && !/\/\/\//.test(xpath);
      return isValid;
    } catch (e) {
      logger.error('XPath validation error', { xpath, error: e.message });
      console.warn('XPath validation error:', e);
      return false;
    }
  }

  // Add this helper function for script injection
  async function injectScripts(tabId) {
    logger.info("injectScripts starting", { tabId });
    try {
      // First inject helper
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['locator_helper.js']
      });

      // Then inject generator
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['locator_generator.js']
      });

      // Finally inject content script
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });

      // Wait a bit to ensure scripts are initialized
      await new Promise(resolve => setTimeout(resolve, 500));

      logger.info("Scripts injected successfully", { tabId });
      return true;
    } catch (err) {
      logger.error('Script injection failed', { tabId, error: err.message });
      console.error('Script injection failed:', err);
      return false;
    }
  }

  // Listen for connections from the devtools page
  chrome.runtime.onConnect.addListener(function (port) {
    if (port.name !== "panel-page") return;

    logger.info("DevTools panel connected");

    // Send immediate ping to establish connection
    port.postMessage({ type: 'ping' });

    // Set up periodic ping for this specific connection
    const pingInterval = setInterval(() => {
      try {
        port.postMessage({ type: 'ping' });
      } catch (err) {
        clearInterval(pingInterval);
      }
    }, KEEP_ALIVE_INTERVAL * 1000);

    // Clear interval when port disconnects
    port.onDisconnect.addListener(() => {
      clearInterval(pingInterval);
    });

    const devToolsListener = async (message, sender, sendResponse) => {
      try {
        // Initialize the connection
        if (message.name === 'init') {
          const tabId = message.tabId;
          connections[tabId] = port;

          logger.info("Initialized connection with DevTools", { tabId });
          console.log("Initialized connection with DevTools for tab:", tabId);

          port.onDisconnect.addListener(() => {
            logger.info("DevTools disconnected", { tabId });
            console.log("DevTools disconnected from tab:", tabId);
            delete connections[tabId];
            pendingResponses.delete(tabId);
          });

          if (typeof sendResponse === 'function') {
            sendResponse({ status: 'connected' });
          }
          return;
        }

        // Handle activating locator mode
        if (message.action === 'activateLocatorMode') {
          const tabId = message.tabId;
          logger.info("activateLocatorMode message received", { tabId, isActive: message.isActive });
          console.log("Activating locator mode for tab:", tabId, "isActive:", message.isActive);

          // Store the sendResponse function
          pendingResponses.set(tabId, sendResponse);

          try {
            if (message.isActive) {
              // Inject scripts and wait for completion
              const success = await injectScripts(tabId);
              if (!success) {
                throw new Error('Failed to inject required scripts');
              }

              // Send activation message
              await chrome.tabs.sendMessage(tabId, {
                action: 'activateLocatorMode',
                isActive: true
              });

              // Respond to DevTools
              const responseFn = pendingResponses.get(tabId);
              if (typeof responseFn === 'function') {
                responseFn({ status: 'success' });
              }
            } else {
              // Just send deactivation message
              await chrome.tabs.sendMessage(tabId, {
                action: 'activateLocatorMode',
                isActive: false
              });

              const responseFn = pendingResponses.get(tabId);
              if (typeof responseFn === 'function') {
                responseFn({ status: 'success' });
              }
            }
          } catch (err) {
            logger.error("Error in locator mode activation", { tabId, error: err.message });
            console.error("Error in locator mode activation:", err);
            const responseFn = pendingResponses.get(tabId);
            if (typeof responseFn === 'function') {
              responseFn({ status: 'error', error: err.message });
            }
          } finally {
            pendingResponses.delete(tabId);
          }

          return true; // Indicate async response
        }
      } catch (err) {
        console.error("Error in devToolsListener:", err);
        if (typeof sendResponse === 'function') {
          sendResponse({ status: 'error', error: err.message });
        }
      }
    };

    port.onMessage.addListener(devToolsListener);
  });

  // Listen for messages from content scripts
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    try {
      if (message.action === 'log') {
        // Log forwarding already has logger usage
        const { log_type, message: logMsg, extra_data } = message;
        if (logger[log_type]) {
          logger[log_type](logMsg, extra_data);
        } else {
          logger.info(logMsg, extra_data);
        }
        return;
      }


      if (!sender.tab) return;

      const tabId = sender.tab.id;

      if (message.action === 'getLocators' && message.locators) {
        // Validate and clean XPaths
        if (message.locators.xpath) {
          if (!isValidXPath(message.locators.xpath)) {
            delete message.locators.xpath;
          }
        }

        if (message.locators.allXPaths) {
          message.locators.allXPaths = message.locators.allXPaths.filter(isValidXPath);
        }
      }

      // Forward messages to DevTools panel
      if (tabId in connections) {

        connections[tabId].postMessage(message);
      }

      // Handle locator saving
      if (message.action === 'saveLocator') {
        logger.info("saveLocator message received", { url: message.url });
        chrome.storage.local.get({ locators: [] }, (result) => {
          const locators = result.locators;
          locators.push({
            url: message.url,
            timestamp: message.timestamp,
            locators: message.locators
          });

          chrome.storage.local.set({ locators: locators }, () => {
            if (chrome.runtime.lastError) {
              logger.error("Storage error during saveLocator", { error: chrome.runtime.lastError.message });
              console.error("Storage error:", chrome.runtime.lastError);
              if (typeof sendResponse === 'function') {
                sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
              }
            } else {
              logger.info("Locator saved successfully");
              if (typeof sendResponse === 'function') {
                sendResponse({ status: 'success' });
              }
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

      // Handle toggleBestLocator message
      if (message.action === 'toggleBestLocator') {
        chrome.storage.local.set({ 'isBestLocatorEnabled': message.enable }, () => {
          console.log("Best locator setting updated in storage:", message.enable);
        });
        return;
      }

      // For other messages
      if (typeof sendResponse === 'function') {
        sendResponse({ status: 'received' });
      }
    } catch (err) {
      logger.error("Error in chrome.runtime.onMessage handler", { error: err.message, action: message.action });
      console.error("Error in message handler:", err);
      if (typeof sendResponse === 'function') {
        sendResponse({ status: 'error', error: err.message });
      }
    }
  });

  chrome.runtime.onInstalled.addListener(() => {
    console.log("Selenium Locator Helper installed");
  });

  const CURRENT_VERSION = '1.1.3';

  // Function to check and show update notification
  async function checkAndShowUpdateNotification() {
    const lastVersion = await chrome.storage.local.get('lastVersion');
    const lastNotificationShown = await chrome.storage.local.get('lastNotificationShown');
    const now = Date.now();

    if (!lastVersion.lastVersion || lastVersion.lastVersion !== CURRENT_VERSION) {
      // Show notification for update or new installation
      chrome.notifications.create('version-update', {
        type: 'basic',
        iconUrl: 'popup/icons/icon48.png',
        title: 'Locator Spy Updated!',
        message: 'Click here to see what\'s new in version ' + CURRENT_VERSION,
        priority: 2
      });

      // Update stored version
      await chrome.storage.local.set({
        'lastVersion': CURRENT_VERSION,
        'lastNotificationShown': now
      });
    }
  }

  // Listen for notification clicks
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId === 'version-update') {
      chrome.tabs.create({ url: 'https://example.com/changelog' });
    }
  });
};

// Initialize service worker registration
try {
  initializeServiceWorker();
  console.log('Service worker initialized successfully');
} catch (error) {
  console.error('Service worker initialization failed:', error);
}

// Update messaging to use module syntax
self.onmessage = async (event) => {
  try {
    // ...existing message handling code...
  } catch (error) {
    console.error('Error handling message:', error);
  }
};

// Add error recovery
self.onerror = (error) => {
  console.error('Service worker error:', error);
  // Attempt to re-initialize
  try {
    initializeServiceWorker();
  } catch (e) {
    console.error('Failed to recover service worker:', e);
  }
};