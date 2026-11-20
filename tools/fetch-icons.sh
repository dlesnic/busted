#!/bin/sh
# Dev-only: download preset site icons into extension/icons/sites/.
# Not part of the packaged extension. Re-run after editing extension/lib/presets.js.
set -e
cd "$(dirname "$0")/../extension"
node --input-type=module -e '
import { PRESET_GROUPS } from "./lib/presets.js";
for (const g of PRESET_GROUPS) for (const p of g.items) console.log(p.domains[0]);
' | while read -r d; do
  src=$d
  case $d in web.whatsapp.com) src=whatsapp.com ;; esac  # web.* has no icon of its own
  code=$(curl -s -L -o "icons/sites/$d.png" -w "%{http_code}" \
    "https://www.google.com/s2/favicons?domain=$src&sz=64")
  size=$(sips -g pixelWidth "icons/sites/$d.png" 2>/dev/null | awk '/pixelWidth/{print $2}')
  echo "$code ${size:-?}px $d"
done
