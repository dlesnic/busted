<p align="center">
  <a href="https://gotbusted.app"><img src="docs/banner.png" width="720" alt="Busted, the website blocker that judges you. Hoot the owl stands between a raccoon and a fox."></a>
</p>

<p align="center">
  A website blocker for Chrome, small enough to read before you trust it.<br>
  Block sites always, on a schedule, or after a daily limit. Open one anyway and an owl catches you.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/hboldmfdfgijnjjndagdnalehfjngphg"><img src="https://img.shields.io/badge/Add%20to%20Chrome-free-7c5cff?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Add to Chrome, free"></a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/hboldmfdfgijnjjndagdnalehfjngphg"><img src="https://img.shields.io/chrome-web-store/v/hboldmfdfgijnjjndagdnalehfjngphg?label=chrome%20web%20store&color=7c5cff" alt="Version on the Chrome Web Store"></a>
  <a href="https://github.com/dlesnic/busted/actions/workflows/tests.yml"><img src="https://github.com/dlesnic/busted/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <img src="https://img.shields.io/badge/manifest-v3-7c5cff" alt="Manifest V3">
  <img src="https://img.shields.io/badge/data%20collected-none-2ea44f" alt="No data collected">
  <a href="LICENSE"><img src="https://img.shields.io/badge/code-MIT-ff5c8a" alt="MIT license"></a>
</p>

<p align="center">
  <a href="#why-another-blocker">Why</a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#the-wheel-of-freedom">The wheel</a> ·
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="https://gotbusted.app">gotbusted.app</a> ·
  <a href="https://www.youtube.com/watch?v=rmgBHqof8_Y">Video</a>
</p>

<p align="center">
  <img src="docs/demo.gif" width="800" alt="The page you get on tiktok.com when it is blocked. The cursor goes for the Unblock button three times and the button jumps away each time.">
</p>

<p align="center"><i>Go on, click "Unblock it".</i></p>

## Why another blocker

A website blocker sees the address of every tab you open. The Chrome Web Store has plenty of them, and I had no way to tell what most of them do with that. So I wanted one small enough to check in one sitting.

- **1,253 lines of plain JavaScript in five files.** No build step, no libraries, nothing minified.
- **No host permissions.** Busted sees the address of a tab. It cannot read or change what is on the page.
- **No network requests.** This prints nothing:
  ```sh
  grep -nE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon" *.js
  ```
- **No account, no analytics.** Your list, schedules and counters stay in `chrome.storage.local` on your device.
- **The store version is this code.** `tools/package.sh` zips these same files, unchanged, and that zip is what I upload.

Two things open a web page in your browser. Removing the extension opens a short "why did you leave" page on gotbusted.app, with the version number in the address and nothing else. The "Rate Busted" button opens the Chrome Web Store.

## What it does

<table>
  <tr>
    <td width="36%" valign="top">
      <img src="docs/popup.gif" alt="The popup in use: three sites added from Quick add, youtube.com/shorts typed in, a 30 minute daily limit set on instagram.com, and a 25 minute focus session started">
    </td>
    <td valign="top">

**A whole site, or one part of it.** `youtube.com/shorts` blocks Shorts and leaves the rest of YouTube alone. `reddit.com/r/all` works the same way.

**47 sites in Quick add.** From TikTok and Instagram to Hacker News and Steam. Subdomains are covered, so `youtube.com` also blocks `m.youtube.com`.

**Schedules.** Pick the days and the hours. A window that ends before it starts runs overnight, like 23:00 to 07:00.

**Daily limits.** 15, 30, 60 or your own number of minutes a day. Only time with the site in the tab in front of you counts. When the minutes run out, the site is blocked until midnight.

**Focus sessions.** 25, 50 or up to 180 minutes. Block your list, or block everything except the few sites you need. There is no pause, and ending early takes a 60 second wait. When the session ends, blocked tabs go back to the page they were on.

**No way around it through an open tab.** Tabs already on a site you just blocked are sent to the blocked page. The Back button and cached pages are covered too.

  </td>
  </tr>
</table>

## The Wheel of Freedom

Chrome's own error page would do the job. Busted shows Hoot, who counts how many times you tried today and has an opinion about it. And once every 20 minutes, per site, you get to spin.

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/wheel.gif" width="400" alt="The wheel spins and stops on the slice called Nothing. Hoot pops up over the wheel."></td>
    <td width="50%" align="center"><img src="docs/jackpot.gif" width="400" alt="The wheel stops on the 5 minute pass. Lucky the fox throws a net over Hoot and the site opens for 5 minutes."></td>
  </tr>
  <tr>
    <td align="center">Most slices send you back to work, or to do 10 push-ups.</td>
    <td align="center">One thin slice is a real 5 minute pass. Lucky the fox takes care of Hoot.</td>
  </tr>
</table>

The pass slice is drawn smaller than your real chance of hitting it. The actual odds are in [`blocked.js`](blocked.js), if you want to spoil it.

## Install

**From the store:** [Busted on the Chrome Web Store](https://chromewebstore.google.com/detail/hboldmfdfgijnjjndagdnalehfjngphg). Free, no account.

**From this code:**

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click "Load unpacked" and pick the folder.

Tested in Chrome and Chromium. I have not tried Edge, Brave or other Chromium browsers.

## How it works

| File | Lines | What it does |
|---|---|---|
| [`shared.js`](shared.js) | 161 | The rules: parse a list entry, check a schedule or a limit, decide if an address is blocked right now. Its only browser call reads storage |
| [`background.js`](background.js) | 185 | The service worker. Turns the list into block rules, checks schedules every minute, counts daily-limit time, sends blocked tabs to the blocked page |
| [`popup.js`](popup.js) | 411 | The popup: the list, the schedule and limit editor, focus sessions |
| [`blocked.js`](blocked.js) | 399 | The blocked page and the wheel |
| [`presets.js`](presets.js) | 97 | The Quick add sites |

1. The popup saves your list to `chrome.storage.local`.
2. The service worker rebuilds the block rules from it: one `declarativeNetRequest` rule per entry that is active right now. Chrome itself stops the request before the site loads.
3. A tab listener then replaces Chrome's error page with the blocked page. It also catches what never reaches the network, like the Back button and navigation inside a page that is already open.
4. An alarm fires every minute for schedules. Separate alarms fire at the moment a pass, a focus session or a daily limit ends.

### Permissions

| Permission | Why |
|---|---|
| `declarativeNetRequest` | Blocks requests for the sites on your list |
| `tabs` | Reads the address of open tabs, to send a tab on a blocked site to the blocked page and to count time for daily limits. Addresses are not saved or sent anywhere |
| `storage` | Saves your list and settings on your device |
| `alarms` | Wakes the extension for schedules, passes, limits and focus sessions |
| `favicon` | Shows site icons from Chrome's own local icon cache |

## Tests

41 end-to-end tests drive the real extension in Chromium: the popup, the blocked page, the wheel, focus sessions and daily limits. They take about 4 minutes.

```sh
npm install
npx playwright-core install chromium
npm test
```

`npm run build` makes the zip for the Chrome Web Store.

## Feedback

Found a bug, or a site that should be in Quick add? [Open an issue](https://github.com/dlesnic/busted/issues/new/choose). Pull requests are welcome as long as they add no permissions and no network requests.

If Busted helps you, a [review on the Chrome Web Store](https://chromewebstore.google.com/detail/hboldmfdfgijnjjndagdnalehfjngphg/reviews) does more for it than a star here. The list of changes is in [CHANGELOG.md](CHANGELOG.md).

## License

The code is MIT, see [LICENSE](LICENSE). The Busted name, the icon and the mascot art in `art/` are not covered by it. The site icons in `icons/sites/` belong to their owners.
