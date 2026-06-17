import {
  trackLocatorModeActive,
  trackOptimizeWithAI,
  trackAiSettingsOpened,
  trackAutoOptimizeToggle,
  trackAutoValidatorToggle,
  trackLogout,
  logLocatorLifecycle,
  trackFreeCreditsBannerShown,
  trackFreeCreditsBannerDismissed,
  trackFreeCreditsCtaClicked,
  trackFreeCreditsHydrated,
  trackFreeCreditsExhausted,
  trackFreeCreditsFallback,
  trackRecorderOpened,
  trackRecorderClosed,
  trackRecorderStarted,
  trackRecorderStopped,
  trackRecorderCleared,
  trackRecorderCodeCopied,
  trackRecorderFrameworkSelected,
  trackRecorderAiStarted,
  trackRecorderAiGenerated,
  trackRecorderAiFailed,
  trackByokCtaClicked,
  trackSettingsOpened,
  trackNotificationsOpened,
  trackEngineSelected,
  trackCopyFormatSelected,
  trackPanelRefreshed,
} from '../utils/analytics.js';
import { WORKER_BASE } from '../utils/endpoints.js';


document.addEventListener("DOMContentLoaded", function () {
  const locatorModeBtn = document.getElementById("locatorModeBtn");
  const locatorResults = document.getElementById("locatorResults");
  const menuBtn = document.getElementById("menuBtn");
  const dropdownContent = document.querySelector(".dropdown-content");
  const copyNotification = document.getElementById("copyNotification");
  const searchBoxInput = document.querySelector(".search-box input");
  const expandAllBtn = document.querySelector(
    '.section-actions button[title="Expand All"]'
  );
  const copyAllBtn = document.querySelector(
    '.section-actions .action-btn[title="Copy All"]'
  );
  const autoValidatorToggle = document.getElementById("autoValidatorToggle");
  const autoOptimizeToggle = document.getElementById("autoOptimizeToggle");
  const logoutBtn = document.getElementById("logoutBtn");
  const locatorSectionTitle = document.getElementById("locatorSectionTitle");
  const locatorSectionSubtitle = document.getElementById("locatorSectionSubtitle");

  // Auth Status Check
  if (window.AuthModule) {
    if (!AuthModule.isAuthenticated()) {
      window.location.href = 'login.html';
      return;
    }

    // Update UI for logged in state
    if (logoutBtn) {
      logoutBtn.style.display = 'flex';

      const logoutModal = document.getElementById("logoutModal");
      const cancelLogoutBtn = document.getElementById("cancelLogoutBtn");
      const cancelLogoutBtnX = document.getElementById("cancelLogoutBtnX");
      const confirmLogoutBtn = document.getElementById("confirmLogoutBtn");

      // Open Modal
      logoutBtn.addEventListener('click', () => {
        if (logoutModal) logoutModal.style.display = "flex";
      });

      // Close Modal Actions
      const closeLogoutModal = () => {
        if (logoutModal) logoutModal.style.display = "none";
      };

      if (cancelLogoutBtn) cancelLogoutBtn.addEventListener('click', closeLogoutModal);
      if (cancelLogoutBtnX) cancelLogoutBtnX.addEventListener('click', closeLogoutModal);

      // Confirm Logout
      if (confirmLogoutBtn) {
        confirmLogoutBtn.addEventListener('click', async () => {
          closeLogoutModal();
          trackLogout();
          // Show loading or visual feedback if needed
          await AuthModule.logout();
          window.location.href = 'login.html';
        });
      }

      // Close on outside click
      window.addEventListener("click", (event) => {
        if (event.target === logoutModal) {
          closeLogoutModal();
        }
      });
    }

    // Periodic session check (every 5 mins)
    setInterval(async () => {
      const isValid = await AuthModule.checkSession();
      if (!isValid) {
        window.location.href = 'login.html';
      }
    }, 300000);

    // Opportunistic two-way reconcile: pulls server data into any missing
    // local slots, OR pushes local keys up if the server is reachable but
    // empty (first-run upgrade for users who saved keys before this feature
    // existed). `fillOnly: true` so we never clobber unsaved local edits.
    if (typeof AuthModule.syncUserSettings === 'function') {
      AuthModule.syncUserSettings({ fillOnly: true }).catch(() => { /* non-fatal */ });
    }
  }

  let isLocatorModeActive = false;

  // Ensure light mode is default since dark mode is removed
  document.body.classList.add("light-mode");
  document.body.classList.remove("dark-mode");

  // Connection to the background service worker.
  //
  // In MV3 the worker is torn down after ~30s idle, which silently kills this
  // port — after which hover results never reach the panel and Refresh can't
  // re-sync ("nothing shows up after the page sits idle"). To survive that we
  // hold the port in a reassignable binding, keep all panel-side message
  // handlers in a stable list (so they outlive any single port), and
  // transparently reconnect + re-announce the tab + re-assert locator mode
  // whenever the port drops.
  let backgroundPageConnection = null;
  let bgReconnectTimer = null;
  const bgMessageHandlers = [];

  function onBackgroundMessage(handler) {
    bgMessageHandlers.push(handler);
  }

  function postToBackground(message) {
    try {
      if (!backgroundPageConnection) return false;
      backgroundPageConnection.postMessage(message);
      return true;
    } catch (err) {
      // Port died between checks — drop it and let onDisconnect reconnect.
      backgroundPageConnection = null;
      return false;
    }
  }

  function connectToBackground() {
    backgroundPageConnection = chrome.runtime.connect({ name: "panel-page" });

    // Single dispatcher fans out to every registered handler, so handlers
    // survive reconnects without having to be re-bound to each new port.
    backgroundPageConnection.onMessage.addListener((message) => {
      for (const handler of bgMessageHandlers) {
        try { handler(message); } catch (e) { console.error("[LocatorSpy] message handler error:", e); }
      }
    });

    backgroundPageConnection.onDisconnect.addListener(() => {
      backgroundPageConnection = null;
      if (bgReconnectTimer) clearTimeout(bgReconnectTimer);
      bgReconnectTimer = setTimeout(connectToBackground, 500);
    });

    // (Re)announce which tab this panel inspects.
    postToBackground({
      name: "init",
      tabId: chrome.devtools.inspectedWindow.tabId,
    });

    // If locator mode was on before the worker died, re-assert it so hovering
    // keeps producing locators after an idle teardown / reconnect.
    if (isLocatorModeActive) {
      postToBackground({
        action: "activateLocatorMode",
        isActive: true,
        tabId: chrome.devtools.inspectedWindow.tabId,
      });
    }
  }

  connectToBackground();

  // Re-sync when the inspected page navigates or is refreshed. The page's
  // content scripts reload (losing locator mode + leaving stale results in
  // the panel), so clear the list and — if locator mode was on — re-assert it
  // against the freshly loaded page so hovering keeps working without a
  // manual toggle.
  if (chrome.devtools && chrome.devtools.network && chrome.devtools.network.onNavigated) {
    chrome.devtools.network.onNavigated.addListener(() => {
      locatorResults.innerHTML =
        '<p class="placeholder">Activate locator mode and hover over elements to see locators</p>';
      if (locatorSectionTitle && locatorSectionSubtitle) {
        locatorSectionTitle.textContent = "Element Locators";
        locatorSectionSubtitle.textContent = "Activate locator mode and hover on the page";
      }
      if (isLocatorModeActive) {
        // Give the reloaded content scripts a moment to register, then
        // re-activate (background re-injects as part of this message).
        setTimeout(() => {
          postToBackground({
            action: "activateLocatorMode",
            isActive: true,
            tabId: chrome.devtools.inspectedWindow.tabId,
          });
        }, 300);
      }
    });
  }

  // Toggle locator mode with animation
  locatorModeBtn.addEventListener("click", async function () {
    // Check if user is gated by feedback
    if (window.FeedbackService) {
      const needsFeedback = await FeedbackService.checkIfNeedsFeedback();
      if (needsFeedback) {
        FeedbackService.selectedRating = "positive";
        const feedbackPrompt = document.getElementById("feedbackPrompt");
        if (feedbackPrompt) feedbackPrompt.textContent = "Please share your feedback to continue generating locators.";
        const feedbackModal = document.getElementById("feedbackModal");
        if (feedbackModal) {
          // Use the `.show` class (display: flex) so the dialog centers
          // properly via the modal flex layout. `style.display = "block"`
          // un-hides it but skips centering and looks broken.
          feedbackModal.classList.add("show");
          feedbackModal.style.display = "";
        }
        return;
      }
    }
    isLocatorModeActive = !isLocatorModeActive;

    if (isLocatorModeActive) {
      trackLocatorModeActive();
      locatorModeBtn.classList.add("active-mode");
      locatorModeBtn.classList.remove("pulse-animation");
      locatorModeBtn.innerHTML = `
        <img src="../images/cursor-icon.png" class="icon" width="16" height="16" alt="Locator Mode">
        Locator Mode (Active)
      `;
    } else {
      locatorModeBtn.classList.remove("active-mode");
      locatorModeBtn.innerHTML = `
        <img src="../images/cursor-icon.png" class="icon" width="16" height="16" alt="Locator Mode">
        Locator Mode
      `;
    }

    // Send message to background script
    postToBackground({
      action: "activateLocatorMode",
      isActive: isLocatorModeActive,
      tabId: chrome.devtools.inspectedWindow.tabId,
    });
  });



  // Toggle dropdown menu
  menuBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    dropdownContent.classList.toggle("show");
  });

  // Close dropdown when clicking elsewhere
  document.addEventListener("click", function () {
    if (dropdownContent.classList.contains("show")) {
      dropdownContent.classList.remove("show");
    }
  });

  // Initialize Feedback Service
  if (window.FeedbackService) {
    FeedbackService.setupFeedbackHandlers();
    FeedbackService.checkFeedbackStatus();
  }


  // Listen for messages from the background page
  onBackgroundMessage(async function (message) {


    if (message.action === "getLocators") {
      if (window.FeedbackService) {
        // Feedback gate: once the user has generated enough locators without
        // submitting feedback, stop producing more on hover. Turn locator
        // mode off in the page and surface the prompt instead of rendering
        // new results — otherwise an already-active session keeps working
        // past the threshold and never has to give feedback.
        const gated = await FeedbackService.checkIfNeedsFeedback();
        if (gated) {
          if (isLocatorModeActive) {
            isLocatorModeActive = false;
            locatorModeBtn.classList.remove("active-mode");
            locatorModeBtn.innerHTML = `
        <img src="../images/cursor-icon.png" class="icon" width="16" height="16" alt="Locator Mode">
        Locator Mode
      `;
            postToBackground({
              action: "activateLocatorMode",
              isActive: false,
              tabId: chrome.devtools.inspectedWindow.tabId,
            });
          }
          FeedbackService.checkFeedbackStatus();
          return;
        }
        FeedbackService.incrementLocatorCount();
      }
      displayLocators(message.locators, false, message.trigger);
    }

    if (message.action === "locatorModeDeactivated") {
      isLocatorModeActive = false;
      locatorModeBtn.classList.remove("active-mode");
      locatorModeBtn.innerHTML = `
        <img src="../images/cursor-icon.png" class="icon" width="16" height="16" alt="Locator Mode">
        Locator Mode
      `;
    }
  });

  // Add validation listener
  onBackgroundMessage(function (message) {
    if (message.action === "validationResult") {
      const btns = document.querySelectorAll(".validate-btn");
      btns.forEach((btn) => {
        if (
          btn.dataset.type === message.locatorType &&
          btn.dataset.value === message.locatorValue
        ) {
          btn.classList.remove("validating");

          if (message.success) {
            btn.classList.remove("validation-failed");
            btn.classList.add("validation-success");
            btn.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
              Valid
            `;
          } else {
            btn.classList.remove("validation-success");
            btn.classList.add("validation-failed");
            btn.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              Failed
            `;
          }
        }
      });
    }
  });

  // Update displayLocators function to include validation for all XPath locators
  function displayLocators(locators, isAiGenerated = false, trigger = null) {
    // Reset validation states
    document.querySelectorAll('.validate-btn').forEach(btn => {
      btn.classList.remove('validation-success', 'validation-failed', 'validating');
      btn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1-7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
        </svg>
        Validate
      `;
    });

    if (!locators || Object.keys(locators).length === 0) {
      locatorResults.innerHTML =
        '<p class="placeholder">No locators found for this element</p>';
      if (locatorSectionTitle && locatorSectionSubtitle) {
        locatorSectionTitle.textContent = "Element Locators";
        locatorSectionSubtitle.textContent = "No locators for the current selection";
      }
      return;
    }

    // Count only the locators that will actually render (truthy string fields
    // + the entries in allXPaths). The result object always has the same
    // shape with null fields, so a raw key count is misleading.
    const RENDERED_FIELDS = [
      "id", "dataTestId", "cssSelector", "cssByAttrPair",
      "relativeXPath", "absoluteXPath",
      "xpathById", "xpathByName", "xpathByDataTestId", "xpathByAriaLabel",
      "xpathByPlaceholder", "xpathByText", "xpathByLinkText",
      "xpathByPartialLinkText", "partialTextXPath",
      "xpathByClassName", "xpathByTagName",
    ];
    let locatorCount = 0;
    for (const key of RENDERED_FIELDS) {
      if (locators[key]) locatorCount++;
    }
    if (Array.isArray(locators.allXPaths)) {
      locatorCount += locators.allXPaths.filter(Boolean).length;
    }


    // Sanitize XPath values
    if (locators.xpath) {
      locators.xpath = sanitizeXPath(locators.xpath);
    }

    if (locators.allXPaths) {
      locators.allXPaths = locators.allXPaths.map((xpath) =>
        sanitizeXPath(xpath)
      );
    }

    let html = "";
    html += '<div class="locators-table">';

    if (locatorSectionTitle && locatorSectionSubtitle) {
      locatorSectionTitle.textContent = isAiGenerated ? "AI Optimized Locators" : "Element Locators";
      const countLabel = `${locatorCount} locator${locatorCount === 1 ? "" : "s"}`;
      locatorSectionSubtitle.textContent = isAiGenerated
        ? `${countLabel} · AI refined for robustness`
        : `${countLabel} · Generated directly from the DOM`;
    }

    if (isAiGenerated) {
      // Dynamic rendering for AI results (can be many types)
      for (const [key, value] of Object.entries(locators)) {
        if (value && typeof value === 'string') {
          // Format key slightly if it's camelCase (optional, but AI prompt asks for readable keys)
          html += createLocatorItem(key, value, true);
        }
      }
    } else {
      // Standard rendering for local generator results (Strict Order)
      if (locators.id) html += createLocatorItem("ID", locators.id);
      if (locators.dataTestId) html += createLocatorItem("Data Test ID", locators.dataTestId);
      if (locators.cssSelector) html += createLocatorItem("CSS Selector", locators.cssSelector);
      if (locators.cssByAttrPair) html += createLocatorItem("CSS by Attr Pair", locators.cssByAttrPair);
      if (locators.relativeXPath) html += createLocatorItem("Relative XPath", locators.relativeXPath);
      if (locators.absoluteXPath) html += createLocatorItem("Absolute XPath", locators.absoluteXPath);
      if (locators.xpathById) html += createLocatorItem("XPath by ID", locators.xpathById);
      if (locators.xpathByName) html += createLocatorItem("XPath by Name", locators.xpathByName);
      if (locators.xpathByDataTestId) html += createLocatorItem("XPath by Data Test ID", locators.xpathByDataTestId);
      if (locators.xpathByAriaLabel) html += createLocatorItem("XPath by Aria Label", locators.xpathByAriaLabel);
      if (locators.xpathByPlaceholder) html += createLocatorItem("XPath by Placeholder", locators.xpathByPlaceholder);
      if (locators.xpathByText) html += createLocatorItem("XPath by Text", locators.xpathByText);
      if (locators.xpathByLinkText) html += createLocatorItem("XPath by Link Text", locators.xpathByLinkText);
      if (locators.xpathByPartialLinkText) html += createLocatorItem("XPath by Partial Link Text", locators.xpathByPartialLinkText);

      if (locators.partialTextXPath) {
        html += createLocatorItem("XPath by Partial Text", locators.partialTextXPath);
      }

      if (locators.allXPaths && locators.allXPaths.length > 0) {
        locators.allXPaths.forEach((xpath) => {
          html += `
          <div class="locator-item">
            <div class="locator-meta">
              <span class="locator-type">XPath</span>
            </div>
            <div class="locator-main" title="${escapeHtml(xpath)}">
              <span class="locator-value">
                <code class="locator-code">${xpath}</code>
              </span>
            </div>
            <div class="locator-actions">
              <button class="validate-btn" data-type="XPath" data-value="${escapeHtml(xpath)}" title="Validate locator">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1-7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                </svg>
                Validate
              </button>
              <button class="copy-btn" data-type="XPath" data-value="${escapeHtml(xpath)}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                Copy
              </button>
            </div>
          </div>
        `;
        });
      }

      if (locators.xpathByClassName) html += createLocatorItem("XPath by Class Name", locators.xpathByClassName);
      if (locators.xpathByTagName) html += createLocatorItem("XPath by Tag Name", locators.xpathByTagName);
    }

    html += "</div>";
    locatorResults.innerHTML = html;

    // Add event listeners to copy and validate buttons
    document.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        const value = this.getAttribute("data-value");
        const type = this.getAttribute("data-type") || "";
        copyToClipboard(formatLocator(type, value, getCopyFormat()), this);
      });
    });

    addValidationListeners();
    autoValidateLocators(locators); // Trigger auto-validation if enabled

    // Trigger Auto Optimization if enabled and not already AI generated
    if (!isAiGenerated && trigger === 'click') {
      chrome.storage.local.get("isAutoOptimizeEnabled", (result) => {
        if (result.isAutoOptimizeEnabled) {
          performAiOptimization(true);
        }
      });
    }
  }

  // Helper function to create locator item
  function createLocatorItem(type, value, isAiGenerated = false) {
    const aiBadge = isAiGenerated
      ? '<span class="badge-pill badge-ai">AI</span>'
      : '';

    return `
      <div class="locator-item">
        <div class="locator-meta">
          <span class="locator-type">${type}</span>
          <span class="locator-badges">
            ${aiBadge}
          </span>
        </div>
        <div class="locator-main" title="${escapeHtml(value)}">
          <span class="locator-value">
            <code class="locator-code">${value}</code>
          </span>
        </div>
        <div class="locator-actions">
          <button class="validate-btn" data-type="${type}" data-value="${escapeHtml(value)}" title="Validate locator">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1-7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
            </svg>
            Validate
          </button>
          <button class="copy-btn" data-type="${escapeHtml(type)}" data-value="${escapeHtml(value)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy
          </button>
        </div>
      </div>
    `;
  }

  // Add event listener for validate buttons
  function addValidationListeners() {
    document.querySelectorAll(".validate-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        const type = this.getAttribute("data-type");
        const value = this.getAttribute("data-value");

        // Send validation request to content script
        chrome.tabs.query(
          { active: true, currentWindow: true },
          function (tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "validateLocator",
              locatorType: type,
              locatorValue: value,
            });
          }
        );

        // Add visual feedback
        this.classList.add("validating");
        setTimeout(() => {
          this.classList.remove("validating");
        }, 2000);
      });
    });
  }

  // Recorder view — sibling of the locator results inside .results. Toggled
  // by the Recorder button in the controls strip. The actual click capture
  // happens in content.js (always-injected on <all_urls>); this view just
  // shows the captured stream and generates framework code.
  const openRecorderBtn = document.getElementById("openRecorderBtn");
  const locatorView = document.getElementById("locatorView");
  const recorderView = document.getElementById("recorderView");
  const recBackBtn = document.getElementById("recBackBtn");

  // Tracks whether the recorder view is currently shown, so setView can
  // tell a true open/close transition from a no-op (and only fire the
  // matching analytics event once per actual transition).
  let recorderViewActive = false;
  function setView(name) {
    if (!locatorView || !recorderView) return;
    const wasRecorder = recorderViewActive;
    // Locator-only chrome that should disappear in recorder mode: the whole
    // controls strip (Filter, Auto Validate, Auto Optimize, Engine, Copy
    // as), and the eligibility-driven banners (they all advertise
    // locator-side features). The recorder view ships with its own header
    // controls and a Back button, so nothing essential is hidden.
    document.body.classList.toggle("view-recorder", name === "recorder");
    if (name === "recorder") {
      locatorView.hidden = true;
      recorderView.hidden = false;
      if (openRecorderBtn) openRecorderBtn.classList.add("active");
      recorderViewActive = true;
      // Hard reset on every entry — recording stopped, steps cleared,
      // generated code reset back to its initial placeholder.
      chrome.storage.local.set({
        recorderActive: false,
        recorderInteractions: [],
      }, () => {
        readRecorderState(renderRecorderView);
      });
      if (!wasRecorder) {
        trackRecorderOpened();
        logLocatorLifecycle("recorder_opened");
      }
    } else {
      // Leaving recorder view → stop any in-progress recording so the
      // user's locator-mode hovers/clicks aren't quietly captured.
      chrome.storage.local.set({ recorderActive: false });
      recorderView.hidden = true;
      locatorView.hidden = false;
      if (openRecorderBtn) openRecorderBtn.classList.remove("active");
      recorderViewActive = false;
      if (wasRecorder) {
        trackRecorderClosed();
        logLocatorLifecycle("recorder_closed");
      }
    }
  }

  if (openRecorderBtn) {
    openRecorderBtn.addEventListener("click", () => {
      const showing = recorderView && !recorderView.hidden;
      setView(showing ? "locator" : "recorder");
    });
  }
  if (recBackBtn) {
    recBackBtn.addEventListener("click", () => setView("locator"));
  }

  // -------- Recorder logic --------
  const recStartBtn = document.getElementById("recStartBtn");
  const recStopBtn = document.getElementById("recStopBtn");
  const recClearBtn = document.getElementById("recClearBtn");
  const recCopyCodeBtn = document.getElementById("recCopyCodeBtn");
  const recFrameworkSelect = document.getElementById("recFrameworkSelect");
  const recLanguageSelect = document.getElementById("recLanguageSelect");
  const recStatus = document.getElementById("recStatus");
  const recStatusLabel = recStatus ? recStatus.querySelector(".rec-status-label") : null;
  const recStepsList = document.getElementById("recStepsList");
  const recStepsEmpty = document.getElementById("recStepsEmpty");
  const recStepCount = document.getElementById("recStepCount");
  const recCodeInner = document.getElementById("recCodeInner");
  const recCodeBlock = document.getElementById("recCodeBlock");
  const recCodeFrameworkLabel = document.getElementById("recCodeFrameworkLabel");
  const recGenerateAiBtn = document.getElementById("recGenerateAiBtn");
  const recCodeAiBadge = document.getElementById("recCodeAiBadge");
  const recTestName = document.getElementById("recTestName");
  const recCreditsInfo = document.getElementById("recCreditsInfo");

  // (Framework, Language) → format key. Each combo points at one of the
  // existing format keys the code generators already understand. New
  // combos (e.g. Playwright Python) plug in here without touching the
  // emitters until we add their flavor.
  const REC_COMBOS = [
    { framework: "selenium",    language: "java",       format: "selenium-java",       languageLabel: "Java" },
    { framework: "selenium",    language: "python",     format: "selenium-python",     languageLabel: "Python" },
    { framework: "selenium",    language: "javascript", format: "selenium-javascript", languageLabel: "JavaScript" },
    { framework: "playwright",  language: "javascript", format: "playwright",          languageLabel: "JavaScript" },
    { framework: "playwright",  language: "typescript", format: "playwright",          languageLabel: "TypeScript" },
    { framework: "playwright",  language: "python",     format: "playwright-python",   languageLabel: "Python" },
    { framework: "cypress",     language: "javascript", format: "cypress",             languageLabel: "JavaScript" },
    { framework: "cypress",     language: "typescript", format: "cypress",             languageLabel: "TypeScript" },
    { framework: "webdriverio", language: "javascript", format: "webdriverio",         languageLabel: "JavaScript" },
    { framework: "webdriverio", language: "typescript", format: "webdriverio",         languageLabel: "TypeScript" },
    { framework: "raw",         language: "raw",        format: "raw",                 languageLabel: "—" },
  ];

  function recLanguagesFor(framework) {
    return REC_COMBOS.filter((c) => c.framework === framework);
  }
  function recFormatFor(framework, language) {
    const c = REC_COMBOS.find((x) => x.framework === framework && x.language === language);
    return c ? c.format : "selenium-java";
  }
  function recDecomposeFormat(format) {
    const c = REC_COMBOS.find((x) => x.format === format);
    return c
      ? { framework: c.framework, language: c.language }
      : { framework: "selenium", language: "java" };
  }
  // Repaint the Language dropdown to only show valid languages for the
  // currently selected framework, preserving the previous selection if it
  // remains valid.
  function recRepaintLanguageOptions(framework, preferLang) {
    if (!recLanguageSelect) return;
    const valid = recLanguagesFor(framework);
    const prev = preferLang || recLanguageSelect.value;
    recLanguageSelect.innerHTML = valid
      .map((c) => `<option value="${c.language}">${c.languageLabel}</option>`)
      .join("");
    const match = valid.find((c) => c.language === prev) || valid[0];
    if (match) recLanguageSelect.value = match.language;
    recLanguageSelect.disabled = framework === "raw";
  }

  function recPickBestLocator(locators) {
    if (!locators) return null;
    if (locators.cssSelector) return { type: "CSS Selector", value: locators.cssSelector };
    if (locators.id) return { type: "ID", value: locators.id };
    if (locators.relativeXPath) return { type: "Relative XPath", value: locators.relativeXPath };
    if (locators.absoluteXPath) return { type: "Absolute XPath", value: locators.absoluteXPath };
    return null;
  }

  // Same shape as formatLocator() but emits just the locator-creation
  // expression for embedding inside an action (`.click()`).
  function recLocatorExpr(loc, framework) {
    if (!loc || !loc.value) return null;
    const t = loc.type || "", value = loc.value;
    const isXpath = /xpath/i.test(t);
    const isPureId = t === "ID" && /^[A-Za-z][\w\-]*$/.test(String(value));
    const dq = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const sq = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const cssEscapeId = (s) =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(String(s))
        : String(s);
    switch (framework) {
      case "selenium-java":
        if (isPureId) return `By.id("${dq(value)}")`;
        if (isXpath) return `By.xpath("${dq(value)}")`;
        if (t === "ID") return `By.cssSelector("#${dq(cssEscapeId(value))}")`;
        return `By.cssSelector("${dq(value)}")`;
      case "selenium-python":
        if (isPureId) return `By.ID, "${dq(value)}"`;
        if (isXpath) return `By.XPATH, "${dq(value)}"`;
        if (t === "ID") return `By.CSS_SELECTOR, "#${dq(cssEscapeId(value))}"`;
        return `By.CSS_SELECTOR, "${dq(value)}"`;
      case "selenium-javascript":
        // selenium-webdriver Node API: By.id / By.xpath / By.css
        if (isPureId) return `By.id('${sq(value)}')`;
        if (isXpath) return `By.xpath('${sq(value)}')`;
        if (t === "ID") return `By.css('#${sq(cssEscapeId(value))}')`;
        return `By.css('${sq(value)}')`;
      case "playwright":
        if (t === "ID") return `'#${sq(cssEscapeId(value))}'`;
        if (isXpath) return `'xpath=${sq(value)}'`;
        return `'${sq(value)}'`;
      case "playwright-python":
        // page.locator takes a string just like JS — single quotes here
        // produce double-quoted Python literals via the line builders.
        if (t === "ID") return `'#${sq(cssEscapeId(value))}'`;
        if (isXpath) return `'xpath=${sq(value)}'`;
        return `'${sq(value)}'`;
      case "cypress":
      case "webdriverio":
        if (t === "ID") return `'#${sq(cssEscapeId(value))}'`;
        return `'${sq(value)}'`;
      default:
        return value;
    }
  }

  // Per-action emitters. Each returns a single line (or empty string for
  // raw mode, where the per-step text is emitted by the outer loop).

  function recEscapeJavaStr(s) {
    return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  }
  function recEscapeJsStr(s) {
    return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
  }

  function recClickLine(it, fw) {
    const loc = recPickBestLocator(it.locators);
    const expr = recLocatorExpr(loc, fw);
    switch (fw) {
      case "selenium-java": return `    driver.findElement(${expr}).click();`;
      case "selenium-python": return `driver.find_element(${expr}).click()`;
      case "selenium-javascript": return `    await driver.findElement(${expr}).click();`;
      case "playwright": return `  await page.locator(${expr}).click();`;
      case "playwright-python": return `    page.locator(${expr}).click()`;
      case "cypress": {
        const isXpath = loc && /xpath/i.test(loc.type);
        return `    ${isXpath ? "cy.xpath" : "cy.get"}(${expr}).click();`;
      }
      case "webdriverio": return `    await $(${expr}).click();`;
      default: return loc ? `${loc.type}: ${loc.value}` : "(no locator)";
    }
  }

  // Text input typing. Most frameworks have a "replace value" idiom; for
  // Selenium and Cypress we explicitly clear() first so the recorded value
  // is what ends up in the field regardless of pre-fill.
  function recInputLine(it, fw) {
    const loc = recPickBestLocator(it.locators);
    const expr = recLocatorExpr(loc, fw);
    const v = it.value == null ? "" : String(it.value);
    switch (fw) {
      case "selenium-java":
        return `    {\n      org.openqa.selenium.WebElement el = driver.findElement(${expr});\n      el.clear();\n      el.sendKeys("${recEscapeJavaStr(v)}");\n    }`;
      case "selenium-python":
        return `el = driver.find_element(${expr})\nel.clear()\nel.send_keys("${recEscapeJavaStr(v)}")`;
      case "selenium-javascript":
        return `    {\n      const el = await driver.findElement(${expr});\n      await el.clear();\n      await el.sendKeys('${recEscapeJsStr(v)}');\n    }`;
      case "playwright":
        return `  await page.locator(${expr}).fill('${recEscapeJsStr(v)}');`;
      case "playwright-python":
        return `    page.locator(${expr}).fill("${recEscapeJavaStr(v)}")`;
      case "cypress": {
        const isXpath = loc && /xpath/i.test(loc.type);
        const getter = isXpath ? "cy.xpath" : "cy.get";
        // Cypress .type() with empty string throws — use .clear() alone.
        if (!v) return `    ${getter}(${expr}).clear();`;
        return `    ${getter}(${expr}).clear().type('${recEscapeJsStr(v)}');`;
      }
      case "webdriverio":
        return `    await $(${expr}).setValue('${recEscapeJsStr(v)}');`;
      default:
        return loc ? `${loc.type}: ${loc.value}  (input "${v}")` : `(input "${v}")`;
    }
  }

  function recSelectLine(it, fw) {
    const loc = recPickBestLocator(it.locators);
    const expr = recLocatorExpr(loc, fw);
    const v = it.value == null ? "" : String(it.value);
    switch (fw) {
      case "selenium-java":
        return `    new org.openqa.selenium.support.ui.Select(driver.findElement(${expr})).selectByValue("${recEscapeJavaStr(v)}");`;
      case "selenium-python":
        return `Select(driver.find_element(${expr})).select_by_value("${recEscapeJavaStr(v)}")`;
      case "selenium-javascript":
        // selenium-webdriver Node has no Select wrapper; use a value-based
        // option click via xpath. Reasonable fidelity for most flows.
        return `    await driver.findElement(${expr}).findElement(By.css('option[value="${recEscapeJavaStr(v)}"]')).click();`;
      case "playwright":
        return `  await page.locator(${expr}).selectOption('${recEscapeJsStr(v)}');`;
      case "playwright-python":
        return `    page.locator(${expr}).select_option("${recEscapeJavaStr(v)}")`;
      case "cypress": {
        const isXpath = loc && /xpath/i.test(loc.type);
        const getter = isXpath ? "cy.xpath" : "cy.get";
        return `    ${getter}(${expr}).select('${recEscapeJsStr(v)}');`;
      }
      case "webdriverio":
        return `    await $(${expr}).selectByAttribute('value', '${recEscapeJsStr(v)}');`;
      default:
        return loc ? `${loc.type}: ${loc.value}  (select "${v}")` : `(select "${v}")`;
    }
  }

  // Window-level scroll. Modern frameworks auto-scroll-to-element on
  // .click(), so explicit scroll is mostly a fidelity feature for tests
  // that depend on a specific viewport position (lazy-loaded content,
  // sticky headers measured by scrollY, etc.).
  function recScrollLine(it, fw) {
    const x = it.x | 0, y = it.y | 0;
    switch (fw) {
      case "selenium-java":
        return `    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollTo(${x}, ${y});");`;
      case "selenium-python":
        return `driver.execute_script("window.scrollTo(${x}, ${y})")`;
      case "selenium-javascript":
        return `    await driver.executeScript('window.scrollTo(${x}, ${y});');`;
      case "playwright":
        return `  await page.evaluate(() => window.scrollTo(${x}, ${y}));`;
      case "playwright-python":
        return `    page.evaluate("window.scrollTo(${x}, ${y})")`;
      case "cypress":
        return `    cy.scrollTo(${x}, ${y});`;
      case "webdriverio":
        return `    await browser.execute(() => window.scrollTo(${x}, ${y}));`;
      default:
        return `(scroll to ${x}, ${y})`;
    }
  }

  function recActionLine(it, fw) {
    switch (it.action) {
      case "click": return recClickLine(it, fw);
      case "input": return recInputLine(it, fw);
      case "select": return recSelectLine(it, fw);
      case "scroll": return recScrollLine(it, fw);
      default: return recClickLine(it, fw); // unknown action falls back to click
    }
  }

  function recNavLine(url, fw) {
    const sqUrl = url.replace(/'/g, "\\'");
    switch (fw) {
      case "selenium-java": return `    driver.get("${url}");`;
      case "selenium-python": return `driver.get("${url}")`;
      case "selenium-javascript": return `    await driver.get('${sqUrl}');`;
      case "playwright": return `  await page.goto('${sqUrl}');`;
      case "playwright-python": return `    page.goto("${url}")`;
      case "cypress": return `    cy.visit('${sqUrl}');`;
      case "webdriverio": return `    await browser.url('${sqUrl}');`;
      default: return `# ${url}`;
    }
  }

  function recWrap(framework, hasCypressXpath) {
    switch (framework) {
      case "selenium-java": return {
        header:
`import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;

public class RecordedFlow {
  public static void main(String[] args) {
    WebDriver driver = new ChromeDriver();
`,
        footer:
`
    driver.quit();
  }
}`,
      };
      case "selenium-python": return {
        header:
`from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select

driver = webdriver.Chrome()
`,
        footer: `
driver.quit()`,
      };
      case "selenium-javascript": return {
        header:
`const { Builder, By, Key, until } = require('selenium-webdriver');

(async function recordedFlow() {
  const driver = await new Builder().forBrowser('chrome').build();
  try {
`,
        footer:
`
  } finally {
    await driver.quit();
  }
})();`,
      };
      case "playwright-python": return {
        header:
`from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
`,
        footer: `
    browser.close()`,
      };
      case "playwright": return {
        header:
`import { test, expect } from '@playwright/test';

test('recorded flow', async ({ page }) => {
`,
        footer: `});`,
      };
      case "cypress": {
        const note = hasCypressXpath
          ? `// Requires cypress-xpath plugin (https://github.com/cypress-io/cypress-xpath).\n`
          : "";
        return {
          header:
`${note}describe('Recorded flow', () => {
  it('runs the recorded interactions', () => {
`,
          footer: `  });
});`,
        };
      }
      case "webdriverio": return {
        header:
`describe('Recorded flow', () => {
  it('runs the recorded interactions', async () => {
`,
        footer: `  });
});`,
      };
      default: return { header: `# Recorded steps\n`, footer: `` };
    }
  }

  function recGenerateCode(interactions, framework) {
    if (!interactions || !interactions.length) {
      return "// Click \"Start\", then interact with the page.";
    }
    const hasCypressXpath = framework === "cypress" &&
      interactions.some((i) => {
        const l = recPickBestLocator(i.locators);
        return l && /xpath/i.test(l.type);
      });
    const w = recWrap(framework, hasCypressXpath);
    const lines = [];
    let lastUrl = null;
    interactions.forEach((it, idx) => {
      if (framework === "raw") {
        const loc = recPickBestLocator(it.locators);
        lines.push(
          `Step ${idx + 1}: ${it.action} on <${(it.element && it.element.tag) || "?"}>` +
          (it.element && it.element.text ? ` "${it.element.text}"` : "") +
          (it.url && it.url !== lastUrl ? ` @ ${it.url}` : "")
        );
        lines.push(loc ? `  ${loc.type}: ${loc.value}` : "  (no locator)");
        lastUrl = it.url || lastUrl;
        lines.push("");
        return;
      }
      if (it.url && it.url !== lastUrl) {
        lines.push(recNavLine(it.url, framework));
        lastUrl = it.url;
      }
      lines.push(recActionLine(it, framework));
    });
    return w.header + lines.join("\n") + (lines.length ? "\n" : "") + w.footer;
  }

  function readRecorderState(cb) {
    chrome.storage.local.get(
      ["recorderActive", "recorderInteractions", "copyFormat"],
      (state) => cb(state || {})
    );
  }

  // Most recent AI generation, re-applied by renderRecorderView across the
  // storage-driven re-renders. Shape: { format, stepSig, data }. It
  // auto-invalidates when the recorded steps or the framework/language change
  // (signature mismatch) — the view falls back to the template codegen and
  // the user can regenerate.
  let recAiResult = null;
  function recStepSignature(interactions) {
    return (interactions || []).map((i) => i && i.id).join("|");
  }

  // Mirror the locator panel's free-credit count into the recorder view. Reads
  // the shared freeCreditsState; hidden until credits are known.
  function applyRecorderCreditsInfo() {
    if (!recCreditsInfo) return;
    const s = freeCreditsState;
    if (s && typeof s.remaining === "number") {
      const left = s.remaining;
      const limit = typeof s.limit === "number" ? s.limit : null;
      recCreditsInfo.hidden = false;
      recCreditsInfo.textContent = limit != null
        ? `${left} / ${limit} free AI credits`
        : `${left} free AI ${left === 1 ? "credit" : "credits"} left`;
    } else {
      recCreditsInfo.hidden = true;
    }
  }

  function renderRecorderView(state) {
    const interactions = state.recorderInteractions || [];
    const isActive = !!state.recorderActive;
    // Default the recorder to a runnable format rather than raw — most
    // users come here for code, not a selector dump. Selenium JavaScript is
    // the default flavor. The Copy-as dropdown's own default of "raw" still
    // applies to per-locator copy.
    const stored = state.copyFormat;
    const format = stored && stored !== "raw" ? stored : "selenium-javascript";
    const decomposed = recDecomposeFormat(format);

    if (recFrameworkSelect && recFrameworkSelect.value !== decomposed.framework) {
      recFrameworkSelect.value = decomposed.framework;
    }
    // Always repaint the language options (they depend on framework), then
    // sync to the decomposed language if it's valid.
    recRepaintLanguageOptions(decomposed.framework, decomposed.language);

    // The downstream code generators still take the single format key.
    const framework = format;

    // If the last AI generation still matches the current steps + framework,
    // it becomes the active output (code, test name, per-step annotations).
    const sig = recStepSignature(interactions);
    const aiData =
      recAiResult && recAiResult.format === format && recAiResult.stepSig === sig
        ? recAiResult.data
        : null;

    if (recStatus) {
      recStatus.classList.toggle("active", isActive);
      recStatus.classList.toggle("idle", !isActive);
    }
    if (recStatusLabel) recStatusLabel.textContent = isActive ? "Recording" : "Idle";
    if (recStartBtn) recStartBtn.disabled = isActive;
    if (recStopBtn) recStopBtn.disabled = !isActive;

    if (recStepCount) recStepCount.textContent = String(interactions.length);
    if (recStepsList && recStepsEmpty) {
      if (!interactions.length) {
        recStepsList.innerHTML = "";
        recStepsEmpty.style.display = "";
      } else {
        recStepsEmpty.style.display = "none";
        recStepsList.innerHTML = interactions
          .map((it, idx) => {
            const loc = recPickBestLocator(it.locators);
            const tag = (it.element && it.element.tag) || "?";
            // Build a per-action descriptor. Click shows the element text,
            // input/select show the typed/picked value, scroll shows target.
            let descriptor = "";
            if (it.action === "scroll") {
              descriptor = `→ scrollTo(${it.x | 0}, ${it.y | 0})`;
            } else if (it.action === "input") {
              const v = it.isPassword ? "••••••••" : (it.value == null ? "" : String(it.value));
              descriptor = `&lt;${escapeHtml(tag)}&gt; ← "${escapeHtml(v.slice(0, 60))}"`;
            } else if (it.action === "select") {
              descriptor = `&lt;${escapeHtml(tag)}&gt; ← "${escapeHtml(String(it.value || "").slice(0, 60))}"`;
            } else {
              const text = it.element && it.element.text ? `"${it.element.text}"` : "";
              descriptor = `<strong>&lt;${escapeHtml(tag)}&gt;</strong> ${escapeHtml(text)}`;
            }
            const locStr = loc ? `${loc.type}: ${loc.value}` : (it.action === "scroll" ? "" : "(no locator)");
            // When an AI generation is active, annotate each step with its
            // plain-English description and any inferred assertion.
            const aiStep = aiData && Array.isArray(aiData.steps) ? aiData.steps[idx] : null;
            const aiNote = aiStep && aiStep.description
              ? `<span class="step-ai-note">${escapeHtml(String(aiStep.description))}</span>` : "";
            const aiAssert = aiStep && aiStep.assertion
              ? `<span class="step-ai-assert">${escapeHtml(String(aiStep.assertion))}</span>` : "";
            return `<li>
              <span class="step-index">${idx + 1}</span>
              <span class="step-action">${escapeHtml(it.action)}</span>
              <div class="step-body">
                <span class="step-element">${descriptor}</span>
                ${locStr ? `<span class="step-locator">${escapeHtml(locStr)}</span>` : ""}
                ${aiNote}
                ${aiAssert}
              </div>
            </li>`;
          })
          .join("");
      }
    }

    if (aiData) {
      // AI generation is the active output for the current steps + framework.
      if (recCodeInner) recCodeInner.textContent = aiData.code;
      if (recCodeAiBadge) recCodeAiBadge.hidden = false;
      if (recTestName) recTestName.textContent = aiData.testName ? String(aiData.testName) : "";
    } else {
      if (recCodeInner) recCodeInner.textContent = recGenerateCode(interactions, framework);
      if (recCodeAiBadge) recCodeAiBadge.hidden = true;
      if (recTestName) recTestName.textContent = "";
    }
    if (recCodeFrameworkLabel) recCodeFrameworkLabel.textContent = framework;

    applyRecorderCreditsInfo();
  }

  // Timestamp of the last Start click. Used to compute session duration
  // when recording stops.
  let recSessionStartTs = 0;

  function recCurrentPickers() {
    return {
      framework: recFrameworkSelect ? recFrameworkSelect.value : null,
      language: recLanguageSelect ? recLanguageSelect.value : null,
    };
  }

  function recActionBreakdown(interactions) {
    const counts = { click: 0, input: 0, select: 0, scroll: 0 };
    for (const it of interactions || []) {
      if (counts.hasOwnProperty(it.action)) counts[it.action]++;
    }
    return counts;
  }

  if (recStartBtn) recStartBtn.addEventListener("click", () => {
    chrome.storage.local.set({ recorderActive: true });
    recSessionStartTs = Date.now();
    const p = recCurrentPickers();
    trackRecorderStarted(p);
    logLocatorLifecycle("recorder_started", p);
  });
  if (recStopBtn) recStopBtn.addEventListener("click", () => {
    chrome.storage.local.set({ recorderActive: false });
    chrome.storage.local.get("recorderInteractions", (r) => {
      const interactions = (r && r.recorderInteractions) || [];
      const meta = {
        ...recCurrentPickers(),
        stepCount: interactions.length,
        actionBreakdown: recActionBreakdown(interactions),
        durationMs: recSessionStartTs ? Date.now() - recSessionStartTs : null,
      };
      trackRecorderStopped(meta);
      logLocatorLifecycle("recorder_stopped", meta);
    });
    recSessionStartTs = 0;
  });
  if (recClearBtn) recClearBtn.addEventListener("click", () => {
    chrome.storage.local.get("recorderInteractions", (r) => {
      const priorStepCount = ((r && r.recorderInteractions) || []).length;
      chrome.storage.local.set({ recorderInteractions: [] });
      trackRecorderCleared({ priorStepCount });
      logLocatorLifecycle("recorder_cleared", { priorStepCount });
    });
  });
  if (recCopyCodeBtn) recCopyCodeBtn.addEventListener("click", () => {
    if (!recCodeInner) return;
    const text = recCodeInner.textContent || "";
    if (!text.trim()) return;
    copyToClipboard(text);
    chrome.storage.local.get("recorderInteractions", (r) => {
      const interactions = (r && r.recorderInteractions) || [];
      const meta = {
        ...recCurrentPickers(),
        stepCount: interactions.length,
        charCount: text.length,
        actionBreakdown: recActionBreakdown(interactions),
      };
      trackRecorderCodeCopied(meta);
      logLocatorLifecycle("recorder_code_copied", meta);
    });
  });

  // AI generation: turn the recorded steps into a production-quality test.
  // Reuses the exact free-credits-first / BYO-key resolution as Optimize, and
  // the same transparent fallback when free credits run out.
  // Staged "thinking" UX for the recorder's AI generation — same cosmetic
  // pattern as the optimize flow's aiThinking. The generate call is a single
  // blocking request, so we narrate plausible stages of the work in the code
  // pane while we wait. No worker or response-contract changes.
  const recAiThinking = {
    timers: [],
    panel: null,
    STAGES: [
      "Reading recorded steps",
      "Mapping actions to framework",
      "Hardening locators & waits",
      "Writing assertions & test code",
    ],
    REASSURE: [
      { delay: 5000, text: "Hold tight — we're at the final processing…" },
      { delay: 11000, freeOnly: true, text: "Almost there — free-credit responses can run a little slow." },
    ],
    isFree: false,
    start(isFree = false) {
      this.stop();
      this.isFree = isFree;
      if (!recCodeBlock || !recCodeBlock.parentElement) return;
      const steps = this.STAGES
        .map(
          (label, i) =>
            `<li class="ai-step is-pending" data-i="${i}">
               <span class="ai-step-dot"></span>
               <span class="ai-step-label">${label}</span>
             </li>`,
        )
        .join("");
      const panel = document.createElement("div");
      panel.className = "ai-thinking rec-ai-thinking";
      panel.setAttribute("role", "status");
      panel.setAttribute("aria-live", "polite");
      panel.innerHTML =
        `<div class="ai-thinking-head">
           <span class="ai-thinking-orb"></span>
           <span class="ai-thinking-title">AI is writing your test…</span>
         </div>
         <ul class="ai-thinking-steps">${steps}</ul>
         <p class="ai-thinking-note" hidden></p>`;
      // Hide the code block and show the panel in its place, so the existing
      // <pre> content stays intact for the success/restore paths.
      recCodeBlock.hidden = true;
      recCodeBlock.parentElement.appendChild(panel);
      this.panel = panel;
      this.activate(0);
    },
    activate(index) {
      if (!this.panel) return;
      const steps = this.panel.querySelectorAll(".ai-step");
      steps.forEach((el, i) => {
        el.classList.toggle("is-done", i < index);
        el.classList.toggle("is-active", i === index);
        el.classList.toggle("is-pending", i > index);
      });
      if (index < this.STAGES.length - 1) {
        this.timers.push(setTimeout(() => this.activate(index + 1), 1600 + index * 300));
      } else {
        const note = this.panel.querySelector(".ai-thinking-note");
        this.REASSURE.filter((r) => !r.freeOnly || this.isFree).forEach((r) => {
          this.timers.push(
            setTimeout(() => {
              if (!note) return;
              note.textContent = r.text;
              note.hidden = false;
            }, r.delay),
          );
        });
      }
    },
    stop() {
      this.timers.forEach(clearTimeout);
      this.timers = [];
      if (this.panel) {
        this.panel.remove();
        this.panel = null;
      }
      if (recCodeBlock) recCodeBlock.hidden = false;
    },
  };

  async function performRecorderAiGeneration() {
    chrome.storage.local.get(
      ["recorderInteractions", "aiProvider", "googleApiKey", "aiModel", "openRouterApiKey", "openRouterModel", "auth_token"],
      async (result) => {
        const interactions = result.recorderInteractions || [];
        if (!interactions.length) {
          showCopyNotification("Record some steps first, then Generate with AI.");
          return;
        }

        const { framework, language } = recCurrentPickers();
        const fw = framework || "selenium";
        const lang = language || "java";
        if (fw === "raw") {
          showCopyNotification("Pick a framework (not Raw) for AI generation.");
          return;
        }

        const provider = result.aiProvider || "google";
        const apiKey = provider === "openrouter" ? result.openRouterApiKey : result.googleApiKey;
        const model = provider === "openrouter" ? result.openRouterModel : result.aiModel;
        const authToken = result.auth_token;

        // Free credits first whenever available (google + signed in), falling
        // back to the user's own key when exhausted — same policy as Optimize.
        const credits = freeCreditsState;
        const hasFreeRemaining = credits && typeof credits.remaining === "number" && credits.remaining > 0;
        const freeAvailable = provider === "google" && !!authToken;
        const tryFreeFirst = freeAvailable && (hasFreeRemaining || !apiKey);

        if (!apiKey && !tryFreeFirst) {
          logLocatorLifecycle("recorder_ai_failed", { reason: "api_key_missing", provider });
          trackRecorderAiFailed({ reason: "api_key_missing", provider, framework: fw, language: lang });
          if (typeof openAiSettings === "function") openAiSettings();
          return;
        }

        if (recGenerateAiBtn) {
          recGenerateAiBtn.disabled = true;
          recGenerateAiBtn.classList.add("is-loading");
        }
        const restoreBtn = () => {
          if (recGenerateAiBtn) {
            recGenerateAiBtn.disabled = false;
            recGenerateAiBtn.classList.remove("is-loading");
          }
        };

        recAiThinking.start(tryFreeFirst);

        const callOnce = (mode) =>
          generateAiTestCode(
            interactions, fw, lang, apiKey, model, provider,
            mode === "free_credits" ? { freeCredits: { authToken } } : undefined,
          );

        let mode = tryFreeFirst ? "free_credits" : "byo_key";
        let fellBackToKey = false;
        logLocatorLifecycle("recorder_ai_started", {
          provider, model, mode, framework: fw, language: lang, stepCount: interactions.length,
        });
        trackRecorderAiStarted({
          provider, model, mode, framework: fw, language: lang, stepCount: interactions.length,
        });

        try {
          let data;
          try {
            data = await callOnce(mode);
          } catch (err) {
            if (err && err.code === "free_credits_exhausted" && apiKey) {
              updateCreditsFromResponse({ used: err.creditsLimit, remaining: 0, limit: err.creditsLimit });
              const fbMeta = { provider, model, limit: err.creditsLimit };
              trackFreeCreditsExhausted({ ...fbMeta, source: "recorder" });
              trackFreeCreditsFallback(fbMeta);
              logLocatorLifecycle("free_credits_exhausted", { ...fbMeta, source: "recorder" });
              logLocatorLifecycle("recorder_ai_fallback", { reason: "free_credits_exhausted", ...fbMeta });
              mode = "byo_key";
              fellBackToKey = true;
              data = await callOnce(mode);
            } else {
              throw err;
            }
          }

          if (!data || typeof data.code !== "string") throw new Error("Empty AI result");

          if (data.__credits) updateCreditsFromResponse(data.__credits);
          recAiResult = {
            format: recFormatFor(fw, lang),
            stepSig: recStepSignature(interactions),
            data,
          };
          readRecorderState(renderRecorderView);

          const left = data.__credits ? data.__credits.remaining : null;
          const completedMeta = {
            provider, model, mode, fellBackToKey, framework: fw, language: lang,
            testName: data.testName, stepCount: interactions.length,
            creditsRemaining: typeof left === "number" ? left : undefined,
          };
          logLocatorLifecycle("recorder_ai_completed", completedMeta);
          trackRecorderAiGenerated(completedMeta);

          if (fellBackToKey) {
            showCopyNotification("Generated with AI! Free credits used up — switched to your API key.");
          } else if (mode === "free_credits" && typeof left === "number") {
            showCopyNotification(
              left > 0
                ? `Generated with AI! (${left} free ${left === 1 ? "credit" : "credits"} left)`
                : "Generated with AI! Last free credit used.",
            );
          } else {
            showCopyNotification("Generated with AI!");
          }
        } catch (err) {
          console.error("Recorder AI generation failed:", err);
          const failMeta = {
            provider, model, framework: fw, language: lang,
            error: String((err && err.message) || err),
          };
          logLocatorLifecycle("recorder_ai_failed", failMeta);
          trackRecorderAiFailed(failMeta);
          showCopyNotification(`AI generation failed: ${(err && err.message) || "try again"}`);
        } finally {
          // Removes the panel and unhides the code block. On success the code
          // pane was already re-rendered (while hidden) by renderRecorderView.
          recAiThinking.stop();
          restoreBtn();
        }
      },
    );
  }
  if (recGenerateAiBtn) recGenerateAiBtn.addEventListener("click", performRecorderAiGeneration);

  // "add your own API key" (BYOK) links in the AI caveat strips (recorder +
  // locator views) open the AI settings panel.
  [document.getElementById("recByokLink"), document.getElementById("locByokLink")].forEach((lnk) => {
    if (!lnk) return;
    lnk.addEventListener("click", (e) => {
      e.preventDefault();
      const source = lnk.id === "recByokLink" ? "recorder" : "locator";
      logLocatorLifecycle("byok_cta_clicked", { source });
      trackByokCtaClicked({ source });
      if (typeof openAiSettings === "function") openAiSettings();
    });
  });

  // Recorder feedback button — reuses the panel's feedback modal and POSTs
  // to the same /feedback endpoint, just tags the payload with
  // feature: "recorder" so the backend can bucket it separately.
  const recFeedbackBtn = document.getElementById("recFeedbackBtn");
  if (recFeedbackBtn) {
    recFeedbackBtn.addEventListener("click", () => {
      logLocatorLifecycle("recorder_feedback_opened", recCurrentPickers());
      if (window.FeedbackService && typeof window.FeedbackService.openFeedbackForFeature === "function") {
        window.FeedbackService.openFeedbackForFeature(
          "recorder",
          "How is the Recorder working for you? What's missing, broken, or confusing?",
          "neutral"
        );
      }
    });
  }
  // Framework + Language pickers inside the recorder view. Both compose
  // into the single `copyFormat` storage key (same source of truth as the
  // controls-bar "Copy as" dropdown), so the storage.onChanged listener
  // handles re-rendering. Framework change also repaints the Language
  // options to only show combinations we actually support.
  if (recFrameworkSelect) {
    recFrameworkSelect.addEventListener("change", (event) => {
      const framework = event.target.value;
      // Repaint language options first; this lets us read the (possibly
      // newly-selected) language right after.
      recRepaintLanguageOptions(framework);
      const language = recLanguageSelect ? recLanguageSelect.value : "";
      chrome.storage.local.set({ copyFormat: recFormatFor(framework, language) });
      trackRecorderFrameworkSelected(framework, language, { source: "framework" });
      logLocatorLifecycle("recorder_framework_selected", { framework, language, source: "framework" });
    });
  }
  if (recLanguageSelect) {
    recLanguageSelect.addEventListener("change", () => {
      const framework = recFrameworkSelect ? recFrameworkSelect.value : "selenium";
      const language = recLanguageSelect.value;
      chrome.storage.local.set({ copyFormat: recFormatFor(framework, language) });
      trackRecorderFrameworkSelected(framework, language, { source: "language" });
      logLocatorLifecycle("recorder_framework_selected", { framework, language, source: "language" });
    });
  }

  // Initial render and live-update subscription. Storage changes from any
  // tab (content.js capturing a click; recorder buttons toggling state)
  // re-render the panel view automatically.
  readRecorderState(renderRecorderView);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (
      "recorderActive" in changes ||
      "recorderInteractions" in changes ||
      "copyFormat" in changes
    ) {
      readRecorderState(renderRecorderView);
    }
  });

  // Replace your current refresh button code with this:
  const refreshBtn = document.getElementById("refreshBtn");

  refreshBtn.addEventListener("click", () => {
    trackPanelRefreshed();
    logLocatorLifecycle("panel_refreshed");

    // Clear selected locators
    locatorResults.innerHTML =
      '<p class="placeholder">Activate locator mode and hover over elements to see locators</p>';

    if (locatorSectionTitle && locatorSectionSubtitle) {
      locatorSectionTitle.textContent = "Element Locators";
      locatorSectionSubtitle.textContent = "Activate locator mode and hover on the page";
    }

    // Reset locator mode if it's active
    if (isLocatorModeActive) {
      isLocatorModeActive = false;
      locatorModeBtn.classList.remove("active-mode");
      locatorModeBtn.innerHTML = `
        <img src="../images/cursor-icon.png" class="icon" width="16" height="16" alt="Locator Mode">
        Locator Mode
      `;

      // Notify background script to deactivate locator mode
      postToBackground({
        action: "activateLocatorMode",
        isActive: false,
        tabId: chrome.devtools.inspectedWindow.tabId,
      });
    }
  });

  // Filter locators based on search input
  searchBoxInput.addEventListener("input", function () {
    const filterText = this.value.toLowerCase();
    const locatorItems = document.querySelectorAll(
      "#locatorResults .locator-item"
    );
    locatorItems.forEach((item) => {
      const locatorTypeElement = item.querySelector(".locator-type");
      const locatorValueElement = item.querySelector(".locator-value");

      // Add null checks for child elements
      if (locatorTypeElement && locatorValueElement) {
        const locatorType = locatorTypeElement.textContent.toLowerCase();
        const locatorValue = locatorValueElement.textContent.toLowerCase();
        if (
          locatorType.includes(filterText) ||
          locatorValue.includes(filterText)
        ) {
          item.style.display = "";
        } else {
          item.style.display = "none";
        }
      }
    });
  });

  // Copy all visible locators
  copyAllBtn.addEventListener("click", function () {
    const format = getCopyFormat();
    const allLocatorTexts = [];
    const locatorItems = document.querySelectorAll(
      "#locatorResults .locator-item"
    );

    locatorItems.forEach((item) => {
      const locatorTypeElement = item.querySelector(".locator-type");
      const locatorValueElement = item.querySelector(".locator-value");

      // Only process items that have both type and value elements
      if (locatorTypeElement && locatorValueElement) {
        const isHidden =
          item.style.display === "none" ||
          window.getComputedStyle(item).display === "none";
        const type = locatorTypeElement.textContent.replace(":", "").trim();

        // Skip items that are hidden or only contain header text (like "All XPaths:")
        if (!isHidden && type !== "All XPaths") {
          const value = locatorValueElement.textContent.trim();
          allLocatorTexts.push(
            format === "raw"
              ? `${type}: ${value}`
              : formatLocator(type, value, format)
          );
        }
      }
    });

    if (allLocatorTexts.length > 0) {
      const sep = format === "raw" ? "\n\n" : "\n";
      const textToCopy = allLocatorTexts.join(sep);
      copyToClipboard(textToCopy);
      showCopyNotification("Locators copied to clipboard!");
    } else {
      showCopyNotification("No locators available to copy");
    }
  });

  // Helper function to copy to clipboard that works in Chrome extensions
  function copyToClipboard(text, buttonElement = null) {
    if (!text) {
      showCopyNotification("No locator available to copy");
      return;
    }

    // Use the newer navigator.clipboard API when available
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          showCopyNotification("Locator copied to clipboard!");
          if (buttonElement) {
            buttonElement.classList.add("copied");
            setTimeout(() => {
              buttonElement.classList.remove("copied");
            }, 1000);
          }
        })
        .catch((err) => {
          console.error("Failed to copy: ", err);
          // Fall back to the older method
          fallbackCopyToClipboard(text, buttonElement);
        });
    } else {
      // Use the older method as fallback
      fallbackCopyToClipboard(text, buttonElement);
    }
  }

  // Add this helper function for fallback copying
  function fallbackCopyToClipboard(text, buttonElement) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);

    try {
      textarea.select();
      const success = document.execCommand("copy");
      if (success) {
        showCopyNotification("Locator copied to clipboard!");
        if (buttonElement) {
          buttonElement.classList.add("copied");
          setTimeout(() => {
            buttonElement.classList.remove("copied");
          }, 1000);
        }
      } else {
        showCopyNotification("Failed to copy to clipboard");
      }
    } catch (err) {
      console.error("Failed to copy: ", err);
      showCopyNotification("Failed to copy to clipboard");
    } finally {
      document.body.removeChild(textarea);
    }
  }

  // Helper function to show copy notification
  function showCopyNotification(message) {
    copyNotification.textContent = message; // Set the notification message
    copyNotification.classList.add("show");
    setTimeout(() => {
      copyNotification.classList.remove("show");
    }, 2000);
  }

  // Helper function to escape HTML
  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Add this function near the other helper functions
  function sanitizeXPath(xpath) {
    // Remove invalid triple slashes
    xpath = xpath.replace(/^\/\/\//, "//");

    // Remove any invalid characters
    xpath = xpath.replace(/[^\w\s\-\[\]@\(\)\.\/\*='"]/g, "");

    return xpath;
  }

  // Read the active copy format off the <select>. Synchronous so Copy / Copy
  // All can call into it inline. Falls back to "raw" if the dropdown isn't
  // in the DOM yet (e.g. very early initialization).
  function getCopyFormat() {
    const el = document.getElementById("copyFormatSelect");
    return (el && el.value) || "raw";
  }

  // Wrap a locator value in framework-specific code so it can be pasted
  // directly into a test. `type` is the human label shown in the panel
  // (e.g. "ID", "CSS Selector", "Relative XPath", "XPath by Text"); we use
  // it to pick between By.id / By.cssSelector / By.xpath flavors.
  function formatLocator(type, value, format) {
    if (value == null) return "";
    if (!format || format === "raw") return value;

    const t = String(type || "");
    const isXpath = /xpath/i.test(t);
    // "ID" — and only "ID" — should use By.id; "Data Test ID", "XPath by ID"
    // etc. fall through to CSS/XPath. The Selenium By.id helper also can't
    // handle ids with CSS-special characters (colons, spaces), so we degrade
    // those to a CSS form rather than emitting code that won't compile.
    const isPureId = t === "ID" && /^[A-Za-z][\w\-]*$/.test(String(value));

    const dq = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const sq = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    // CSS-escape ID values that aren't a plain identifier so the cssSelector
    // fallback ("#foo:1" → "#foo\:1") is actually valid CSS.
    const cssEscapeId = (s) =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(String(s))
        : String(s);

    switch (format) {
      case "selenium-java":
        if (isPureId) return `driver.findElement(By.id("${dq(value)}"))`;
        if (isXpath) return `driver.findElement(By.xpath("${dq(value)}"))`;
        if (t === "ID") return `driver.findElement(By.cssSelector("#${dq(cssEscapeId(value))}"))`;
        return `driver.findElement(By.cssSelector("${dq(value)}"))`;
      case "selenium-python":
        if (isPureId) return `driver.find_element(By.ID, "${dq(value)}")`;
        if (isXpath) return `driver.find_element(By.XPATH, "${dq(value)}")`;
        if (t === "ID") return `driver.find_element(By.CSS_SELECTOR, "#${dq(cssEscapeId(value))}")`;
        return `driver.find_element(By.CSS_SELECTOR, "${dq(value)}")`;
      case "playwright":
        if (t === "ID") return `page.locator('#${sq(cssEscapeId(value))}')`;
        if (isXpath) return `page.locator('xpath=${sq(value)}')`;
        return `page.locator('${sq(value)}')`;
      case "cypress":
        if (t === "ID") return `cy.get('#${sq(cssEscapeId(value))}')`;
        if (isXpath) return `cy.xpath('${sq(value)}') // requires cypress-xpath plugin`;
        return `cy.get('${sq(value)}')`;
      case "webdriverio":
        if (t === "ID") return `$('#${sq(cssEscapeId(value))}')`;
        // WebdriverIO auto-detects XPath when the selector starts with / or (.
        return `$('${sq(value)}')`;
      default:
        return value;
    }
  }

  // Release notes panel functionality
  const releaseNotesBtn = document.getElementById("releaseNotesBtn");
  const releaseNotesPanel = document.querySelector(".release-notes-panel");
  const closeReleaseNotesBtn = document.querySelector(".close-release-notes");

  releaseNotesBtn.addEventListener("click", () => {
    releaseNotesPanel.classList.add("show");
    dropdownContent.classList.remove("show");
  });

  closeReleaseNotesBtn.addEventListener("click", () => {
    releaseNotesPanel.classList.remove("show");
  });

  // Close release notes panel when clicking outside
  document.addEventListener("click", (e) => {
    if (
      !releaseNotesPanel.contains(e.target) &&
      !releaseNotesBtn.contains(e.target) &&
      releaseNotesPanel.classList.contains("show")
    ) {
      releaseNotesPanel.classList.remove("show");
    }
  });

  // Initialize "Auto Validator" toggle state from storage
  chrome.storage.local.get("isAutoValidatorEnabled", (result) => {
    const isEnabled = result.hasOwnProperty("isAutoValidatorEnabled")
      ? result.isAutoValidatorEnabled
      : false;
    chrome.storage.local.set({ isAutoValidatorEnabled: isEnabled }); // Ensure default is false
    autoValidatorToggle.checked = isEnabled;
  });

  // Update storage and behavior when "Auto Validator" toggle changes
  autoValidatorToggle.addEventListener("change", (event) => {
    const isEnabled = event.target.checked;
    trackAutoValidatorToggle(isEnabled);
    chrome.storage.local.set({ isAutoValidatorEnabled: isEnabled }, () => {

    });
  });

  // Initialize "Auto Optimize" toggle state from storage
  chrome.storage.local.get("isAutoOptimizeEnabled", (result) => {
    const isEnabled = result.hasOwnProperty("isAutoOptimizeEnabled")
      ? result.isAutoOptimizeEnabled
      : false;
    chrome.storage.local.set({ isAutoOptimizeEnabled: isEnabled });
    autoOptimizeToggle.checked = isEnabled;
  });

  // Update storage when "Auto Optimize" toggle changes
  autoOptimizeToggle.addEventListener("change", (event) => {
    const isEnabled = event.target.checked;
    trackAutoOptimizeToggle(isEnabled);
    chrome.storage.local.set({ isAutoOptimizeEnabled: isEnabled }, () => {

    });
  });

  // Engine selector (v1 / v2). Persisted in chrome.storage.local; content.js
  // mirrors it into window.LocatorSpyConfig so the dispatcher routes correctly.
  const engineSelect = document.getElementById("engineSelect");
  if (engineSelect) {
    chrome.storage.local.get("locatorEngine", (result) => {
      const engine = result.locatorEngine || "v2";
      engineSelect.value = engine;
      chrome.storage.local.set({ locatorEngine: engine });
    });
    engineSelect.addEventListener("change", (event) => {
      const engine = event.target.value === "v1" ? "v1" : "v2";
      chrome.storage.local.set({ locatorEngine: engine });
      trackEngineSelected(engine);
      logLocatorLifecycle("locator_engine_selected", { engine });
    });
  }

  // Copy-format selector. Wraps each locator in framework code on copy.
  // Persisted in chrome.storage.local; read synchronously off the <select>.
  const copyFormatSelect = document.getElementById("copyFormatSelect");

  if (copyFormatSelect) {
    chrome.storage.local.get("copyFormat", (result) => {
      const fmt = result.copyFormat || "raw";
      copyFormatSelect.value = fmt;
      chrome.storage.local.set({ copyFormat: fmt });
    });
    copyFormatSelect.addEventListener("change", (event) => {
      chrome.storage.local.set({ copyFormat: event.target.value });
      trackCopyFormatSelected(event.target.value);
      logLocatorLifecycle("copy_format_selected", { format: event.target.value });
    });
  }


  // Automatically validate locators if "Auto Validator" is enabled
  function autoValidateLocators(locators) {
    chrome.storage.local.get("isAutoValidatorEnabled", (result) => {
      const allLocators = [];

      // Collect all available locators with their types
      if (locators.id) allLocators.push({ type: 'ID', value: locators.id });
      if (locators.dataTestId) allLocators.push({ type: 'Data Test ID', value: locators.dataTestId });
      if (locators.cssSelector) allLocators.push({ type: 'CSS Selector', value: locators.cssSelector });
      if (locators.cssByAttrPair) allLocators.push({ type: 'CSS by Attr Pair', value: locators.cssByAttrPair });
      if (locators.relativeXPath) allLocators.push({ type: 'Relative XPath', value: locators.relativeXPath });
      if (locators.absoluteXPath) allLocators.push({ type: 'Absolute XPath', value: locators.absoluteXPath });
      if (locators.xpathById) allLocators.push({ type: 'XPath by ID', value: locators.xpathById });
      if (locators.xpathByName) allLocators.push({ type: 'XPath by Name', value: locators.xpathByName });
      if (locators.xpathByDataTestId) allLocators.push({ type: 'XPath by Data Test ID', value: locators.xpathByDataTestId });
      if (locators.xpathByAriaLabel) allLocators.push({ type: 'XPath by Aria Label', value: locators.xpathByAriaLabel });
      if (locators.xpathByPlaceholder) allLocators.push({ type: 'XPath by Placeholder', value: locators.xpathByPlaceholder });
      if (locators.xpathByText) allLocators.push({ type: 'XPath by Text', value: locators.xpathByText });
      if (locators.xpathByLinkText) allLocators.push({ type: 'XPath by Link Text', value: locators.xpathByLinkText });
      if (locators.xpathByPartialLinkText) allLocators.push({ type: 'XPath by Partial Link Text', value: locators.xpathByPartialLinkText });
      if (locators.partialTextXPath) allLocators.push({ type: 'XPath by Partial Text', value: locators.partialTextXPath });
      if (locators.xpathByClassName) allLocators.push({ type: 'XPath by Class Name', value: locators.xpathByClassName });
      if (locators.xpathByTagName) allLocators.push({ type: 'XPath by Tag Name', value: locators.xpathByTagName });
      if (locators.allXPaths) {
        locators.allXPaths.forEach(xpath => allLocators.push({ type: 'XPath', value: xpath }));
      }

      if (result.isAutoValidatorEnabled) {
        // Auto validate all locators
        allLocators.forEach(({ type, value }) => {
          // Find and update the button state before validation
          const buttons = document.querySelectorAll('.validate-btn');
          buttons.forEach(btn => {
            if (btn.dataset.type === type && btn.dataset.value === value) {
              btn.classList.add('validating');
              btn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
                Validating...
              `;
            }
          });

          // Send validation request
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "validateLocator",
              locatorType: type,
              locatorValue: value
            });
          });
        });
      }
    });
  }

  // Listen for storage changes to update the toggle state dynamically
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.isAutoValidatorEnabled) {
      autoValidatorToggle.checked = changes.isAutoValidatorEnabled.newValue;
    }
  });

  // Add dock position detection
  function checkDockPosition() {
    const rect = document.body.getBoundingClientRect();
    const isSideDocked = rect.height > rect.width;

    const dockWarning = document.getElementById("dockWarning");
    if (dockWarning) {
      dockWarning.style.display = isSideDocked ? "flex" : "none";
    }
  }

  // Check dock position on load and window resize
  checkDockPosition();
  window.addEventListener("resize", checkDockPosition);


  // Scroll Down Button Logic
  const scrollDownBtn = document.getElementById("scrollDownBtn");
  if (scrollDownBtn) {
    scrollDownBtn.addEventListener("click", () => {
      const targetSelector = scrollDownBtn.getAttribute("data-target");
      const targetElement = document.querySelector(targetSelector);
      if (targetElement) {
        targetElement.scrollBy({ top: 100, behavior: "smooth" });
      }
    });
  }

  // AI Optimization Feature
  const optimizeAiBtn = document.getElementById("optimizeAiBtn");
  const saveAiSettingsBtn = document.getElementById("saveAiSettingsBtn");

  // Settings drawer — holds the validation toggles, engine/copy selectors and
  // the AI provider form. Opened by the toolbar gear and by openAiSettings().
  const settingsDrawer = document.getElementById("settingsDrawer");
  const settingsOverlay = document.getElementById("settingsOverlay");
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");

  function openSettingsDrawer(scrollToAi) {
    if (!settingsDrawer) return;
    settingsDrawer.classList.add("open");
    settingsDrawer.setAttribute("aria-hidden", "false");
    if (settingsOverlay) settingsOverlay.hidden = false;
    document.body.classList.add("settings-open");
    if (scrollToAi) {
      const aiSection = document.getElementById("settingsAiSection");
      if (aiSection) aiSection.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  function closeSettingsDrawer() {
    if (!settingsDrawer) return;
    settingsDrawer.classList.remove("open");
    settingsDrawer.setAttribute("aria-hidden", "true");
    if (settingsOverlay) settingsOverlay.hidden = true;
    document.body.classList.remove("settings-open");
  }

  if (openSettingsBtn) openSettingsBtn.addEventListener("click", () => {
    trackSettingsOpened({ source: "toolbar" });
    logLocatorLifecycle("settings_opened", { source: "toolbar" });
    openSettingsDrawer(false);
  });
  // Recorder view hides the main toolbar (and its gear), so it carries its own
  // settings button next to the status pill — same drawer.
  const recSettingsBtn = document.getElementById("recSettingsBtn");
  if (recSettingsBtn) recSettingsBtn.addEventListener("click", () => {
    trackSettingsOpened({ source: "recorder" });
    logLocatorLifecycle("settings_opened", { source: "recorder" });
    openSettingsDrawer(false);
  });
  if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", closeSettingsDrawer);
  if (settingsOverlay) settingsOverlay.addEventListener("click", closeSettingsDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settingsDrawer && settingsDrawer.classList.contains("open")) {
      closeSettingsDrawer();
    }
  });

  // Notifications drawer — the update / AI-credit info items live here now
  // instead of as inline banners. The existing eligibility logic still owns
  // each item's visibility & data; we only mirror that state onto the bell
  // badge and the empty-state line via a MutationObserver, so none of the
  // banner logic below needs to change.
  const notificationsBtn = document.getElementById("notificationsBtn");
  const notificationsDrawer = document.getElementById("notificationsDrawer");
  const notificationsOverlay = document.getElementById("notificationsOverlay");
  const closeNotificationsBtn = document.getElementById("closeNotificationsBtn");
  const notifBadge = document.getElementById("notifBadge");
  const notifEmpty = document.getElementById("notifEmpty");
  const notifItems = [
    document.getElementById("updateAlertDev"),
    document.getElementById("aiCreditsBanner"),
  ].filter(Boolean);

  function isNotifVisible(el) {
    return el && !el.hidden && !el.classList.contains("hidden");
  }
  function refreshNotifState() {
    const count = notifItems.filter(isNotifVisible).length;
    if (notifBadge) notifBadge.hidden = count === 0;
    if (notifEmpty) notifEmpty.hidden = count > 0;
  }
  function openNotificationsDrawer() {
    if (!notificationsDrawer) return;
    notificationsDrawer.classList.add("open");
    notificationsDrawer.setAttribute("aria-hidden", "false");
    if (notificationsOverlay) notificationsOverlay.hidden = false;
  }
  function closeNotificationsDrawer() {
    if (!notificationsDrawer) return;
    notificationsDrawer.classList.remove("open");
    notificationsDrawer.setAttribute("aria-hidden", "true");
    if (notificationsOverlay) notificationsOverlay.hidden = true;
  }
  if (notificationsBtn) notificationsBtn.addEventListener("click", () => {
    trackNotificationsOpened({ count: notifItems.filter(isNotifVisible).length });
    logLocatorLifecycle("notifications_opened");
    openNotificationsDrawer();
  });
  if (closeNotificationsBtn) closeNotificationsBtn.addEventListener("click", closeNotificationsDrawer);
  if (notificationsOverlay) notificationsOverlay.addEventListener("click", closeNotificationsDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && notificationsDrawer && notificationsDrawer.classList.contains("open")) {
      closeNotificationsDrawer();
    }
  });
  if (notifItems.length) {
    const notifObserver = new MutationObserver(refreshNotifState);
    notifItems.forEach((el) =>
      notifObserver.observe(el, { attributes: true, attributeFilter: ["hidden", "class"] }),
    );
    refreshNotifState();
  }
  const googleApiKeyInput = document.getElementById("googleApiKey");
  const aiModelSelect = document.getElementById("aiModelSelect");

  // New OpenRouter Elements
  const aiProviderSelect = document.getElementById("aiProviderSelect");
  const googleFields = document.getElementById("googleFields");
  const openRouterFields = document.getElementById("openRouterFields");
  const openRouterApiKeyInput = document.getElementById("openRouterApiKey");
  const openRouterModelInput = document.getElementById("openRouterModel");

  let currentHtmlContext = null;
  let currentLocators = null;

  // ---- Free credits UI ---------------------------------------------------
  // Single source of truth for the badge near the Optimize button and the
  // banner inside AI Settings. We hydrate from /ai/credits on load and
  // after every successful AI call. Cached locally so the badge can render
  // instantly on the next panel open without a network round-trip.
  const FREE_CREDITS_CACHE_KEY = "aiFreeCredits";
  const FREE_CREDITS_DISMISSED_KEY = "aiFreeCreditsBannerDismissed";
  // Tracks which user_id the cache + dismiss flag belong to. When a
  // different user logs in on the same device, we reset both so the
  // new account starts with a clean banner — previous user's remaining
  // count and "dismissed" click don't carry over.
  const FREE_CREDITS_OWNER_KEY = "aiFreeCreditsOwner";
  let freeCreditsState = null;
  let creditsBannerDismissed = false;

  const creditsBadge = document.getElementById("aiCreditsBadge");
  const creditsBanner = document.getElementById("freeCreditsBanner");
  const creditsTitle = document.getElementById("freeCreditsTitle");
  const creditsSub = document.getElementById("freeCreditsSub");
  const creditsCount = document.getElementById("freeCreditsCount");

  // Tracks the last analytics signature for the panel banner so we only
  // emit a "shown" event when the state actually changes (e.g. fresh →
  // low → empty), not every time refreshFreeCreditsUi re-renders.
  let lastBannerShownSignature = null;
  function emitBannerShown(state) {
    const sig = `${state.bannerState}|${state.remaining}|${state.hasOwnKey ? "k" : "nk"}|${state.signedIn ? "in" : "out"}`;
    if (sig === lastBannerShownSignature) return;
    lastBannerShownSignature = sig;
    trackFreeCreditsBannerShown(state);
    logLocatorLifecycle("free_credits_banner_shown", state);
  }

  // In-panel banner (the prominent one above locator results).
  const panelBanner = document.getElementById("aiCreditsBanner");
  const panelBannerTitle = document.getElementById("aiCreditsBannerTitle");
  const panelBannerSub = document.getElementById("aiCreditsBannerSub");
  const panelBannerMeter = document.getElementById("aiCreditsBannerMeter");
  const panelBannerCta = document.getElementById("aiCreditsBannerCta");
  const panelBannerDismiss = document.getElementById("aiCreditsBannerDismiss");

  function paintMeter(remaining, limit) {
    if (!panelBannerMeter) return;
    const dots = panelBannerMeter.querySelectorAll(".ai-credit-dot");
    const total = limit || dots.length;
    dots.forEach((dot, idx) => {
      const ordinal = idx + 1;
      // Light up the leftmost `remaining` dots; dim the rest.
      const spent = ordinal > remaining || ordinal > total;
      dot.dataset.spent = spent ? "true" : "false";
    });
  }

  function applyPanelBanner(state, hasOwnKey, isSignedIn) {
    if (!panelBanner) return;
    const knownState = !!(state && typeof state.remaining === "number");
    const remaining = knownState ? state.remaining : 3;
    const limit = state && typeof state.limit === "number" ? state.limit : 3;
    // Dismissal only sticks while credits remain. Once exhausted, the
    // banner reappears so the user sees the "add your key" CTA.
    const honorDismissed = creditsBannerDismissed && remaining > 0;

    // Existing-key users: only show the banner while bonus credits are
    // *confirmed* in play. We never speculate optimistically — if state
    // hasn't been fetched yet, or if remaining is 0, hide entirely so the
    // user's key takes over silently.
    if (hasOwnKey) {
      if (!isSignedIn || !knownState || remaining <= 0 || honorDismissed) {
        panelBanner.hidden = true;
        return;
      }
      panelBanner.hidden = false;
      panelBanner.removeAttribute("data-state");
      panelBannerMeter.style.opacity = "1";
      paintMeter(remaining, limit);
      panelBannerTitle.textContent = `${remaining} bonus AI ${remaining === 1 ? "credit" : "credits"} on us`;
      panelBannerSub.innerHTML =
        "We'll use these first before your key — same Optimize button, no change to your workflow.";
      panelBannerCta.textContent = "Manage settings";
      emitBannerShown({
        bannerState: "byo_with_bonus",
        remaining, limit, hasOwnKey, signedIn: isSignedIn,
      });
      return;
    }

    if (honorDismissed) {
      panelBanner.hidden = true;
      return;
    }
    panelBanner.hidden = false;

    if (!isSignedIn) {
      panelBanner.dataset.state = "signed-out";
      panelBannerTitle.textContent = "Get 3 free AI optimizations";
      panelBannerSub.innerHTML = "Sign in and click <b>Optimize with AI</b> on any element — our key, your locators.";
      panelBannerCta.textContent = "Sign in";
      paintMeter(3, 3);
      panelBannerMeter.style.opacity = "0.55";
      emitBannerShown({
        bannerState: "signed_out",
        remaining: 3, limit: 3, hasOwnKey, signedIn: false,
      });
      return;
    }

    panelBannerMeter.style.opacity = "1";
    paintMeter(remaining, limit);

    if (remaining === 0) {
      panelBanner.dataset.state = "empty";
      panelBannerTitle.textContent = "Free AI credits used up";
      panelBannerSub.innerHTML = "Add your own Google API key to keep optimizing — it's free from <b>aistudio.google.com</b>.";
      panelBannerCta.textContent = "Add your API key";
    } else if (remaining === 1) {
      panelBanner.dataset.state = "low";
      panelBannerTitle.textContent = "1 free AI credit left";
      panelBannerSub.innerHTML = "Add your own key now to avoid interruption — takes 30 seconds.";
      panelBannerCta.textContent = "Add your API key";
    } else {
      panelBanner.removeAttribute("data-state");
      panelBannerTitle.textContent = `${remaining} free AI optimizations available`;
      panelBannerSub.innerHTML = "Click <b>Optimize with AI</b> on any element — no setup, no API key needed.";
      panelBannerCta.textContent = "Add your API key";
    }

    const bannerState = remaining === 0 ? "empty" : remaining === 1 ? "low" : "available";
    emitBannerShown({
      bannerState,
      remaining, limit, hasOwnKey, signedIn: isSignedIn,
    });
  }

  function applyCreditsBadge(state, hasOwnKey) {
    if (!creditsBadge) return;
    if (!state || typeof state.remaining !== "number") {
      creditsBadge.hidden = true;
      creditsBadge.removeAttribute("data-state");
      return;
    }
    const left = state.remaining;
    // For existing-key users: hide once <= 0 (they won't see the banner
    // either — their key just takes over silently). While credits remain,
    // surface the badge so they know bonus calls are in play.
    if (hasOwnKey && left <= 0) {
      creditsBadge.hidden = true;
      creditsBadge.removeAttribute("data-state");
      return;
    }
    creditsBadge.hidden = false;
    creditsBadge.textContent = left > 0 ? `${left} free` : "0 free";
    creditsBadge.title = hasOwnKey
      ? `${left} free AI ${left === 1 ? "credit" : "credits"} on us — used before your key`
      : `${left} free AI ${left === 1 ? "credit" : "credits"} remaining`;
    if (left === 0) creditsBadge.dataset.state = "empty";
    else if (left === 1) creditsBadge.dataset.state = "low";
    else creditsBadge.removeAttribute("data-state");
  }

  function applyCreditsBanner(state, hasOwnKey, isSignedIn) {
    if (!creditsBanner) return;
    if (hasOwnKey) {
      creditsBanner.hidden = true;
      return;
    }
    creditsBanner.hidden = false;
    if (!isSignedIn) {
      creditsBanner.removeAttribute("data-state");
      creditsTitle.textContent = "Try AI optimization for free";
      creditsSub.textContent = "Sign in to get 3 free AI optimizations using our key — no setup required.";
      creditsCount.hidden = true;
      return;
    }
    if (!state || typeof state.remaining !== "number") {
      creditsBanner.removeAttribute("data-state");
      creditsTitle.textContent = "Free AI credits";
      creditsSub.textContent = "Use 3 free AI optimizations on us — your key never leaves the server.";
      creditsCount.hidden = true;
      return;
    }
    const { remaining, limit } = state;
    creditsCount.hidden = false;
    creditsCount.textContent = `${remaining} / ${limit}`;
    if (remaining === 0) {
      creditsBanner.dataset.state = "empty";
      creditsTitle.textContent = "Free credits used up";
      creditsSub.textContent = "Add your own Google API key below to keep optimizing with AI.";
    } else if (remaining === 1) {
      creditsBanner.dataset.state = "low";
      creditsTitle.textContent = "1 free credit left";
      creditsSub.textContent = "Optional: add your own key now to avoid interruption when this runs out.";
    } else {
      creditsBanner.removeAttribute("data-state");
      creditsTitle.textContent = `${remaining} free AI credits available`;
      creditsSub.textContent = "Powered by our shared key while you try things out. The key stays server-side.";
    }
  }

  function readCachedCredits() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([FREE_CREDITS_CACHE_KEY], (r) =>
          resolve(r && r[FREE_CREDITS_CACHE_KEY] ? r[FREE_CREDITS_CACHE_KEY] : null),
        );
      } catch {
        resolve(null);
      }
    });
  }

  function writeCachedCredits(state) {
    try {
      chrome.storage.local.set({ [FREE_CREDITS_CACHE_KEY]: state });
    } catch {}
  }

  async function refreshFreeCreditsUi({ networkRefresh = true } = {}) {
    const ctx = await new Promise((resolve) =>
      chrome.storage.local.get(
        [
          "aiProvider",
          "googleApiKey",
          "openRouterApiKey",
          "auth_token",
          "user_id",
          FREE_CREDITS_DISMISSED_KEY,
          FREE_CREDITS_OWNER_KEY,
        ],
        resolve,
      ),
    );
    const provider = ctx.aiProvider || "google";
    const hasOwnKey = provider === "openrouter"
      ? !!ctx.openRouterApiKey
      : !!ctx.googleApiKey;
    const isSignedIn = !!ctx.auth_token;

    // User-switch guard: if the cached credits / dismiss flag belong to a
    // different user_id than the one currently signed in, blow them away.
    const currentUserId = ctx.user_id || null;
    const cachedOwner = ctx[FREE_CREDITS_OWNER_KEY] || null;
    if (currentUserId && cachedOwner && cachedOwner !== currentUserId) {
      freeCreditsState = null;
      creditsBannerDismissed = false;
      try {
        chrome.storage.local.remove([FREE_CREDITS_CACHE_KEY, FREE_CREDITS_DISMISSED_KEY]);
        chrome.storage.local.set({ [FREE_CREDITS_OWNER_KEY]: currentUserId });
      } catch {}
    } else if (currentUserId && !cachedOwner) {
      try {
        chrome.storage.local.set({ [FREE_CREDITS_OWNER_KEY]: currentUserId });
      } catch {}
      creditsBannerDismissed = !!ctx[FREE_CREDITS_DISMISSED_KEY];
    } else {
      creditsBannerDismissed = !!ctx[FREE_CREDITS_DISMISSED_KEY];
    }

    // Hide everything when the user is on OpenRouter — free credits only
    // apply to the Google path.
    if (provider !== "google") {
      applyCreditsBadge(null, true);
      applyCreditsBanner(null, true, isSignedIn);
      applyPanelBanner(null, true, isSignedIn);
      return;
    }

    if (!freeCreditsState) freeCreditsState = await readCachedCredits();
    applyCreditsBadge(freeCreditsState, hasOwnKey);
    applyCreditsBanner(freeCreditsState, hasOwnKey, isSignedIn);
    applyPanelBanner(freeCreditsState, hasOwnKey, isSignedIn);

    // Always fetch credits for signed-in Google users — including those
    // with their own key — so existing users see the bonus credits and
    // we can fall back transparently when they run out.
    if (networkRefresh && isSignedIn && typeof window.fetchFreeCredits === "function") {
      const fresh = await window.fetchFreeCredits(ctx.auth_token);
      if (fresh) {
        freeCreditsState = fresh;
        writeCachedCredits(fresh);
        applyCreditsBadge(fresh, hasOwnKey);
        applyCreditsBanner(fresh, hasOwnKey, isSignedIn);
        applyPanelBanner(fresh, hasOwnKey, isSignedIn);

        const meta = {
          remaining: fresh.remaining,
          used: fresh.used,
          limit: fresh.limit,
          hasOwnKey,
          provider,
        };
        trackFreeCreditsHydrated(meta);
        logLocatorLifecycle("free_credits_hydrated", meta);
        if (fresh.remaining === 0) {
          trackFreeCreditsExhausted({ ...meta, source: "hydration" });
          logLocatorLifecycle("free_credits_exhausted", { ...meta, source: "hydration" });
        }
      }
    }

    // Keep the recorder's free-credit chip in sync with locator-panel updates.
    applyRecorderCreditsInfo();
  }

  function updateCreditsFromResponse(credits) {
    if (!credits || typeof credits.remaining !== "number") return;
    freeCreditsState = {
      used: credits.used,
      remaining: credits.remaining,
      limit: credits.limit,
    };
    writeCachedCredits(freeCreditsState);
    refreshFreeCreditsUi({ networkRefresh: false });
  }

  if (panelBannerCta) {
    panelBannerCta.addEventListener("click", async () => {
      const ctx = await new Promise((resolve) =>
        chrome.storage.local.get(["auth_token", "googleApiKey"], resolve),
      );
      const action = !ctx.auth_token
        ? "sign_in"
        : ctx.googleApiKey
          ? "manage_settings"
          : "add_api_key";
      const meta = {
        action,
        remaining: freeCreditsState ? freeCreditsState.remaining : null,
        hasOwnKey: !!ctx.googleApiKey,
        signedIn: !!ctx.auth_token,
      };
      trackFreeCreditsCtaClicked(meta);
      logLocatorLifecycle("free_credits_cta_clicked", meta);

      // Signed-out state: send them to login. Otherwise: open AI Settings
      // so they can paste their own key.
      if (!ctx.auth_token) {
        window.location.href = "login.html";
        return;
      }
      if (typeof openAiSettings === "function") openAiSettings();
    });
  }

  if (panelBannerDismiss) {
    panelBannerDismiss.addEventListener("click", () => {
      creditsBannerDismissed = true;
      try {
        chrome.storage.local.set({ [FREE_CREDITS_DISMISSED_KEY]: true });
      } catch {}
      const meta = {
        remaining: freeCreditsState ? freeCreditsState.remaining : null,
        used: freeCreditsState ? freeCreditsState.used : null,
        limit: freeCreditsState ? freeCreditsState.limit : null,
      };
      trackFreeCreditsBannerDismissed(meta);
      logLocatorLifecycle("free_credits_banner_dismissed", meta);
      if (panelBanner) panelBanner.hidden = true;
    });
  }

  refreshFreeCreditsUi();

  // Listen for locators message to get context
  onBackgroundMessage(function (message) {
    if (message.action === "getLocators") {
      if (message.locators) {
        currentLocators = message.locators;
      }
      if (message.htmlContext) {
        currentHtmlContext = message.htmlContext;
      }
    }
  });

  // Toggle Provider Fields
  aiProviderSelect.addEventListener("change", () => {
    if (aiProviderSelect.value === "openrouter") {
      googleFields.style.display = "none";
      openRouterFields.style.display = "block";
    } else {
      googleFields.style.display = "block";
      openRouterFields.style.display = "none";
    }
  });

  function openAiSettings() {
    // Load saved settings
    chrome.storage.local.get(["aiProvider", "googleApiKey", "aiModel", "openRouterApiKey", "openRouterModel"], (result) => {
      // Default to google if no provider set
      const provider = result.aiProvider || "google";
      aiProviderSelect.value = provider;

      // Trigger change to set correct visibility
      aiProviderSelect.dispatchEvent(new Event('change'));

      if (result.googleApiKey) {
        googleApiKeyInput.value = result.googleApiKey;
      }
      if (result.aiModel) {
        aiModelSelect.value = result.aiModel;
      }

      if (result.openRouterApiKey) {
        openRouterApiKeyInput.value = result.openRouterApiKey;
      }
      if (result.openRouterModel) {
        openRouterModelInput.value = result.openRouterModel;
      }

      openSettingsDrawer(true);
      refreshFreeCreditsUi();
    });
  }

  // Save Settings
  saveAiSettingsBtn.addEventListener("click", () => {
    const provider = aiProviderSelect.value;
    const googleKey = googleApiKeyInput.value.trim();
    const googleModel = aiModelSelect.value;
    const orKey = openRouterApiKeyInput.value.trim();
    const orModel = openRouterModelInput.value.trim();

    if (provider === "google" && !googleKey) {
      alert("Please enter a valid Google API Key");
      return;
    }

    if (provider === "openrouter" && !orKey) {
      alert("Please enter a valid OpenRouter API Key");
      return;
    }

    const settings = {
      aiProvider: provider,
      googleApiKey: googleKey,
      aiModel: googleModel,
      openRouterApiKey: orKey,
      openRouterModel: orModel
    };

    chrome.storage.local.set(settings, () => {
      closeSettingsDrawer();
      showCopyNotification("Settings saved!");
      // Sync to the auth backend so the same account picks them up on
      // other devices. Fire-and-forget — local save is the source of truth.
      if (window.AuthModule && typeof AuthModule.pushUserSettings === 'function') {
        AuthModule.pushUserSettings(settings).catch(() => { /* non-fatal */ });
      }
      refreshFreeCreditsUi({ networkRefresh: false });
    });
  });

  // Optimize AI Button Click
  if (optimizeAiBtn) {
    optimizeAiBtn.addEventListener("click", () => {
      trackOptimizeWithAI();
      performAiOptimization(false);
    });
  }

  // Staged "thinking" UX. The optimize request is a single blocking call, so
  // there's no real reasoning stream to show — instead we narrate plausible
  // stages of the work while the request is in flight. Purely cosmetic: it
  // makes the wait (free-credit responses can be slow) feel responsive without
  // touching the worker or the JSON response contract.
  const aiThinking = {
    timers: [],
    prevHTML: null,
    STAGES: [
      "Reading element & DOM structure",
      "Evaluating candidate selectors",
      "Scoring locators for stability",
      "Finalizing recommendations",
    ],
    // Reassurance copy shown when the final stage drags on, so a slow
    // response doesn't read as a stall. {delay} is ms after the final stage is
    // reached. freeOnly entries only show on the free-credit path (the slow one).
    REASSURE: [
      { delay: 5000, text: "Hold tight — we're at the final processing…" },
      { delay: 11000, freeOnly: true, text: "Almost there — free-credit responses can run a little slow." },
    ],
    isFree: false,
    start(isFree = false) {
      this.stop();
      this.isFree = isFree;
      this.prevHTML = locatorResults.innerHTML;
      const steps = this.STAGES
        .map(
          (label, i) =>
            `<li class="ai-step is-pending" data-i="${i}">
               <span class="ai-step-dot"></span>
               <span class="ai-step-label">${label}</span>
             </li>`,
        )
        .join("");
      locatorResults.innerHTML =
        `<div id="aiThinkingPanel" class="ai-thinking" role="status" aria-live="polite">
           <div class="ai-thinking-head">
             <span class="ai-thinking-orb"></span>
             <span class="ai-thinking-title">AI is optimizing your locators…</span>
           </div>
           <ul class="ai-thinking-steps">${steps}</ul>
           <p class="ai-thinking-note" hidden></p>
         </div>`;
      this.activate(0);
    },
    activate(index) {
      const panel = document.getElementById("aiThinkingPanel");
      if (!panel) return;
      const steps = panel.querySelectorAll(".ai-step");
      steps.forEach((el, i) => {
        el.classList.toggle("is-done", i < index);
        el.classList.toggle("is-active", i === index);
        el.classList.toggle("is-pending", i > index);
      });
      if (index < this.STAGES.length - 1) {
        // Advance while earlier stages remain.
        this.timers.push(setTimeout(() => this.activate(index + 1), 1600 + index * 300));
      } else {
        // Held on the final stage — escalate reassurance over time.
        const note = panel.querySelector(".ai-thinking-note");
        this.REASSURE.filter((r) => !r.freeOnly || this.isFree).forEach((r) => {
          this.timers.push(
            setTimeout(() => {
              if (!note) return;
              note.textContent = r.text;
              note.hidden = false;
            }, r.delay),
          );
        });
      }
    },
    stop() {
      this.timers.forEach(clearTimeout);
      this.timers = [];
    },
    // Restore the pre-thinking content only if our panel is still on screen
    // (i.e. the request errored out before displayLocators replaced it).
    dismiss() {
      if (document.getElementById("aiThinkingPanel") && this.prevHTML != null) {
        locatorResults.innerHTML = this.prevHTML;
      }
      this.prevHTML = null;
    },
  };

  async function performAiOptimization(isAutoTrigger = false) {
    if (optimizeAiBtn) {
      optimizeAiBtn.innerHTML = `Improving...`;
      optimizeAiBtn.classList.add("pulse-animation");
    }

    chrome.storage.local.get(
      ["aiProvider", "googleApiKey", "aiModel", "openRouterApiKey", "openRouterModel", "auth_token"],
      async (result) => {
        const provider = result.aiProvider || "google";

        const apiKey = provider === "openrouter" ? result.openRouterApiKey : result.googleApiKey;
        const model = provider === "openrouter" ? result.openRouterModel : result.aiModel;
        const authToken = result.auth_token;

        // Backward-compat policy: free credits are tried *first* whenever
        // they're available, even for users who already have their own key
        // configured. When credits run out we transparently fall back to
        // their key — no UI interruption. Free credits don't apply to
        // OpenRouter (different provider).
        const credits = freeCreditsState;
        const hasFreeRemaining = credits && typeof credits.remaining === "number" && credits.remaining > 0;
        const freeAvailable = provider === "google" && !!authToken;
        const tryFreeFirst = freeAvailable && (hasFreeRemaining || !apiKey);

        if (!apiKey && !tryFreeFirst) {
          logLocatorLifecycle("ai_optimization_failed", { reason: "api_key_missing", provider });
          if (!isAutoTrigger) openAiSettings();
          resetOptimizeBtn();
          return;
        }

        if (!currentHtmlContext && !currentLocators) {
          logLocatorLifecycle("ai_optimization_failed", { reason: "no_context" });
          if (!isAutoTrigger) showCopyNotification("No element selected to optimize");
          resetOptimizeBtn();
          return;
        }

        const callOnce = (mode) =>
          generateAiLocators(
            currentHtmlContext,
            currentLocators,
            apiKey,
            model,
            provider,
            mode === "free_credits" ? { freeCredits: { authToken } } : undefined,
          );

        let mode = tryFreeFirst ? "free_credits" : "byo_key";
        let locators;
        let fellBackToKey = false;

        aiThinking.start(mode === "free_credits");

        logLocatorLifecycle("ai_optimization_started", {
          provider,
          model,
          isAutoTrigger,
          mode,
          inputLocators: currentLocators,
          htmlContextPreview: currentHtmlContext ? String(currentHtmlContext).slice(0, 500) : null,
        });

        try {
          try {
            locators = await callOnce(mode);
          } catch (err) {
            // Transparent fallback: if free credits ran out and the user
            // has their own key, retry with the BYO path so the click
            // still produces a result.
            if (err && err.code === "free_credits_exhausted" && apiKey) {
              updateCreditsFromResponse({
                used: err.creditsLimit,
                remaining: 0,
                limit: err.creditsLimit,
              });
              const fbMeta = {
                provider,
                model,
                limit: err.creditsLimit,
              };
              trackFreeCreditsExhausted({ ...fbMeta, source: "optimize" });
              trackFreeCreditsFallback(fbMeta);
              logLocatorLifecycle("free_credits_exhausted", { ...fbMeta, source: "optimize" });
              logLocatorLifecycle("ai_optimization_fallback", {
                reason: "free_credits_exhausted",
                ...fbMeta,
              });
              mode = "byo_key";
              fellBackToKey = true;
              locators = await callOnce(mode);
            } else {
              throw err;
            }
          }

          if (locators) {
            const credits = locators.__credits;
            if (credits) updateCreditsFromResponse(credits);
            logLocatorLifecycle("ai_optimization_completed", {
              provider,
              model,
              success: true,
              mode,
              fellBackToKey,
              creditsRemaining: credits ? credits.remaining : undefined,
              generatedLocators: locators,
            });
            displayLocators(locators, true);

            const verb = isAutoTrigger ? "Auto-optimized" : "Optimized";
            if (fellBackToKey) {
              showCopyNotification(
                `${verb} by AI! Free credits used up — switched to your API key.`,
              );
            } else if (mode === "free_credits" && credits) {
              const left = credits.remaining;
              if (left > 0) {
                const suffix = left === 1 ? "1 free AI credit left" : `${left} free AI credits left`;
                const tail = apiKey ? " (your key kicks in after)" : "";
                showCopyNotification(`${verb} by AI! (${suffix}${tail})`);
              } else {
                showCopyNotification(
                  apiKey
                    ? `${verb} by AI! Last free credit used — your key takes over from here.`
                    : `${verb} by AI! Last free credit used — add your API key to continue.`,
                );
              }
            } else {
              showCopyNotification(`${verb} by AI!`);
            }
          }
        } catch (error) {
          if (error && error.code === "free_credits_exhausted") {
            // Reaches here only when there's no apiKey to fall back to.
            updateCreditsFromResponse({
              used: error.creditsLimit,
              remaining: 0,
              limit: error.creditsLimit,
            });
            const meta = { provider, model, limit: error.creditsLimit, source: "optimize_no_key" };
            trackFreeCreditsExhausted(meta);
            logLocatorLifecycle("free_credits_exhausted", meta);
            logLocatorLifecycle("ai_optimization_failed", {
              reason: "free_credits_exhausted",
              provider,
              model,
            });
            if (!isAutoTrigger) {
              showCopyNotification("Free AI credits used up — add your API key to continue.");
              openAiSettings();
            }
          } else {
            logLocatorLifecycle("ai_optimization_failed", {
              reason: "generation_error",
              error: error.message,
              provider,
              model,
              mode,
            });
            console.error("AI Generation Error: ", error);
            if (!isAutoTrigger) showCopyNotification("AI Optimization Failed: " + error.message);
          }
        } finally {
          aiThinking.stop();
          // On success displayLocators has already replaced the panel; on
          // failure this restores whatever was showing before.
          aiThinking.dismiss();
          resetOptimizeBtn();
        }
      },
    );
  }

  function resetOptimizeBtn() {
    optimizeAiBtn.classList.remove("pulse-animation");
    optimizeAiBtn.innerHTML = `
        <img src="../images/ai2.png" width="16" height="16" alt="AI">
        <b>Optimize Using AI</b>
      `;
  }
});

document.addEventListener("DOMContentLoaded", function () {
  // Check if opened from notification
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("showReleaseNotes") === "true") {
    const releaseNotesPanel = document.querySelector(".release-notes-panel");
    releaseNotesPanel.classList.add("show");
  }

  // Check for updates
  checkVersionUpdate();

  async function checkVersionUpdate() {
    try {
      const response = await fetch(`${WORKER_BASE}/api/latest-version?source=locator-spy`);
      const data = await response.json();
      const latestVersion = data.version;
      const currentVersion = chrome.runtime.getManifest().version;

      if (isNewerVersion(latestVersion, currentVersion)) {
        showUpdateAlert(latestVersion);
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
    }
  }

  function isNewerVersion(latest, current) {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);
    
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const v1 = latestParts[i] || 0;
      const v2 = currentParts[i] || 0;
      if (v1 > v2) return true;
      if (v1 < v2) return false;
    }
    return false;
  }

  function showUpdateAlert(version) {
    const updateAlert = document.getElementById('updateAlertDev');
    if (!updateAlert) return;
    
    const versionSpan = updateAlert.querySelector('span');
    versionSpan.textContent = `Update available! v${version} is now live.`;
    updateAlert.classList.remove('hidden');
    
    document.getElementById('updateNowBtnDev').addEventListener('click', () => {
      window.open('https://chromewebstore.google.com/detail/locator-finder-ai-powered/gpgjidcedjiphbgagldchpcliacmanjf', '_blank');
    });

    const closeBtn = document.getElementById('closeUpdateAlertDev');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        updateAlert.classList.add('hidden');
      });
    }
  }

  // Listen for feedback submission to unlock button
  window.addEventListener('feedbackSubmitted', () => {
    // Optionally trigger something here
    // But the modal will close and the next click will work
  });
});
