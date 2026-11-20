# Busted

A website blocker for Chrome. Block sites always, on a schedule, or after a daily time limit, and run focus sessions. Everything stays on your device.

- Install from the Chrome Web Store: https://chromewebstore.google.com/detail/hboldmfdfgijnjjndagdnalehfjngphg
- Site: https://gotbusted.app

## What it does

- Block any site, or one part of a site (for example `youtube.com/shorts`)
- Block always, or only on the days and hours you pick
- Daily time limit per site
- Focus sessions: block your list, or everything except a short allowed list
- A wheel that sometimes gives a 5 minute pass

## Privacy

No account, no analytics, no remote code. The extension code makes no network requests. Your block list, schedules and counters are saved in `chrome.storage.local` on your device.

Two things open a web page in your browser: removing the extension opens the uninstall page on gotbusted.app, and the "Rate Busted" button opens the Chrome Web Store.

## Permissions

| Permission | Why |
|---|---|
| `declarativeNetRequest` | Blocks requests for the sites on your block list |
| `tabs` | Reads the address of open tabs, so a tab on a blocked site is switched to the blocked page, and to count time for daily limits. Addresses are not stored or sent anywhere |
| `storage` | Saves your list and settings locally |
| `alarms` | Checks schedules, passes, limits and focus sessions at the right time |
| `favicon` | Shows site icons from Chrome's local favicon cache |

There are no host permissions.

## Run it from source

1. Download or clone this repository.
2. Open `chrome://extensions`, turn on Developer mode.
3. Click "Load unpacked" and pick the folder.

## Tests

End-to-end tests run the real extension in Chromium.

```
npm i playwright-core@1.58 && npx playwright-core install chromium
node tests/e2e.mjs .
```

## Build the store zip

```
sh tools/package.sh
```

## License

The code is MIT, see `LICENSE`. The Busted name, the icon and the mascot art in `art/` are not covered by that license. The site icons in `icons/sites/` belong to their owners.
