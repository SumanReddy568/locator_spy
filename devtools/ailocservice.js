const CLOUDFLARE_WORKER_URL = "https://cloud-fare-ai-gateway.sumanreddy568.workers.dev";

let cachedBasePrompt = null;

/**
 * Fetches the base prompt from the external text file.
 * @returns {Promise<string>}
 */
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
  provider = "google"
) {
  let prompt = await getBasePrompt();

  if (htmlContext) {
    prompt += `
    HTML Context:
    ${htmlContext}
    `;
  }

  if (existingLocators && Object.keys(existingLocators).length > 0) {
    prompt += `
    Existing Locators (reference only, do not repeat unless improved):
    ${JSON.stringify(existingLocators, null, 2)}
    `;
  }

  // Default model fallback
  if (!model) {
    model =
      provider === "google"
        ? "gemini-1.5-flash"
        : "google/gemini-2.5-flash-exp:free";
  }

  let url, headers, body;

  if (provider === "google") {
    url = `${CLOUDFLARE_WORKER_URL}/compat/chat/completions`;

    const fullModelName = model.includes("/") ? model : `google-ai-studio/${model}`;

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
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 1,
    });
  } else {
    throw new Error("Unsupported provider");
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || err.message || "AI request failed");
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("Empty AI response");
  }

  // Strip accidental markdown
  const cleaned = text.replace(/```json|```/gi, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Raw AI output:", cleaned);
    throw new Error("Invalid JSON returned by AI");
  }
}
