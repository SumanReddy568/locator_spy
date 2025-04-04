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

# Create backlog directory with proper permissions
mkdir -p "$BACKLOG_DIR" || {
    echo "Failed to create backlog directory"
    exit 1
}
chmod 755 "$BACKLOG_DIR"

# Move existing zip files to backlog directory
find . -maxdepth 1 -name "${EXTENSION_NAME}*.zip" -type f | while read -r file; do
    if [ -f "$file" ]; then
        version=$(echo "$file" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+')
        backup_path="${BACKLOG_DIR}/$(basename "$file")"
        
        echo "Moving $file to $backup_path"
        if mv "$file" "$backup_path"; then
            echo "Successfully moved $(basename "$file") to backlog"
        else
            echo "Failed to move $(basename "$file") to backlog"
            exit 1
        fi
    fi
done

# Clean up duplicates in backlog directory
find "$BACKLOG_DIR" -name "${EXTENSION_NAME}_*.zip" | while read -r file; do
    version=$(basename "$file" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+')
    count=$(find "$BACKLOG_DIR" -name "*${version}.zip" | wc -l)
    if [ "$count" -gt 1]; then
        echo "Removing duplicate version: $file"
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

# Create new versioned zip file in the root directory
ZIP_FILENAME="${EXTENSION_NAME}_${NEW_VERSION}.zip"
zip -r "$ZIP_FILENAME" ./* -x "*.git*" -x ".github/*" -x "*.sh" -x "${BACKLOG_DIR}/*" -x "${EXTENSION_NAME}*.zip"

# Move the newly created zip to backlog directory
mv "$ZIP_FILENAME" "${BACKLOG_DIR}/${ZIP_FILENAME}" || {
    echo "Failed to move new zip to backlog directory"
    exit 1
}

# Create a symlink in root directory
ln -sf "${BACKLOG_DIR}/${ZIP_FILENAME}" "${ZIP_FILENAME}" || {
    echo "Failed to create symlink"
    exit 1
}

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
if git add "$MANIFEST_PATH" "$PANEL_PATH" "$POPUP_HTML_PATH" "$WELCOME_HTML_PATH" "$CHANGELOG_PATH" "$ZIP_FILENAME" "$BACKLOG_DIR"; then
  git commit -m "Auto-update: Version $NEW_VERSION [skip ci]"
  echo "Successfully updated to version $NEW_VERSION"
else
  echo "Failed to commit version update"
  exit 1
fi