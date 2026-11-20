#!/bin/sh
# Build the Chrome Web Store upload zip from the extension files only.
set -e
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="dist/busted-$VERSION.zip"
mkdir -p dist
rm -f "$OUT"
zip -q -X "$OUT" \
  manifest.json background.js shared.js presets.js \
  popup.html popup.css popup.js \
  blocked.html blocked.css blocked.js \
  art/hoot_v2.webp art/fox.webp art/cutscene.webm \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  icons/sites/*.png
echo "$OUT"
unzip -l "$OUT" | tail -1
