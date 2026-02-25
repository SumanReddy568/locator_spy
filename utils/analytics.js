const TRACK_URL = "https://multi-product-analytics.sumanreddy568.workers.dev/";

// Cache user info to avoid hitting chrome.storage.local too frequently
let userInfoCache = null;
let userInfoCacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds

// Function to get user info when needed
async function getUserInfo() {
  const now = Date.now();
  if (userInfoCache && now - userInfoCacheTime < CACHE_TTL) {
    return userInfoCache;
  }

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const storageData = await new Promise((resolve) => {
        chrome.storage.local.get(
          ["auth_token", "user_email", "user_hash", "user_id"],
          resolve
        );
      });

      userInfoCache = {
        userId: storageData.user_id || null,
        email: storageData.user_email || null,
        userHash: storageData.user_hash || null,
        authToken: storageData.auth_token || null,
      };
      userInfoCacheTime = now;
      return userInfoCache;
    } catch (e) {
      console.warn("Failed to fetch user info from Chrome storage:", e);
      try {
        const localData = {
          userId: localStorage.getItem("user_id"),
          email: localStorage.getItem("user_email"),
          userHash: localStorage.getItem("user_hash"),
          authToken: localStorage.getItem("auth_token"),
        };
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

    const response = await fetch(TRACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    return result;
  } catch (err) {
    console.error("Analytics failed", err);
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

export function trackSignup(meta = {}) {
  return track("user_signup", {
    feature: "auth",
    meta,
  });
}

export function trackLogout(meta = {}) {
  userInfoCache = null;
  return track("user_logout", {
    feature: "auth",
    meta,
  });
}

// ---------------------------------------------------------------------------
// Locator Generation Lifecycle Logger
// Only logs meaningful user actions - never on page load/refresh.
// Events: mode_activated (select element) | element_sent_to_generation |
//         generation_started | generation_completed | element_selected |
//         mode_deactivated | ai_optimization_*
// ---------------------------------------------------------------------------
async function logPushLifecycle(entry) {
  try {
    const currentUserInfo = await getUserInfo();
    const systemInfo =
      typeof window !== "undefined"
        ? {
            ua: navigator.userAgent,
            lang: navigator.language,
            platform: navigator.platform,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }
        : { ua: "service-worker" };

    const payload = {
      product: "locator_spy",
      log_type: "lifecycle",
      user_id: currentUserInfo.userId || "anonymous",
      user_email: currentUserInfo.email || null,
      user_hash: currentUserInfo.userHash || null,
      message: entry.event,
      extra_data: JSON.stringify({
        ...entry,
        metadata: {
          user_id: currentUserInfo.userId || "anonymous",
          user_email: currentUserInfo.email || null,
          user_hash: currentUserInfo.userHash || null,
          system: systemInfo,
          extensionId: chrome?.runtime?.id || "web_user",
          version: chrome?.runtime?.getManifest?.()?.version || "1.0.0",
          page: typeof window !== "undefined" ? window.location.href : "background",
        },
      }),
    };

    const baseUrl = TRACK_URL.endsWith("/") ? TRACK_URL.slice(0, -1) : TRACK_URL;
    await fetch(`${baseUrl}/api/logpush`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[LocatorSpy] Lifecycle log push failed:", err);
  }
}

export function logLocatorLifecycle(eventName, data = {}) {
  const entry = {
    event: eventName,
    product: "locator_spy",
    timestamp: new Date().toISOString(),
    ...data,
  };
  console.log("[LocatorLifecycle]", eventName, entry);
  logPushLifecycle(entry);
}

export function logAuthLifecycle(eventName, data = {}) {
  const entry = {
    event: eventName,
    product: "locator_spy",
    flow: "auth",
    timestamp: new Date().toISOString(),
    ...data,
  };
  console.log("[AuthLifecycle]", eventName, entry);
  logPushLifecycle(entry);
}

// Minimal logger - no-op to avoid log spam. Use logLocatorLifecycle for locator flow.
export const logger = {
  info: () => {},
  error: (msg, data) => console.error("[LocatorSpy]", msg, data),
  warn: (msg, data) => console.warn("[LocatorSpy]", msg, data),
  debug: () => {},
};
