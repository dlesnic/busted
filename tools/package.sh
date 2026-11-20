#!/bin/sh
# Build the Chrome Web Store upload zip: the extension/ folder, as it is.
set -e
cd "$(dirname "$0")/../extension"
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="../dist/busted-$VERSION.zip"
mkdir -p ../dist
rm -f "$OUT"
zip -q -X -r "$OUT" . -x "*.DS_Store"
echo "dist/busted-$VERSION.zip"
unzip -l "$OUT" | tail -1
