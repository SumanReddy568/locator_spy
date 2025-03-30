#!/bin/bash

# Configuration
EXTENSION_NAME="locator_spy_extension"
MANIFEST_PATH="manifest.json"
PANEL_PATH="./devtools/panel.html"
CHANGELOG_PATH="CHANGELOG.md"
BACKLOG_DIR="backlog"

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

# Get current commit message
COMMIT_MESSAGE=$(git log -1 --pretty=%B | sed 's/\[skip ci\]//g' | xargs)

# Update version in manifest
CURRENT_VERSION=$(jq -r '.version' "$MANIFEST_PATH")
NEW_VERSION=$(increment_version "$CURRENT_VERSION")

# Update manifest version
jq --arg new_version "$NEW_VERSION" '.version = $new_version' "$MANIFEST_PATH" > temp.json && mv temp.json "$MANIFEST_PATH"

# Update version in panel.html
sed -i "s|<div class=\"version-info\">Version [0-9]\+\.[0-9]\+\.[0-9]\+</div>|<div class=\"version-info\">Version $NEW_VERSION</div>|g" "$PANEL_PATH"

# Update changelog
if [ ! -f "$CHANGELOG_PATH" ]; then
  echo -e "# Changelog\n\nAll notable changes to this project will be documented in this file.\n" > "$CHANGELOG_PATH"
fi
{
  echo "## [$NEW_VERSION] - $(date +%Y-%m-%d)"
  echo "- $COMMIT_MESSAGE"
  echo ""
  cat "$CHANGELOG_PATH"
} > temp_changelog.md && mv temp_changelog.md "$CHANGELOG_PATH"

# Create backlog directory if not exists
mkdir -p "$BACKLOG_DIR"

# Move old extension to backlog
if [ -f "$EXTENSION_NAME.zip" ]; then
  mv "$EXTENSION_NAME.zip" "$BACKLOG_DIR/${EXTENSION_NAME}_$CURRENT_VERSION.zip"
fi

# Create new extension zip
zip -r "$EXTENSION_NAME.zip" ./* -x "*.git*" -x ".github/*" -x "*.sh" -x "$EXTENSION_NAME.zip"
cp "$EXTENSION_NAME.zip" "$BACKLOG_DIR/${EXTENSION_NAME}_latest.zip"

# Configure git
git config --global user.name "GitHub Actions"
git config --global user.email "actions@github.com"

# Commit changes
git add "$EXTENSION_NAME.zip" "$MANIFEST_PATH" "$PANEL_PATH" "$CHANGELOG_PATH"
git commit -m "Auto-update: Version $NEW_VERSION [skip ci]"
