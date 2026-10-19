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
cp -R manifest.json background.js index.html bookmarks-data.js css js icons "$stage/"
(cd dist && zip -qrX dev-dashboard.zip dev-dashboard)
rm -rf "$stage"
echo "Built dist/dev-dashboard.zip (v$version)"
