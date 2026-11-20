import { parseTarget, siteKey, todayKey, loadState, findBlock, focusActive, focusEnd, urlMatches, FOCUS_EXIT_WAIT_SEC } from "../lib/shared.js";
import { PRESET_GROUPS } from "../lib/presets.js";

const $ = (id) => document.getElementById(id);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// A whole site ("youtube.com") or one part of it ("youtube.com/shorts").
const target = parseTarget(new URLSearchParams(location.search).get("site"));
const site = target ? siteKey(target) : "this site";

const HEADLINES = [
  "Nice try.",
  "Absolutely not.",
  "Denied. Lovingly.",
  "Not today, champ.",
  "Bold move. Rejected.",
  "Nope-a-tron 3000 says no.",
  "Halt, procrastinator!",
];

const ROASTS = [
  `${site} will still be there after you finish. Probably. Mostly.`,
  `Your future self just sent a strongly worded email about ${site}.`,
  `Hoot has reviewed your request to visit ${site}. Hoot is disappointed.`,
  `Opening ${site} won't make that task do itself. We checked.`,
  `Fun fact: nobody ever wrote "I wish I'd spent more time on ${site}" in their memoir.`,
  `${site} misses you too. It's a toxic relationship. Walk away.`,
  `You typed ${site} faster than you've typed anything useful today.`,
  `Plot twist: the real ${site} was the focus we lost along the way.`,
  `Somewhere, a deadline is quietly sharpening its knife.`,
  `Your browser tried to open ${site}. Your browser has been grounded.`,
];

const IDEAS = [
  "finish the thing you've been avoiding 👀",
  "drink a glass of water 💧",
  "do 10 push-ups. Yes, now. 💪",
  "close 5 tabs you'll never read 🗂️",
  "write down the next tiny step 📝",
  "stand up and stretch for 60 seconds 🧘",
  "reply to that one message 📨",
  "take 5 deep breaths, then get back to it 🌬️",
  "look out a window like a philosopher 🪟",
  "start a 25-minute timer and go ⏲️",
];

const RUN_TAUNTS = ["Too slow!", "Nope 🙃", "Catch me!", "lol no", "Keep trying", "Never!", "So close…", "Get back to work"];

function verdictFor(n) {
  if (n <= 1) return "First offense. We'll let it slide. (We won't.)";
  if (n <= 3) return "A pattern is emerging…";
  if (n <= 6) return "Hoot is taking notes. 📓";
  if (n <= 10) return "This is getting a bit embarrassing, honestly.";
  if (n <= 20) return "At this point you should be paying rent here.";
  return "Legendary commitment to distraction. Truly unmatched. 🏆";
}

async function bumpCounter() {
  const key = todayKey();
  const { stats = {} } = await chrome.storage.local.get("stats");
  // keep only today's stats to avoid unbounded growth
  const today = stats[key] || {};
  today[site] = (today[site] || 0) + 1;
  await chrome.storage.local.set({ stats: { [key]: today } });
  return today[site];
}

async function init() {
  $("site").textContent = site;
  $("headline").textContent = pick(HEADLINES);
  $("roast").textContent = pick(ROASTS);
  $("idea").textContent = pick(IDEAS);

  let n = 1;
  try { n = await bumpCounter(); } catch (e) { console.warn(e); }
  $("count").textContent = n;
  $("count-label").firstChild.textContent = `attempt${n === 1 ? "" : "s"} today on `;
  $("verdict").textContent = verdictFor(n);
}

// --- buttons ---
// Don't use history.back(): the previous entry is often the blocked site itself.
$("back").addEventListener("click", () => {
  chrome.tabs.getCurrent((tab) => tab && chrome.tabs.update(tab.id, { url: "chrome://newtab/" }));
});

$("reroll").addEventListener("click", () => {
  let next;
  do next = pick(IDEAS); while (next === $("idea").textContent && IDEAS.length > 1);
  $("idea").textContent = next;
});

$("guard").addEventListener("click", () => {
  const g = $("guard");
  g.classList.remove("shake");
  void g.offsetWidth; // restart animation
  g.classList.add("shake");
  $("roast").textContent = pick(ROASTS);
});

// The "Unblock" button runs away from the cursor.
const runaway = $("unblock");
function flee() {
  const r = runaway.getBoundingClientRect();
  if (!runaway.classList.contains("fleeing")) {
    // Move to <body>: the card's backdrop-filter would make position:fixed
    // relative to the card instead of the window, letting it escape off-screen.
    document.body.appendChild(runaway);
    runaway.style.left = r.left + "px";
    runaway.style.top = r.top + "px";
    runaway.classList.add("fleeing");
  }
  const pad = 20;
  const maxX = window.innerWidth - r.width - pad;
  const maxY = window.innerHeight - r.height - pad;
  runaway.style.left = pad + Math.random() * maxX + "px";
  runaway.style.top = pad + Math.random() * maxY + "px";
  runaway.textContent = pick(RUN_TAUNTS);
}
runaway.addEventListener("mouseenter", flee);
runaway.addEventListener("focus", flee);
runaway.addEventListener("click", (e) => { e.preventDefault(); flee(); });

// --- why it's blocked: a focus session or a used-up daily limit get their own line ---
// Where the tab was when it got blocked; it goes back there by itself when a focus session ends.
const cameFrom = (() => {
  try {
    const u = new URL(new URLSearchParams(location.search).get("url"));
    if (target && /^https?:$/.test(u.protocol) && urlMatches(u, target)) return u.href;
  } catch { /* no address given */ }
  return target ? `https://${site}` : null;
})();

/** True once the background has lifted every rule that stops this site. */
async function rulesLifted() {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const has = (type, filter) => rules.some((r) => r.action.type === type && r.condition.urlFilter === filter);
  return !has("block", `||${site}^`) && (!has("block", "|http") || has("allow", `||${site}^`));
}

let inFocus = false; // this page was shown during a focus session
let returning = false;
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
async function explain() {
  const st = await loadState();
  const note = $("note"), text = $("note-text"), exit = $("focus-exit");
  const entry = st.sites.find((s) => siteKey(s) === site);
  text.textContent = "";
  exit.hidden = true;
  if (focusActive(st.focus)) {
    inFocus = true;
    const leaving = !!st.focus.exitAt;
    const min = Math.ceil((st.focus.until - Date.now()) / 60000);
    text.textContent = leaving ? `🎯 Focus session ending in ${mmss(focusEnd(st.focus) - Date.now())}. Changed your mind?`
      : `🎯 Focus session: ${min} minute${min === 1 ? "" : "s"} to go.`;
    exit.hidden = false;
    exit.textContent = leaving ? "Keep focusing" : "End session early";
    exit.classList.toggle("stay", leaving);
  } else if (inFocus && cameFrom && !findBlock(cameFrom, st)) {
    // The session ended while this page was open and nothing else blocks the site: go back to it.
    text.textContent = `🎯 Focus session done. Nicely held. Opening ${site}...`;
    if (!returning && !spinning) {
      returning = true;
      for (let k = 0; k < 25 && !(await rulesLifted()); k++) await sleep(200);
      location.replace(cameFrom);
    }
  } else {
    inFocus = false;
    if (entry?.limit) text.textContent = `⏳ Today's ${entry.limit === 1 ? "minute" : `${entry.limit} minutes`} on ${site} ${entry.limit === 1 ? "is" : "are"} used up. Fresh minutes at midnight.`;
  }
  note.hidden = !text.textContent;
}
// Ending early is allowed, but slow: the session stops after a wait, and one click calls it off.
$("focus-exit").addEventListener("click", async () => {
  const { focus } = await chrome.storage.local.get("focus");
  if (!focusActive(focus)) return;
  const { exitAt, ...rest } = focus;
  await chrome.storage.local.set({ focus: exitAt ? rest : { ...rest, exitAt: Date.now() + FOCUS_EXIT_WAIT_SEC * 1000 } });
  explain();
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && (changes.focus || changes.sites)) explain(); });
setInterval(explain, 1000);

// --- clock ---
function tick() {
  const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("clock").textContent = `It's ${t}. A perfectly good time to focus.`;
}
tick();
setInterval(tick, 15000);

init();

// Hoot leans toward the cursor
addEventListener("pointermove", (e) => {
  const r = $("guard").getBoundingClientRect();
  const dx = (e.clientX - (r.left + r.width / 2)) / innerWidth;
  $("guard").style.setProperty("--tilt", `${Math.max(-1, Math.min(1, dx * 2)) * 8}deg`);
});

// --- Wheel of Freedom (casino edition) ---
// The outcome is decided first (see passOdds below), then the wheel is aimed at
// a random spot inside the chosen slice. The 5-minute pass slice is drawn thin
// on purpose, but the real chance of landing on it is much better than it looks.
const FORCE_WIN = false; // TEST ONLY: every spin wins. Set to false before publishing.
const PASS_MINUTES = FORCE_WIN ? 1 : 5; // TEST ONLY: 1 minute while FORCE_WIN is on
const COOLDOWN_MIN = 20;
const CUTSCENE_MAX_MS = 15000; // the cutscene is ~5 s; never wait longer than this for it
// A pass covers every domain of the same site (x.com + twitter.com, all Amazon stores...).
const PASS_DOMAINS = PRESET_GROUPS.flatMap((g) => g.items).find((p) => p.domains.includes(site))?.domains || [site];
const SLICES = [
  { label: "5 MIN PASS", icon: "🔓", deg: 18, c: ["#ffd36b", "#f0a020"], win: true },
  { label: "Back to work", icon: "😤", deg: 49.7, c: ["#7c5cff", "#4b2fd0"], msg: "Back to work. The wheel has spoken.", leave: true },
  { label: "10 push-ups", icon: "💪", deg: 49.7, c: ["#ff5c8a", "#c2245a"], msg: "10 push-ups. Hoot is counting." },
  { label: "Drink water", icon: "💧", deg: 49.7, c: ["#5a3fd0", "#2e1d8a"], msg: "Drink a glass of water. Then work." },
  { label: "Spin again", icon: "🔁", deg: 49.7, c: ["#e0457a", "#9c1c48"], msg: "Spin again! Hoot is feeling generous.", again: true },
  { label: "Hoot says no", icon: "🦉", deg: 49.7, c: ["#8a6cff", "#5a3fd0"], msg: "Hoot says no. Hoot always says no." },
  { label: "Next tiny step", icon: "📝", deg: 49.7, c: ["#d9467a", "#8e1f47"], msg: "Write down the next tiny step. Then do it." },
  { label: "Nothing", icon: "🫠", deg: 43.8, c: ["#3a2f6b", "#1f1840"], msg: "You won... absolutely nothing. Congrats." },
];

// The pass slice stays thin, but the wheel is tilted in the user's favour:
// chance to land on it is 50% on the first spin of the day on this site, then 25%.
const passOdds = (spinsDone) => (spinsDone === 0 ? 0.5 : 0.25);
async function spinsToday() {
  const { spinDay = {} } = await chrome.storage.local.get("spinDay");
  return spinDay.key === todayKey() ? spinDay.counts[site] || 0 : 0;
}
async function countSpin() {
  const { spinDay = {} } = await chrome.storage.local.get("spinDay");
  const day = spinDay.key === todayKey() ? spinDay : { key: todayKey(), counts: {} };
  day.counts[site] = (day.counts[site] || 0) + 1;
  await chrome.storage.local.set({ spinDay: day });
}

const wheel = $("wheel"), result = $("wheel-result"), spinBtn = $("wheel-spin"), flapper = $("flapper");
let rotation = 0, spinning = false, freeSpin = false, audio;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rad = (d) => (d * Math.PI) / 180;
const pt = (deg, r) => [Math.sin(rad(deg)) * r, -Math.cos(rad(deg)) * r];

function drawWheel() {
  let a = 0, defs = "", body = "", pegs = "";
  SLICES.forEach((s, i) => {
    const [x1, y1] = pt(a, 100), [x2, y2] = pt(a + s.deg, 100), mid = a + s.deg / 2;
    defs += `<radialGradient id="sg${i}" cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse"><stop offset="0.25" stop-color="${s.c[0]}"/><stop offset="1" stop-color="${s.c[1]}"/></radialGradient>`;
    body += `<path class="slice" data-i="${i}" d="M0 0 L${x1} ${y1} A100 100 0 0 1 ${x2} ${y2} Z" fill="url(#sg${i})" stroke="#ffd36b" stroke-opacity=".55" stroke-width=".8"/>`;
    const flip = mid > 180 ? 90 : -90, [ix, iy] = pt(mid, 88), [tx, ty] = pt(mid, 51);
    body += `<text class="ico" x="${ix}" y="${iy}" transform="rotate(${mid} ${ix} ${iy})">${s.icon}</text>`;
    body += `<text class="lbl${s.win ? " jackpot" : ""}" x="${tx}" y="${ty}" transform="rotate(${mid + flip} ${tx} ${ty})">${s.label}</text>`;
    const [px, py] = pt(a, 96);
    pegs += `<circle cx="${px}" cy="${py}" r="2.6" fill="url(#gold)" stroke="#5a3a00" stroke-width=".4"/>`;
    a += s.deg;
  });
  let bulbs = "";
  for (let i = 0; i < 24; i++) { const [bx, by] = pt(i * 15, 111); bulbs += `<circle class="bulb" style="--i:${i}" cx="${bx}" cy="${by}" r="3.4"/>`; }
  wheel.innerHTML = `<defs>${defs}
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2b0"/><stop offset=".45" stop-color="#ffcc4d"/><stop offset="1" stop-color="#a86b00"/></linearGradient></defs>
    <circle r="118" fill="#2a0f3a"/><circle r="116" fill="none" stroke="url(#gold)" stroke-width="8"/>
    <g class="bulbs">${bulbs}</g>
    <g id="rotor">${body}${pegs}<circle r="101" fill="none" stroke="url(#gold)" stroke-width="3"/></g>
    <circle r="22" fill="url(#gold)"/><circle r="18" fill="#1b0f2e"/>`;
}

// --- tiny synth (no sound files) ---
function ctx() { return (audio ||= new AudioContext()); }
function tone(freq, dur, type = "square", vol = 0.05, when = 0) {
  const a = ctx(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime + when;
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur);
}
const clickTick = () => tone(1800, 0.03, "square", 0.04);
const fanfare = () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.35, "triangle", 0.08, i * 0.11));
const wahwah = () => [392, 370, 349, 294].forEach((f, i) => tone(f, 0.38, "sawtooth", 0.03, i * 0.32));

async function cooldownLeft() {
  const { spins = {} } = await chrome.storage.local.get("spins");
  return Math.max(0, (spins[site] || 0) + COOLDOWN_MIN * 60000 - Date.now());
}

async function openWheel() {
  drawWheel();
  $("wheel-modal").hidden = false;
  $("cutscene").hidden = true; wheel.parentElement.hidden = false;
  if (FORCE_WIN) { // TEST ONLY (remove before publishing)
    await chrome.storage.local.remove("spins");
    spinBtn.disabled = false; spinBtn.hidden = false;
    result.textContent = "🧪 TEST MODE: this spin will win.";
    return;
  }
  const left = await cooldownLeft();
  spinBtn.disabled = left > 0;
  result.textContent = left > 0 ? `Hoot confiscated the wheel. Back in ${Math.ceil(left / 60000)} min. 🔒` : "Feeling lucky?";
}

function setRotor(deg) { $("rotor").setAttribute("transform", `rotate(${deg})`); }

async function spin() {
  if (spinning || (!freeSpin && !FORCE_WIN && (await cooldownLeft()) > 0)) return;
  spinning = true; spinBtn.disabled = true; ctx().resume();
  $("wheel-modal").classList.add("spinning");
  $("laugh").classList.remove("pop");
  wheel.querySelectorAll(".slice.hit").forEach((s) => s.classList.remove("hit"));
  result.textContent = "Spinning… 🤞";
  if (!freeSpin) {
    const { spins = {} } = await chrome.storage.local.get("spins");
    spins[site] = Date.now();
    await chrome.storage.local.set({ spins });
  }
  freeSpin = false;
  const odds = passOdds(await spinsToday());
  await countSpin();
  // TEST ONLY (remove before publishing): #win in the URL forces a landing on the pass slice.
  // Decide the outcome first, then aim the wheel at a random spot inside it.
  const passDeg = SLICES[0].deg;
  const target = FORCE_WIN || Math.random() < odds
    ? 2 + Math.random() * (passDeg - 4)                  // somewhere inside the pass slice
    : passDeg + 1 + Math.random() * (360 - passDeg - 2); // anywhere else
  const r = (360 - target + 360 - (rotation % 360)) % 360;
  const start = rotation, total = 360 * 7 + r, dur = 6500;
  const ease = (t) => 1 - Math.pow(1 - t, 4.2); // long, suspenseful crawl at the end
  const pegsAt = []; let a = 0; for (const s of SLICES) { pegsAt.push(a); a += s.deg; }
  let lastPeg = null, t0 = performance.now();
  await new Promise((done) => {
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      rotation = start + total * ease(t);
      setRotor(rotation);
      const under = (360 - (rotation % 360)) % 360; // wheel angle under the pointer
      const peg = pegsAt.filter((p) => p <= under).length;
      if (lastPeg !== null && peg !== lastPeg) { clickTick(); flapper.classList.remove("kick"); void flapper.offsetWidth; flapper.classList.add("kick"); }
      lastPeg = peg;
      t < 1 ? requestAnimationFrame(frame) : done();
    };
    requestAnimationFrame(frame);
  });
  $("wheel-modal").classList.remove("spinning");
  spinning = false;
  land((360 - (rotation % 360)) % 360);
}

function land(angle) {
  let a = 0;
  const i = SLICES.findIndex((x) => (a += x.deg) > angle), s = SLICES[i < 0 ? SLICES.length - 1 : i];
  wheel.querySelector(`.slice[data-i="${SLICES.indexOf(s)}"]`).classList.add("hit");
  if (s.win) return jackpot();
  result.textContent = `${s.icon} ${s.msg}`;
  wahwah();
  $("laugh").classList.add("pop");
  if (s.again) { freeSpin = true; spinBtn.disabled = false; spinBtn.textContent = "SPIN AGAIN"; }
  else spinBtn.textContent = "SPIN";
  if (s.leave) setTimeout(() => $("back").click(), 2200);
}

// The impossible happened: fanfare, Lucky the fox nets Hoot, then a real 5-minute pass.
async function jackpot() {
  fanfare();
  $("wheel-modal").classList.add("jackpot");
  result.textContent = "🎰 JACKPOT! 5 MIN PASS?!";
  rain(["🎉", "💰", "✨", "🎰", "🪙"]);
  await sleep(1800);
  wheel.parentElement.hidden = true;
  spinBtn.hidden = true;
  const v = $("cutscene"); v.hidden = false; v.currentTime = 0;
  result.textContent = "Lucky the fox has entered the chat… 🦊";
  // A cutscene that fails to load, refuses to play or stalls must never swallow
  // the pass that was just won: skip it and carry on.
  const finished = new Promise((r) => ["ended", "error"].forEach((ev) => v.addEventListener(ev, r, { once: true })));
  try { await v.play(); await Promise.race([finished, sleep(CUTSCENE_MAX_MS)]); } catch (e) { console.warn("cutscene skipped", e); }
  const { passes = {} } = await chrome.storage.local.get("passes");
  const until = Date.now() + PASS_MINUTES * 60000;
  for (const d of PASS_DOMAINS) passes[d] = until;
  await chrome.storage.local.set({ passes });
  for (let n = 3; n > 0; n--) {
    result.textContent = `Lucky has Hoot in a net. ${PASS_MINUTES} minutes on ${site}. Opening in ${n}… ⏳`;
    await sleep(1000);
  }
  for (let k = 0; k < 15 && !(await rulesLifted()); k++) await sleep(200); // wait until the background has lifted the block
  location.href = cameFrom;
}

function rain(chars) {
  for (let k = 0; k < 80; k++) {
    const e = document.createElement("span");
    e.textContent = pick(chars);
    e.style.left = Math.random() * 100 + "vw";
    e.style.animationDuration = 2 + Math.random() * 2.5 + "s";
    e.style.animationDelay = Math.random() * 0.8 + "s";
    $("confetti").appendChild(e);
    setTimeout(() => e.remove(), 6000);
  }
}

if (!target) $("wheel-open").hidden = true;
explain();
$("wheel-open").addEventListener("click", openWheel);
$("wheel-close").addEventListener("click", () => { if (!spinning) $("wheel-modal").hidden = true; });
spinBtn.addEventListener("click", spin);
