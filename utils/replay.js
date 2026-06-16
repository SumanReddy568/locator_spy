// Session-replay recorder for the locator_spy DevTools panel + popup UI.
//
// Records the extension's OWN surfaces (DevTools panel, popup) with rrweb —
// NOT the inspected web page / content scripts, so no third-party page data is
// captured. rrweb is loaded as a local 'self' script (vendor/rrweb.js) because
// MV3 CSP forbids CDN scripts. Events are batched and POSTed to the worker's
// POST /api/replay.
//
// Load order: vendor/rrweb.js BEFORE this file (see panel.html / popup.html).
//
// PRIVACY: all input fields are masked (maskAllInputs). Add class "rr-block"
// to any element that must never be recorded, "rr-ignore" to drop an input's
// events. Disclose recording to users.
(function () {
  "use strict";

  if (typeof document === "undefined" || typeof rrweb === "undefined" || !rrweb.record) {
    return; // no DOM or rrweb missing — nothing to record
  }

  var WORKER_BASE =
    (typeof self !== "undefined" && self.WORKER_BASE) ||
    "https://open-api-worker.sumanreddy568.workers.dev";
  var ENDPOINT = WORKER_BASE + "/api/replay";
  var SOURCE = "locator-spy";
  var PRODUCT = "locator_spy";
  var FLUSH_INTERVAL_MS = 5000;
  var MAX_BATCH = 200;

  var buffer = [];
  var sessionId = null;
  var user = { user_id: null, email: null };

  function randomId() {
    if (self.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  // Stable per-browser-session id, shared across panel/popup re-opens.
  function loadSessionId(cb) {
    try {
      chrome.storage.session.get(["__replay_session_id"], function (r) {
        var id = r && r.__replay_session_id;
        if (!id) {
          id = randomId();
          chrome.storage.session.set({ __replay_session_id: id });
        }
        cb(id);
      });
    } catch (e) {
      cb(randomId());
    }
  }

  function loadUser(cb) {
    try {
      chrome.storage.local.get(["user_id", "user_email"], function (r) {
        cb({ user_id: (r && r.user_id) || null, email: (r && r.user_email) || null });
      });
    } catch (e) {
      cb({ user_id: null, email: null });
    }
  }

  function flush(useBeacon) {
    if (!sessionId || buffer.length === 0) return;
    var events = buffer;
    buffer = [];
    var payload = JSON.stringify({
      session_id: sessionId,
      source: SOURCE,
      product: PRODUCT,
      user_id: user.user_id,
      email: user.email,
      page: location.href,
      user_agent: navigator.userAgent,
      events: events,
    });
    try {
      // sendBeacon and fetch-keepalive share a hard ~64KB body cap in Chrome.
      // rrweb's full-snapshot chunk is far larger, so only use the beacon path
      // on unload AND only for small payloads; normal flushes use a plain fetch
      // (keepalive:false) which has no such cap.
      if (useBeacon && navigator.sendBeacon && payload.length < 60000) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
      } else {
        fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: useBeacon,
        }).catch(function () {
          // Best-effort: re-queue on failure so the next flush retries.
          try { buffer = events.concat(buffer); } catch (e) {}
        });
      }
    } catch (e) {
      /* swallow — recording must never break the UI */
    }
  }

  function start() {
    rrweb.record({
      emit: function (event) {
        buffer.push(event);
        if (buffer.length >= MAX_BATCH) flush(false);
      },
      maskAllInputs: true,
      blockClass: "rr-block",
      ignoreClass: "rr-ignore",
      recordCanvas: false,
      collectFonts: false,
    });

    setInterval(function () { flush(false); }, FLUSH_INTERVAL_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush(true);
    });
    window.addEventListener("pagehide", function () { flush(true); });
  }

  loadSessionId(function (id) {
    sessionId = id;
    loadUser(function (u) {
      user = u;
      start();
    });
  });
})();
