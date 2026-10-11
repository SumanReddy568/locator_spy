import { logLocatorLifecycle, trackLocatorGenerated } from './utils/analytics.js';
import { WORKER_BASE } from './utils/endpoints.js';

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
        console.warn('Connection to tab lost:', tabId);
        delete connections[tabId];
      }
    }
  }

  // Listen for runtime suspend
  chrome.runtime.onSuspend.addListener(() => {
    chrome.storage.local.set({ connectionState: connections });
  });

  // Handle wake-up
  chrome.runtime.onStartup.addListener(async () => {
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
      console.warn('XPath validation error:', e);
      return false;
    }
  }

  // Add this helper function for script injection
  async function injectScripts(tabId) {
    try {
      // Inject into every frame (not just the top document) so locator mode
      // works inside iframes too. Content scripts also auto-inject via the
      // manifest (all_frames); this executeScript path is the activation-time
      // fallback for frames that loaded before the extension/devtools did.
      const target = { tabId, allFrames: true };

      // First inject helper
      await chrome.scripting.executeScript({
        target,
        files: ['locator_helper.js']
      });

      // Then inject generator + v2/v3 engines (mirror the manifest's idle bundle)
      await chrome.scripting.executeScript({
        target,
        files: ['locator_generator.js']
      });

      await chrome.scripting.executeScript({
        target,
        files: ['locator_engine_v2.js']
      });

      await chrome.scripting.executeScript({
        target,
        files: ['locator_engine_v3.js']
      });

      // Finally inject content script
      await chrome.scripting.executeScript({
        target,
        files: ['content.js']
      });

      // Wait a bit to ensure scripts are initialized
      await new Promise(resolve => setTimeout(resolve, 500));

      return true;
    } catch (err) {
      console.error('Script injection failed:', err);
      return false;
    }
  }

  // ── Recorder safety ─────────────────────────────────────────────────────
  // `recorderActive` lives in chrome.storage, and while it's true every
  // content script records every click on every page. It used to survive the
  // DevTools panel closing, so a forgotten recording kept capturing clicks
  // (and writing generation logs) indefinitely. Two guards:
  //  1. When the last Locator Spy panel disconnects, stop recording after a
  //     short grace period (a panel reload / reconnect doesn't count).
  //  2. A red "REC" badge on the toolbar icon whenever recording is on.
  const panelPorts = new Set();
  const RECORDER_STOP_GRACE_MS = 5000;
  let recorderStopTimer = null;

  function syncRecorderBadge(active) {
    try {
      chrome.action.setBadgeText({ text: active ? "REC" : "" });
      if (active) chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
      chrome.action.setTitle({ title: active ? "Locator Spy — recording clicks (stop it in the DevTools panel)" : "Locator Finder: AI Powered" });
    } catch (e) { /* action API unavailable */ }
  }
  chrome.storage.local.get("recorderActive", (r) => syncRecorderBadge(!!(r && r.recorderActive)));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.recorderActive) syncRecorderBadge(!!changes.recorderActive.newValue);
  });

  function onPanelGone(port) {
    panelPorts.delete(port);
    if (panelPorts.size) return;
    clearTimeout(recorderStopTimer);
    recorderStopTimer = setTimeout(() => {
      if (panelPorts.size) return;
      chrome.storage.local.get("recorderActive", (r) => {
        if (r && r.recorderActive) {
          chrome.storage.local.set({ recorderActive: false });
          logLocatorLifecycle("recorder_auto_stopped", { reason: "devtools_closed" });
        }
      });
    }, RECORDER_STOP_GRACE_MS);
  }

  // Listen for connections from the devtools page
  chrome.runtime.onConnect.addListener(function (port) {
    if (port.name !== "panel-page") return;
    panelPorts.add(port);
    clearTimeout(recorderStopTimer);
    port.onDisconnect.addListener(() => onPanelGone(port));

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

          port.onDisconnect.addListener(() => {
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

  // Recorder append-queue. Multiple content scripts (one per tab) can fire
  // recorderAppend messages in quick succession; serialize the storage
  // get-set here so we never lose an interaction to a read/write race.
  let recorderQueue = [];
  let recorderFlushPending = false;

  function flushRecorderQueue() {
    if (recorderFlushPending || recorderQueue.length === 0) return;
    recorderFlushPending = true;
    chrome.storage.local.get({ recorderInteractions: [] }, (r) => {
      const list = (r.recorderInteractions || []).concat(recorderQueue);
      recorderQueue = [];
      chrome.storage.local.set({ recorderInteractions: list }, () => {
        recorderFlushPending = false;
        if (recorderQueue.length) flushRecorderQueue();
      });
    });
  }

  // Listen for messages from content scripts
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    try {
      if (message.action === 'locatorLifecycle') {
        logLocatorLifecycle(message.eventName, message.data || {});
        // Also emit a persistent, cumulative locator-generated event for the
        // header stats strip (lifecycle logs are pruned after 10 days).
        if (message.eventName === 'generation_completed') {
          trackLocatorGenerated(message.data || {});
        }
        return;
      }

      if (message.action === 'recorderAppend' && message.interaction) {
        recorderQueue.push(message.interaction);
        flushRecorderQueue();
        return;
      }

      if (!sender.tab) return;

      const tabId = sender.tab.id;

      // v3 engine: call the worker's /generate-locator on behalf of the page.
      // Lives here (not in the content script) because this context holds the
      // user_id and isn't subject to the page's CSP / CORS.
      if (message.action === 'generateLocatorV3') {
        generateLocatorV3(message.payload).then(sendResponse);
        return true; // async response
      }

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
        chrome.storage.local.get({ locators: [] }, (result) => {
          const locators = result.locators;
          locators.push({
            url: message.url,
            timestamp: message.timestamp,
            locators: message.locators
          });

          chrome.storage.local.set({ locators: locators }, () => {
            if (chrome.runtime.lastError) {
              console.error("Storage error:", chrome.runtime.lastError);
              if (typeof sendResponse === 'function') {
                sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
              }
            } else {
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

      // For other messages
      if (typeof sendResponse === 'function') {
        sendResponse({ status: 'received' });
      }
    } catch (err) {
      console.error("Error in message handler:", err);
      if (typeof sendResponse === 'function') {
        sendResponse({ status: 'error', error: err.message });
      }
    }
  });

  async function generateLocatorV3(payload) {
    try {
      const { user_id: userId } = await chrome.storage.local.get('user_id');
      if (!userId) return { ok: false, error: 'not_logged_in' };
      const res = await fetch(`${WORKER_BASE}/generate-locator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(payload || {}), userId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, error: (data && data.error) || `http_${res.status}` };
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    console.log("Selenium Locator Helper installed");
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