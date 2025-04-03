#!/bin/bash

# Configuration
EXTENSION_NAME="locator_spy_extension"
MANIFEST_PATH="manifest.json"
PANEL_PATH="./devtools/panel.html"
CHANGELOG_PATH="CHANGELOG.md"
WELCOME_HTML_PATH="welcome.html"
POPUP_HTML_PATH="./popup/popup.html"
BACKLOG_DIR="backlogextension"

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

# Create backlog directory if it doesn't exist
mkdir -p "$BACKLOG_DIR"

# Clean up old versions in backlog (keep only latest)
if [ -d "$BACKLOG_DIR" ]; then
  # Find all zip files in backlog and sort by version
  find "$BACKLOG_DIR" -name "${EXTENSION_NAME}_*.zip" | sort -V | head -n -1 | xargs rm -f
fi

# Move current zip to backlog if exists (with versioned name)
if [ -f "${EXTENSION_NAME}.zip" ]; then
  mv "${EXTENSION_NAME}.zip" "${BACKLOG_DIR}/${EXTENSION_NAME}_${CURRENT_VERSION}.zip"
  git rm "${EXTENSION_NAME}.zip"
fi

# Update manifest version
jq --arg new_version "$NEW_VERSION" '.version = $new_version' "$MANIFEST_PATH" > temp.json && mv temp.json "$MANIFEST_PATH"

# Update version in panel.html
sed -i "s|<div class=\"version-info\">.*<span>Version [0-9]\+\.[0-9]\+\.[0-9]\+</span>.*</div>|<div class=\"version-info\"><span>Version $NEW_VERSION</span></div>|g" "$PANEL_PATH"

# Update version in welcome.html
sed -i 's|<span class="version-badge">v[0-9]\+\.[0-9]\+\.[0-9]\+</span>|<span class="version-badge">v'$NEW_VERSION'</span>|g' "$WELCOME_HTML_PATH"

# Update version in popup.html
sed -i "s|<div class=\"version-info\">.*<span>Version [0-9]\+\.[0-9]\+\.[0-9]\+</span>.*</div>|<div class=\"version-info\"><span>Version $NEW_VERSION</span></div>|g" "$POPUP_HTML_PATH"

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

# Create new versioned zip file (excluding git and script files)
ZIP_FILENAME="${EXTENSION_NAME}_${NEW_VERSION}.zip"
zip -r "$ZIP_FILENAME" ./* -x "*.git*" -x ".github/*" -x "*.sh" -x "$EXTENSION_NAME*.zip" -x "$BACKLOG_DIR/*"

# Configure git
git config --global user.name "GitHub Actions"
git config --global user.email "actions@github.com"

# Commit changes
git add "$ZIP_FILENAME" "$MANIFEST_PATH" "$PANEL_PATH" "$CHANGELOG_PATH" "$WELCOME_HTML_PATH" "$POPUP_HTML_PATH"
if [ -d "$BACKLOG_DIR" ]; then
  git add "$BACKLOG_DIR"
fi
git commit -m "Auto-update: Version $NEW_VERSION [skip ci]"