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
NEW_ZIP_FILENAME="${EXTENSION_NAME}_${NEW_VERSION}.zip"

echo "Preparing to update from version $CURRENT_VERSION to $NEW_VERSION"

# Create backlog directory if it doesn't exist
mkdir -p "$BACKLOG_DIR"
echo "Ensuring backlog directory exists: $BACKLOG_DIR"

# First handle version management:
# 1. Move any existing version with the NEW_VERSION from root to backlog (safety check)
# 2. Move all other existing versions from root to backlog
# 3. Remove any duplicate versions in the backlog

# Step 1: Check if the new version zip already exists (shouldn't happen, but just in case)
if [ -f "$NEW_ZIP_FILENAME" ]; then
    echo "Found existing file with new version name: $NEW_ZIP_FILENAME - moving to backlog"
    mv "$NEW_ZIP_FILENAME" "$BACKLOG_DIR/"
fi

# Step 2: Move all existing extension zips to backlog
find . -maxdepth 1 -name "${EXTENSION_NAME}_*.zip" -type f | while read -r file; do
    filename=$(basename "$file")
    echo "Moving existing extension file to backlog: $filename"
    mv "$file" "$BACKLOG_DIR/" || {
        echo "Failed to move $file to backlog"
        exit 1
    }
done

# Step 3: Clean up duplicates in backlog (keep only latest copy of each version)
echo "Cleaning up duplicate versions in backlog..."
find "$BACKLOG_DIR" -name "${EXTENSION_NAME}_*.zip" | sort | while read -r file; do
    version=$(basename "$file" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+')
    # Get most recent file with this version number
    latest=$(find "$BACKLOG_DIR" -name "*${version}.zip" -type f -printf "%T@ %p\n" | sort -n | tail -1 | cut -d' ' -f2-)
    
    # Remove if not the latest
    if [ "$file" != "$latest" ] && [ -n "$latest" ]; then
        echo "Removing older duplicate of version $version: $file"
        rm -f "$file"
    fi
done

# Update manifest version with error checking
if ! jq --arg new_version "$NEW_VERSION" '.version = $new_version' "$MANIFEST_PATH" > temp.json; then
  echo "Error updating manifest version"
  exit 1
fi
mv temp.json "$MANIFEST_PATH"

# Update version in panel.html with proper sed command
if [ -f "$PANEL_PATH" ]; then
  sed -i'' -e "s/Version [0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*/Version ${NEW_VERSION}/g" "$PANEL_PATH"
  if ! grep -q "Version $NEW_VERSION" "$PANEL_PATH"; then
    echo "Failed to update version in panel.html"
    exit 1
  fi
fi

# Update version in popup.html with proper sed command
if [ -f "$POPUP_HTML_PATH" ]; then
  sed -i'' -e "s/Version [0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*/Version ${NEW_VERSION}/g" "$POPUP_HTML_PATH"
  if ! grep -q "Version $NEW_VERSION" "$POPUP_HTML_PATH"; then
    echo "Failed to update version in popup.html"
    exit 1
  fi
fi

# Update version in welcome.html with proper sed command
if [ -f "$WELCOME_HTML_PATH" ]; then
  sed -i'' -e "s/v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*/v${NEW_VERSION}/g" "$WELCOME_HTML_PATH"
  if ! grep -q "v$NEW_VERSION" "$WELCOME_HTML_PATH"; then
    echo "Failed to update version in welcome.html"
    exit 1
  fi
fi

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

# Create new zip file in root directory
echo "Creating new extension version $NEW_VERSION"
zip -r "$NEW_ZIP_FILENAME" ./* -x "*.git*" -x ".github/*" -x "*.sh" -x "${BACKLOG_DIR}/*" -x "${EXTENSION_NAME}*.zip" || {
    echo "Failed to create new extension zip"
    exit 1
}

echo "Successfully created new extension: $NEW_ZIP_FILENAME"

# No need for symlink - the new version is already in the root directory
# and old versions are properly archived in backlog

# Configure git
git config --global user.name "GitHub Actions"
git config --global user.email "actions@github.com"

# Add verification steps before commit
echo "Verifying version updates..."
echo "Manifest version: $(jq -r '.version' "$MANIFEST_PATH")"
echo "Panel version: $(grep 'Version' "$PANEL_PATH" || echo 'Not found')"
echo "Popup version: $(grep 'Version' "$POPUP_HTML_PATH" || echo 'Not found')"
echo "Welcome version: $(grep 'v[0-9]' "$WELCOME_HTML_PATH" || echo 'Not found')"

# Commit changes with verification
if git add "$MANIFEST_PATH" "$PANEL_PATH" "$POPUP_HTML_PATH" "$WELCOME_HTML_PATH" "$CHANGELOG_PATH" "$NEW_ZIP_FILENAME"; then
  git commit -m "Auto-update: Version $NEW_VERSION [skip ci]"
  echo "Successfully updated to version $NEW_VERSION"
else
  echo "Failed to commit version update"
  exit 1
fi