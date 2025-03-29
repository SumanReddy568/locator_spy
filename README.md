# Locator Spy - Web Element Locator Finder

![Extension Logo](popup/icons/icon128.png)

A Chrome extension that helps developers and QA engineers find reliable locators for web automation testing.

## Features

- 🔍 **Element Inspection**: Hover to find locators
- 📋 **Multiple Locator Strategies**: CSS, XPath, ID, Class Name
- 📦 **Auto-Zip Packaging**: GitHub Action auto-packages extension
- 🔄 **Version Auto-Increment**: Updates with each change
- 🌓 **Dark/Light Mode**: Comfortable viewing
- 📋 **Copy to Clipboard**: One-click locator copying

## Installation

### Chrome Web Store
[![Available in Chrome Web Store](https://developer.chrome.com/webstore/images/ChromeWebStore_Badge_v2_206x58.png)](https://chrome.google.com/webstore/detail/locator-spy/your-extension-id)

### Manual Installation
1. Download the latest `locator_spy_extension.zip` from [Releases](https://github.com/SumanReddy568/locator_spy/releases)
2. Unzip the package
3. In Chrome:
   - Go to `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the unzipped folder

## Usage

1. Click the extension icon in your toolbar
2. Activate "Locator Mode"
3. Hover over page elements
4. View generated locators in the panel
5. Click any locator to copy to clipboard

![Interface Screenshot](images/screenshot.png)

## Development

### Requirements
- Node.js (v14+ recommended)
- Chrome browser

### Build Steps
```bash
# Clone repository
git clone https://github.com/SumanReddy568/locator_spy.git
cd locator_spy

# Create production zip
chmod +x zip_extension.sh
./zip_extension.sh
Automatic Packaging
Every merge to main branch:

Auto-increments version in manifest

Creates fresh zip package

Commits changes back to repo

Support
For help or feature requests:

Open an Issue

Email: your-email@example.com

License
This project is licensed under the MIT License - see the LICENSE file for details.
