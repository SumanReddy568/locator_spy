/**
 * Feedback Service
 * Handles all feedback-related logic: checking feedback status,
 * submitting feedback, and managing the feedback modal UI.
 */

window.FeedbackService = {
  /** Base URL for the feedback collector worker */
  API_BASE: "https://feedback-collector.sumanreddy568.workers.dev",
  SOURCE: "locator-spy",

  /**
   * Fetches user identity fields from chrome.storage.local.
   * @returns {Promise<{userId: string, email: string|null, userHash: string|null}>}
   */
  async getUserInfo() {
    const result = await new Promise((resolve) =>
      chrome.storage.local.get(
        ["user_id", "user_email", "user_hash"],
        resolve,
      ),
    );
    return {
      userId: result.user_id || result.user_email || "anonymous",
      email: result.user_email || null,
      userHash: result.user_hash || null,
    };
  },

  /**
   * Checks via the API whether the given userId has already submitted feedback.
   * Falls back to `fallback` if the request fails.
   * @param {string} userId
   * @param {boolean} fallback - value to return on API failure
   * @returns {Promise<boolean>}
   */
  async checkFeedbackViaApi(userId, fallback = true) {
    try {
      const response = await fetch(
        `${this.API_BASE}/check-feedback?userId=${encodeURIComponent(userId)}`,
        {
          method: "GET",
          mode: "cors",
          cache: "no-cache",
          credentials: "omit",
          headers: { Accept: "application/json" },
        },
      );
      if (response.ok) {
        const data = await response.json();
        return data.hasSubmittedFeedback || false;
      }
      console.warn("FeedbackService: check-feedback API returned non-OK, using fallback");
      return fallback;
    } catch (err) {
      console.warn("FeedbackService: check-feedback API error, using fallback:", err);
      return fallback;
    }
  },

  /**
   * Shows or hides the feedback rating container based on whether
   * the current user has already submitted feedback or needs to.
   */
  async checkFeedbackStatus() {
    const feedbackRatingContainer = document.getElementById('feedbackRatingContainer');
    if (!feedbackRatingContainer) return;

    try {
      const { userId } = await this.getUserInfo();
      const needsFeedback = await this.checkIfNeedsFeedback();
      
      const result = await chrome.storage.local.get(['feedbackSubmitted']);
      let hasSubmitted = result.feedbackSubmitted || false;

      if (!hasSubmitted && userId !== "anonymous") {
        hasSubmitted = await this.checkFeedbackViaApi(userId, false);
        if (hasSubmitted) {
          chrome.storage.local.set({ feedbackSubmitted: true });
        }
      }

      if (hasSubmitted) {
        feedbackRatingContainer.style.display = "none";
      } else if (needsFeedback) {
        feedbackRatingContainer.style.display = "block";
      } else {
        feedbackRatingContainer.style.display = "none";
      }
    } catch (error) {
      console.warn("FeedbackService: Failed to check feedback status:", error);
    }
  },

  /**
   * Increments the locator generation count and checks if threshold is reached.
   */
  async incrementLocatorCount() {
    const result = await new Promise((resolve) =>
      chrome.storage.local.get(["locatorCount", "feedbackSubmitted"], resolve)
    );
    
    // If already submitted, no need to track/gate
    if (result.feedbackSubmitted) return;

    const count = (result.locatorCount || 0) + 1;
    await chrome.storage.local.set({ locatorCount: count });

    if (count >= 5) {
      this.checkFeedbackStatus();
    }
  },

  /**
   * Checks if the user is currently gated by the 5-locator limit.
   */
  async checkIfNeedsFeedback() {
    const result = await new Promise((resolve) =>
      chrome.storage.local.get(["locatorCount", "feedbackSubmitted"], resolve)
    );
    
    if (result.feedbackSubmitted) return false;
    return (result.locatorCount || 0) >= 5;
  },

  /**
   * Submits feedback to the API.
   */
  async submitFeedback() {
    const feedbackText = document.getElementById('feedbackText');
    const feedbackStatus = document.getElementById('feedbackStatus');
    const submitFeedbackBtn = document.getElementById('submitFeedback');
    const feedbackRatingContainer = document.getElementById('feedbackRatingContainer');
    const feedbackModal = document.getElementById('feedbackModal');
    
    const feedback = feedbackText.value.trim();

    if (!feedback) {
      feedbackStatus.textContent = "Please enter a message before submitting.";
      feedbackStatus.style.color = "#dc3545";
      return; 
    }

    submitFeedbackBtn.disabled = true;
    feedbackStatus.textContent = "Sending...";
    feedbackStatus.style.color = "#666";

    let userInfo = { userId: "anonymous", email: null, userHash: null };
    try {
      userInfo = await this.getUserInfo();
    } catch (e) {
      console.warn("FeedbackService: Failed to fetch user info for feedback:", e);
    }

    const payload = {
      source: this.SOURCE,
      userId: userInfo.userId,
      userEmail: userInfo.email,
      userHash: userInfo.userHash,
      feedback,
      rating: this.selectedRating || "positive",
      timestamp: new Date().toISOString(),
    };

    try {
      const res = await fetch(`${this.API_BASE}/feedback/`, {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await chrome.storage.local.set({ feedbackSubmitted: true });
        console.log("FeedbackService: Feedback submitted successfully");

        feedbackStatus.textContent = "Thank you for your feedback!";
        feedbackStatus.style.color = "#28a745";
        
        if (feedbackRatingContainer) feedbackRatingContainer.style.display = "none";

        setTimeout(() => {
          if (feedbackModal) feedbackModal.style.display = "none";
          // We don't want to reload the whole extension page usually, but we want to unlock the button
          const event = new CustomEvent('feedbackSubmitted');
          window.dispatchEvent(event);
        }, 1500);
      } else {
        feedbackStatus.textContent = "Failed to send feedback. Please try again.";
        feedbackStatus.style.color = "#dc3545";
      }
    } catch (e) {
      feedbackStatus.textContent = "Error sending feedback. Check your connection.";
      feedbackStatus.style.color = "#dc3545";
    }

    submitFeedbackBtn.disabled = false;
  },

  /**
   * Registers all DOM event listeners related to the feedback UI.
   */
  setupFeedbackHandlers() {
    const thumbsUp = document.getElementById('thumbsUp');
    const thumbsDown = document.getElementById('thumbsDown');
    const feedbackModal = document.getElementById('feedbackModal');
    const feedbackClose = document.getElementById('feedbackClose');
    const submitFeedback = document.getElementById('submitFeedback');
    const feedbackPrompt = document.getElementById('feedbackPrompt');
    const feedbackText = document.getElementById('feedbackText');
    const feedbackStatus = document.getElementById('feedbackStatus');

    if (!thumbsUp || !thumbsDown || !feedbackModal) return;

    thumbsUp.addEventListener("click", () => {
      this.selectedRating = "positive";
      feedbackPrompt.textContent = "What did you like about Locator Spy?";
      feedbackModal.style.display = "block";
      feedbackText.focus();
      feedbackStatus.textContent = "";
      feedbackText.value = "";
    });

    thumbsDown.addEventListener("click", () => {
      this.selectedRating = "negative";
      feedbackPrompt.textContent = "What issues did you experience?";
      feedbackModal.style.display = "block";
      feedbackText.focus();
      feedbackStatus.textContent = "";
      feedbackText.value = "";
    });

    feedbackClose.addEventListener("click", () => {
      feedbackModal.style.display = "none";
    });

    window.addEventListener("click", (event) => {
      if (event.target === feedbackModal) {
        feedbackModal.style.display = "none";
      }
    });

    submitFeedback.addEventListener("click", () => this.submitFeedback());
  },
};
