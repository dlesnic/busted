import { blockedNow, findBlock, focusActive, focusEnd, focusOpenHosts, limitLeft, loadState, siteBlocked, siteKey, todayKey, urlMatches } from "../lib/shared.js";
import { kindOf, siteOf } from "../lib/categories.js";
import { addSpan, addTime, addVisit, BADGE_COLOR, badgeText, countable, DAY_PREFIX, hostOf, KEEP_DAYS, lastDays, mood, summarize } from "../lib/insights.js";

// Re-evaluate schedules every minute.
const ALARM = "focus-tick";
const PASS_ALARM = "pass-end";
const FOCUS_ALARM = "focus-end";
const LIMIT_ALARM = "limit-end";

// Opened by Chrome after the extension is removed, with only the extension's version attached.
const UNINSTALL_URL = "https://gotbusted.app/uninstall/";

// Daily limits: time is added in steps, at least once a minute. A longer gap
// means the computer slept or Chrome was closed, so it is never counted in full.
const MAX_STEP_SEC = 70;
// No keyboard or mouse for this long means nobody is at the computer, unless the tab in front plays sound.
const IDLE_SEC = 120;

// Serialize all work so overlapping triggers never race on rule IDs or counters.
let chain = Promise.resolve();
function run(job) {
  chain = chain.then(job).catch((e) => console.error("sync failed", e));
  return chain;
}
const sync = () => run(doSync);
/** Count daily-limit and insights time, and re-sync only if a limit just ran out. */
const count = () => run(async () => { if (await settle()) await doSync(); });

async function doSync() {
  await settle();
  await endFocusIfOver();
  await schedulePassEnd();
  const st = await loadState();
  const active = blockedNow(st);
  const everything = focusActive(st.focus) && st.focus.mode === "all";

  // "block" and "allow" need no host permissions; the tabs listener below then
  // swaps Chrome's error page for our blocked page.
  const rule = (type, priority, urlFilter) => ({ priority, action: { type }, condition: { urlFilter, resourceTypes: ["main_frame"] } });
  const addRules = [
    // Block-everything focus session: every web page, minus the allowed sites and running wheel passes.
    ...(everything ? [rule("block", 1, "|http"), ...focusOpenHosts(st).map((a) => rule("allow", 2, `||${a}^`))] : []),
    // List entries beat the allowed sites.
    ...active.map((s) => rule("block", 3, `||${siteKey(s)}^`)),
  ].map((r, i) => ({ id: i + 1, ...r }));

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules,
  });

  // Kick already-open tabs off sites that just became blocked.
  if (addRules.length) {
    for (const tab of await chrome.tabs.query({})) kickIfBlocked(tab.id, tab.url, st);
  }
}

/** Wake up exactly when the next wheel pass runs out, and drop expired passes. */
async function schedulePassEnd() {
  const { passes = {} } = await chrome.storage.local.get("passes");
  const now = Date.now();
  const live = Object.fromEntries(Object.entries(passes).filter(([, t]) => t > now));
  if (Object.keys(live).length !== Object.keys(passes).length) await chrome.storage.local.set({ passes: live });
  const next = Math.min(...Object.values(live));
  if (Number.isFinite(next)) chrome.alarms.create(PASS_ALARM, { when: next + 500 });
}

/** Wake up when the focus session ends, and forget a finished one. */
async function endFocusIfOver() {
  const { focus } = await chrome.storage.local.get("focus");
  if (!focus) return;
  if (focusActive(focus)) chrome.alarms.create(FOCUS_ALARM, { when: focusEnd(focus) + 300 });
  else await chrome.storage.local.remove("focus");
}

// --- daily limits and insights ---
/** The web page the user is looking at right now: the active tab of the focused window. null if there is none. */
async function frontTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) return null;
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  return win?.focused ? tab : null;
}

/** Daily-limit entries that cover the page in front. */
function watchedLimits(st, url) {
  if (!url) return [];
  const u = new URL(url);
  return st.sites.filter((s) => s.limit && s.enabled && !siteBlocked(s, st) && urlMatches(u, s)).map(siteKey);
}

/**
 * Insights: add the time just spent on a site to today's record (seconds, and the minutes of the day it covered),
 * and count an open of the site now in front. Only the site name is stored. One read and one write of today's small record; nothing else is touched.
 */
async function recordActivity(prevSite, secs, site, kinds) {
  const opened = site && site !== prevSite;
  if (!(prevSite && secs > 0) && !opened) return;
  const key = DAY_PREFIX + todayKey();
  const got = await chrome.storage.local.get(key);
  const day = got[key] || {};
  if (prevSite && secs > 0) {
    const n = new Date();
    const min = n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60;
    addTime(day, prevSite, kindOf(prevSite, kinds), secs, n.getHours());
    addSpan(day, prevSite, min - secs / 60, min);
  }
  if (opened) addVisit(day, site);
  await chrome.storage.local.set({ [key]: day });
  if (!got[key]) {
    // First record of a new day: drop the days that are older than we keep.
    const keep = new Set(lastDays(KEEP_DAYS).map((d) => DAY_PREFIX + d));
    const old = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith(DAY_PREFIX) && !keep.has(k));
    if (old.length) await chrome.storage.local.remove(old);
  }
}

/**
 * The toolbar icon shows today's time on distracting sites while Insights is on, in Hoot's mood color.
 * Chrome is only asked to change it when the text or the color actually changes.
 */
let shown = { text: null, color: null };
async function showBadge(insights, kinds) {
  let text = "", color = shown.color;
  if (insights?.on) {
    const key = DAY_PREFIX + todayKey();
    const day = (await chrome.storage.local.get(key))[key] || {};
    const secs = summarize({ today: day }, ["today"], kinds).byKind.distraction;
    text = badgeText(secs);
    color = BADGE_COLOR[mood(secs)];
  }
  if (color !== shown.color && color) await chrome.action.setBadgeBackgroundColor({ color });
  if (text !== shown.text) await chrome.action.setBadgeText({ text });
  shown = { text, color };
}

/**
 * Add the time since the last call to the sites that were being watched, then
 * note what is being watched now. Returns true if a daily limit just ran out.
 */
async function settle() {
  const now = Date.now();
  const st = await loadState();
  const { track } = await chrome.storage.session.get("track");
  const { insights, siteKinds } = await chrome.storage.local.get(["insights", "siteKinds"]);
  const tab = await frontTab();
  const url = tab?.url || null;
  // Time counts only while someone is there: at the start of the step and now.
  const here = countable(await chrome.idle.queryState(IDLE_SEC), tab?.audible || track?.audible);
  const add = track && here && !track.away ? Math.min(MAX_STEP_SEC, Math.max(0, (now - track.since) / 1000)) : 0;
  let crossed = false;

  if (track?.keys.length) {
    const usage = st.usage.key === todayKey() ? st.usage : { key: todayKey(), secs: {} };
    for (const key of track.keys) {
      const site = st.sites.find((s) => s.limit && siteKey(s) === key);
      if (!site) continue;
      const before = usage.secs[key] || 0;
      usage.secs[key] = Math.round((before + add) * 10) / 10;
      if (before < site.limit * 60 && usage.secs[key] >= site.limit * 60) crossed = true;
    }
    st.usage = usage;
    await chrome.storage.local.set({ usage });
  }

  const keys = watchedLimits(st, url);
  // Insights are recorded only after the user has turned them on.
  const site = insights?.on && url ? siteOf(hostOf(url)) : "";
  if (insights?.on) await recordActivity(track?.site || "", add, site, siteKinds || {});
  await showBadge(insights, siteKinds || {});
  if (keys.length || track?.keys.length || site || track?.site) await chrome.storage.session.set({ track: { keys, since: now, site, audible: !!tab?.audible, away: !here } });
  // Wake up at the moment the first of the watched limits runs out.
  const left = Math.min(...st.sites.filter((s) => keys.includes(siteKey(s))).map((s) => limitLeft(s, st.usage)));
  if (Number.isFinite(left) && left > 0) chrome.alarms.create(LIMIT_ALARM, { when: now + left * 1000 + 200 });
  return crossed;
}

// The address the tab was on rides along, so the blocked page can send the tab back when the block lifts.
function blockedPageUrl(name, url) {
  return chrome.runtime.getURL(`blocked/blocked.html?site=${encodeURIComponent(name)}&url=${encodeURIComponent(url)}`);
}

/** Redirect a tab to the blocked page if its URL is blocked right now. */
function kickIfBlocked(tabId, url, st) {
  if (!url || !/^https?:/.test(url)) return false;
  const hit = findBlock(url, st);
  if (hit) chrome.tabs.update(tabId, { url: blockedPageUrl(hit, url) });
  return !!hit;
}

// Sends any tab that lands on a blocked site to the blocked page. Covers
// navigations stopped by the block rule, and ones that never hit the network
// (back/forward cache restores, in-page SPA navigations).
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Also check when a load starts: pages served from cache or a site's own
  // service worker may never report a URL change or hit the block rule.
  const url = changeInfo.url || (changeInfo.status === "loading" ? tab?.url : null);
  if (!url || !/^https?:/.test(url)) return;
  if (!kickIfBlocked(tabId, url, await loadState()) && changeInfo.url) count();
});

// Chrome preloads pages typed in the address bar and swaps the preloaded tab in
// on Enter. That swap is a tab replacement, not a navigation, so check it too.
chrome.tabs.onReplaced.addListener(async (addedTabId) => {
  try {
    const tab = await chrome.tabs.get(addedTabId);
    kickIfBlocked(addedTabId, tab.url || tab.pendingUrl, await loadState());
  } catch (e) { console.warn(e); }
});

// Daily limits and insights count only the tab being looked at: follow tab and window switches.
chrome.tabs.onActivated.addListener(count);
chrome.windows.onFocusChanged.addListener(count);
// And only while someone is at the computer: note the moment they leave or come back.
chrome.idle.setDetectionInterval(IDLE_SEC);
chrome.idle.onStateChanged.addListener(count);

/**
 * Tick on whole minutes, so a schedule switches at its start/end time instead
 * of up to a minute late. Chrome won't fire an alarm sooner than 30 s from now,
 * so aim at the first whole minute that is at least that far away.
 */
function startTicking() {
  const when = Math.ceil((Date.now() + 31000) / 60000) * 60000;
  chrome.alarms.create(ALARM, { when, periodInMinutes: 1 });
  // If a whole minute comes up before that first alarm, catch it with a plain
  // timer: the worker is awake right now and stays awake that long.
  const next = Math.ceil(Date.now() / 60000) * 60000;
  if (next < when) setTimeout(sync, next - Date.now() + 20);
}

function boot() {
  chrome.runtime.setUninstallURL(`${UNINSTALL_URL}?v=${chrome.runtime.getManifest().version}`);
  startTicking();
  sync();
}
chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(boot);

// Safety net: if the tick alarm is ever missing when the worker wakes up, recreate it.
chrome.alarms.get(ALARM).then((a) => { if (!a) startTicking(); });

chrome.alarms.onAlarm.addListener((a) => {
  if ([ALARM, PASS_ALARM, FOCUS_ALARM, LIMIT_ALARM].includes(a.name)) sync();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.sites || changes.passes || changes.focus || changes.focusAllow) sync();
  else if (changes.insights || changes.siteKinds) count();
});
