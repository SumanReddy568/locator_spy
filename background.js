import { logLocatorLifecycle, trackLocatorGenerated } from './utils/analytics.js';
import { WORKER_BASE, GOOGLE_OAUTH_CLIENT_ID } from './utils/endpoints.js';

// Add export statement at the start
export const initializeServiceWorker = () => {
  // Store connections from devtools panels
  const connections = {};
  const pendingForPanel = {}; // tabId -> messages waiting for the panel to reconnect
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
          for (const m of pendingForPanel[tabId] || []) port.postMessage(m);
          delete pendingForPanel[tabId];

          port.onDisconnect.addListener(() => {
            delete connections[tabId];
            pendingResponses.delete(tabId);
          });

          if (typeof sendResponse === 'function') {
            sendResponse({ status: 'connected' });
          }
          return;
        }

        // Recorder replay (see runRecording).
        if (message.action === 'runRecording' && Array.isArray(message.steps)) {
          runRecording(message.tabId, message.steps, port);
          return;
        }
        if (message.action === 'stopRecordingRun') {
          if (recRuns[message.tabId]) recRuns[message.tabId].cancelled = true;
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

      // "Continue with Google" from the DevTools login/signup pages, which
      // can't call chrome.identity themselves. Replies { idToken } or { error }.
      if (message.action === 'googleSignIn') {
        googleSignIn().then(sendResponse, (e) => sendResponse({ error: e.message }));
        return true; // async response
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

      // Forward messages to DevTools panel. While the panel's port is down
      // (it reconnects ~500ms after the worker restarts) keep the latest few
      // and deliver them on its next `init`, instead of losing that result.
      if (tabId in connections) {
        connections[tabId].postMessage(message);
      } else if (message.action) {
        const q = (pendingForPanel[tabId] ||= []);
        q.push(message);
        if (q.length > 5) q.shift();
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

  // Google OpenID Connect implicit flow in the identity popup: returns an ID
  // token for POST /login/google, which verifies it server-side. No client
  // secret is involved. The nonce ties the token to this request.
  async function googleSignIn() {
    if (!GOOGLE_OAUTH_CLIENT_ID) throw new Error('Google sign-in is not configured');
    const nonce = crypto.randomUUID();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      response_type: 'id_token',
      redirect_uri: chrome.identity.getRedirectURL(),
      scope: 'openid email profile',
      nonce,
      prompt: 'select_account',
    }).toString();
    const redirect = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
    const params = new URLSearchParams(new URL(redirect).hash.slice(1));
    const idToken = params.get('id_token');
    if (!idToken) throw new Error(params.get('error') || 'Google did not return a token');
    const claims = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (claims.nonce !== nonce) throw new Error('Google sign-in failed (nonce mismatch)');
    return { idToken };
  }

  // ── Recorder replay ───────────────────────────────────────────────────────
  // Runs recorded steps in the inspected tab, one at a time. Lives here, not
  // in the page, because a step can navigate: between steps we wait for the
  // tab to finish loading, so flows that cross pages (log in → dashboard)
  // replay too. Progress goes to the panel as recRunProgress / recRunDone.
  const recRuns = {}; // tabId -> { cancelled }
  const REPLAY_STEP_GAP_MS = 500;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  async function tabReady(tabId, maxMs = 15000) {
    const until = Date.now() + maxMs;
    for (;;) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete" || Date.now() > until) return tab;
      await sleep(200);
    }
  }

  // Navigate and resolve once Chrome reports the new page loaded. Listening for
  // the event (not polling status) matters: right after tabs.update the old
  // page can still say "complete", and the first step would go to it.
  function navigateAndWait(tabId, url, maxMs = 20000) {
    return new Promise((resolve) => {
      const done = () => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timer);
        resolve();
      };
      const onUpdated = (id, info) => { if (id === tabId && info.status === "complete") done(); };
      const timer = setTimeout(done, maxMs);
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.update(tabId, { url }).catch(done);
    });
  }

  async function sendStep(tabId, step) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await chrome.tabs.sendMessage(tabId, { action: "runRecordedStep", step }, { frameId: 0 });
        // A content script from before the extension was updated answers
        // with something else (or nothing useful): it can't replay.
        if (res && typeof res.ok === "boolean") return res;
        if (res) return { ok: false, error: "this page has an old copy of the extension: refresh the page and run again" };
      } catch (err) {
        // No listener yet (new page still loading its content script): the
        // step never ran, so retry, injecting the scripts if needed. A click
        // whose page went away mid-step navigated, which is a success; for
        // anything else the step may not have run, so retry it.
        const noListener = /Receiving end does not exist/i.test(err.message || "");
        if (!noListener && step.action === "click") return { ok: true };
        if (attempt === 1) await injectScripts(tabId);
        await sleep(500);
      }
    }
    return { ok: false, error: "the page didn't respond (is it still loading?)" };
  }

  async function runRecording(tabId, steps, port) {
    const run = (recRuns[tabId] = { cancelled: false });
    const post = (m) => {
      try { (connections[tabId] || port).postMessage(m); } catch (e) { /* panel closed */ }
    };
    post({ action: "recRunStarted" }); // the panel's start watchdog waits for this
    try {
      // A run starts like a test: fresh load of the page the recording began on.
      const start = steps.find((st) => st.url);
      if (start) await navigateAndWait(tabId, start.url);
      for (let i = 0; i < steps.length; i++) {
        if (run.cancelled) return post({ action: "recRunDone", ok: false, cancelled: true, index: i });
        post({ action: "recRunProgress", index: i, status: "running" });
        await tabReady(tabId);
        const res = await sendStep(tabId, steps[i]);
        post({ action: "recRunProgress", index: i, status: !res.ok ? "fail" : res.skipped ? "skip" : "pass", error: res.error || null });
        if (!res.ok) return post({ action: "recRunDone", ok: false, failedAt: i, error: res.error });
        await sleep(REPLAY_STEP_GAP_MS);
      }
      post({ action: "recRunDone", ok: true, count: steps.length });
    } catch (err) {
      post({ action: "recRunDone", ok: false, error: err.message });
    } finally {
      if (recRuns[tabId] === run) delete recRuns[tabId];
    }
  }

  async function generateLocatorV3(payload) {
    try {
      const { user_id: userId, auth_token: token } = await chrome.storage.local.get(['user_id', 'auth_token']);
      if (!userId) return { ok: false, error: 'not_logged_in' };
      // The session token is the real credential (userId is just an id, and
      // Origin is spoofable outside a browser); the worker validates it and
      // can then require it (GENERATE_LOCATOR_REQUIRE_BEARER). `omit` keeps
      // cookies for this host (e.g. an admin dashboard session) off the request.
      const res = await fetch(`${WORKER_BASE}/generate-locator`, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
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