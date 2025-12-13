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
  let prompt = `
    You are a senior Automation QA Architect.

    **OBJECTIVE**: 
    Analyze the provided "HTML Context" to generate precise, robust, and optimized Selenium/WebDriver locators for the **Single Target Element**.

    **INPUTS PROVIDED**:
    1. **HTML Context**: The DOM snippet containing the target element.
    2. **Existing Locators**: A list of locators that *already* identify the target element. 

    **STRICT INSTRUCTIONS**:
    1. **IDENTIFY TARGET**: Use the "Existing Locators" to find the EXACT matching element within the "HTML Context". ALL generated locators must point to this SAME element.
    2. **NO HALLUCINATIONS**: You must ONLY use attributes (id, class, name, data-*, text) that are VISIBLE in the "HTML Context". Do not invent attributes.
    3. **CORE GENERATION**: Generate the fundamental locators (ID, CSS Selector, XPath) again based on the "HTML Context" to ensure they are the most accurate.
    4. **OPTIMIZATION**: Review the "Existing Locators". Can they be shortened? Can they be made more robust (e.g., using a data attribute instead of a long path)? If yes, provide the optimized version.
    5. **ADDITIONAL LOCATORS**: Suggest creative but reliable alternatives (e.g., searching by partial text, specific attribute combinations, relative XPaths).

    **LOCATOR STRATEGIES**:
    - **Reliability**: Prioritize IDs, \`data-test-id\`, \`data-cy\`, unique names.
    - **Text Matching**: ALWAYS use \`normalize-space(.)\` instead of \`text()\` to handle whitespace and nested elements safely (e.g., \`//span[contains(normalize-space(.), 'My Text')]\`).
    - **Maintainability**: Avoid long absolute XPaths or CSS chains. Use relative paths where possible.
    - **Length Constraint**: AVOID locators longer than 75 characters unless absolutely necessary for uniqueness.
    - **Conciseness**: Prefer \`#submit\` over \`div > form > button#submit\`. Short is better if unique.
    - **Uniqueness**: Ensure the locator is likely unique to that element (or at least the snippet provided).

    **OUTPUT FORMAT**:
    Return ONLY a valid JSON object.
    Keys should be descriptive (e.g., "Optimized CSS", "Robust XPath", "Data Attribute").
    Values must be the locator strings.

    Example:
    {
    "Optimized CSS": "button.submit-btn",
    "Robust XPath": "//button[contains(normalize-space(.), 'Submit')]",
    "Data ID": "[data-testid='submit-form']"
    }
    `;

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
        ? "gemini-2.5-flash-exp"
        : "google/gemini-2.5-flash-exp:free";
  }

  let url, headers, body;

  if (provider === "google") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    headers = { "Content-Type": "application/json" };
    body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    });
  } else if (provider === "openrouter") {
    url = "https://openrouter.ai/api/v1/chat/completions";
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/SumanReddy568/locator_spy",
      "X-Title": "Locator Spy",
    };
    body = JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
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
  let text;

  if (provider === "google") {
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  } else {
    text = data?.choices?.[0]?.message?.content;
  }

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
