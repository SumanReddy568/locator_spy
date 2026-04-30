// UI Helper functions for Locator Spy.
// The in-page "Best Locator" banner has been removed; only highlight helpers
// remain.
window.LocatorHelper = {
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
    },

    init() {
        window.LocatorHelper = this;
        return this;
    },
};

window.LocatorHelper.init();
