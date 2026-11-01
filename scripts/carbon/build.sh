#!/bin/sh
# Builds src/vendor/carbon/ from the versions pinned in package.json (and package-lock.json):
#   carbon.js   the Carbon web components the page uses, lit-html and the Carbon icons (carbon.js here)
#   carbon.css  Carbon's reset, themes, type and class-based styles (carbon.scss here)
#   fonts/      IBM Plex Sans and Mono
# The extension loads the output as is; this only runs when the Carbon versions or the component list change.
set -eu
cd "$(dirname "$0")"

npm ci --ignore-scripts --no-audit --no-fund
out=../../src/vendor/carbon
rm -rf "$out"
mkdir -p "$out/fonts"

npx esbuild carbon.js --bundle --format=esm --minify --legal-comments=eof --outfile="$out/carbon.js"
npx sass --load-path=node_modules --no-source-map --quiet-deps --silence-deprecation=if-function --style=compressed carbon.scss "$out/carbon.css"

for f in Light Regular Italic SemiBold; do cp "node_modules/@ibm/plex-sans/fonts/complete/woff2/IBMPlexSans-$f.woff2" "$out/fonts/"; done
for f in Regular SemiBold; do cp "node_modules/@ibm/plex-mono/fonts/complete/woff2/IBMPlexMono-$f.woff2" "$out/fonts/"; done
cp node_modules/@ibm/plex-sans/LICENSE.txt "$out/fonts/LICENSE.txt"

echo "Built $out"
