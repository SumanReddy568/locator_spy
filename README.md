# Locator Spy - Web Element Locator Finder

![Extension Logo](popup/icons/icon128.png)

A Chrome extension that helps developers and QA engineers find reliable locators for web automation testing.

## Features

- 🔍 **Element Inspection**: Hover over elements to find locators.
- 📋 **Multiple Locator Strategies**: CSS, XPath, ID, Class Name.
- 📦 **Auto-Zip Packaging**: GitHub Action auto-packages the extension.
- 🔄 **Version Auto-Increment**: Automatically updates the version with each change.
- 🌓 **Dark/Light Mode**: Comfortable viewing experience.
- 📋 **Copy to Clipboard**: One-click locator copying.

## Installation

### Chrome Web Store
[![Available in Chrome Web Store](https://developer.chrome.com/webstore/images/ChromeWebStore_Badge_v2_206x58.png)](https://chrome.google.com/webstore/detail/locator-spy/your-extension-id)

### Manual Installation
1. Download the latest `locator_spy_extension.zip` from the [Releases](https://github.com/SumanReddy568/locator_spy/releases) page.
2. Unzip the package.
3. In Chrome:
   - Go to `chrome://extensions`.
   - Enable "Developer mode".
   - Click "Load unpacked" and select the unzipped folder.

## Usage

1. Click the extension icon in your toolbar.
2. Activate "Locator Mode".
3. Hover over page elements.
4. View generated locators in the panel.
5. Click any locator to copy it to the clipboard.

![Interface Screenshot](images/screenshot.png)

## Development

### Requirements
- Node.js (v14+ recommended)
- Chrome browser

### Build Steps
```bash
# Clone the repository
git clone https://github.com/SumanReddy568/locator_spy.git
cd locator_spy

# Install dependencies (if applicable)
npm install

# Create production zip
chmod +x zip_extension.sh
./zip_extension.sh
```

### Automatic Packaging
Every merge to the `main` branch:
- Auto-increments the version in `manifest.json`.
- Creates a fresh zip package.
- Commits changes back to the repository.

## Authentication Feature (Optional)
This extension supports optional Google Sign-In for enhanced functionality. To enable:
1. Set up Firebase Authentication (free tier).
2. Follow the instructions in the [Firebase Setup Guide](https://firebase.google.com/docs/auth/web/start).

## Support
For help or feature requests:
- Open an [Issue](https://github.com/SumanReddy568/locator_spy/issues).
- Email: your-email@example.com

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.