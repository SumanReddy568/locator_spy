#!/bin/bash

# Configuration
EXTENSION_NAME="locator_spy_extension"
MANIFEST_PATH="manifest.json"
PANEL_PATH="./devtools/panel.html"
CHANGELOG_PATH="CHANGELOG.md"
WELCOME_HTML_PATH="welcome.html"
POPUP_HTML_PATH="popup/popup.html"

# Function to increment version number
increment_version() {
  local version=$1
  local major=$(echo "$version" | cut -d. -f1)
  local minor=$(echo "$version" | cut -d. -f2)
  local patch=$(echo "$version" | cut -d. -f3)
  
  patch=$((patch + 1))
  
  if [ "$patch" -gt 9 ]; then
    patch=0
    minor=$((minor + 1))
  fi
  
  if [ "$minor" -gt 9 ]; then
    minor=0
    major=$((major + 1))
  fi
  
  echo "$major.$minor.$patch"
}

# Get current commit message (excluding [skip ci] if present)
COMMIT_MESSAGE=$(git log -1 --pretty=%B | sed 's/\[skip ci\]//g' | xargs)

# Update version in manifest
CURRENT_VERSION=$(jq -r '.version' "$MANIFEST_PATH")
NEW_VERSION=$(increment_version "$CURRENT_VERSION")

# Update manifest version
jq --arg new_version "$NEW_VERSION" '.version = $new_version' "$MANIFEST_PATH" > temp.json && mv temp.json "$MANIFEST_PATH"

# Update version in panel.html
sed -i "s|<div class=\"version-info\">Version [0-9]\+\.[0-9]\+\.[0-9]\+</div>|<div class=\"version-info\">Version $NEW_VERSION</div>|g" "$PANEL_PATH"
sed -i 's|<span class="version-badge">v[0-9]\+\.[0-9]\+\.[0-9]\+</span>|<span class="version-badge">v'$NEW_VERSION'</span>|g' "$WELCOME_HTML_PATH"
sed -i 's|<div class="version-info">.*<span>Version [0-9]\+\.[0-9]\+\.[0-9]\+</span>.*</div>|<div class="version-info"><span>Version '"$NEW_VERSION"'</span></div>|g' "$POPUP_HTML_PATH"

# Update changelog
if [ ! -f "$CHANGELOG_PATH" ]; then
  echo "# Changelog" > "$CHANGELOG_PATH"
  echo "" >> "$CHANGELOG_PATH"
  echo "All notable changes to this project will be documented in this file." >> "$CHANGELOG_PATH"
  echo "" >> "$CHANGELOG_PATH"
fi

# Add new version entry to changelog
{
  echo "## [$NEW_VERSION] - $(date +%Y-%m-%d)"
  echo "- $COMMIT_MESSAGE"
  echo ""
  cat "$CHANGELOG_PATH"
} > temp_changelog.md && mv temp_changelog.md "$CHANGELOG_PATH"

# Remove old zip if exists
if [ -f "$EXTENSION_NAME.zip" ]; then
  git rm "$EXTENSION_NAME.zip"
fi

# Create new zip file (excluding git and script files)
zip -r "$EXTENSION_NAME.zip" ./* -x "*.git*" -x ".github/*" -x "*.sh" -x "$EXTENSION_NAME.zip"

# Configure git
git config --global user.name "GitHub Actions"
git config --global user.email "actions@github.com"

# Commit changes
git add "$EXTENSION_NAME.zip" "$MANIFEST_PATH" "$PANEL_PATH" "$CHANGELOG_PATH"
git commit -m "Auto-update: Version $NEW_VERSION [skip ci]"