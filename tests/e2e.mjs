// End-to-end tests for the Busted extension in a real Chromium.
// Loads the unpacked extension, serves fake sites on 127.0.0.1:8123 and drives the
// popup, the blocked page, the wheel, focus sessions and daily limits. Takes about 4 minutes.
// setup (once): npm install && npx playwright-core install chromium
// usage: npm test, or node tests/e2e.mjs <extension dir> [only-substring]   e.g. node tests/e2e.mjs . bug1
// The daily-limit tests need the test browser to be left alone: they count time in the front tab.
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EXT = path.resolve(process.argv[2]);
const ONLY = process.argv[3] || "";
const PORT = 8123;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<title>OK ${req.headers.host}</title><h1>real page</h1>`);
}).listen(PORT, "127.0.0.1");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "busted-e2e-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    // every hostname, with or without a port, lands on the local test server
    `--host-resolver-rules=MAP * 127.0.0.1:${PORT}`,
    "--autoplay-policy=document-user-activation-required",
  ],
});

let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
const ID = new URL(sw.url()).host;
const ext = (p) => `chrome-extension://${ID}/${p}`;

const errors = [];
ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`)));

// Control page: an extension page that stays open, used to call chrome.* APIs.
const ctl = await ctx.newPage();
await ctl.goto(ext("popup.html"));
const api = (fn, arg) => ctl.evaluate(fn, arg);
const rules = () => api(() => chrome.declarativeNetRequest.getDynamicRules().then((r) => r.map((x) => x.condition.urlFilter).sort()));
const store = (keys) => api((k) => chrome.storage.local.get(k), keys);
const setStore = (obj) => api((o) => chrome.storage.local.set(o), obj);
const site = (domain, extra = {}) => ({ id: domain, domain, enabled: true, schedule: null, ...extra });

async function waitFor(fn, what, timeout = 8000, step = 100) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e.message; }
    await sleep(step);
  }
  throw new Error(`timeout waiting for: ${what} (last: ${JSON.stringify(last)})`);
}
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, what) => { if (!c) throw new Error(`failed: ${what}`); };

async function reset() {
  for (const p of ctx.pages()) if (p !== ctl) await p.close();
  await api(() => chrome.storage.local.clear());
  await waitFor(async () => (await rules()).length === 0, "rules cleared after reset");
  await ctl.reload();
}

/** Navigate to a URL that may be blocked; resolves once the tab settles. */
async function visit(page, url) {
  try { await page.goto(url, { waitUntil: "domcontentloaded" }); } catch {}
}
const isBlockedPage = (page, domain) => page.url().startsWith(ext("blocked.html")) && page.url().includes(`site=${encodeURIComponent(domain)}`);

const results = [];
async function test(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  await reset();
  const t0 = Date.now();
  try { await fn(); results.push([name, "PASS", Date.now() - t0]); console.log(`PASS  ${name}  (${Date.now() - t0} ms)`); }
  catch (e) { results.push([name, "FAIL", e.message]); console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ---------------------------------------------------------------- startup
await test("startup: tick alarm exists, every 1 minute", async () => {
  const a = await waitFor(() => api(() => chrome.alarms.get("focus-tick")), "tick alarm");
  eq(a.periodInMinutes, 1, "period");
});

await test("bug3: tick alarm is aligned to whole minutes", async () => {
  const a = await api(() => chrome.alarms.get("focus-tick"));
  const off = a.scheduledTime % 60000;
  ok(off < 50 || off > 59950, `alarm fires ${Math.round(off)} ms past the minute`);
});

// ---------------------------------------------------------------- popup
await test("popup: add a site by typing, normalised, rule created", async () => {
  const p = await ctx.newPage(); await p.goto(ext("popup.html"));
  await p.fill("#domain", "https://www.YouTube.com/watch?v=1");
  await p.click("#add-form button[type=submit]");
  await waitFor(async () => (await p.locator(".item .domain").allTextContents()).join() === "youtube.com", "list shows youtube.com");
  eq(await p.inputValue("#domain"), "", "input cleared");
  eq(await p.textContent("#summary"), "1 of 1 site blocked right now", "summary");
  eq(await p.locator(".item .pill").textContent(), "Blocked", "pill");
  await waitFor(async () => (await rules()).join() === "||youtube.com^", "rule for youtube.com");
});

await test("popup: duplicate and invalid input show errors, nothing added", async () => {
  await setStore({ sites: [site("youtube.com")] });
  const p = await ctx.newPage(); await p.goto(ext("popup.html"));
  await p.fill("#domain", "youtube.com"); await p.click("#add-form button[type=submit]");
  await waitFor(async () => (await p.textContent("#error")).includes("already"), "duplicate error");
  await p.fill("#domain", "not a domain"); await p.click("#add-form button[type=submit]");
  await waitFor(async () => (await p.textContent("#error")).includes("doesn't look like a domain"), "invalid error");
  eq((await store("sites")).sites.length, 1, "site count");
});

await test("popup: preset chip adds and removes all its domains", async () => {
  const p = await ctx.newPage(); await p.goto(ext("popup.html"));
  await p.locator(".chip", { hasText: /^X$/ }).click();
  await waitFor(async () => ((await store("sites")).sites || []).map((s) => s.domain).sort().join() === "twitter.com,x.com", "x.com + twitter.com added");
  await waitFor(async () => (await rules()).join() === "||twitter.com^,||x.com^", "two rules");
  ok(await p.locator(".chip.sel", { hasText: /^X$/ }).count() === 1, "chip marked selected");
  await p.locator(".chip", { hasText: /^X$/ }).click();
  await waitFor(async () => ((await store("sites")).sites || []).length === 0, "removed");
  await waitFor(async () => (await rules()).length === 0, "rules gone");
});

await test("popup: More shows every preset group", async () => {
  const p = await ctx.newPage(); await p.goto(ext("popup.html"));
  eq(await p.locator(".chip").count(), 9, "chips in Popular");
  await p.click("#more");
  eq(await p.locator(".group-name").allTextContents(), ["Popular", "Social & chat", "Video & streaming", "News", "Shopping", "Games"], "groups");
  eq(await p.locator(".chip").count(), 47, "all chips");
  await p.click("#more");
  eq(await p.locator(".chip").count(), 9, "collapsed again");
});

await test("popup: pause switch lifts the block, re-enable restores it", async () => {
  await setStore({ sites: [site("youtube.com")] });
  const p = await ctx.newPage(); await p.goto(ext("popup.html"));
  await p.locator(".item .switch").click();
  await waitFor(async () => (await p.locator(".item .pill").textContent()) === "Paused", "pill Paused");
  eq(await p.textContent("#summary"), "0 of 1 site blocked right now", "summary");
  await waitFor(async () => (await rules()).length === 0, "rule removed");
  await p.locator(".item .switch").click();
  await waitFor(async () => (await rules()).join() === "||youtube.com^", "rule back");
});

await test("popup: schedule editor saves mode, days and times", async () => {
  await setStore({ sites: [site("youtube.com")] });
  const p = await ctx.newPage(); await p.goto(ext("popup.html"));
  await p.locator(".item .toggle-edit").click();
  await p.locator(".item .seg button[data-mode=schedule]").click();
  await waitFor(async () => { const c = (await store("sites")).sites[0].schedule; return c && c.days.join() === "1,2,3,4,5" && c.start === "09:00" && c.end === "18:00"; }, "default schedule");
  eq(await p.locator(".item .sched").textContent(), "Weekdays, 09:00-18:00", "label");
  await p.locator(".item .presets button[data-preset=all]").click();
  await waitFor(async () => (await store("sites")).sites[0].schedule.days.length === 7, "every day");
  // same start and end = all day -> blocked right now
  await p.locator(".item .start").fill("10:00"); await p.locator(".item .start").dispatchEvent("change");
  await waitFor(async () => (await store("sites")).sites[0].schedule.start === "10:00", "start saved");
  await p.locator(".item .end").fill("10:00"); await p.locator(".item .end").dispatchEvent("change");
  await waitFor(async () => (await store("sites")).sites[0].schedule.end === "10:00", "end saved");
  eq(await p.locator(".item .sched").textContent(), "Every day, all day", "label all day");
  eq(await p.locator(".item .pill").textContent(), "Blocked", "pill");
  await waitFor(async () => (await rules()).length === 1, "rule on");
  // a single day toggle
  const today = new Date().getDay();
  const label = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][today];
  await p.locator(".item .days button", { hasText: label }).click();
  await waitFor(async () => !(await store("sites")).sites[0].schedule.days.includes(today), "today removed");
  await waitFor(async () => (await p.locator(".item .pill").textContent()) === "Off-hours", "pill Off-hours");
  await waitFor(async () => (await rules()).length === 0, "rule off");
  // back to Always
  await p.locator(".item .seg button[data-mode=always]").click();
  await waitFor(async () => (await store("sites")).sites[0].schedule === null, "always");
  await waitFor(async () => (await rules()).length === 1, "rule on again");
});

await test("popup: remove deletes the site and shows the empty state", async () => {
  await setStore({ sites: [site("youtube.com")] });
  const p = await ctx.newPage(); await p.goto(ext("popup.html"));
  await p.locator(".item .remove").click();
  await waitFor(async () => ((await store("sites")).sites || []).length === 0, "removed");
  ok(await p.locator("#empty").isVisible(), "empty state visible");
  eq(await p.textContent("#summary"), "Nothing blocked. Living dangerously.", "summary");
  await waitFor(async () => (await rules()).length === 0, "rule removed");
});

await test("bug2: popup shows an active wheel pass and stops counting it as blocked", async () => {
  await setStore({ sites: [site("youtube.com"), site("reddit.com")], passes: { "youtube.com": Date.now() + 60000 } });
  const p = await ctx.newPage(); await p.goto(ext("popup.html"));
  await waitFor(async () => (await p.locator(".item").count()) === 2, "two items");
  eq(await p.textContent("#summary"), "1 of 2 sites blocked right now", "summary");
  eq(await p.locator(".item .pill").allTextContents(), ["Wheel pass", "Blocked"], "pills");
  await setStore({ passes: {} }); // pass ends while the popup is open
  await waitFor(async () => (await p.textContent("#summary")) === "2 of 2 sites blocked right now", "summary updates live");
  eq(await p.locator(".item .pill").allTextContents(), ["Blocked", "Blocked"], "pills after pass");
});

// ---------------------------------------------------------------- blocking
await test("blocking: blocked site and its subdomain go to the blocked page, others load", async () => {
  await setStore({ sites: [site("blockme.test")] });
  await waitFor(async () => (await rules()).length === 1, "rule");
  const p = await ctx.newPage();
  await visit(p, `http://blockme.test:${PORT}/some/path?x=1`);
  await waitFor(() => isBlockedPage(p, "blockme.test"), "redirect to blocked page");
  await visit(p, `http://fine.test:${PORT}/`);
  eq(await p.title(), `OK fine.test:${PORT}`, "unblocked site loads after a block");
  await visit(p, `http://m.blockme.test:${PORT}/`);
  await waitFor(() => isBlockedPage(p, "blockme.test"), "subdomain redirect");
  await p.waitForLoadState("load"); await sleep(300);
  await visit(p, `http://fine.test:${PORT}/`);
  eq(await p.title(), `OK fine.test:${PORT}`, "unblocked site loads");
  await visit(p, `http://notblockme.test:${PORT}/`); // must not match by suffix only
  eq(await p.title(), `OK notblockme.test:${PORT}`, "lookalike domain loads");
});

await test("blocking: a tab already open is kicked when its site gets blocked", async () => {
  const p = await ctx.newPage();
  await visit(p, `http://later.test:${PORT}/`);
  eq(await p.title(), `OK later.test:${PORT}`, "loads before block");
  await setStore({ sites: [site("later.test")] });
  await waitFor(() => isBlockedPage(p, "later.test"), "open tab kicked");
});

await test("blocking: paused and off-schedule sites are not blocked", async () => {
  const today = new Date().getDay(), other = (today + 3) % 7;
  await setStore({ sites: [site("paused.test", { enabled: false }), site("offday.test", { schedule: { days: [other], start: "00:00", end: "00:00" } })] });
  await sleep(600);
  eq(await rules(), [], "no rules");
  const p = await ctx.newPage();
  await visit(p, `http://paused.test:${PORT}/`); eq(await p.title(), `OK paused.test:${PORT}`, "paused loads");
  await visit(p, `http://offday.test:${PORT}/`); eq(await p.title(), `OK offday.test:${PORT}`, "off-day loads");
});

await test("bug3: a schedule starts blocking at its start time (within 3 s)", async () => {
  let now = new Date();
  if (now.getSeconds() > 50) { await sleep((61 - now.getSeconds()) * 1000); now = new Date(); }
  const start = new Date(now); start.setSeconds(0, 0); start.setMinutes(start.getMinutes() + 1);
  const end = new Date(start.getTime() + 5 * 60000);
  const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  await setStore({ sites: [site("sched.test", { schedule: { days: [start.getDay()], start: hm(start), end: hm(end) } })] });
  await sleep(500);
  eq(await rules(), [], "not blocked before the start time");
  const p = await ctx.newPage();
  await visit(p, `http://sched.test:${PORT}/`);
  eq(await p.title(), `OK sched.test:${PORT}`, "loads before start");
  await waitFor(async () => (await rules()).length === 1, "rule at start time", start.getTime() - Date.now() + 70000, 200);
  const late = Date.now() - start.getTime();
  console.log(`      block began ${late} ms after the scheduled minute`);
  ok(late >= -300 && late <= 3000, `block began ${late} ms after start`);
  await waitFor(() => isBlockedPage(p, "sched.test"), "open tab kicked at start");
});

// ---------------------------------------------------------------- blocked page
await test("blocked page: shows site, counts attempts, buttons behave", async () => {
  await setStore({ sites: [site("blockme.test")] });
  await waitFor(async () => (await rules()).length === 1, "rule");
  const p = await ctx.newPage();
  await visit(p, `http://blockme.test:${PORT}/`);
  await waitFor(() => isBlockedPage(p, "blockme.test"), "blocked page");
  await p.waitForLoadState("load");
  await waitFor(async () => (await p.textContent("#site")) === "blockme.test", "site name");
  eq(await p.textContent("#count"), "1", "first attempt");
  eq((await p.textContent("#count-label")).trim(), "attempt today on blockme.test", "label singular");
  ok((await p.textContent("#roast")).length > 10, "roast text");
  ok((await p.textContent("#clock")).includes("A perfectly good time to focus"), "clock");
  await visit(p, `http://blockme.test:${PORT}/`);
  await waitFor(() => isBlockedPage(p, "blockme.test"), "blocked again");
  await p.waitForLoadState("load");
  await waitFor(async () => (await p.textContent("#count")) === "2", "second attempt");
  eq((await p.textContent("#count-label")).trim(), "attempts today on blockme.test", "label plural");
  // reroll gives a different idea
  const idea = await p.textContent("#idea"); await p.click("#reroll");
  ok((await p.textContent("#idea")) !== idea, "idea changed");
  // the Unblock button runs away and never unblocks
  const before = await p.locator("#unblock").boundingBox();
  await p.hover("#unblock").catch(() => {});
  await sleep(700);
  const after = await p.locator("#unblock").boundingBox();
  ok(Math.abs(before.x - after.x) + Math.abs(before.y - after.y) > 1, "unblock button moved");
  eq((await store("sites")).sites.length, 1, "still blocked");
  // Back to work leaves the blocked page
  await p.click("#back");
  await waitFor(() => !p.url().includes("blocked.html"), "left the blocked page");
});

await test("wheel: the close button is clickable across its whole face", async () => {
  const p = await ctx.newPage(); await p.goto(ext("blocked.html?site=example.com"));
  await p.click("#wheel-open");
  await sleep(500);
  const hits = await p.evaluate(() => {
    const b = document.getElementById("wheel-close").getBoundingClientRect();
    return [[.5, .5], [.2, .2], [.8, .2], [.2, .8], [.8, .8]].map(([fx, fy]) => document.elementFromPoint(b.left + b.width * fx, b.top + b.height * fy)?.id || "other");
  });
  eq(hits, Array(5).fill("wheel-close"), "element under the close button");
  await p.click("#wheel-close");
  ok(await p.locator("#wheel-modal").isHidden(), "wheel closed");
});

await test("blocked page: no site parameter hides the wheel", async () => {
  const p = await ctx.newPage(); await p.goto(ext("blocked.html"));
  ok(await p.locator("#wheel-open").isHidden(), "wheel button hidden");
  eq(await p.textContent("#site"), "this site", "fallback name");
});

// ---------------------------------------------------------------- wheel
async function openBlocked(domain) {
  const p = await ctx.newPage();
  await visit(p, `http://${domain}:${PORT}/`);
  await waitFor(() => isBlockedPage(p, domain), "blocked page");
  await p.waitForLoadState("load");
  return p;
}
/** Spin with the random outcome forced: r=0 lands on the pass, r=0.99 on "Nothing". */
async function spin(p, r) {
  await p.evaluate((v) => { Math.random = () => v; }, r);
  await p.click("#wheel-open");
  await waitFor(async () => (await p.textContent("#wheel-result")) === "Feeling lucky?", "wheel ready");
  await p.click("#wheel-spin");
}

await test("wheel: a losing spin gives no pass and starts the 20-minute cooldown", async () => {
  await setStore({ sites: [site("blockme.test")] });
  await waitFor(async () => (await rules()).length === 1, "rule");
  const p = await openBlocked("blockme.test");
  await spin(p, 0.99);
  await waitFor(async () => (await p.textContent("#wheel-result")).includes("absolutely nothing"), "losing result", 12000);
  const s = await store(["passes", "spins", "spinDay"]);
  eq(Object.keys(s.passes || {}), [], "no pass");
  ok(s.spins["blockme.test"] > Date.now() - 20000, "cooldown stamp");
  eq(s.spinDay.counts["blockme.test"], 1, "spin counted");
  await p.click("#wheel-close"); await p.click("#wheel-open");
  await waitFor(async () => (await p.textContent("#wheel-result")).includes("confiscated the wheel"), "cooldown message");
  ok(await p.locator("#wheel-spin").isDisabled(), "spin disabled");
  eq(await rules(), ["||blockme.test^"], "still blocked");
});

async function jackpotTest(domain, tamper, expectDomains, maxMs) {
  await setStore({ sites: expectDomains.map((d) => site(d)) });
  await waitFor(async () => (await rules()).length === expectDomains.length, "rules");
  const p = await openBlocked(domain);
  if (tamper) await p.evaluate(tamper);
  const t0 = Date.now();
  await spin(p, 0);
  await waitFor(async () => (await p.textContent("#wheel-result").catch(() => "")).includes("JACKPOT"), "jackpot text", 12000);
  let played = 0;
  await waitFor(async () => {
    played = Math.max(played, await p.evaluate(() => document.getElementById("cutscene").currentTime).catch(() => played));
    const { passes = {} } = await store("passes");
    return Object.keys(passes).length > 0;
  }, "pass granted", maxMs, 150);
  const took = Date.now() - t0;
  const { passes } = await store("passes");
  eq(Object.keys(passes).sort(), [...expectDomains].sort(), "pass domains");
  for (const d of expectDomains) ok(passes[d] > Date.now() + 4.5 * 60000 && passes[d] < Date.now() + 5.1 * 60000, `5-minute pass for ${d}`);
  await waitFor(async () => (await rules()).length === 0, "block rules lifted");
  await waitFor(() => p.url() === `http://${domain}:${PORT}/`, "tab sent back to the address it came from", 8000);
  eq(await p.title(), `OK ${domain}:${PORT}`, "site loaded");
  ok(!p.url().includes("blocked.html"), "not on the blocked page");
  return { took, played };
}

await test("wheel: jackpot plays the cutscene, then gives a 5-minute pass", async () => {
  const { took, played } = await jackpotTest("blockme.test", null, ["blockme.test"], 25000);
  console.log(`      pass after ${took} ms, cutscene reached ${played.toFixed(1)} s`);
  ok(played > 4, `cutscene played to the end (reached ${played.toFixed(1)} s)`);
});

await test("bug4: a pass won on x.com also unlocks twitter.com", async () => {
  await jackpotTest("x.com", null, ["x.com", "twitter.com"], 25000);
  const p = await ctx.newPage();
  await visit(p, `http://twitter.com:${PORT}/`);
  eq(await p.title(), `OK twitter.com:${PORT}`, "twitter.com opens during the pass");
});

await test("bug1: jackpot still gives the pass when the cutscene file fails to load", async () => {
  const { took } = await jackpotTest("blockme.test", () => { document.getElementById("cutscene").src = "art/missing.webm"; }, ["blockme.test"], 20000);
  console.log(`      pass after ${took} ms`);
});

await test("bug1: jackpot still gives the pass when the browser refuses to play the cutscene", async () => {
  const { took } = await jackpotTest("blockme.test", () => { document.getElementById("cutscene").play = () => Promise.reject(new Error("NotAllowedError")); }, ["blockme.test"], 20000);
  console.log(`      pass after ${took} ms`);
});

await test("bug1: jackpot still gives the pass when the cutscene stalls forever", async () => {
  const { took } = await jackpotTest("blockme.test", () => { document.getElementById("cutscene").play = () => Promise.resolve(); }, ["blockme.test"], 35000);
  console.log(`      pass after ${took} ms`);
});

await test("pass: when a pass runs out the block returns and the open tab is kicked", async () => {
  await setStore({ sites: [site("passy.test")], passes: { "passy.test": Date.now() + 4000 } });
  await sleep(500);
  eq(await rules(), [], "no rule during the pass");
  const p = await ctx.newPage();
  await visit(p, `http://passy.test:${PORT}/`);
  eq(await p.title(), `OK passy.test:${PORT}`, "site opens during the pass");
  await waitFor(() => isBlockedPage(p, "passy.test"), "kicked when the pass ends", 12000);
  eq(await rules(), ["||passy.test^"], "rule back");
  eq(Object.keys((await store("passes")).passes), [], "expired pass cleaned up");
});


// ---------------------------------------------------------------- part of a site
const todayKey = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const popup = async () => { const p = await ctx.newPage(); await p.goto(ext("popup.html")); return p; };
// A tab on the blocked page may be going back by itself at the same moment, so wait for the title instead of reading it once.
const loads = async (p, url, what) => { await visit(p, url); await waitFor(async () => (await p.title()) === `OK ${new URL(url).host}`, what); };

await test("path: typing youtube.com/shorts adds only that part; a pasted link still means the whole site", async () => {
  const p = await popup();
  await p.fill("#domain", "YouTube.com/Shorts/"); await p.click("#add-form button[type=submit]");
  await waitFor(async () => (await p.locator(".item .domain").allTextContents()).join() === "youtube.com/shorts", "list shows youtube.com/shorts");
  eq((await store("sites")).sites.map((x) => [x.domain, x.path]), [["youtube.com", "/shorts"]], "stored entry");
  await waitFor(async () => (await rules()).join() === "||youtube.com/shorts^", "rule for the path");
  await p.fill("#domain", "youtube.com/shorts"); await p.click("#add-form button[type=submit]");
  await waitFor(async () => (await p.textContent("#error")).includes("youtube.com/shorts is already"), "duplicate path error");
  await p.fill("#domain", "https://www.youtube.com/watch?v=1"); await p.click("#add-form button[type=submit]");
  await waitFor(async () => (await rules()).join() === "||youtube.com/shorts^,||youtube.com^", "whole site added next to the path");
  await p.fill("#domain", "youtube.com/a b"); await p.click("#add-form button[type=submit]");
  await waitFor(async () => (await p.textContent("#error")).includes("doesn't look like a domain"), "bad path refused");
  eq((await store("sites")).sites.length, 2, "nothing else added");
});

await test("path: only that part of the site is blocked, the rest loads", async () => {
  await setStore({ sites: [site("vid.test", { path: "/shorts" })] });
  await waitFor(async () => (await rules()).join() === "||vid.test/shorts^", "rule");
  const p = await ctx.newPage();
  await loads(p, "http://vid.test/", "home page loads");
  await loads(p, "http://vid.test/watch?v=1", "another part loads");
  await loads(p, "http://vid.test/shortsx", "lookalike path loads");
  await loads(p, "http://other.test/shorts/1", "same path on another site loads");
  for (const u of ["http://vid.test/shorts", "http://vid.test/shorts/abc?x=1", "http://www.vid.test/Shorts/abc", "http://m.vid.test/shorts/"]) {
    let err = ""; try { await p.goto(u, { waitUntil: "domcontentloaded" }); } catch (e) { err = e.message; }
    ok(err.includes("ERR_BLOCKED_BY_CLIENT"), `${u} is stopped by the block rule itself (got: ${err.split("\n")[0]})`);
    await waitFor(() => isBlockedPage(p, "vid.test/shorts"), `${u} goes to the blocked page`);
    await p.waitForLoadState("load"); await sleep(200);
    await loads(p, "http://vid.test/", "home page still loads");
  }
});

await test("path: moving to the blocked part inside the page (no reload) is caught too", async () => {
  await setStore({ sites: [site("vid.test", { path: "/shorts" })] });
  await waitFor(async () => (await rules()).length === 1, "rule");
  const p = await ctx.newPage();
  await loads(p, "http://vid.test/", "home page loads");
  await p.evaluate(() => history.pushState({}, "", "/watch"));
  await sleep(600);
  ok(!p.url().includes("blocked.html"), "in-page move to an open part is left alone");
  await p.evaluate(() => history.pushState({}, "", "/shorts/abc"));
  await waitFor(() => isBlockedPage(p, "vid.test/shorts"), "in-page move to the blocked part is kicked");
  await p.waitForLoadState("load");
  await waitFor(async () => (await p.textContent("#site")) === "vid.test/shorts", "blocked page names the part");
});

await test("path: the YouTube Shorts chip adds and removes just Shorts", async () => {
  const p = await popup();
  await p.locator(".chip", { hasText: /^YouTube Shorts$/ }).click();
  await waitFor(async () => (await rules()).join() === "||youtube.com/shorts^", "Shorts rule");
  ok(await p.locator(".chip.sel", { hasText: /^YouTube Shorts$/ }).count() === 1, "Shorts chip selected");
  ok(await p.locator(".chip.sel", { hasText: /^YouTube$/ }).count() === 0, "YouTube chip not selected");
  ok((await p.locator(".chip", { hasText: /^YouTube Shorts$/ }).locator("img").getAttribute("src")).endsWith("icons/sites/youtube.com.png"), "chip icon");
  await p.locator(".chip", { hasText: /^YouTube$/ }).click();
  await waitFor(async () => (await rules()).join() === "||youtube.com/shorts^,||youtube.com^", "both rules");
  await p.locator(".chip", { hasText: /^YouTube Shorts$/ }).click();
  await waitFor(async () => (await rules()).join() === "||youtube.com^", "only YouTube left");
});

await test("path: a wheel pass won on a blocked part opens that part", async () => {
  await setStore({ sites: [site("vid.test", { path: "/shorts" })] });
  await waitFor(async () => (await rules()).length === 1, "rule");
  const p = await ctx.newPage();
  await visit(p, "http://vid.test/shorts/abc");
  await waitFor(() => isBlockedPage(p, "vid.test/shorts"), "blocked page");
  await p.waitForLoadState("load");
  await spin(p, 0);
  await waitFor(async () => Object.keys((await store("passes")).passes || {}).join() === "vid.test/shorts", "pass for the part", 25000, 150);
  await waitFor(async () => (await rules()).length === 0, "rule lifted");
  await waitFor(() => p.url() === "http://vid.test/shorts/abc", "tab sent back to the exact address it came from", 8000);
});

// ---------------------------------------------------------------- focus session
await test("focus: the panel remembers its setup, and the allowed sites can be edited", async () => {
  const p = await popup();
  ok(await p.locator("#focus-panel").isHidden(), "panel closed at first");
  await p.click("#focus-btn");
  eq(await p.textContent("#focus-start"), "Start 25-minute focus", "default 25 minutes");
  ok(await p.locator("#focus-start").isDisabled(), "cannot start on an empty list");
  ok((await p.textContent("#focus-hint")).includes("list is empty"), "empty list hint");
  await p.locator("#focus-mins button[data-min='50']").click();
  eq(await p.textContent("#focus-start"), "Start 50-minute focus", "50 minutes");
  await p.fill("#focus-custom", "90");
  await waitFor(async () => (await p.textContent("#focus-start")) === "Start 90-minute focus", "custom minutes");
  await p.fill("#focus-custom", "9999");
  await waitFor(async () => (await p.textContent("#focus-start")) === "Start 180-minute focus", "capped at 180");
  ok(await p.locator("#focus-allow").isHidden(), "allowed sites hidden in list mode");
  await p.locator("#focus-mode button[data-mode=all]").click();
  ok(await p.locator("#focus-allow").isVisible(), "allowed sites shown");
  ok(await p.locator("#focus-start").isEnabled(), "can start when blocking everything");
  for (const d of ["https://Docs.Google.com/document/1", "not a site", "localhost", "docs.google.com"]) { await p.fill("#allow-input", d); await p.press("#allow-input", "Enter"); await sleep(150); }
  eq((await store("focusAllow")).focusAllow, ["docs.google.com", "localhost"], "allowed sites saved, normalised, no duplicates");
  await p.locator(".chip.allowed", { hasText: "localhost" }).click();
  await waitFor(async () => (await store("focusAllow")).focusAllow.join() === "docs.google.com", "allowed site removed");
  eq((await store("focusPrefs")).focusPrefs, { minutes: 180, mode: "all" }, "setup saved");
  const p2 = await popup(); await p2.click("#focus-btn");
  eq(await p2.textContent("#focus-start"), "Start 180-minute focus", "setup remembered");
  eq(await p2.locator(".chip.allowed").allTextContents(), ["docs.google.com"], "allowed sites remembered");
  eq(await rules(), [], "nothing blocked before starting");
});

await test("focus: block my list overrides paused, off-schedule and limits, keeps wheel passes, and locks the list", async () => {
  const other = (new Date().getDay() + 3) % 7;
  await setStore({
    sites: [site("paused.test", { enabled: false }), site("offday.test", { schedule: { days: [other], start: "00:00", end: "00:00" } }), site("limited.test", { limit: 30 }), site("passy.test")],
    passes: { "passy.test": Date.now() + 120000 },
  });
  await sleep(500);
  eq(await rules(), [], "nothing blocked before the session");
  const p = await popup();
  await p.click("#focus-btn"); await p.click("#focus-start");
  ok(await p.locator("#focus-confirm").isVisible() && await p.locator("#focus-setup").isHidden(), "asks before starting");
  eq(await p.textContent("#confirm-title"), "Lock in for 25 minutes?", "confirm title");
  ok((await p.textContent("#confirm-what")).startsWith("Your whole list will be blocked until"), "confirm text");
  ok((await p.textContent("#focus-confirm")).includes("Ending early takes a 60-second wait"), "confirm warning");
  eq((await store("focus")).focus, undefined, "not started yet");
  await p.click("#confirm-back");
  ok(await p.locator("#focus-setup").isVisible() && await p.locator("#focus-confirm").isHidden(), "go back returns to the setup");
  eq((await store("focus")).focus, undefined, "going back starts nothing");
  await p.click("#focus-start"); await p.click("#confirm-go");
  const { focus } = await store("focus");
  eq(focus.mode, "list", "mode");
  ok(Math.abs(focus.until - Date.now() - 25 * 60000) < 5000, "ends in 25 minutes");
  await waitFor(async () => (await rules()).length === 3, "all entries blocked, except the one with a wheel pass");
  ok(/^🎯 2[45]:\d\d$/.test(await p.textContent("#focus-btn")), `countdown on the button (${await p.textContent("#focus-btn")})`);
  ok(await p.locator("#focus-setup").isHidden() && await p.locator("#focus-running").isVisible(), "running view");
  ok((await p.textContent("#focus-what")).includes("Your whole list is blocked until"), "running text");
  eq(await p.locator(".item .pill").allTextContents(), ["Focus", "Focus", "Focus", "Wheel pass"], "pills");
  eq(await p.textContent("#summary"), "3 of 4 sites blocked right now", "summary");
  // nothing can be removed, paused or edited
  await p.locator(".item .remove").first().click({ force: true });
  await p.locator(".item .toggle-edit").first().click({ force: true });
  await p.evaluate(() => { const c = document.querySelector(".item .enabled"); c.checked = !c.checked; c.dispatchEvent(new Event("change")); });
  await sleep(400);
  const after = (await store("sites")).sites;
  eq(after.length, 4, "nothing removed"); eq(after[0].enabled, false, "switch unchanged");
  eq(await p.locator(".editor:visible").count(), 0, "editor stays closed");
  // a preset already on the list can't be taken off; adding still works
  await setStore({ sites: [...after, site("tiktok.com")] });
  const p2 = await popup();
  await p2.locator(".chip", { hasText: /^TikTok$/ }).click();
  await waitFor(async () => (await p2.textContent("#error")).includes("Nothing leaves the list"), "preset removal refused");
  await p2.locator(".chip", { hasText: /^Reddit$/ }).click();
  await waitFor(async () => (await store("sites")).sites.length === 6, "adding during a session works");
  // the sites really are blocked, and the blocked page explains and still offers the wheel
  const t = await ctx.newPage();
  await loads(t, "http://passy.test/", "a running wheel pass survives the session");
  for (const d of ["paused.test", "offday.test", "limited.test"]) {
    await visit(t, `http://${d}/`);
    await waitFor(() => isBlockedPage(t, d), `${d} blocked`);
    await t.waitForLoadState("load"); await sleep(200);
  }
  await waitFor(async () => (await t.textContent("#note")).includes("Focus session: 25 minutes to go"), "blocked page note");
  ok(await t.locator("#wheel-open").isVisible(), "wheel offered during a session");
  ok(await t.locator("#focus-exit").isVisible(), "end-early button on the blocked page");
  await loads(t, "http://fine.test/", "sites off the list still load");
});

await test("focus: when the session ends the blocks lift, the list unlocks and the blocked page says so", async () => {
  await setStore({ sites: [site("paused.test", { enabled: false }), site("always.test")], focus: { until: Date.now() + 5000, mode: "list" } });
  await waitFor(async () => (await rules()).length === 2, "both blocked");
  const p = await popup();
  const t = await ctx.newPage(), t2 = await ctx.newPage();
  await visit(t, "http://paused.test/deep/page?x=1"); await waitFor(() => isBlockedPage(t, "paused.test"), "blocked");
  await visit(t2, "http://always.test/"); await waitFor(() => isBlockedPage(t2, "always.test"), "blocked");
  await waitFor(async () => (await rules()).join() === "||always.test^", "only the always-blocked site stays", 12000);
  eq((await store("focus")).focus, undefined, "finished session forgotten");
  await waitFor(async () => (await p.textContent("#focus-btn")) === "🎯 Focus", "button back to normal");
  eq(await p.locator(".item .pill").allTextContents(), ["Paused", "Blocked"], "pills after the session");
  ok(!(await p.locator("#list").getAttribute("class")).includes("locked"), "list unlocked");
  await waitFor(async () => t.url() === "http://paused.test/deep/page?x=1" && (await t.title()) === "OK paused.test", "the tab goes back to where it was by itself");
  await waitFor(async () => await t2.locator("#note").isHidden(), "still-blocked site shows no focus note");
  ok(await t2.locator("#wheel-open").isVisible(), "wheel is back for the still-blocked site");
  await loads(t, "http://paused.test/", "site opens again");
});

await test("focus: ending early takes a 60-second wait and can be called off", async () => {
  const until = Date.now() + 25 * 60000;
  await setStore({ sites: [site("always.test"), site("paused.test", { enabled: false })], focus: { until, mode: "list" } });
  await waitFor(async () => (await rules()).length === 2, "both blocked");
  const p = await popup();
  const t = await ctx.newPage();
  await visit(t, "http://paused.test/"); await waitFor(() => isBlockedPage(t, "paused.test"), "blocked");
  await waitFor(async () => (await t.textContent("#focus-exit")) === "End session early" && await t.locator("#focus-exit").isVisible(), "blocked page has the exit button");
  eq(await p.textContent("#focus-exit"), "End session early", "exit link");
  ok(await p.locator("#exit-note").isHidden(), "no exit note yet");
  await p.click("#focus-exit");
  let { focus } = await store("focus");
  ok(Math.abs(focus.exitAt - Date.now() - 60000) < 3000 && focus.until === until, `exit set 60 s ahead (${focus.exitAt - Date.now()})`);
  await waitFor(async () => /^Ending in 00:5\d\. Changed your mind\?$/.test(await p.textContent("#exit-note")), "exit countdown");
  eq(await p.textContent("#focus-exit"), "Keep focusing", "link flips");
  eq((await rules()).length, 2, "still blocked while waiting");
  await waitFor(async () => (await t.textContent("#focus-exit")) === "Keep focusing" && /ending in 00:\d\d/.test(await t.textContent("#note-text")), "blocked page shows the countdown too");
  await p.click("#focus-exit");
  ({ focus } = await store("focus"));
  ok(focus.exitAt === undefined && focus.until === until, "called off, session unchanged");
  ok(await p.locator("#exit-note").isHidden(), "exit note gone");
  // the same button on the blocked page
  await waitFor(async () => (await t.textContent("#focus-exit")) === "End session early", "blocked page back to normal");
  await t.click("#focus-exit");
  await waitFor(async () => (await store("focus")).focus.exitAt > Date.now(), "exit requested from the blocked page");
  await waitFor(async () => (await p.textContent("#focus-exit")) === "Keep focusing", "popup follows");
  await t.click("#focus-exit");
  await waitFor(async () => (await store("focus")).focus.exitAt === undefined, "called off from the blocked page");
  // Don't wait the full minute: put the exit a few seconds ahead.
  await setStore({ sites: [site("always.test"), site("paused.test", { enabled: false })], focus: { until, mode: "list", exitAt: Date.now() + 4000 } });
  await waitFor(async () => (await rules()).join() === "||always.test^", "session over after the wait", 12000);
  eq((await store("focus")).focus, undefined, "ended session forgotten");
  await waitFor(async () => (await p.textContent("#focus-btn")) === "🎯 Focus", "button back to normal");
  await waitFor(async () => (await t.title()) === "OK paused.test", "the tab goes back by itself");
});

await test("focus: a wheel win during a session opens that one site", async () => {
  for (const mode of ["all", "list"]) {
    await setStore({ sites: [site("lucky.test"), site("other.test")], passes: {}, spins: {}, focus: { until: Date.now() + 25 * 60000, mode } });
    await waitFor(async () => (await rules()).includes(mode === "all" ? "|http" : "||other.test^"), `${mode}: session rules`);
    const p = await openBlocked("lucky.test");
    await waitFor(async () => (await p.textContent("#note-text")).includes("Focus session"), `${mode}: focus note`);
    await spin(p, 0);
    await waitFor(() => p.url() === `http://lucky.test:${PORT}/`, `${mode}: tab sent to the site after the win`, 30000);
    eq(await p.title(), `OK lucky.test:${PORT}`, `${mode}: site loaded`);
    ok((await store("passes")).passes["lucky.test"] > Date.now(), `${mode}: pass stored`);
    await visit(p, "http://other.test/"); await waitFor(() => isBlockedPage(p, "other.test"), `${mode}: the rest stays blocked`);
    await p.close();
  }
});

await test("focus: block everything stops every site except the allowed ones", async () => {
  await setStore({ sites: [site("always.test"), site("partly.test", { path: "/feed" })], focusAllow: ["ok.test", "always.test", "partly.test"], focusPrefs: { minutes: 25, mode: "all" } });
  const p = await popup();
  await p.click("#focus-btn");
  eq(await p.textContent("#focus-start"), "Start 25-minute focus", "ready");
  await p.click("#focus-start");
  const what = await p.textContent("#confirm-what");
  ok(what.startsWith("Every website will be blocked until") && what.endsWith("except: ok.test, always.test, partly.test."), `confirm names the allowed sites (${what})`);
  await p.click("#confirm-go");
  await waitFor(async () => (await rules()).join() === "|http,||always.test^,||always.test^,||ok.test^,||partly.test/feed^,||partly.test^", "rules: block all, allow three, block the list");
  eq(await p.textContent("#summary"), "Focus session: everything is blocked", "summary");
  ok((await p.textContent("#focus-what")).includes("Everything is blocked until"), "running text");
  ok(await p.locator("#focus-setup").isHidden(), "allowed sites can't be edited during a session");
  const t = await ctx.newPage();
  await loads(t, "http://ok.test/page", "allowed site loads");
  await loads(t, "http://docs.ok.test/", "its subdomain loads");
  await loads(t, "http://partly.test/home", "allowed site with a blocked part: the rest loads");
  for (const [u, name] of [["http://random.test/x", "random.test"], ["http://www.news.test/", "news.test"], ["http://notok.test/", "notok.test"], ["http://always.test/", "always.test"], ["http://partly.test/feed/1", "partly.test/feed"]]) {
    let err = ""; try { await t.goto(u, { waitUntil: "domcontentloaded" }); } catch (e) { err = e.message; }
    ok(err.includes("ERR_BLOCKED_BY_CLIENT"), `${u} stopped by the rules (got: ${err.split("\n")[0]})`);
    await waitFor(() => isBlockedPage(t, name), `${u} -> blocked page for ${name}`);
    await t.waitForLoadState("load"); await sleep(200);
  }
  await visit(t, "http://random.test/");
  await waitFor(() => isBlockedPage(t, "random.test"), "blocked page"); await t.waitForLoadState("load");
  await waitFor(async () => (await t.textContent("#note")).includes("Focus session"), "note on the blocked page");
  ok(await t.locator("#wheel-open").isVisible(), "wheel offered");
  // a wheel pass opens that one site, and nothing else
  await api(() => chrome.storage.local.set({ passes: { "random.test": Date.now() + 120000 } }));
  await waitFor(async () => (await rules()).join() === "|http,||always.test^,||always.test^,||ok.test^,||partly.test/feed^,||partly.test^,||random.test^", "pass adds an allow rule");
  await loads(t, "http://random.test/x", "site with a pass loads");
  await visit(t, "http://news.test/"); await waitFor(() => isBlockedPage(t, "news.test"), "other sites stay blocked");
  await api(() => chrome.storage.local.set({ passes: {} }));
  await visit(t, "http://random.test/"); await waitFor(() => isBlockedPage(t, "random.test"), "blocked again without the pass"); await t.waitForLoadState("load");
  const ep = await popup(); // the extension's own pages keep working
  ok(await ep.locator("#focus-running").isVisible(), "popup still opens");
  // a tab that was already open on a site that isn't allowed gets kicked when a session starts
  await api(() => chrome.storage.local.remove("focus"));
  await waitFor(async () => (await rules()).join() === "||always.test^,||partly.test/feed^", "back to the normal rules");
  await loads(t, "http://random.test/", "site loads after the session");
  await setStore({ focus: { until: Date.now() + 60000, mode: "all" } });
  await waitFor(() => isBlockedPage(t, "random.test"), "open tab kicked when a session starts");
});

// ---------------------------------------------------------------- daily limit
await test("limit: the editor sets a daily limit, one mode at a time", async () => {
  await setStore({ sites: [site("youtube.com")] });
  const p = await popup();
  await p.locator(".item .toggle-edit").click();
  ok(await p.locator(".item .sched-fields").isHidden() && await p.locator(".item .limit-fields").isHidden(), "Always shows no extra fields");
  await p.locator(".item .seg button[data-mode=limit]").click();
  await waitFor(async () => (await store("sites")).sites[0].limit === 30, "default 30 minutes");
  eq((await store("sites")).sites[0].schedule, null, "no schedule");
  eq(await p.locator(".item .sched").textContent(), "30 of 30 min left today", "label");
  eq(await p.locator(".item .pill").textContent(), "Open", "pill");
  eq(await p.textContent("#summary"), "0 of 1 site blocked right now", "summary");
  await waitFor(async () => (await rules()).length === 0, "not blocked while minutes are left");
  ok(await p.locator(".item .limit-fields").isVisible() && await p.locator(".item .sched-fields").isHidden(), "limit fields only");
  await p.locator(".item .limit-row button[data-limit='15']").click();
  await waitFor(async () => (await store("sites")).sites[0].limit === 15, "15 minutes");
  await p.locator(".item .limit-min").fill("45"); await p.locator(".item .limit-min").dispatchEvent("change");
  await waitFor(async () => (await store("sites")).sites[0].limit === 45, "custom 45 minutes");
  eq(await p.locator(".item .sched").textContent(), "45 of 45 min left today", "label after change");
  await p.locator(".item .limit-min").fill("0"); await p.locator(".item .limit-min").dispatchEvent("change");
  await sleep(300);
  eq((await store("sites")).sites[0].limit, 45, "zero is ignored");
  await p.locator(".item .seg button[data-mode=schedule]").click();
  await waitFor(async () => { const x = (await store("sites")).sites[0]; return x.schedule && x.limit === undefined; }, "schedule replaces the limit");
  await p.locator(".item .seg button[data-mode=limit]").click();
  await waitFor(async () => { const x = (await store("sites")).sites[0]; return x.schedule === null && x.limit === 30; }, "limit replaces the schedule");
  await p.locator(".item .seg button[data-mode=always]").click();
  await waitFor(async () => { const x = (await store("sites")).sites[0]; return x.schedule === null && x.limit === undefined; }, "always clears both");
  await waitFor(async () => (await rules()).join() === "||youtube.com^", "blocked again");
});

await test("limit: time counts only while the site is the tab in front", async () => {
  await setStore({ sites: [site("lim.test", { limit: 30 })] });
  const used = async () => ((await store("usage")).usage?.secs || {})["lim.test"] || 0;
  const a = await ctx.newPage(), b = await ctx.newPage();
  await loads(b, "http://fine.test/", "other site loads");
  await loads(a, "http://lim.test/", "limited site loads");
  await b.bringToFront(); await sleep(400);
  const u0 = await used();
  await sleep(3000);                        // limited site is open but hidden behind another tab
  await a.bringToFront(); await sleep(400);
  const u1 = await used();
  ok(u1 - u0 < 0.5, `hidden tab is not counted (added ${(u1 - u0).toFixed(1)} s)`);
  await sleep(3000);                        // now it is the tab in front
  await b.bringToFront(); await sleep(400);
  const u2 = await used();
  console.log(`      hidden 3 s: +${(u1 - u0).toFixed(1)} s, in front ~3.4 s: +${(u2 - u1).toFixed(1)} s`);
  ok(u2 - u1 > 2.8 && u2 - u1 < 4.5, `front tab is counted (added ${(u2 - u1).toFixed(1)} s)`);
  await a.bringToFront(); await sleep(300);
  await a.goto("http://fine.test/x");       // leaving the site in the same tab stops the count
  await sleep(2500);
  const u3 = await used(); await b.bringToFront(); await sleep(400);
  ok((await used()) - u3 < 0.5, "time on another site in the same tab is not counted");
  eq((await store("usage")).usage.key, todayKey(), "counted under today's date");
  eq(await rules(), [], "still open");
});

await test("limit: when the minutes run out the site is blocked on the spot, until midnight", async () => {
  await setStore({ sites: [site("lim.test", { limit: 1 })], usage: { key: todayKey(), secs: { "lim.test": 54 } } });
  await sleep(400);
  eq(await rules(), [], "open with 6 seconds left");
  const p = await popup();
  eq(await p.locator(".item .sched").textContent(), "1 of 1 min left today", "label");
  const t = await ctx.newPage();
  await loads(t, "http://lim.test/", "site loads");
  const t0 = Date.now();
  await waitFor(() => isBlockedPage(t, "lim.test"), "kicked when the limit runs out", 20000);
  const took = (Date.now() - t0) / 1000;
  console.log(`      blocked ${took.toFixed(1)} s after opening with 6 s left`);
  ok(took > 4.5 && took < 9, `blocked after about 6 s (took ${took.toFixed(1)} s)`);
  eq(await rules(), ["||lim.test^"], "rule on");
  ok(((await store("usage")).usage.secs["lim.test"]) >= 60, "full minute recorded");
  await t.waitForLoadState("load");
  await waitFor(async () => (await t.textContent("#note")).includes("Today's minute on lim.test is used up"), "blocked page explains the limit");
  ok(await t.locator("#wheel-open").isVisible(), "wheel still offered");
  await waitFor(async () => (await p.locator(".item .sched").textContent()) === "1 min used up, back tomorrow", "popup label updates live");
  eq(await p.locator(".item .pill").textContent(), "Blocked", "pill");
  // a wheel pass opens it for 5 minutes; a new day gives fresh minutes
  await setStore({ passes: { "lim.test": Date.now() + 60000 } });
  await waitFor(async () => (await rules()).length === 0, "pass lifts the block");
  await setStore({ passes: {} });
  await waitFor(async () => (await rules()).length === 1, "blocked again without the pass");
  await setStore({ usage: { key: "2000-01-01", secs: { "lim.test": 9999 } }, sites: [site("lim.test", { limit: 2 })] });
  await waitFor(async () => (await rules()).length === 0, "yesterday's minutes don't count");
});

await test("limit: works for one part of a site, and a paused limit doesn't count", async () => {
  await setStore({ sites: [site("vid.test", { path: "/shorts", limit: 30 }), site("off.test", { limit: 30, enabled: false })] });
  const secs = async () => (await store("usage")).usage?.secs || {};
  const a = await ctx.newPage(), b = await ctx.newPage();
  await loads(a, "http://vid.test/watch", "site loads");
  await a.bringToFront(); await sleep(2000);
  await a.goto("http://vid.test/shorts/abc"); await sleep(2500);
  await a.goto("http://off.test/"); await sleep(2000);
  await b.bringToFront(); await sleep(400);
  const s = await secs();
  console.log(`      counted: ${JSON.stringify(s)}`);
  ok(s["vid.test/shorts"] > 2 && s["vid.test/shorts"] < 3.6, `only the time on the part counts (${s["vid.test/shorts"]} s)`);
  eq(s["off.test"], undefined, "paused limit not counted");
});

// ---------------------------------------------------------------- rating request
await test("rate: asked once after three days, never during the first days, answer is remembered", async () => {
  const DAY = 24 * 3600 * 1000;
  const shown = () => ctl.evaluate(() => !document.querySelector("#rate").hidden);
  await setStore({ sites: [site("a.test")] });
  await ctl.reload();
  ok(!(await shown()), "not asked on day one");
  ok((await store("rate")).rate.since > Date.now() - 60000, "first open is remembered");

  await setStore({ rate: { since: Date.now() - 4 * DAY }, sites: [] });
  await ctl.reload();
  ok(!(await shown()), "not asked with an empty list");
  await setStore({ sites: [site("a.test")], focus: { until: Date.now() + 60000, mode: "list" } });
  await ctl.reload();
  ok(!(await shown()), "not asked during a focus session");
  await api(() => chrome.storage.local.remove("focus"));
  await ctl.reload();
  ok(await shown(), "asked after three days");

  await ctl.click("#rate-no");
  ok(!(await shown()), "hidden after No thanks");
  eq((await store("rate")).rate.answer, "no", "answer saved");
  await ctl.reload();
  ok(!(await shown()), "stays hidden");

  await setStore({ rate: { since: Date.now() - 4 * DAY } });
  await ctl.reload();
  await ctl.click("#rate-go");
  // The test browser cannot reach the real store, so check the address the new tab was sent to.
  const want = `https://chromewebstore.google.com/detail/${ID}/reviews`;
  await waitFor(() => api((u) => chrome.tabs.query({}).then((ts) => ts.some((t) => (t.pendingUrl || t.url) === u)), want), "a tab opened on the reviews page");
  eq((await store("rate")).rate.answer, "yes", "answer saved");
  await ctl.bringToFront();
  ok(!(await shown()), "hidden after Rate");
});

// ---------------------------------------------------------------- wrap up
await test("no JavaScript errors on extension pages", async () => {
  eq(errors, [], "page errors");
});

await ctx.close();
server.close();
fs.rmSync(profile, { recursive: true, force: true });
const failed = results.filter((r) => r[1] === "FAIL");
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
