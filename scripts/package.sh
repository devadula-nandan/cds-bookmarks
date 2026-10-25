#!/bin/sh
# Builds dist/dev-dashboard.zip (a dev-dashboard/ folder with only the files the extension loads).
# The name stays the same across versions so the README can link to the latest release's download.
set -eu
cd "$(dirname "$0")/.."

version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' manifest.json)
[ -n "$version" ] || { echo "No version found in manifest.json" >&2; exit 1; }

stage="dist/dev-dashboard"
rm -rf dist
mkdir -p "$stage"
cp -R manifest.json background.js index.html style.css bookmarks.json src icons ai-helper "$stage/"
# Strip the "key" field — not allowed in Chrome Web Store uploads
node -e "
  const fs = require('fs');
  const m = JSON.parse(fs.readFileSync('$stage/manifest.json', 'utf8'));
  delete m.key;
  fs.writeFileSync('$stage/manifest.json', JSON.stringify(m, null, 2) + '\n');
"
(cd dist && zip -qrX dev-dashboard.zip dev-dashboard)
rm -rf "$stage"
echo "Built dist/dev-dashboard.zip (v$version)"
