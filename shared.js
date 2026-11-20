// Shared helpers used by background, popup and blocked page.

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "https://www.YouTube.com/watch?v=1" -> "youtube.com" ; returns "" if invalid */
export function normalizeDomain(input) {
  let s = String(input || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z]+:\/\//, ""); // protocol
  s = s.split(/[/?#]/)[0];           // path, query, hash
  s = s.split("@").pop();            // credentials
  s = s.replace(/:\d+$/, "");        // port
  s = s.replace(/^www\./, "");
  s = s.replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return "";
  return s;
}

/**
 * What a list entry blocks: a whole site, or one part of it.
 * "youtube.com/Shorts/" -> { domain: "youtube.com", path: "/shorts" } ; null if invalid
 */
export function parseTarget(input) {
  const raw = String(input || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "");
  const domain = normalizeDomain(raw);
  if (!domain) return null;
  const slash = raw.split(/[?#]/)[0].indexOf("/");
  const path = slash < 0 ? "" : raw.split(/[?#]/)[0].slice(slash).replace(/\/+$/, "");
  if (path && !/^(\/[a-z0-9._~%@+-]+)+$/.test(path)) return null;
  return { domain, path };
}

/** "youtube.com" or "youtube.com/shorts": the name of a list entry everywhere (rules, passes, stats). */
export const siteKey = (s) => s.domain + (s.path || "");

/** "09:30" -> 570 */
export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

/**
 * Is a site's block active at `now`?
 * site.schedule = null  -> always blocked
 * site.schedule = { days: [0..6], start: "09:00", end: "17:00" }
 * If start > end the window wraps past midnight (e.g. 22:00 -> 02:00);
 * the after-midnight part belongs to the previous day.
 */
export function isActive(site, now = new Date()) {
  if (!site.enabled) return false;
  const sch = site.schedule;
  if (!sch) return true;
  const days = sch.days || [];
  const start = toMinutes(sch.start);
  const end = toMinutes(sch.end);
  const cur = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  const yesterday = (today + 6) % 7;

  if (start === end) return days.includes(today); // whole day
  if (start < end) return days.includes(today) && cur >= start && cur < end;
  // overnight window
  return (days.includes(today) && cur >= start) || (days.includes(yesterday) && cur < end);
}

/** Does hostname belong to domain (exact or subdomain)? */
export function hostMatches(hostname, domain) {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  return h === domain || h.endsWith("." + domain);
}

export function describeSchedule(sch) {
  if (!sch) return "Always";
  const days = [...(sch.days || [])].sort();
  let d;
  const key = days.join(",");
  if (key === "0,1,2,3,4,5,6") d = "Every day";
  else if (key === "1,2,3,4,5") d = "Weekdays";
  else if (key === "0,6") d = "Weekends";
  else if (days.length === 0) d = "No days";
  else d = days.map((i) => DAY_LABELS[i]).join(" ");
  const time = sch.start === sch.end ? "all day" : `${sch.start}-${sch.end}`;
  return `${d}, ${time}`;
}

export function todayKey(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Does a URL (a URL object) fall under a list entry? A path entry covers the path and everything below it. */
export function urlMatches(u, site) {
  if (!hostMatches(u.hostname, site.domain)) return false;
  if (!site.path) return true;
  const p = u.pathname.toLowerCase();
  return p === site.path || p.startsWith(site.path + "/");
}

// --- state: { sites, passes, usage, focus, allow } as read by loadState() ---
export const STATE_KEYS = ["sites", "passes", "usage", "focus", "focusAllow"];

export async function loadState() {
  const s = await chrome.storage.local.get(STATE_KEYS);
  return { sites: s.sites || [], passes: s.passes || {}, usage: s.usage || {}, focus: s.focus || null, allow: s.focusAllow || [] };
}

/** focus = { until: timestamp, mode: "list" | "all", exitAt?: timestamp of a requested early end } */
export const FOCUS_EXIT_WAIT_SEC = 60;
export const focusEnd = (focus) => Math.min(focus.until, focus.exitAt || Infinity);
export const focusActive = (focus, now = new Date()) => !!focus && focusEnd(focus) > now.getTime();

/** Seconds of today's allowance already spent on a daily-limit site. usage = { key: "2026-01-31", secs: { siteKey: n } } */
export function usedSeconds(site, usage, now = new Date()) {
  return usage && usage.key === todayKey(now) ? (usage.secs || {})[siteKey(site)] || 0 : 0;
}

/** Seconds left today on a daily-limit site (site.limit is minutes a day). */
export function limitLeft(site, usage, now = new Date()) {
  return Math.max(0, site.limit * 60 - usedSeconds(site, usage, now));
}

/**
 * One word for where a list entry stands right now:
 * "focus" (blocked by a focus session), "paused", "pass" (wheel pass running),
 * "limit" (daily limit not used up yet), "idle" (outside its schedule) or "blocked".
 */
export function siteStatus(site, st, now = new Date()) {
  const pass = (st.passes[siteKey(site)] || 0) > now.getTime();
  if (focusActive(st.focus, now) && st.focus.mode === "list") return pass ? "pass" : "focus";
  if (!site.enabled) return "paused";
  const due = site.limit ? limitLeft(site, st.usage, now) <= 0 : isActive(site, now);
  if (!due) return site.limit ? "limit" : "idle";
  return pass ? "pass" : "blocked";
}

export const siteBlocked = (site, st, now = new Date()) => ["focus", "blocked"].includes(siteStatus(site, st, now));

/** Sites that stay open during a block-everything session: the allowed ones, plus any with a running wheel pass. */
export const focusOpenHosts = (st, now = new Date()) =>
  [...new Set([...st.allow, ...Object.keys(st.passes).filter((k) => st.passes[k] > now.getTime() && !k.includes("/"))])];

/** List entries blocked right now. */
export function blockedNow(st, now = new Date()) {
  return st.sites.filter((s) => siteBlocked(s, st, now));
}

/**
 * Is this address blocked right now? Returns the name to show on the blocked
 * page (a list entry, or the bare host during a block-everything focus session), or null.
 */
export function findBlock(url, st, now = new Date()) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const hit = st.sites.find((s) => siteBlocked(s, st, now) && urlMatches(u, s));
  if (hit) return siteKey(hit);
  if (focusActive(st.focus, now) && st.focus.mode === "all" && !focusOpenHosts(st, now).some((a) => hostMatches(u.hostname, a))) {
    return u.hostname.toLowerCase().replace(/^www\./, "");
  }
  return null;
}
