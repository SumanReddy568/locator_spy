#!/bin/bash

# Configuration
EXTENSION_NAME="locator_spy_extension"
MANIFEST_PATH="manifest.json"
PANEL_PATH="./devtools/panel.html"
CHANGELOG_PATH="CHANGELOG.md"
WELCOME_HTML_PATH="welcome.html"
POPUP_HTML_PATH="./popup/popup.html"
EXTENSIONS_DIR="extensions"

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

# Create extensions directory if it doesn't exist
mkdir -p "${EXTENSIONS_DIR}"
echo "Created or verified extensions directory: ${EXTENSIONS_DIR}"

# Move all existing extension zips to the extensions directory
find . -maxdepth 1 -name "${EXTENSION_NAME}_*.zip" -type f -exec mv {} "${EXTENSIONS_DIR}/" \;

# Remove duplicate versions in extensions directory, keeping only the latest
cd "${EXTENSIONS_DIR}"
for version in $(ls ${EXTENSION_NAME}_*.zip 2>/dev/null | sed 's/.*_\([0-9.]*\)\.zip/\1/' | sort -u); do
  # Get all files for this version
  files=(${EXTENSION_NAME}_${version}.zip)
  # Keep only the newest file
  if [ ${#files[@]} -gt 1 ]; then
    newest=$(ls -t "${files[@]}" | head -1)
    for file in "${files[@]}"; do
      if [ "$file" != "$newest" ]; then
        rm -f "$file"
        echo "Removed duplicate version: $file"
      fi
    done
  fi
done
cd ..

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

# Create new zip file in the extensions directory
echo "Creating new extension version $NEW_VERSION"
zip -r "$EXTENSIONS_DIR/$NEW_ZIP_FILENAME" ./* -x "*.git*" -x ".github/*" -x "*.sh" -x "${EXTENSIONS_DIR}/*" || {
  echo "Failed to create new extension zip"
  exit 1
}

echo "Successfully created new extension: $EXTENSIONS_DIR/$NEW_ZIP_FILENAME"

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
if git add "$MANIFEST_PATH" "$PANEL_PATH" "$POPUP_HTML_PATH" "$WELCOME_HTML_PATH" "$CHANGELOG_PATH" "$EXTENSIONS_DIR/$NEW_ZIP_FILENAME"; then
  git commit -m "Auto-update: Version $NEW_VERSION [skip ci]"
  echo "Successfully updated to version $NEW_VERSION"
else
  echo "Failed to commit version update"
  exit 1
fi