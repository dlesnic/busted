import {
  DAY_LABELS, STATE_KEYS, normalizeDomain, parseTarget, siteKey, describeSchedule,
  loadState, blockedNow, siteStatus, focusActive, focusEnd, FOCUS_EXIT_WAIT_SEC, limitLeft,
} from "../lib/shared.js";
import { PRESET_GROUPS, PRESET_ICON } from "../lib/presets.js";
import { DAY_PREFIX, fmt, mood, MOOD_LEVEL, MOOD_LINES, summarize } from "../lib/insights.js";
import { todayKey } from "../lib/shared.js";

const $ = (sel) => document.querySelector(sel);
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon first
const DEFAULT_SCHEDULE = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const DEFAULT_LIMIT = 30; // minutes a day
const FOCUS_MAX_MIN = 180;

// sites, passes (wheel passes), usage (daily-limit time), focus (running session), allow (sites open during "block everything")
let st = { sites: [], passes: {}, usage: {}, focus: null, allow: [] };
let prefs = { minutes: 25, mode: "list" }; // last focus session setup
let openId = null;
let showAllPresets = false;
let focusOpen = false;
let confirming = false; // the "are you sure" step before a focus session starts
// A request to rate the extension, shown once: three days after the popup was first opened.
const RATE_AFTER_MS = 3 * 24 * 3600 * 1000;
let rate = { since: Date.now() }; // { since: first popup open, answer?: "yes" | "no" }

async function load() {
  st = await loadState();
  const { focusPrefs } = await chrome.storage.local.get("focusPrefs");
  prefs = { ...prefs, ...focusPrefs };
  const saved = (await chrome.storage.local.get("rate")).rate;
  if (saved) rate = saved; else await chrome.storage.local.set({ rate });
  render();
  renderInsights();
}

// Insights strip: an offer to turn them on, or today's time with a link to the full page.
async function renderInsights() {
  const key = DAY_PREFIX + todayKey();
  const got = await chrome.storage.local.get(["insights", "siteKinds", key]);
  const ins = got.insights || {};
  $("#ins").hidden = !ins.since && !!ins.hidden;
  $("#ins-off").hidden = !!ins.since;
  $("#ins-live").hidden = !ins.since;
  if (!ins.since) return;
  const sum = summarize({ today: got[key] || {} }, ["today"], got.siteKinds || {});
  const line = $("#ins-today");
  line.textContent = "";
  const b = (text, cls) => { const e = document.createElement("b"); e.textContent = text; if (cls) e.className = cls; return e; };
  if (!ins.on) line.append("Insights are paused");
  else line.append("Today: ", b(fmt(sum.total)), " on sites, ", b(fmt(sum.byKind.distraction), "dis"), " on distractions");
  // Hoot only speaks up when it is getting out of hand.
  const m = ins.on ? mood(sum.byKind.distraction) : "calm";
  $("#ins-hoot").className = `mood-${m}`;
  $("#ins-mood").textContent = MOOD_LEVEL[m] >= MOOD_LEVEL.annoyed ? MOOD_LINES[m].join(" ") : "";
}
$("#ins-on").addEventListener("click", async () => { await chrome.storage.local.set({ insights: { on: true, since: Date.now() } }); renderInsights(); });
$("#ins-hide").addEventListener("click", async () => { await chrome.storage.local.set({ insights: { hidden: true } }); renderInsights(); });
$("#ins-open").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") }));

async function save() {
  await chrome.storage.local.set({ sites: st.sites });
  render();
}

const focusOn = () => focusActive(st.focus);

function showError(msg) {
  const el = $("#error");
  el.textContent = msg;
  el.hidden = !msg;
}

const newSite = (t) => ({ id: crypto.randomUUID(), domain: t.domain, ...(t.path ? { path: t.path } : {}), enabled: true, schedule: null });
const onList = (key) => st.sites.some((s) => siteKey(s) === key);

async function addDomain(raw) {
  const t = parseTarget(raw);
  if (!t) return showError("That doesn't look like a domain. Try “youtube.com”.");
  // A pasted link means the whole site; type "youtube.com/shorts" to block one part.
  if (/^\s*[a-z]+:\/\//i.test(raw)) t.path = "";
  if (onList(siteKey(t))) return showError(`${siteKey(t)} is already on the list.`);
  showError("");
  st.sites.unshift(newSite(t));
  await save();
}

function faviconUrl(domain) {
  if (PRESET_ICON[domain]) return PRESET_ICON[domain]; // bundled, works offline
  const u = new URL(chrome.runtime.getURL("/_favicon/"));
  u.searchParams.set("pageUrl", `https://${domain}`);
  u.searchParams.set("size", "32");
  return u.toString();
}

const minutes = (sec) => Math.ceil(sec / 60);
const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function render() {
  const list = $("#list");
  list.innerHTML = "";
  list.classList.toggle("locked", focusOn());
  const now = new Date();
  const n = st.sites.length;

  if (focusOn() && st.focus.mode === "all") $("#summary").textContent = "Focus session: everything is blocked";
  else if (n) $("#summary").textContent = `${blockedNow(st, now).length} of ${n} site${n === 1 ? "" : "s"} blocked right now`;
  else $("#summary").textContent = "Nothing blocked. Living dangerously.";
  $("#empty").hidden = n > 0;
  $("#rate").hidden = !!rate.answer || !n || focusOn() || Date.now() - rate.since < RATE_AFTER_MS;

  for (const site of st.sites) list.appendChild(renderItem(site, now));
  renderChips();
  renderFocus();
}

// --- quick-add chips ---
function presetSelected(p) {
  return p.domains.every(onList);
}

async function togglePreset(p) {
  showError("");
  if (presetSelected(p)) {
    if (focusOn()) return showError("Nothing leaves the list during a focus session.");
    st.sites = st.sites.filter((s) => !p.domains.includes(siteKey(s)));
  } else {
    const fresh = p.domains.filter((d) => !onList(d)).map((d) => newSite(parseTarget(d)));
    st.sites = [...fresh, ...st.sites];
  }
  await save();
}

function renderChips() {
  const box = $("#chips");
  box.innerHTML = "";
  const groups = showAllPresets ? PRESET_GROUPS : PRESET_GROUPS.slice(0, 1);
  for (const g of groups) {
    if (showAllPresets) {
      const h = document.createElement("div");
      h.className = "group-name";
      h.textContent = g.name;
      box.appendChild(h);
    }
    const row = document.createElement("div");
    row.className = "chip-row";
    for (const p of g.items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (presetSelected(p) ? " sel" : "");
      b.title = (presetSelected(p) ? "Unblock " : "Block ") + p.domains.join(", ");
      const img = document.createElement("img");
      img.src = faviconUrl(p.domains[0]);
      img.alt = "";
      img.onerror = () => (img.style.visibility = "hidden");
      b.append(img, p.label);
      b.addEventListener("click", () => togglePreset(p));
      row.appendChild(b);
    }
    box.appendChild(row);
  }
  $("#more").textContent = showAllPresets ? "Less ▴" : "More ▾";
}

// --- focus session ---
function renderFocus() {
  const on = focusOn();
  const btn = $("#focus-btn");
  btn.classList.toggle("on", on);
  btn.classList.toggle("open", focusOpen && !on);
  btn.textContent = on ? `🎯 ${clock(st.focus.until - Date.now())}` : "🎯 Focus";
  $("#focus-panel").hidden = !(focusOpen || on);
  if (on) confirming = false;
  $("#focus-setup").hidden = on || confirming;
  $("#focus-confirm").hidden = on || !confirming;
  $("#focus-running").hidden = !on;

  if (on) {
    $("#focus-left").textContent = clock(st.focus.until - Date.now());
    const end = new Date(st.focus.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("#focus-what").textContent = (st.focus.mode === "all" ? "Everything is blocked" : "Your whole list is blocked") + ` until ${end}.`;
    const leaving = !!st.focus.exitAt;
    $("#exit-note").hidden = !leaving;
    if (leaving) $("#exit-note").textContent = `Ending in ${clock(focusEnd(st.focus) - Date.now())}. Changed your mind?`;
    $("#focus-exit").textContent = leaving ? "Keep focusing" : "End session early";
    $("#focus-exit").classList.toggle("primary", leaving);
    return;
  }

  if (confirming) {
    const end = new Date(Date.now() + prefs.minutes * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("#confirm-title").textContent = `Lock in for ${prefs.minutes} ${prefs.minutes === 1 ? "minute" : "minutes"}?`;
    $("#confirm-what").textContent = prefs.mode === "all"
      ? `Every website will be blocked until ${end}` + (st.allow.length ? `, except: ${st.allow.join(", ")}.` : ". You allowed no sites, so nothing will open.")
      : `Your whole list will be blocked until ${end}, paused and off-hours sites included.`;
    return;
  }

  const custom = $("#focus-custom");
  const preset = [25, 50].includes(prefs.minutes);
  document.querySelectorAll("#focus-mins button").forEach((b) => b.classList.toggle("sel", Number(b.dataset.min) === prefs.minutes));
  custom.classList.toggle("sel", !preset);
  if (document.activeElement !== custom) custom.value = preset ? "" : prefs.minutes;
  document.querySelectorAll("#focus-mode button").forEach((b) => b.classList.toggle("sel", b.dataset.mode === prefs.mode));

  $("#focus-allow").hidden = prefs.mode !== "all";
  const chips = $("#allow-chips");
  chips.innerHTML = "";
  for (const d of st.allow) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip allowed";
    b.title = `Stop allowing ${d}`;
    b.textContent = d;
    b.addEventListener("click", () => saveAllow(st.allow.filter((x) => x !== d)));
    chips.appendChild(b);
  }

  const start = $("#focus-start");
  const empty = prefs.mode === "list" && st.sites.length === 0;
  start.disabled = empty;
  start.textContent = `Start ${prefs.minutes}-minute focus`;
  $("#focus-hint").textContent = empty ? "Your list is empty. Add a site first, or block everything."
    : `No pause and no changes. Ending early takes a ${FOCUS_EXIT_WAIT_SEC}-second wait.`;
}

async function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  await chrome.storage.local.set({ focusPrefs: prefs });
  renderFocus();
}

async function saveAllow(allow) {
  if (focusOn()) return; // the allowed sites are fixed while a session runs
  st.allow = allow;
  await chrome.storage.local.set({ focusAllow: allow });
  renderFocus();
}

$("#focus-btn").addEventListener("click", () => { focusOpen = !focusOpen; confirming = false; renderFocus(); });
document.querySelectorAll("#focus-mins button").forEach((b) => b.addEventListener("click", () => savePrefs({ minutes: Number(b.dataset.min) })));
document.querySelectorAll("#focus-mode button").forEach((b) => b.addEventListener("click", () => savePrefs({ mode: b.dataset.mode })));
$("#focus-custom").addEventListener("input", (e) => {
  const m = Math.min(FOCUS_MAX_MIN, Math.floor(Number(e.target.value)));
  if (m >= 1) savePrefs({ minutes: m });
});
$("#allow-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#allow-input");
  const raw = input.value.trim().toLowerCase();
  const d = raw === "localhost" ? raw : normalizeDomain(raw);
  if (!d) return input.select();
  input.value = "";
  if (!st.allow.includes(d)) saveAllow([...st.allow, d]);
});
// Starting takes two clicks: a session can't be stopped, so spell out what is about to happen.
$("#focus-start").addEventListener("click", () => { confirming = true; renderFocus(); });
$("#confirm-back").addEventListener("click", () => { confirming = false; renderFocus(); });
$("#confirm-go").addEventListener("click", async () => {
  if (focusOn()) return;
  confirming = false;
  st.focus = { until: Date.now() + prefs.minutes * 60000, mode: prefs.mode };
  await chrome.storage.local.set({ focus: st.focus });
  openId = null;
  render();
});
// Ending early is allowed, but slow: the session stops after a wait, and one click calls it off.
$("#focus-exit").addEventListener("click", async () => {
  if (!focusOn()) return;
  const { exitAt, ...rest } = st.focus;
  st.focus = exitAt ? rest : { ...rest, exitAt: Date.now() + FOCUS_EXIT_WAIT_SEC * 1000 };
  await chrome.storage.local.set({ focus: st.focus });
  renderFocus();
});
// The countdown. When the session runs out, the list unlocks.
setInterval(() => {
  if (!st.focus) return;
  if (focusOn()) return renderFocus();
  st.focus = null;
  render();
}, 1000);

// --- list ---
function renderItem(site, now) {
  const node = $("#item-tpl").content.firstElementChild.cloneNode(true);
  const q = (s) => node.querySelector(s);

  q(".fav").src = faviconUrl(site.domain);
  q(".domain").textContent = siteKey(site);

  const status = siteStatus(site, st, now);
  const pill = q(".pill");
  const [text, cls] = {
    focus: ["Focus", "focus"], paused: ["Paused", "paused"], pass: ["Wheel pass", "pass"],
    blocked: ["Blocked", "on"], idle: ["Off-hours", "idle"], limit: ["Open", "idle"],
  }[status];
  pill.textContent = text;
  pill.className = `pill ${cls}`;
  if (!site.limit) q(".sched").textContent = describeSchedule(site.schedule);
  else if (limitLeft(site, st.usage, now) > 0) q(".sched").textContent = `${minutes(limitLeft(site, st.usage, now))} of ${site.limit} min left today`;
  else q(".sched").textContent = `${site.limit} min used up, back tomorrow`;

  const enabled = q(".enabled");
  enabled.checked = site.enabled;
  enabled.addEventListener("change", () => {
    if (focusOn()) return render();
    site.enabled = enabled.checked;
    save();
  });

  q(".remove").addEventListener("click", () => {
    if (focusOn()) return;
    st.sites = st.sites.filter((s) => s.id !== site.id);
    save();
  });

  const editor = q(".editor");
  const toggle = q(".toggle-edit");
  editor.hidden = openId !== site.id || focusOn();
  toggle.classList.toggle("active", !editor.hidden);
  toggle.addEventListener("click", () => {
    if (focusOn()) return;
    openId = openId === site.id ? null : site.id;
    render();
  });

  // --- editor: always / schedule / daily limit (one at a time) ---
  const mode = site.limit ? "limit" : site.schedule ? "schedule" : "always";
  q(".sched-fields").hidden = mode !== "schedule";
  q(".limit-fields").hidden = mode !== "limit";
  const sch = site.schedule || { ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] };

  node.querySelectorAll(".seg button").forEach((b) => {
    b.classList.toggle("sel", b.dataset.mode === mode);
    b.addEventListener("click", () => {
      site.schedule = b.dataset.mode === "schedule" ? (site.schedule || sch) : null;
      if (b.dataset.mode === "limit") site.limit = site.limit || DEFAULT_LIMIT;
      else delete site.limit;
      save();
    });
  });

  const daysEl = q(".days");
  for (const d of DAY_ORDER) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = DAY_LABELS[d].slice(0, 2);
    b.classList.toggle("sel", sch.days.includes(d));
    b.addEventListener("click", () => {
      sch.days = sch.days.includes(d) ? sch.days.filter((x) => x !== d) : [...sch.days, d];
      site.schedule = sch;
      save();
    });
    daysEl.appendChild(b);
  }

  const presets = { weekdays: [1, 2, 3, 4, 5], weekends: [0, 6], all: [0, 1, 2, 3, 4, 5, 6] };
  node.querySelectorAll(".presets button").forEach((b) =>
    b.addEventListener("click", () => {
      sch.days = [...presets[b.dataset.preset]];
      site.schedule = sch;
      save();
    })
  );

  const start = q(".start");
  const end = q(".end");
  start.value = sch.start;
  end.value = sch.end;
  const onTime = () => {
    if (!start.value || !end.value) return;
    sch.start = start.value;
    sch.end = end.value;
    site.schedule = sch;
    save();
  };
  start.addEventListener("change", onTime);
  end.addEventListener("change", onTime);

  const limitMin = q(".limit-min");
  limitMin.value = site.limit || DEFAULT_LIMIT;
  const setLimit = (m) => {
    m = Math.min(600, Math.floor(Number(m)));
    if (!(m >= 1)) return;
    site.limit = m;
    save();
  };
  limitMin.addEventListener("change", () => setLimit(limitMin.value));
  node.querySelectorAll(".limit-row button").forEach((b) => {
    b.classList.toggle("sel", Number(b.dataset.limit) === site.limit);
    b.addEventListener("click", () => setLimit(b.dataset.limit));
  });

  return node;
}

$("#add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#domain");
  addDomain(input.value).then(() => { if ($("#error").hidden) input.value = ""; });
});

$("#block-current").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) return showError("Current tab isn't a regular website.");
  addDomain(new URL(tab.url).hostname);
});

$("#more").addEventListener("click", () => {
  showAllPresets = !showAllPresets;
  renderChips();
});

// Passes, daily-limit time and focus sessions can change while the popup is open.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && Object.keys(changes).some((k) => k === "insights" || k.startsWith(DAY_PREFIX))) renderInsights();
  if (area !== "local" || !STATE_KEYS.some((k) => k !== "sites" && changes[k])) return;
  const fresh = await loadState();
  st = { ...fresh, sites: st.sites };
  // Don't redraw the list under someone typing in it; the next change will catch up.
  const typing = document.activeElement?.tagName === "INPUT" && $("#list").contains(document.activeElement);
  if (!typing) render();
});

async function answerRate(answer) {
  rate = { ...rate, answer };
  await chrome.storage.local.set({ rate });
  render();
}
$("#rate-no").addEventListener("click", () => answerRate("no"));
$("#rate-go").addEventListener("click", async () => {
  await answerRate("yes");
  chrome.tabs.create({ url: `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews` });
});

$("#domain").focus();
load();
