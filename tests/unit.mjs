// Unit tests for the pure modules behind Insights (no browser needed).
// usage: npm run test:unit
import { CATALOG, kindOf, siteOf } from "../extension/lib/categories.js";
import { PRESET_GROUPS } from "../extension/lib/presets.js";
import { addSpan, addTime, addVisit, badgeText, BADGE_COLOR, countable, fmt, hostOf, insights, lastDays, mood, MOOD_LEVEL, peakWindow, siteHours, spanText, suggestBlocks, suggestLimit, summarize } from "../extension/lib/insights.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const eq = (a, b, what = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, what) => { if (!c) throw new Error(`failed: ${what}`); };

// ---- categories ----
test("siteOf strips www and folds subdomains of a known site into the site", () => {
  eq(siteOf("www.reddit.com"), "reddit.com");
  eq(siteOf("m.youtube.com"), "youtube.com");
  eq(siteOf("old.reddit.com"), "reddit.com");
});
test("siteOf leaves an unknown host as it is", () => {
  eq(siteOf("blog.example.org"), "blog.example.org");
});
test("siteOf picks the most specific known site", () => {
  eq(siteOf("console.aws.amazon.com"), "aws.amazon.com");
  eq(siteOf("www.amazon.com"), "amazon.com");
  eq(siteOf("docs.google.com"), "docs.google.com");
});
test("kindOf: known sites are work or distraction, unknown ones neutral", () => {
  eq(kindOf("youtube.com"), "distraction");
  eq(kindOf("docs.google.com"), "work");
  eq(kindOf("aws.amazon.com"), "work");
  eq(kindOf("amazon.com"), "distraction");
  eq(kindOf("blog.example.org"), "neutral");
});
test("kindOf: the user's own choice for a site wins", () => {
  eq(kindOf("youtube.com", { "youtube.com": "work" }), "work");
  eq(kindOf("blog.example.org", { "blog.example.org": "distraction" }), "distraction");
});
test("every Quick add site counts as a distraction", () => {
  const domains = PRESET_GROUPS.flatMap((g) => g.items).flatMap((p) => p.domains).filter((d) => !d.includes("/"));
  for (const d of domains) eq(kindOf(siteOf(d)), "distraction", d);
  ok(Object.keys(CATALOG).length > domains.length, "catalog also has work sites");
});

// ---- recording ----
test("hostOf: only web pages are tracked", () => {
  eq(hostOf("https://www.Example.com/a?b=1"), "example.com");
  eq(hostOf("http://localhost:3000/x"), "localhost");
  eq(hostOf("chrome://extensions"), "");
  eq(hostOf("chrome-extension://abc/popup/popup.html"), "");
  eq(hostOf("about:blank"), "");
  eq(hostOf(undefined), "");
});
test("addTime adds seconds to the site and to the hour, by kind", () => {
  const day = {};
  addTime(day, "youtube.com", "distraction", 30, 22);
  addTime(day, "youtube.com", "distraction", 12.5, 22);
  addTime(day, "docs.google.com", "work", 60, 9);
  eq(day.s, { "youtube.com": 42.5, "docs.google.com": 60 });
  eq(day.h, { 22: [0, 42.5, 0], 9: [60, 0, 0] });
});
test("addVisit counts how many times a site was opened", () => {
  const day = {};
  addVisit(day, "reddit.com"); addVisit(day, "reddit.com"); addVisit(day, "x.com");
  eq(day.v, { "reddit.com": 2, "x.com": 1 });
});
test("countable: time counts only while someone is there", () => {
  eq(countable("active", false), true, "using the computer");
  eq(countable("idle", true), true, "no input, but the tab in front plays sound (a video)");
  eq(countable("idle", false), false, "no input and no sound: nobody is there");
  eq(countable("locked", true), false, "a locked screen never counts");
  eq(countable("locked", false), false);
});
test("lastDays lists day keys, oldest first, ending today", () => {
  eq(lastDays(3, new Date(2026, 10, 21, 15)), ["2026-11-19", "2026-11-20", "2026-11-21"]);
  eq(lastDays(2, new Date(2026, 0, 1, 0, 5)), ["2025-12-31", "2026-01-01"]);
});

// ---- summary ----
const DAYS = {
  "2026-11-20": { s: { "youtube.com": 3600, "docs.google.com": 7200, "blog.example.org": 600 }, v: { "youtube.com": 4 }, h: { 22: [0, 3000, 0], 23: [0, 600, 0], 10: [7200, 0, 600] } },
  "2026-11-21": { s: { "youtube.com": 1800, "reddit.com": 900 }, v: { "youtube.com": 2, "reddit.com": 9 }, h: { 22: [0, 2700, 0] } },
};
test("summarize adds up a period by kind", () => {
  const s = summarize(DAYS, ["2026-11-20", "2026-11-21"]);
  eq(s.total, 14100);
  eq(s.byKind, { work: 7200, distraction: 6300, neutral: 600 });
  eq(s.days, 2);
});
test("summarize lists sites by time, with visits and kind", () => {
  const s = summarize(DAYS, ["2026-11-20", "2026-11-21"]);
  eq(s.sites.map((x) => x.site), ["docs.google.com", "youtube.com", "reddit.com", "blog.example.org"]);
  eq(s.sites[1], { site: "youtube.com", secs: 5400, visits: 6, kind: "distraction" });
});
test("summarize gives one row per day, also for days with no data", () => {
  const s = summarize(DAYS, ["2026-11-19", "2026-11-20", "2026-11-21"]);
  eq(s.perDay, [
    { key: "2026-11-19", work: 0, distraction: 0, neutral: 0 },
    { key: "2026-11-20", work: 7200, distraction: 3600, neutral: 600 },
    { key: "2026-11-21", work: 0, distraction: 2700, neutral: 0 },
  ]);
  eq(s.days, 2, "days with data");
});
test("summarize gives distraction seconds for each hour of the day", () => {
  const s = summarize(DAYS, ["2026-11-20", "2026-11-21"]);
  eq(s.hours.length, 24);
  eq(s.hours[22], 5700); eq(s.hours[23], 600); eq(s.hours[10], 0);
});
test("summarize follows the user's own choice of kind", () => {
  const s = summarize(DAYS, ["2026-11-20", "2026-11-21"], { "youtube.com": "work" });
  eq(s.byKind, { work: 12600, distraction: 900, neutral: 600 });
});

// ---- advice ----
test("suggestLimit proposes clearly less than the current daily average", () => {
  eq(suggestLimit(100), 60);
  eq(suggestLimit(50), 30);
  eq(suggestLimit(25), 15);
  eq(suggestLimit(200), 120);
  eq(suggestLimit(400), 180);
});
test("mood follows today's distraction time", () => {
  eq(mood(0), "calm");
  eq(mood(20 * 60), "calm");
  eq(mood(45 * 60), "watching");
  eq(mood(100 * 60), "annoyed");
  eq(mood(200 * 60), "furious");
});
test("badgeText fits today's distraction time in the 4 characters of the toolbar badge", () => {
  eq(badgeText(0), "0m");
  eq(badgeText(59), "0m");
  eq(badgeText(25 * 60 + 40), "25m");
  eq(badgeText(100 * 60), "1h40");
  eq(badgeText(125 * 60), "2h05");
  eq(badgeText(120 * 60), "2h");
  eq(badgeText(12 * 3600 + 30 * 60), "12h");
});
test("every mood has a badge color", () => {
  for (const m of Object.keys(MOOD_LEVEL)) ok(/^#[0-9a-f]{6}$/.test(BADGE_COLOR[m]), m);
});
test("moods are ordered from calm to furious", () => {
  ok(MOOD_LEVEL.calm < MOOD_LEVEL.watching && MOOD_LEVEL.watching < MOOD_LEVEL.annoyed && MOOD_LEVEL.annoyed < MOOD_LEVEL.furious, "order");
});
test("fmt writes durations the short way", () => {
  eq(fmt(0), "0m"); eq(fmt(40), "<1m"); eq(fmt(59 * 60), "59m"); eq(fmt(3600), "1h"); eq(fmt(2 * 3600 + 5 * 60), "2h 5m");
});
test("insights: with almost no data it only says so", () => {
  const out = insights(summarize({}, ["2026-11-21"]), null);
  eq(out.map((i) => i.id), ["empty"]);
});
test("insights: names the top distraction, without an action (actions live in the suggestions)", () => {
  const keys = lastDays(7, new Date(2026, 10, 21));
  const days = Object.fromEntries(keys.map((k) => [k, { s: { "youtube.com": 100 * 60, "docs.google.com": 3600 }, v: {}, h: { 22: [0, 6000, 0], 10: [3600, 0, 0] } }]));
  const top = insights(summarize(days, keys), null).find((i) => i.id === "top");
  ok(top, "top insight exists");
  ok(top.text.includes("youtube.com"), "names the site");
  eq(top.action, undefined);
});
test("insights: compares distraction time with the period before", () => {
  const cur = summarize({ a: { s: { "youtube.com": 6000 } } }, ["a"]);
  const prev = summarize({ b: { s: { "youtube.com": 3000 } } }, ["b"]);
  const t = insights(cur, prev).find((i) => i.id === "trend");
  ok(t && /100%/.test(t.text) && t.tone === "bad", "says it doubled");
  const t2 = insights(prev, cur).find((i) => i.id === "trend");
  ok(t2 && /50%/.test(t2.text) && t2.tone === "good", "says it halved");
});
test("insights: points at the hours where most distraction happens", () => {
  const keys = lastDays(7, new Date(2026, 10, 21));
  const days = Object.fromEntries(keys.map((k) => [k, { s: { "youtube.com": 4000 }, v: {}, h: { 22: [0, 2000, 0], 23: [0, 1500, 0], 14: [0, 500, 0] } }]));
  const p = insights(summarize(days, keys), null).find((i) => i.id === "peak");
  ok(p && p.text.includes("22:00") && p.text.includes("00:00"), `names the window, got: ${p && p.text}`);
});
test("insights: mentions a site that was opened very often", () => {
  const cur = summarize({ a: { s: { "reddit.com": 1800 }, v: { "reddit.com": 40 } } }, ["a"]);
  const o = insights(cur, null).find((i) => i.id === "opens");
  ok(o && o.text.includes("reddit.com") && o.text.includes("40"), "names site and count");
});

// ---- when a site is used ----
test("addSpan keeps the minutes of the day a site was used, joining steps that follow each other", () => {
  const day = {};
  addSpan(day, "youtube.com", 600.2, 601.1);   // 10:00 to 10:01
  addSpan(day, "youtube.com", 601.1, 602.5);   // next step: joins
  addSpan(day, "youtube.com", 602.9, 603.4);   // less than a minute later: joins
  addSpan(day, "youtube.com", 700, 705);       // much later: a new range
  addSpan(day, "x.com", 610, 611);
  eq(day.t, { "youtube.com": [[600, 604], [700, 705]], "x.com": [[610, 611]] });
});
test("addSpan starts at midnight when a step began the day before", () => {
  const day = {};
  addSpan(day, "youtube.com", -2, 1.5);
  eq(day.t["youtube.com"], [[0, 2]]);
});
test("addSpan keeps a day small: past 48 ranges for a site, the last one grows", () => {
  const day = {};
  for (let i = 0; i < 60; i++) addSpan(day, "x.com", i * 10, i * 10 + 2);
  eq(day.t["x.com"].length, 48);
  eq(day.t["x.com"][47], [470, 592]);
});
test("siteHours spreads the ranges of a period over the 24 hours, in minutes", () => {
  const days = {
    a: { t: { "youtube.com": [[1310, 1340]], "x.com": [[60, 90]] } },   // 21:50 to 22:20
    b: { t: { "youtube.com": [[1320, 1380]] } },                        // 22:00 to 23:00
  };
  const h = siteHours(days, ["a", "b"]);
  eq(h["youtube.com"][21], 10);
  eq(h["youtube.com"][22], 80);
  eq(h["youtube.com"][23], 0);
  eq(h["x.com"][1], 30);
  eq(siteHours({ c: { s: { "old.test": 5 } } }, ["c"]), {}, "days recorded before ranges existed give nothing");
});
const hoursWith = (o) => { const h = new Array(24).fill(0); for (const [k, v] of Object.entries(o)) h[k] = v; return h; };
test("peakWindow finds the shortest stretch of up to 3 hours that holds at least 75% of the use", () => {
  eq(peakWindow(hoursWith({ 22: 50, 23: 40, 9: 10 })), { start: "22:00", end: "00:00", share: 0.9 });
  eq(peakWindow(hoursWith({ 14: 80, 9: 20 })), { start: "14:00", end: "15:00", share: 0.8 });
  eq(peakWindow(hoursWith({ 22: 60, 23: 40 })), { start: "22:00", end: "00:00", share: 1 }, "60% in one hour is not enough: the block would miss the rest");
  eq(peakWindow(hoursWith({ 23: 40, 0: 30, 1: 20, 12: 10 })), { start: "23:00", end: "02:00", share: 0.9 }, "wraps past midnight");
  eq(peakWindow(hoursWith({ 8: 10, 11: 10, 14: 10, 17: 10, 20: 10 })), null, "spread through the day");
  eq(peakWindow(new Array(24).fill(0)), null, "no data");
});
test("spanText lists today's ranges, the longest few in time order", () => {
  eq(spanText([[552, 580], [1265, 1390]]), "09:12-09:40, 21:05-23:10");
  eq(spanText([[0, 10], [100, 102], [200, 260], [300, 400], [500, 501]]), "00:00-00:10, 03:20-04:20, 05:00-06:40 +2 more");
  eq(spanText([[1430, 1440]]), "23:50-00:00");
  eq(spanText([]), "");
});

// ---- suggested blocks ----
const period = (sites, n = 7) => ({ days: n, sites });
const flat = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hoursWith(v)]));
test("suggestBlocks: a site checked often for a moment at a time gets a block", () => {
  const cur = period([{ site: "x.com", secs: 7 * 30 * 60, visits: 7 * 20, kind: "distraction" }]);
  const [s] = suggestBlocks(cur, {}, []);
  eq(s.site, "x.com");
  eq(s.actions, [{ type: "block", site: "x.com" }, { type: "limit", site: "x.com", minutes: 15 }]);
  ok(s.text.includes("20 times a day"), s.text);
});
test("suggestBlocks: a site used mostly at the same hours gets a block for those hours", () => {
  const cur = period([{ site: "youtube.com", secs: 7 * 100 * 60, visits: 7 * 4, kind: "distraction" }]);
  const [s] = suggestBlocks(cur, flat({ "youtube.com": { 22: 400, 23: 300 } }), []);
  eq(s.actions[0], { type: "schedule", site: "youtube.com", start: "22:00", end: "00:00" });
  eq(s.actions[1], { type: "limit", site: "youtube.com", minutes: 60 });
  ok(s.text.includes("22:00") && s.text.includes("1h 40m"), s.text);
});
test("suggestBlocks: a heavy site with no clear hours gets a daily limit", () => {
  const cur = period([{ site: "reddit.com", secs: 7 * 50 * 60, visits: 7 * 3, kind: "distraction" }]);
  const [s] = suggestBlocks(cur, flat({ "reddit.com": { 8: 50, 12: 50, 16: 50, 20: 50 } }), []);
  eq(s.actions, [{ type: "limit", site: "reddit.com", minutes: 30 }, { type: "block", site: "reddit.com" }]);
});
test("suggestBlocks: skips work sites, sites already on the list and small ones, biggest first, at most 4", () => {
  const big = (site, min, kind = "distraction") => ({ site, secs: 7 * min * 60, visits: 7, kind });
  const cur = period([big("a.com", 90), big("docs.google.com", 300, "work"), big("b.com", 80), big("c.com", 70), big("d.com", 60), big("e.com", 50), big("f.com", 40), big("tiny.com", 5)]);
  eq(suggestBlocks(cur, {}, ["b.com"]).map((s) => s.site), ["a.com", "c.com", "d.com", "e.com"]);
  eq(suggestBlocks(period([big("tiny.com", 5)]), {}, []), []);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}
console.log(`\n${tests.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
