#!/bin/sh
# Compiles the dashboard's Carbon overrides (src/styles/<component>/override.scss, gathered by
# src/styles/overrides.scss) into src/styles/overrides.css, with Carbon's Sass tokens from this folder's
# node_modules. Run it after changing an override: sh scripts/carbon/overrides.sh
set -eu
cd "$(dirname "$0")"

[ -d node_modules ] || npm ci --ignore-scripts --no-audit --no-fund
npx sass --load-path=node_modules --no-source-map --quiet-deps --silence-deprecation=if-function --style=expanded ../../src/styles/overrides.scss ../../src/styles/overrides.css
echo "Built src/styles/overrides.css"
