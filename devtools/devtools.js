chrome.devtools.panels.create(
  "Locator Spy",
  "popup/icons/icon16.png",
  "devtools/panel.html",
  (panel) => {
    panel.onShown.addListener((extPanelWindow) => {
      // Check dock position
      chrome.devtools.panels.ElementsPanel?.createSidebarPane("position", (sidebar) => {
        const checkDockPosition = () => {
          if (extPanelWindow && extPanelWindow.document) {
            const warning = extPanelWindow.document.getElementById('dockWarning');
            if (warning) {
              // Show warning if not in bottom dock
              const rect = extPanelWindow.document.body.getBoundingClientRect();
              const isBottomDocked = rect.width > rect.height;
              warning.style.display = isBottomDocked ? 'none' : 'flex';
            }
          }
        };

        // Check on initialization and window resize
        checkDockPosition();
        extPanelWindow.addEventListener('resize', checkDockPosition);
      });
    });
  }
);