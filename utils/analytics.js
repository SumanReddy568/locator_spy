import { WORKER_BASE } from "./endpoints.js";

const TRACK_URL = `${WORKER_BASE}/api/event`;

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

// ---- Free credits surface ------------------------------------------------
// Track banner-level interactions and the credit lifecycle separately from
// the AI optimization events (which are emitted from panel.js around the
// actual API call). These help answer: are users seeing the offer? are
// they clicking the CTA? when do they exhaust? when does fallback kick in?

export function trackFreeCreditsBannerShown(meta = {}) {
  return track("free_credits_banner_shown", {
    feature: "free_credits",
    meta,
  });
}

export function trackFreeCreditsBannerDismissed(meta = {}) {
  return track("free_credits_banner_dismissed", {
    feature: "free_credits",
    meta,
  });
}

export function trackFreeCreditsCtaClicked(meta = {}) {
  return track("free_credits_cta_clicked", {
    feature: "free_credits",
    meta,
  });
}

export function trackFreeCreditsHydrated(meta = {}) {
  return track("free_credits_hydrated", {
    feature: "free_credits",
    meta,
  });
}

export function trackFreeCreditsExhausted(meta = {}) {
  return track("free_credits_exhausted", {
    feature: "free_credits",
    meta,
  });
}

export function trackFreeCreditsFallback(meta = {}) {
  return track("free_credits_fallback_to_byo", {
    feature: "free_credits",
    meta,
  });
}

// ---------------------------------------------------------------------------
// Recorder feature
// ---------------------------------------------------------------------------

export function trackRecorderOpened(meta = {}) {
  return track("recorder_opened", { feature: "recorder", meta });
}

export function trackRecorderClosed(meta = {}) {
  return track("recorder_closed", { feature: "recorder", meta });
}

export function trackRecorderStarted(meta = {}) {
  return track("recorder_started", { feature: "recorder", meta });
}

export function trackRecorderStopped(meta = {}) {
  // meta may include: stepCount, durationMs, framework, language
  return track("recorder_stopped", { feature: "recorder", meta });
}

export function trackRecorderCleared(meta = {}) {
  // meta.priorStepCount = how many steps were wiped
  return track("recorder_cleared", { feature: "recorder", meta });
}

export function trackRecorderCodeCopied(meta = {}) {
  // meta: { framework, language, stepCount, charCount,
  //         actionBreakdown: { click, input, select, scroll } }
  return track("recorder_code_copied", { feature: "recorder", meta });
}

export function trackRecorderFrameworkSelected(framework, language, meta = {}) {
  return track("recorder_framework_selected", {
    feature: "recorder",
    meta: { framework, language, ...meta },
  });
}

// ---- Intelligent Recorder: AI test generation ----------------------------
// Funnel for "Generate with AI" in the recorder: started → generated|failed.
// Mode-aware (free_credits vs byo_key) and records fallback, just like the
// locator-mode AI optimization events.

export function trackRecorderAiStarted(meta = {}) {
  // meta: { framework, language, stepCount, mode, provider, model }
  return track("recorder_ai_started", { feature: "recorder_ai", meta });
}

export function trackRecorderAiGenerated(meta = {}) {
  // meta: { framework, language, stepCount, mode, fellBackToKey, provider,
  //         model, testName, creditsRemaining }
  return track("recorder_ai_generated", { feature: "recorder_ai", meta });
}

export function trackRecorderAiFailed(meta = {}) {
  // meta: { framework, language, reason | error, provider, model }
  return track("recorder_ai_failed", { feature: "recorder_ai", meta });
}

// BYOK nudge in the AI caveat strip (recorder + locator views).
export function trackByokCtaClicked(meta = {}) {
  // meta.source = "recorder" | "locator"
  return track("byok_cta_clicked", { feature: "ai_settings", meta });
}

// Settings drawer opened (toolbar gear or recorder gear). meta.source =
// "toolbar" | "recorder".
export function trackSettingsOpened(meta = {}) {
  return track("settings_opened", { feature: "settings", meta });
}

// Notifications drawer opened (header bell).
export function trackNotificationsOpened(meta = {}) {
  return track("notifications_opened", { feature: "notifications", meta });
}

// Locator engine switched (v1 / v2) and locator copy-format changed.
export function trackEngineSelected(engine, meta = {}) {
  return track("locator_engine_selected", { feature: "locator_mode", meta: { engine, ...meta } });
}
export function trackCopyFormatSelected(format, meta = {}) {
  return track("copy_format_selected", { feature: "locator_mode", meta: { format, ...meta } });
}

// Panel refreshed via the Refresh button.
export function trackPanelRefreshed(meta = {}) {
  return track("panel_refreshed", { feature: "locator_mode", meta });
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

    await fetch(`${WORKER_BASE}/api/logpush`, {
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
