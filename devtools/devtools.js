// Create a panel in DevTools
chrome.devtools.panels.create(
  "Locator Spy", // Panel title
  "popup/icons/icon16.png", // Panel icon
  "devtools/panel.html", // Panel page
  function(panel) {
    console.log("Selenium Locator Helper panel created");
  }
);