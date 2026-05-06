import { logLocatorLifecycle } from "../utils/analytics.js";

const CLOUDFLARE_WORKER_URL = "https://cloud-fare-ai-gateway.sumanreddy568.workers.dev";
// Server-side free-credit AI proxy. Holds the provider key in a Cloudflare
// secret, enforces per-user budget in D1. Client only sends auth_token.
const FREE_TIER_WORKER_URL = "https://feedback-collector.sumanreddy568.workers.dev";

// -------- Response cache ---------------------------------------------------
// Re-running Optimize on the same element with the same provider/model and
// the same starting locators is deterministic from the AI's perspective —
// so cache the parsed JSON and skip the network call. Stored in
// chrome.storage.local under a single key for cheap whole-map reads.
const AI_CACHE_STORAGE_KEY = "aiLocatorCache";
const AI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const AI_CACHE_MAX_ENTRIES = 200;
// Bump when prompt/v1.txt changes meaningfully so old cache entries are
// invalidated automatically.
const AI_PROMPT_VERSION = "v1";

let cachedBasePrompt = null;

function aiCacheStorageAvailable() {
  return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
}

// Locator Spy injects an inline `outline` highlight on hovered/selected
// elements. The outline state differs between hover-time and click-time
// (RAF-based mutation), which would otherwise cause the same element to hash
// to two different cache keys. Strip those properties from the htmlContext
// so the cache reliably hits, and so the AI doesn't see noise.
function stripLocatorSpyHighlight(html) {
  if (!html) return "";
  return html
    .replace(/outline\s*:\s*[^;"]+;?/gi, "")
    .replace(/outline-offset\s*:\s*[^;"]+;?/gi, "")
    .replace(/style="\s*"/gi, "")
    .replace(/style="\s*;+\s*"/gi, "");
}

async function aiCacheKey({ htmlContext, existingLocators, provider, model, promptVersion }) {
  const composite = JSON.stringify({
    h: stripLocatorSpyHighlight(htmlContext || ""),
    e: existingLocators || {},
    p: provider || "",
    m: model || "",
    v: promptVersion || ""
  });
  const buf = new TextEncoder().encode(composite);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function aiCacheRead() {
  return new Promise((resolve) => {
    if (!aiCacheStorageAvailable()) return resolve({});
    try {
      chrome.storage.local.get([AI_CACHE_STORAGE_KEY], (result) => {
        if (chrome.runtime?.lastError) return resolve({});
        resolve((result && result[AI_CACHE_STORAGE_KEY]) || {});
      });
    } catch {
      resolve({});
    }
  });
}

function aiCacheWrite(map) {
  return new Promise((resolve) => {
    if (!aiCacheStorageAvailable()) return resolve();
    try {
      chrome.storage.local.set({ [AI_CACHE_STORAGE_KEY]: map }, () => resolve());
    } catch {
      resolve();
    }
  });
}

async function aiCacheGet(key) {
  const cache = await aiCacheRead();
  const entry = cache[key];
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.createdAt !== "number") return null;
  if (Date.now() - entry.createdAt > AI_CACHE_TTL_MS) return null;
  return entry.response;
}

async function aiCacheSet(key, response, meta = {}) {
  const cache = await aiCacheRead();
  cache[key] = { response, createdAt: Date.now(), ...meta };

  // Newest-wins eviction. Cheap and deterministic; no LRU bookkeeping.
  const entries = Object.entries(cache);
  if (entries.length > AI_CACHE_MAX_ENTRIES) {
    entries.sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    const trimmed = {};
    for (const [k, v] of entries.slice(0, AI_CACHE_MAX_ENTRIES)) trimmed[k] = v;
    await aiCacheWrite(trimmed);
    return;
  }

  await aiCacheWrite(cache);
}

async function aiCacheClear() {
  if (!aiCacheStorageAvailable()) return;
  await new Promise((resolve) => {
    chrome.storage.local.remove(AI_CACHE_STORAGE_KEY, () => resolve());
  });
}

async function aiCacheStats() {
  const cache = await aiCacheRead();
  const entries = Object.values(cache);
  if (entries.length === 0) return { count: 0 };
  const oldest = Math.min(...entries.map((e) => e.createdAt || Date.now()));
  const newest = Math.max(...entries.map((e) => e.createdAt || 0));
  return {
    count: entries.length,
    oldestAgeHours: ((Date.now() - oldest) / 36e5).toFixed(1),
    newestAgeHours: ((Date.now() - newest) / 36e5).toFixed(1),
    ttlDays: AI_CACHE_TTL_MS / 864e5,
    maxEntries: AI_CACHE_MAX_ENTRIES,
  };
}


async function getBasePrompt() {
  if (cachedBasePrompt) return cachedBasePrompt;
  try {
    const url = chrome.runtime.getURL("devtools/prompt/v1.txt");
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not fetch prompt file");
    cachedBasePrompt = await response.text();
    return cachedBasePrompt;
  } catch (error) {
    console.error("Error loading AI prompt:", error);
    // Fallback in case of failure
    return `You are a senior Automation QA Architect.
Analyze the provided "HTML Context" to generate precise, robust, and optimized Selenium/WebDriver locators for the **Single Target Element**.`;
  }
}

/**
 * Generates AI-based locators using Google Gemini or OpenRouter.
 * Returns ONLY valid, unique, and usable Selenium locators.
 *
 * @param {string} htmlContext - HTML context of the target element
 * @param {object} existingLocators - Locators already generated locally
 * @param {string} apiKey - API key
 * @param {string} model - Model name
 * @param {string} provider - "google" | "openrouter"
 * @returns {Promise<object>}
 */
async function generateAiLocators(
  htmlContext,
  existingLocators = {},
  apiKey,
  model,
  provider = "google",
  { bypassCache = false, freeCredits = null } = {}
) {
  try {
    // Default model fallback (mirrors the API call below). Resolved up here
    // so the cache key matches the request that would have been sent.
    const resolvedModel = model || (provider === "google"
      ? "gemini-2.5-flash"
      : "google/gemini-2.5-flash-exp:free");

    // Cache key intentionally folds the free-tier flag into the provider
    // bucket — the server-rendered prompt is the same content as BYO-key,
    // so reusing cached responses across the two paths is safe and lets
    // free-credit users see instant results when an element was already
    // optimized in the same session.
    const effectiveProvider = freeCredits ? "freecredits" : provider;

    const cacheKey = await aiCacheKey({
      htmlContext,
      existingLocators,
      provider: effectiveProvider,
      model: resolvedModel,
      promptVersion: AI_PROMPT_VERSION,
    });

    if (!bypassCache) {
      const cached = await aiCacheGet(cacheKey);
      if (cached) {
        console.debug("[ailocservice] cache hit", {
          key: cacheKey.slice(0, 10),
          provider: effectiveProvider,
          model: resolvedModel,
        });
        logLocatorLifecycle("ai_cache_hit", {
          provider: effectiveProvider,
          model: resolvedModel,
          keyPrefix: cacheKey.slice(0, 10),
          promptVersion: AI_PROMPT_VERSION,
        });
        return cached;
      }
    }
    logLocatorLifecycle("ai_cache_miss", {
      provider: effectiveProvider,
      model: resolvedModel,
      keyPrefix: cacheKey.slice(0, 10),
      promptVersion: AI_PROMPT_VERSION,
      bypassed: bypassCache,
    });

    const cleanedHtmlContext = stripLocatorSpyHighlight(htmlContext);
    const basePrompt = await getBasePrompt();

    let url, headers, body;

    if (freeCredits) {
      // Server-side path: the worker holds the Gemini key as a Cloudflare
      // secret, validates auth_token via the auth-worker, enforces the
      // per-user credit budget, and shapes the response identically to the
      // OpenAI-compatible gateway (`choices[0].message.content`).
      if (!freeCredits.authToken) {
        throw new Error("Sign in required for free credits");
      }
      url = `${FREE_TIER_WORKER_URL}/ai/optimize`;
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${freeCredits.authToken}`,
      };
      body = JSON.stringify({
        basePrompt,
        htmlContext: cleanedHtmlContext,
        existingLocators: existingLocators || {},
        model: resolvedModel,
      });
    } else {
      let prompt = basePrompt;
      if (cleanedHtmlContext) {
        prompt += `
        HTML Context:
        ${cleanedHtmlContext}
        `;
      }
      if (existingLocators && Object.keys(existingLocators).length > 0) {
        prompt += `
        Existing Locators (reference only, do not repeat unless improved):
        ${JSON.stringify(existingLocators, null, 2)}
        `;
      }

      if (provider === "google") {
        url = `${CLOUDFLARE_WORKER_URL}/compat/chat/completions`;

        const fullModelName = resolvedModel.includes("/") ? resolvedModel : `google-ai-studio/${resolvedModel}`;

        headers = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        };
        body = JSON.stringify({
          model: fullModelName,
          messages: [
            { role: "user", content: prompt }
          ],
          temperature: 1,
        });
      } else if (provider === "openrouter") {
        url = `${CLOUDFLARE_WORKER_URL}/openrouter/chat/completions`;
        headers = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": "https://github.com/SumanReddy568/locator_spy",
          "X-Title": "Locator Spy",
        };
        body = JSON.stringify({
          model: resolvedModel,
          messages: [{ role: "user", content: prompt }],
          temperature: 1,
        });
      } else {
        throw new Error("Unsupported provider");
      }
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errCode = typeof err.error === "string" ? err.error : null;
      // Surface the structured "credits used up" signal so the panel can
      // route the user to the BYO-key settings instead of showing a raw
      // failure toast.
      if (response.status === 402 && errCode === "free_credits_exhausted") {
        const e = new Error("Free credits exhausted");
        e.code = "free_credits_exhausted";
        e.creditsRemaining = 0;
        e.creditsLimit = err.creditsLimit;
        throw e;
      }
      const errMsg = err.error?.message || errCode || err.message || "AI request failed";
      throw new Error(errMsg);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;

    if (!text) throw new Error("Empty AI response");

    // Strip accidental markdown
    const cleaned = text.replace(/```json|```/gi, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("Raw AI output:", cleaned);
      throw new Error("Invalid JSON returned by AI");
    }

    if (freeCredits && typeof data.creditsRemaining === "number") {
      // Non-enumerable so the existing displayLocators code that iterates
      // over locator keys doesn't pick this up as a stray entry.
      Object.defineProperty(parsed, "__credits", {
        value: {
          remaining: data.creditsRemaining,
          used: data.creditsUsed,
          limit: data.creditsLimit,
        },
        enumerable: false,
      });
    }

    // Cache only successful parses. Errors and bad JSON are not cached so a
    // retry hits the network instead of being stuck on a bad response.
    aiCacheSet(cacheKey, parsed, { provider: effectiveProvider, model: resolvedModel }).catch(() => {});
    return parsed;
  } catch (error) {
    throw error;
  }
}

async function fetchFreeCredits(authToken) {
  if (!authToken) return null;
  try {
    const resp = await fetch(`${FREE_TIER_WORKER_URL}/ai/credits`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      used: data.creditsUsed,
      remaining: data.creditsRemaining,
      limit: data.creditsLimit,
    };
  } catch {
    return null;
  }
}

// Expose to window for coexistence with non-module scripts if needed
window.generateAiLocators = generateAiLocators;
window.fetchFreeCredits = fetchFreeCredits;

// Debug / escape hatch: clear or inspect the cache from the DevTools console.
//   await aiLocatorCache.stats()
//   await aiLocatorCache.clear()
window.aiLocatorCache = {
  clear: aiCacheClear,
  stats: aiCacheStats,
};
