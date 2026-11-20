# Changelog

Dates are the day each version was built.

## 1.3.2 (in development)

- The files moved into folders (`popup/`, `blocked/`, `background/`, `lib/`). Nothing changes in how it works.

## 1.3.1 (2026-11-18)

- New store title and summary: "Busted: Website Blocker & Focus Mode".
- A one-time "Rate Busted" request in the popup, three days after the first use. "No thanks" hides it for good.

## 1.3.0 (2026-11-13)

- Block one part of a site: `youtube.com/shorts` blocks Shorts and leaves the rest of YouTube open. There is a "YouTube Shorts" chip in Quick add.
- Focus sessions: 25, 50 or your own number of minutes. Block your list, or block everything except a short allowed list. No pause, and ending early takes a 60 second wait. Blocked tabs go back to where they were when the session ends.
- Daily limit per site: open until the minutes run out, then blocked until midnight.
- Removing the extension opens a short "why did you uninstall" page.
- No new permissions.

## 1.2.1 (2026-11-12)

Bug fixes:

- A pass won on the wheel was lost when the cutscene failed to play.
- The popup ignored a running pass.
- Schedules could switch on or off up to a minute late.
- A pass covered one domain only. It now covers every domain of the same site (x.com and twitter.com, all Amazon stores).
- A fix for the close button of the wheel.

## 1.2.0 (2026-11-09)

- The Wheel of Freedom: a spin that sometimes gives a 5 minute pass.
- New 3D art for Hoot the owl, and Lucky the fox in the jackpot cutscene.

## 1.1.1 (2026-11-08)

- Renamed from Focus Blocker to Busted. Hoot the owl moves into the blocked page.

## 1.0.0 to 1.0.2 (2026-11-06)

- First versions, under the name Focus Blocker: a block list, weekly schedules, one-click presets, and a blocked page whose Unblock button runs away from the cursor.
