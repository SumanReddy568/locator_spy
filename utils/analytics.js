const TRACK_URL = "https://multi-product-analytics.sumanreddy568.workers.dev/";

// Initialize user info asynchronously
let userInfo = {};

// Function to get user info when needed
async function getUserInfo() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const storageData = await new Promise((resolve) => {
        chrome.storage.local.get(
          ["user_id", "user_email", "user_hash"],
          resolve
        );
      });
      return {
        userId: storageData.user_id || null,
        email: storageData.user_email || null,
        userHash: storageData.user_hash || null,
      };
    } catch (e) {
      console.warn("Failed to fetch user info for analytics:", e);
      return {};
    }
  }
  return {};
}

export async function track(eventName, options = {}) {
  try {
    // Get user info when tracking (not at module load time)
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

    const response = await fetch(TRACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    });
    return await response.json();
  } catch (err) {
    console.error("Analytics failed", err);
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
