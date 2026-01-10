const TRACK_URL = "https://multi-product-analytics.sumanreddy568.workers.dev/";

// Function to get user info when needed
async function getUserInfo() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      // Use Chrome extension storage (not localStorage)
      const storageData = await new Promise((resolve) => {
        chrome.storage.local.get(
          ["auth_token", "user_email", "user_hash", "user_id"],
          resolve
        );
      });

      console.log("Chrome storage data:", storageData);

      return {
        userId: storageData.user_id || null,
        email: storageData.user_email || null,
        userHash: storageData.user_hash || null,
        authToken: storageData.auth_token || null,
      };
    } catch (e) {
      console.warn("Failed to fetch user info from Chrome storage:", e);

      // Fallback to localStorage if Chrome storage fails
      try {
        const localData = {
          userId: localStorage.getItem("user_id"),
          email: localStorage.getItem("user_email"),
          userHash: localStorage.getItem("user_hash"),
          authToken: localStorage.getItem("auth_token"),
        };
        console.log("LocalStorage fallback data:", localData);
        return localData;
      } catch (localError) {
        console.warn("Failed to fetch from localStorage as well:", localError);
        return {};
      }
    }
  }
  return {};
}

export async function track(eventName, options = {}) {
  try {
    console.log("Analytics track called for:", eventName);

    // Get user info when tracking (not at module load time)
    const currentUserInfo = await getUserInfo();
    console.log("Got user info:", currentUserInfo);

    const systemInfo =
      typeof window !== "undefined"
        ? {
          ua: navigator.userAgent,
          lang: navigator.language,
          platform: navigator.platform,
          screen: `${window.screen.width}x${window.screen.height}`,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }
        : { ua: "service-worker" };

    const payload = {
      product: "locator_spy",
      event: eventName,
      extensionId: chrome?.runtime?.id || "web_user",
      page:
        options.page ||
        (typeof window !== "undefined" ? window.location.href : "background"),
      feature: options.feature || null,
      version: chrome?.runtime?.getManifest?.()?.version || "1.0.0",
      metadata: {
        system: systemInfo,
        ...options.meta,
        ...currentUserInfo,
      },
    };

    console.log("Sending analytics payload:", payload);

    const response = await fetch(TRACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    console.log("Analytics response:", result);
    return result;
  } catch (err) {
    console.error("Analytics failed", err);
    // Don't throw the error, just log it so it doesn't break the app
    return null;
  }
}

export function trackLocatorModeActive(meta = {}) {
  return track("locator_mode_active", {
    feature: "locator_mode",
    meta,
  });
}

export function trackOptimizeWithAI(meta = {}) {
  return track("optimize_with_ai", {
    feature: "ai_optimization",
    meta,
  });
}

export function trackAiSettingsOpened(meta = {}) {
  return track("ai_settings_opened", {
    feature: "ai_settings",
    meta,
  });
}

export function trackAutoOptimizeToggle(enabled, meta = {}) {
  return track("auto_optimize_toggle", {
    feature: "auto_optimize",
    meta: { enabled, ...meta },
  });
}

export function trackAutoValidatorToggle(enabled, meta = {}) {
  return track("auto_validator_toggle", {
    feature: "auto_validator",
    meta: { enabled, ...meta },
  });
}

export function trackLogin(meta = {}) {
  return track("user_login", {
    feature: "auth",
    meta,
  });
}

export function trackLogout(meta = {}) {
  return track("user_logout", {
    feature: "auth",
    meta,
  });
}

/**
 * Internal function to send logs to the logpush endpoint
 */
async function sendLog(level, message, extraData = {}) {
  try {
    const currentUserInfo = await getUserInfo();
    const systemInfo =
      typeof window !== "undefined"
        ? {
          ua: navigator.userAgent,
          lang: navigator.language,
          platform: navigator.platform,
          screen: `${window.screen.width}x${window.screen.height}`,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }
        : { ua: "service-worker" };

    const payload = {
      product: "locator_spy",
      log_type: level,
      user_id: currentUserInfo.userId || "anonymous",
      message: message,
      extra_data: JSON.stringify({
        ...extraData,
        ...currentUserInfo,
        system: systemInfo,
        extensionId: chrome?.runtime?.id || "web_user",
        version: chrome?.runtime?.getManifest?.()?.version || "1.0.0",
        page: typeof window !== "undefined" ? window.location.href : "background",
      }),
    };

    // Using the same base URL but appending api/logpush
    // The base URL ends with / so we append api/logpush
    // Remove trailing slash if present to avoid double slash
    const baseUrl = TRACK_URL.endsWith('/') ? TRACK_URL.slice(0, -1) : TRACK_URL;
    const LOGPUSH_ENDPOINT = `${baseUrl}/api/logpush`;

    // Fire and forget (don't await in critical path usually, but here we await to log result)
    fetch(LOGPUSH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(err => console.error("Logger fetch failed:", err));

  } catch (err) {
    console.error("Logger execution failed:", err);
  }
}

export const logger = {
  info: (message, extraData) => sendLog("info", message, extraData),
  error: (message, extraData) => sendLog("error", message, extraData),
  warn: (message, extraData) => sendLog("warn", message, extraData),
  debug: (message, extraData) => sendLog("debug", message, extraData),
};
