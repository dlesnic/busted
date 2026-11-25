// Insights: where browsing time goes. Pure functions, no browser APIs.
//
// One record per day, stored under "act:<YYYY-MM-DD>" in chrome.storage.local:
//   { s: { site: seconds }, v: { site: times opened }, h: { hour: [work, distraction, neutral] seconds },
//     t: { site: [[from, to], ...] } minutes of the day the site was in front }
// Only the site name is kept (for example "youtube.com"): never a full address, a page title or a search.

import { kindOf } from "./categories.js";
import { todayKey } from "./shared.js";

export const DAY_PREFIX = "act:";
export const KEEP_DAYS = 90;
const KIND_INDEX = { work: 0, distraction: 1, neutral: 2 };
const round1 = (n) => Math.round(n * 10) / 10;

/** The host a web address is counted under, without "www."; "" for anything that is not a web page. */
export function hostOf(url) {
  let u;
  try { u = new URL(url); } catch { return ""; }
  if (!/^https?:$/.test(u.protocol)) return "";
  return u.hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Does time count right now? state is Chrome's idle check: "active", "idle" (no keyboard or mouse for a
 * while) or "locked". Someone watching a video gives no input, so a tab that plays sound still counts.
 */
export function countable(state, audible) {
  return state === "active" || (state === "idle" && !!audible);
}

/** Add seconds spent on a site to a day record. */
export function addTime(day, site, kind, secs, hour) {
  day.s ||= {};
  day.s[site] = round1((day.s[site] || 0) + secs);
  day.h ||= {};
  const row = day.h[hour] || [0, 0, 0];
  row[KIND_INDEX[kind]] = round1(row[KIND_INDEX[kind]] + secs);
  day.h[hour] = row;
  return day;
}

/** Count one more time a site was opened or switched to. */
export function addVisit(day, site) {
  day.v ||= {};
  day.v[site] = (day.v[site] || 0) + 1;
  return day;
}

const MAX_SPANS = 48;
const hh = (h) => `${String(h % 24).padStart(2, "0")}:00`;

/**
 * Note that a site was in front from minute `from` to minute `to` of the day (fractions allowed).
 * A range that starts within a minute of the previous one's end joins it.
 */
export function addSpan(day, site, from, to) {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(1440, Math.ceil(to));
  if (b <= a) return day;
  day.t ||= {};
  const list = (day.t[site] ||= []);
  const last = list[list.length - 1];
  if (last && (a <= last[1] + 1 || list.length >= MAX_SPANS)) last[1] = Math.max(last[1], b);
  else list.push([a, b]);
  return day;
}

/** Minutes each site was in front in each hour of the day, over a period: { site: [24 numbers] }. */
export function siteHours(days, keys) {
  const out = {};
  for (const key of keys) {
    for (const [site, spans] of Object.entries(days[key]?.t || {})) {
      const row = (out[site] ||= new Array(24).fill(0));
      for (const [a, b] of spans) {
        for (let h = Math.floor(a / 60); h * 60 < b && h < 24; h++) row[h] += Math.min(b, h * 60 + 60) - Math.max(a, h * 60);
      }
    }
  }
  return out;
}

/** The shortest stretch of 1 to 3 hours that holds at least 75% of the use, or null when use is spread out. */
export function peakWindow(hours) {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  for (let len = 1; len <= 3; len++) {
    let best = 0, start = 0;
    for (let h = 0; h < 24; h++) {
      let w = 0;
      for (let i = 0; i < len; i++) w += hours[(h + i) % 24];
      if (w > best) { best = w; start = h; }
    }
    if (best / total >= 0.75) return { start: hh(start), end: hh(start + len), share: Math.round((best / total) * 100) / 100 };
  }
  return null;
}

const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Today's ranges as text: the three longest, in time order, then how many more. */
export function spanText(spans = []) {
  const top = [...spans].sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).slice(0, 3).sort((x, y) => x[0] - y[0]);
  const more = spans.length - top.length;
  return top.map(([a, b]) => `${hm(a)}-${hm(b)}`).join(", ") + (more > 0 ? ` +${more} more` : "");
}

/** The last n day keys, oldest first, ending with today. */
export function lastDays(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(todayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12)));
  return out;
}

/**
 * Add up a period.
 * days = { dayKey: record }, keys = the day keys of the period, overrides = { site: kind } chosen by the user.
 */
export function summarize(days, keys, overrides = {}) {
  const byKind = { work: 0, distraction: 0, neutral: 0 };
  const sites = {};
  const hours = new Array(24).fill(0);
  const perDay = [];
  let withData = 0;

  for (const key of keys) {
    const rec = days[key] || {};
    const row = { key, work: 0, distraction: 0, neutral: 0 };
    for (const [site, secs] of Object.entries(rec.s || {})) {
      const kind = kindOf(site, overrides);
      row[kind] += secs;
      (sites[site] ||= { site, secs: 0, visits: 0, kind }).secs += secs;
    }
    for (const [site, n] of Object.entries(rec.v || {})) {
      (sites[site] ||= { site, secs: 0, visits: 0, kind: kindOf(site, overrides) }).visits += n;
    }
    for (const [hour, r] of Object.entries(rec.h || {})) hours[hour] += r[KIND_INDEX.distraction];
    for (const k of Object.keys(byKind)) { row[k] = round1(row[k]); byKind[k] = round1(byKind[k] + row[k]); }
    if (row.work + row.distraction + row.neutral > 0) withData++;
    perDay.push(row);
  }

  const list = Object.values(sites).map((s) => ({ ...s, secs: round1(s.secs) })).sort((a, b) => b.secs - a.secs);
  return { total: round1(byKind.work + byKind.distraction + byKind.neutral), byKind, days: withData, sites: list, perDay, hours: hours.map(round1) };
}

/** A daily limit, in minutes, clearly below what the site takes now. */
export function suggestLimit(avgMinutes) {
  const steps = [15, 30, 45, 60, 90, 120, 180];
  return steps.filter((s) => s <= avgMinutes * 0.65).pop() || steps[0];
}

export const MOOD_LEVEL = { calm: 0, watching: 1, annoyed: 2, furious: 3 };
/** What Hoot says in each mood: [short line, follow-up]. */
export const MOOD_LINES = {
  calm: ["Nothing to see here.", "Suspicious."],
  watching: ["I am watching.", "Carry on. Carefully."],
  annoyed: ["That much? Really?", "Close a tab or two."],
  furious: ["Enough.", "Close the tab. Go outside."],
};

/** The toolbar badge color for each mood: green while it is fine, red when it is not. */
export const BADGE_COLOR = { calm: "#3ddc97", watching: "#7c5cff", annoyed: "#ff5c8a", furious: "#ff3b5c" };

/** Today's distraction time in the 4 characters a toolbar badge fits: "25m", "1h40", "2h", "12h". */
export function badgeText(secs) {
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h >= 10 || !r) return `${h}h`;
  return `${h}h${String(r).padStart(2, "0")}`;
}

/** Hoot's mood from today's time on distracting sites. */
export function mood(distractionSecs) {
  const m = distractionSecs / 60;
  return m < 30 ? "calm" : m < 90 ? "watching" : m < 180 ? "annoyed" : "furious";
}

/** 7500 -> "2h 5m" */
export function fmt(secs) {
  if (secs <= 0) return "0m";
  if (secs < 60) return "<1m";
  const m = Math.round(secs / 60);
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
}


/**
 * What stands out in a period, as short cards: { id, tone: "good" | "bad" | "info", title, text }.
 * cur, prev = summarize() of this period and the one before it (prev may be null).
 * What to do about it is in suggestBlocks().
 */
export function insights(cur, prev) {
  if (cur.total < 600) {
    return [{ id: "empty", tone: "info", title: "Not enough data yet", text: "Browse as usual. The first numbers show up after about ten minutes of use." }];
  }
  const out = [];
  const days = Math.max(1, cur.days);
  const dis = cur.byKind.distraction;

  if (prev && prev.byKind.distraction >= 600) {
    const change = (dis - prev.byKind.distraction) / prev.byKind.distraction;
    if (Math.abs(change) >= 0.1) {
      const pct = Math.round(Math.abs(change) * 100);
      out.push(change > 0
        ? { id: "trend", tone: "bad", title: "More time on distractions", text: `Distracting sites took ${pct}% more time than the period before: ${fmt(dis)} against ${fmt(prev.byKind.distraction)}.` }
        : { id: "trend", tone: "good", title: "Less time on distractions", text: `Distracting sites took ${pct}% less time than the period before: ${fmt(dis)} against ${fmt(prev.byKind.distraction)}.` });
    }
  }

  const top = cur.sites.find((s) => s.kind === "distraction");
  if (top && top.secs / days >= 20 * 60) {
    out.push({ id: "top", tone: "bad", title: `${top.site} is your biggest distraction`, text: `${top.site} takes ${fmt(top.secs / days)} a day on average, ${fmt(top.secs)} in this period.` });
  }

  // The two hours in a row with the most distraction, wrapping past midnight.
  const totalHours = cur.hours.reduce((a, b) => a + b, 0);
  if (totalHours >= 1800) {
    let best = 0, start = 0;
    for (let h = 0; h < 24; h++) {
      const w = cur.hours[h] + cur.hours[(h + 1) % 24];
      if (w > best) { best = w; start = h; }
    }
    const share = best / totalHours;
    if (share >= 0.35) {
      out.push({ id: "peak", tone: "info", title: "Your drift hours", text: `Most of it happens between ${hh(start)} and ${hh(start + 2)}: ${Math.round(share * 100)}% of your distracting time.` });
    }
  }

  const opened = [...cur.sites].sort((a, b) => b.visits - a.visits)[0];
  if (opened && opened.visits / days >= 15) {
    out.push({ id: "opens", tone: "info", title: "A habit more than a visit", text: `You opened ${opened.site} ${opened.visits} times, about ${Math.round(opened.visits / days)} a day.` });
  }

  if (cur.byKind.work >= cur.total * 0.5) {
    out.push({ id: "split", tone: "good", title: "Mostly work", text: `Work sites got ${fmt(cur.byKind.work)}, ${Math.round(cur.byKind.work / cur.total * 100)}% of your browsing.` });
  }
  return out;
}

/**
 * Blocks worth adding, one per distracting site that is not on the block list yet, biggest first, at most 4.
 * Each is { site, title, text, actions: [first choice, alternative] }, with actions of the form
 * { type: "block" | "limit" | "schedule", site, minutes?, start?, end? }.
 * cur = summarize() of the period, hours = siteHours() of the same period, managed = sites already on the list.
 */
export function suggestBlocks(cur, hours, managed = []) {
  const days = Math.max(1, cur.days);
  const out = [];
  for (const s of cur.sites) {
    if (s.kind !== "distraction" || managed.includes(s.site)) continue;
    const perDay = s.secs / days;
    const opens = s.visits / days;
    const block = { type: "block", site: s.site };
    const limit = { type: "limit", site: s.site, minutes: suggestLimit(perDay / 60) };
    const win = hours[s.site] ? peakWindow(hours[s.site]) : null;
    if (opens >= 10 && s.visits && s.secs / s.visits <= 180) {
      out.push({ site: s.site, title: "A checking habit", text: `You open ${s.site} about ${Math.round(opens)} times a day, ${fmt(s.secs / s.visits)} at a time. Short checks that add up to ${fmt(perDay)} a day.`, actions: [block, limit] });
    } else if (win && perDay >= 15 * 60) {
      out.push({ site: s.site, title: `Mostly ${win.start}-${win.end}`, text: `${s.site} takes ${fmt(perDay)} a day, ${Math.round(win.share * 100)}% of it between ${win.start} and ${win.end}.`, actions: [{ type: "schedule", site: s.site, start: win.start, end: win.end }, limit] });
    } else if (perDay >= 30 * 60) {
      out.push({ site: s.site, title: `${fmt(perDay)} a day`, text: `${s.site} takes ${fmt(perDay)} a day, spread through the day.`, actions: [limit, block] });
    }
    if (out.length === 4) break;
  }
  return out;
}
