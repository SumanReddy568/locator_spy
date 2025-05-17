// UI Helper functions for Locator Spy
// Make helper available globally
window.LocatorHelper = {
    // State
    banner: null,
    isEnabled: true,

    // Methods
    createBestLocatorBanner() {
        if (this.banner) return this.banner;

        const banner = document.createElement("div");
        banner.id = "best-locator-banner";
        banner.style.position = "fixed";
        banner.style.bottom = "20px";
        banner.style.left = "50%";
        banner.style.transform = "translateX(-50%)";
        banner.style.backgroundColor = "#4285F4";
        banner.style.color = "white";
        banner.style.padding = "12px 20px";
        banner.style.borderRadius = "8px";
        banner.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.2)";
        banner.style.zIndex = "999999";
        banner.style.display = "flex";
        banner.style.flexDirection = "column"; // Changed to column layout
        banner.style.gap = "8px";
        banner.style.maxWidth = "90%";
        banner.style.minWidth = "300px";
        banner.style.fontFamily = "Arial, sans-serif";
        banner.style.fontSize = "14px";
        banner.style.transition = "all 0.3s ease";

        // Header section with title and close button
        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "center";
        header.style.width = "100%";

        const title = document.createElement("div");
        title.textContent = "Best Element Locator";
        title.style.fontWeight = "bold";

        const closeBtn = document.createElement("button");
        closeBtn.innerHTML = "&times;";
        closeBtn.style.background = "none";
        closeBtn.style.border = "none";
        closeBtn.style.color = "white";
        closeBtn.style.fontSize = "18px";
        closeBtn.style.cursor = "pointer";
        closeBtn.style.padding = "0";
        closeBtn.addEventListener("click", () => {
            banner.style.display = "none";
        });

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Content section for locator value
        const content = document.createElement("div");
        content.style.padding = "6px 8px";
        content.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
        content.style.borderRadius = "4px";
        content.style.fontFamily = "monospace";
        content.style.fontSize = "13px";
        content.style.width = "100%";
        content.style.wordBreak = "break-all";
        content.style.boxSizing = "border-box";

        // Button row
        const buttonRow = document.createElement("div");
        buttonRow.style.display = "flex";
        buttonRow.style.gap = "8px";
        buttonRow.style.marginTop = "4px";

        const copyBtn = document.createElement("button");
        copyBtn.textContent = "Copy";
        copyBtn.style.background = "rgba(255, 255, 255, 0.2)";
        copyBtn.style.border = "none";
        copyBtn.style.color = "white";
        copyBtn.style.padding = "4px 12px";
        copyBtn.style.borderRadius = "4px";
        copyBtn.style.cursor = "pointer";
        copyBtn.style.fontSize = "12px";
        copyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const locatorText = content.textContent.split(": ").pop(); // Extract only the locator value
            navigator.clipboard.writeText(locatorText).then(() => {
                copyBtn.textContent = "Copied!";
                setTimeout(() => {
                    copyBtn.textContent = "Copy";
                }, 2000);
            });
        });

        const accuracyMeter = document.createElement("div");
        accuracyMeter.style.marginLeft = "auto";
        accuracyMeter.style.fontSize = "12px";
        accuracyMeter.textContent = "Accuracy: ⭐⭐⭐⭐⭐"; // Default value

        buttonRow.appendChild(copyBtn);
        buttonRow.appendChild(accuracyMeter);

        // Info section (optional, can be shown/hidden)
        const infoSection = document.createElement("div");
        infoSection.style.fontSize = "11px";
        infoSection.style.color = "rgba(255, 255, 255, 0.8)";
        infoSection.style.marginTop = "4px";
        infoSection.style.display = "none"; // Hidden by default

        // Prevent banner interactions from propagating
        banner.addEventListener("mouseover", (e) => e.stopPropagation());
        banner.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault(); // Prevent default click behavior
        });

        banner.appendChild(header);
        banner.appendChild(content);
        banner.appendChild(buttonRow);
        banner.appendChild(infoSection);
        document.body.appendChild(banner);
        this.banner = banner;
        return banner;
    },

    // Show the best locator banner with improved information
    showBestLocator(locatorType, locatorValue, score) {
        // Early return if feature is disabled
        if (!this.isEnabled) {
            this.hideBestLocatorBanner();
            return;
        }

        const banner = this.createBestLocatorBanner();
        const content = banner.querySelector("div:nth-child(2)"); // Content is the second div
        content.textContent = `${locatorType}: ${locatorValue}`;
        banner.style.display = "flex";

        // Update accuracy meter based on score
        const accuracyMeter = banner.querySelector(
            "div:nth-child(3) div:nth-child(2)"
        ); // Button row -> accuracy meter
        if (score) {
            let stars = "";
            if (score >= 90) {
                stars = "⭐⭐⭐⭐⭐";
                accuracyMeter.style.color = "#FFEB3B"; // Yellow for high accuracy
            } else if (score >= 70) {
                stars = "⭐⭐⭐⭐";
                accuracyMeter.style.color = "#FFEB3B";
            } else if (score >= 50) {
                stars = "⭐⭐⭐";
                accuracyMeter.style.color = "#FFFFFF";
            } else if (score >= 30) {
                stars = "⭐⭐";
                accuracyMeter.style.color = "#FFFFFF";
            } else {
                stars = "⭐";
                accuracyMeter.style.color = "#FFFFFF";
            }
            accuracyMeter.textContent = `Accuracy: ${stars}`;
        }

        // Show additional info for certain types
        const infoSection = banner.querySelector("div:nth-child(4)"); // Info section is the fourth div
        if (locatorType === "XPath") {
            infoSection.textContent =
                "XPath may be brittle if page structure changes";
            infoSection.style.display = "block";
        } else if (locatorType === "ID") {
            infoSection.textContent =
                "ID selectors are typically the most reliable";
            infoSection.style.display = "block";
        } else if (locatorType === "CSS Selector") {
            infoSection.textContent =
                "CSS selectors balance specificity and readability";
            infoSection.style.display = "block";
        } else {
            infoSection.style.display = "none";
        }
    },

    hideBestLocatorBanner() {
        if (this.banner) {
            this.banner.style.display = "none";
        }
    },

    setBannerEnabled(enabled) {
        this.isEnabled = enabled;
        if (!enabled) {
            this.hideBestLocatorBanner();
            if (this.banner) {
                this.banner.remove();
                this.banner = null;
            }
        }
    },

    highlightElement(element, previousHighlight) {
        if (!element || !element.style) return;

        requestAnimationFrame(() => {
            if (previousHighlight) {
                previousHighlight.style.outline = "";
                previousHighlight.style.outlineOffset = "";
            }

            element.style.outline = "2px solid #4285F4";
            element.style.outlineOffset = "2px";
        });

        return element;
    },

    removeHighlight(element) {
        if (element && element.style) {
            element.style.outline = "";
            element.style.outlineOffset = "";
        }
        this.hideBestLocatorBanner();
    },

    // Expose initialization method
    init() {
        this.isEnabled = true;
        this.banner = null;
        // Expose to window for content script access
        window.LocatorHelper = this;
        return this;
    },
};

// Initialize when script loads
window.LocatorHelper.init();