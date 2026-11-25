// The Insights page. Everything shown here is read from chrome.storage.local in this browser.
import { KINDS, KIND_LABEL, kindOf } from "../lib/categories.js";
import { DAY_PREFIX, fmt, insights, lastDays, mood, MOOD_LINES, peakWindow, siteHours, spanText, suggestBlocks, summarize } from "../lib/insights.js";
import { PRESET_ICON } from "../lib/presets.js";
import { DAY_LABELS, describeSchedule, focusActive, todayKey } from "../lib/shared.js";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const SHOW_SITES = 12;

let range = 7;          // days shown: 1, 7 or 30
let showAll = false;    // the whole site list, not just the top ones
let wipeArmed = false;  // "Delete all data" needs a second click
let data = { days: {}, kinds: {}, settings: {}, sites: [], focus: null };

const MOOD = MOOD_LINES;

async function load() {
  const all = await chrome.storage.local.get(null);
  data = {
    days: Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(DAY_PREFIX)).map(([k, v]) => [k.slice(DAY_PREFIX.length), v])),
    kinds: all.siteKinds || {},
    settings: all.insights || {},
    sites: all.sites || [],
    focus: all.focus || null,
  };
  render();
}

function faviconUrl(site) {
  if (PRESET_ICON[site]) return PRESET_ICON[site];
  const u = new URL(chrome.runtime.getURL("/_favicon/"));
  u.searchParams.set("pageUrl", `https://${site}`);
  u.searchParams.set("size", "32");
  return u.toString();
}

const pct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}% of your time` : "");

function render() {
  const started = !!data.settings.since;       // Insights were turned on at some point
  $("#off").hidden = started;
  $("#board").hidden = !started;
  $("#foot").hidden = !started;
  $("#range").hidden = !started;
  if (started) renderBoard();
  document.body.dataset.ready = "1";
}

function renderBoard() {
  const now = new Date();
  const keys = lastDays(range, now);
  const before = lastDays(range * 2, now).slice(0, range);
  const cur = summarize(data.days, keys, data.kinds);
  const prev = summarize(data.days, before, data.kinds);
  const today = summarize(data.days, [todayKey(now)], data.kinds);

  for (const b of $("#range").children) b.classList.toggle("on", +b.dataset.range === range);

  // Hoot reacts to today, whatever period is shown.
  const m = mood(today.byKind.distraction);
  $("#hoot").className = `mood-${m}`;
  $("#mood-line").textContent = data.settings.on ? MOOD[m][0] : "Recording is paused.";
  $("#mood-sub").textContent = data.settings.on ? `${fmt(today.byKind.distraction)} on distractions today. ${MOOD[m][1]}` : "I see nothing. For now.";

  $("#k-total").textContent = fmt(cur.total);
  $("#k-work").textContent = fmt(cur.byKind.work);
  $("#k-distraction").textContent = fmt(cur.byKind.distraction);
  $("#k-total-sub").textContent = range === 1 ? "today" : `${fmt(cur.total / Math.max(1, cur.days))} a day`;
  $("#k-work-sub").textContent = pct(cur.byKind.work, cur.total);
  $("#k-distraction-sub").textContent = pct(cur.byKind.distraction, cur.total);

  renderChart(range === 1 ? summarize(data.days, lastDays(7, now), data.kinds) : cur, todayKey(now));
  renderHours(cur);
  const hours = siteHours(data.days, keys);
  renderCards(cur, prev);
  renderSuggest(cur, hours);
  renderSites(cur, hours, range === 1 ? data.days[todayKey(now)]?.t || {} : null);

  $("#pause").textContent = data.settings.on ? "Pause recording" : "Resume recording";
  $("#wipe").textContent = wipeArmed ? "Click again to delete everything" : "Delete all data";
}

function renderChart(sum, today) {
  const box = $("#chart");
  box.textContent = "";
  box.classList.toggle("many", sum.perDay.length > 10);
  const max = Math.max(1, ...sum.perDay.map((d) => d.work + d.distraction + d.neutral));
  $("#chart-max").textContent = max > 1 ? `longest day ${fmt(max)}` : "";
  for (const d of sum.perDay) {
    const [y, mo, da] = d.key.split("-").map(Number);
    const date = new Date(y, mo - 1, da);
    const col = el("div", "day" + (d.key === today ? " today" : ""));
    col.title = `${DAY_LABELS[date.getDay()]} ${da}.${mo}: work ${fmt(d.work)}, distractions ${fmt(d.distraction)}, neutral ${fmt(d.neutral)}`;
    const bar = el("div", "bar");
    for (const [k, cls] of [["neutral", "n"], ["distraction", "d"], ["work", "w"]]) {
      const seg = el("i", cls);
      seg.style.height = `${(d[k] / max) * 100}%`;
      bar.appendChild(seg);
    }
    col.append(bar, el("span", "", sum.perDay.length > 10 ? String(da) : DAY_LABELS[date.getDay()]));
    box.appendChild(col);
  }
}

function renderHours(sum) {
  const box = $("#hours");
  box.textContent = "";
  const max = Math.max(...sum.hours);
  sum.hours.forEach((secs, h) => {
    const cell = el("i");
    cell.style.opacity = max > 0 ? String(0.08 + 0.92 * (secs / max)) : "0.08";
    cell.title = `${String(h).padStart(2, "0")}:00 to ${String(h + 1).padStart(2, "0")}:00, ${fmt(secs)}`;
    box.appendChild(cell);
  });
  $("#hours-note").textContent = max > 0 ? "Darker means more time on distracting sites in that hour." : "No distraction time in this period.";
}

function renderCards(cur, prev) {
  const box = $("#cards");
  box.textContent = "";
  for (const c of insights(cur, prev)) {
    const card = el("div", `card ${c.tone}`);
    card.dataset.id = c.id;
    card.append(el("h3", "", c.title), el("p", "", c.text));
    const s = c.id === "top" && data.sites.find((x) => c.title.startsWith(x.domain + " "));
    if (s) card.appendChild(el("p", "done", `On your list: ${ruleText(s).toLowerCase()}.`));
    box.appendChild(card);
  }
}

const ACTION_LABEL = {
  block: () => "Block it",
  limit: (a) => `Limit to ${a.minutes} min a day`,
  schedule: (a) => `Block ${a.start}-${a.end} every day`,
};

function actionButton(action, cls) {
  const b = el("button", cls, ACTION_LABEL[action.type](action));
  b.type = "button";
  b.addEventListener("click", () => apply(action));
  return b;
}

/** Blocks worth adding, with a first choice and an alternative each. */
function renderSuggest(cur, hours) {
  const box = $("#suggest");
  box.textContent = "";
  const list = suggestBlocks(cur, hours, data.sites.filter((s) => !s.path).map((s) => s.domain));
  $("#suggest-box").hidden = !list.length;
  for (const sg of list) {
    const card = el("div", "sugg");
    card.dataset.site = sg.site;
    const head = el("div", "sugg-head");
    const img = el("img", "fav"); img.alt = ""; img.src = faviconUrl(sg.site);
    head.append(img, el("b", "", sg.site), el("span", "tag", sg.title));
    card.append(head, el("p", "", sg.text));
    const acts = el("div", "acts");
    sg.actions.forEach((a, i) => acts.appendChild(actionButton(a, i ? "act alt" : "act")));
    card.appendChild(acts);
    box.appendChild(card);
  }
}

/** The list entry that covers a whole site, if any. */
const ruleFor = (site) => data.sites.find((s) => s.domain === site && !s.path);

function ruleText(s) {
  if (!s.enabled) return "Paused";
  if (s.limit) return `Limit ${s.limit} min a day`;
  if (!s.schedule) return "Blocked";
  return `Blocked ${s.schedule.start}-${s.schedule.end}`;
}

const LIMITS = [15, 30, 45, 60, 90, 120];

/**
 * One row per site: what it is, when it is used, how long, and buttons to block or limit it.
 * hours = siteHours() of the period; todaySpans = today's ranges when only today is shown, else null.
 */
function renderSites(sum, hours, todaySpans) {
  const box = $("#sites");
  box.textContent = "";
  const rows = sum.sites.filter((s) => s.secs >= 1);
  const locked = focusActive(data.focus);
  const max = rows[0]?.secs || 1;
  for (const s of showAll ? rows : rows.slice(0, SHOW_SITES)) {
    const row = el("div", `site-row ${s.kind}`);
    row.dataset.site = s.site;
    const img = el("img", "fav"); img.alt = ""; img.loading = "lazy"; img.src = faviconUrl(s.site);

    const h = hours[s.site];
    let when = "";
    if (todaySpans) when = spanText(todaySpans[s.site]);
    else if (h) { const w = peakWindow(h); when = w ? `mostly ${w.start}-${w.end}` : "spread through the day"; }
    const who = el("div", "who");
    const whenEl = el("span", "when muted");
    whenEl.title = when;
    // Each range stays on one line; the list may wrap between ranges.
    when.split(", ").forEach((part, i) => { if (i) whenEl.append(", "); whenEl.appendChild(el("span", "rng", part)); });
    who.append(el("span", "name", s.site), whenEl);

    const track = el("div", "track"); const fill = el("i"); fill.style.width = `${(s.secs / max) * 100}%`; track.appendChild(fill);

    const sel = el("select", "kind");
    sel.title = "What kind of site is this?";
    for (const k of KINDS) { const o = el("option", "", KIND_LABEL[k]); o.value = k; sel.appendChild(o); }
    sel.value = s.kind;
    sel.addEventListener("change", () => setKind(s.site, sel.value));

    row.append(img, who, track, el("span", "time", fmt(s.secs)), el("span", "opens muted", s.visits ? `${s.visits} opens` : ""), sel, siteActions(s.site, locked));
    box.appendChild(row);
  }
  if (!rows.length) box.appendChild(el("p", "muted", "No sites in this period yet."));
  $("#more").hidden = showAll || rows.length <= SHOW_SITES;
}

/** Block or limit a site from its row, or show the rule it already has. */
function siteActions(site, locked) {
  const box = el("div", "acts");
  const rule = ruleFor(site);
  if (rule) {
    const tag = el("span", "rule", ruleText(rule));
    tag.title = rule.limit ? "" : describeSchedule(rule.schedule);
    box.appendChild(tag);
    if (locked) { const l = el("span", "lock muted", "locked while focusing"); box.appendChild(l); }
    else {
      const rm = el("button", "do-remove", "Remove");
      rm.type = "button";
      rm.title = `Take ${site} off your block list`;
      rm.addEventListener("click", () => removeRule(site));
      box.appendChild(rm);
    }
    return box;
  }
  const block = el("button", "do-block", "Block");
  block.type = "button";
  block.title = `Block ${site} all the time`;
  block.addEventListener("click", () => apply({ type: "block", site }));
  const lim = el("select", "do-limit");
  lim.title = `Give ${site} a daily time limit`;
  lim.appendChild(Object.assign(el("option", "", "Limit"), { value: "" }));
  for (const m of LIMITS) lim.appendChild(Object.assign(el("option", "", `${m} min a day`), { value: String(m) }));
  lim.addEventListener("change", () => { if (lim.value) apply({ type: "limit", site, minutes: +lim.value }); });
  box.append(block, lim);
  return box;
}

/** Remember the user's own choice for a site, or forget it when it matches what Busted would guess anyway. */
async function setKind(site, kind) {
  const kinds = { ...data.kinds };
  if (kind === kindOf(site)) delete kinds[site]; else kinds[site] = kind;
  await chrome.storage.local.set({ siteKinds: kinds });
}

/** Turn a suggestion into a real rule on the block list. */
async function apply(action) {
  const { sites = [] } = await chrome.storage.local.get("sites");
  let site = sites.find((s) => s.domain === action.site && !s.path);
  if (!site) { site = { id: crypto.randomUUID(), domain: action.site, enabled: true, schedule: null }; sites.unshift(site); }
  site.enabled = true;
  if (action.type === "limit") { site.limit = action.minutes; site.schedule = null; }
  else if (action.type === "block") { delete site.limit; site.schedule = null; }
  else { delete site.limit; site.schedule = { days: [0, 1, 2, 3, 4, 5, 6], start: action.start, end: action.end }; }
  await chrome.storage.local.set({ sites });
}

/** Take a whole-site entry off the block list. Not during a focus session, same as in the popup. */
async function removeRule(domain) {
  const { sites = [], focus } = await chrome.storage.local.get(["sites", "focus"]);
  if (focusActive(focus)) return;
  await chrome.storage.local.set({ sites: sites.filter((s) => !(s.domain === domain && !s.path)) });
}

$("#range").addEventListener("click", (e) => {
  const b = e.target.closest("[data-range]");
  if (b) { range = +b.dataset.range; render(); }
});
$("#more").addEventListener("click", () => { showAll = true; render(); });
$("#turn-on").addEventListener("click", () => chrome.storage.local.set({ insights: { on: true, since: Date.now() } }));
$("#pause").addEventListener("click", () => chrome.storage.local.set({ insights: { ...data.settings, on: !data.settings.on } }));
$("#wipe").addEventListener("click", async () => {
  if (!wipeArmed) { wipeArmed = true; render(); setTimeout(() => { wipeArmed = false; render(); }, 5000); return; }
  wipeArmed = false;
  await chrome.storage.local.remove(Object.keys(data.days).map((d) => DAY_PREFIX + d));
});

// Today's record changes about once a minute while the page is open: redraw from fresh data.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.keys(changes).some((k) => k.startsWith(DAY_PREFIX) || ["insights", "siteKinds", "sites", "focus"].includes(k))) load();
});

load();
