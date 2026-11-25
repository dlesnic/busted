// What kind of site a host is. Used by Insights to tell work from distraction.
// Everything here is a plain lookup that ships with the extension; nothing is fetched.

import { PRESET_GROUPS } from "./presets.js";

/** Category -> how Insights treats it. Sites not in the catalog are "neutral". */
export const KIND_OF_CATEGORY = {
  social: "distraction", video: "distraction", news: "distraction", shopping: "distraction", games: "distraction",
  work: "work", learning: "work",
};
export const KINDS = ["work", "distraction", "neutral"];
export const KIND_LABEL = { work: "Work", distraction: "Distraction", neutral: "Neutral" };

const GROUP_CATEGORY = { "Social & chat": "social", "Video & streaming": "video", News: "news", Shopping: "shopping", Games: "games" };
const POPULAR_VIDEO = ["youtube.com", "netflix.com"];

const WORK = [
  // documents, mail, calendar, storage
  "docs.google.com", "drive.google.com", "mail.google.com", "calendar.google.com", "meet.google.com", "keep.google.com",
  "office.com", "microsoft365.com", "cloud.microsoft", "live.com", "sharepoint.com", "teams.microsoft.com", "outlook.com",
  "notion.so", "notion.site", "dropbox.com", "box.com", "evernote.com", "proton.me",
  // planning and teamwork
  "atlassian.net", "atlassian.com", "trello.com", "asana.com", "monday.com", "clickup.com", "linear.app", "basecamp.com",
  "airtable.com", "miro.com", "slack.com", "zoom.us", "webex.com", "calendly.com", "hubspot.com", "salesforce.com", "zendesk.com",
  // design
  "figma.com", "canva.com", "adobe.com", "framer.com",
  // building software
  "github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com", "stackexchange.com", "developer.mozilla.org", "npmjs.com",
  "vercel.com", "netlify.com", "cloudflare.com", "aws.amazon.com", "cloud.google.com", "console.cloud.google.com", "azure.com",
  "digitalocean.com", "heroku.com", "sentry.io", "datadoghq.com", "postman.com", "codepen.io", "replit.com", "localhost", "127.0.0.1",
  // assistants
  "chatgpt.com", "gemini.google.com", "perplexity.ai", "copilot.microsoft.com",
];
const LEARNING = [
  "wikipedia.org", "coursera.org", "udemy.com", "edx.org", "khanacademy.org", "duolingo.com", "brilliant.org",
  "freecodecamp.org", "leetcode.com", "scholar.google.com", "arxiv.org", "translate.google.com", "deepl.com",
];

/** Known site -> category. */
export const CATALOG = Object.fromEntries([
  ...PRESET_GROUPS.flatMap((g) => g.items.flatMap((p) => p.domains.filter((d) => !d.includes("/")).map((d) => [
    d, GROUP_CATEGORY[g.name] || (POPULAR_VIDEO.includes(d) ? "video" : "social"),
  ]))),
  ...WORK.map((d) => [d, "work"]),
  ...LEARNING.map((d) => [d, "learning"]),
]);

/**
 * The name a host is counted under: the most specific known site it belongs to
 * ("m.youtube.com" -> "youtube.com", "console.aws.amazon.com" -> "aws.amazon.com"),
 * or the host itself without "www." when it is not a known site.
 */
export function siteOf(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  const labels = h.split(".");
  for (let i = 0; i < labels.length; i++) {
    const tail = labels.slice(i).join(".");
    if (Object.hasOwn(CATALOG, tail)) return tail;
  }
  return h;
}

/** "work", "distraction" or "neutral". The user's own choice for a site (overrides) wins over the catalog. */
export function kindOf(site, overrides = {}) {
  return overrides[site] || KIND_OF_CATEGORY[CATALOG[site]] || "neutral";
}
