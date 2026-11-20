// One-click presets. A preset can cover several domains (e.g. X = x.com + twitter.com),
// or only a part of a site (youtube.com/shorts).
// Subdomains are covered automatically (youtube.com also blocks m.youtube.com).
// Icons are bundled in /icons/sites/<first-domain>.png, or <icon>.png if the preset names one.

export const PRESET_GROUPS = [
  {
    name: "Popular",
    items: [
      { label: "TikTok", domains: ["tiktok.com"] },
      { label: "Instagram", domains: ["instagram.com"] },
      { label: "Facebook", domains: ["facebook.com"] },
      { label: "X", domains: ["x.com", "twitter.com"] },
      { label: "YouTube", domains: ["youtube.com"] },
      { label: "YouTube Shorts", domains: ["youtube.com/shorts"], icon: "youtube.com" },
      { label: "Reddit", domains: ["reddit.com"] },
      { label: "Netflix", domains: ["netflix.com"] },
      { label: "LinkedIn", domains: ["linkedin.com"] },
    ],
  },
  {
    name: "Social & chat",
    items: [
      { label: "Threads", domains: ["threads.com", "threads.net"] },
      { label: "Snapchat", domains: ["snapchat.com"] },
      { label: "Pinterest", domains: ["pinterest.com"] },
      { label: "Tumblr", domains: ["tumblr.com"] },
      { label: "Bluesky", domains: ["bsky.app"] },
      { label: "Discord", domains: ["discord.com"] },
      { label: "Telegram Web", domains: ["web.telegram.org"] },
      { label: "WhatsApp Web", domains: ["web.whatsapp.com"] },
      { label: "Messenger", domains: ["messenger.com"] },
      { label: "Quora", domains: ["quora.com"] },
      { label: "9GAG", domains: ["9gag.com"] },
    ],
  },
  {
    name: "Video & streaming",
    items: [
      { label: "Twitch", domains: ["twitch.tv"] },
      { label: "Prime Video", domains: ["primevideo.com"] },
      { label: "Disney+", domains: ["disneyplus.com"] },
      { label: "HBO Max", domains: ["hbomax.com", "max.com"] },
      { label: "Hulu", domains: ["hulu.com"] },
      { label: "Kick", domains: ["kick.com"] },
      { label: "Vimeo", domains: ["vimeo.com"] },
      { label: "Spotify", domains: ["open.spotify.com"] },
    ],
  },
  {
    name: "News",
    items: [
      { label: "Google News", domains: ["news.google.com"] },
      { label: "Hacker News", domains: ["news.ycombinator.com"] },
      { label: "CNN", domains: ["cnn.com"] },
      { label: "BBC", domains: ["bbc.com", "bbc.co.uk"] },
      { label: "NY Times", domains: ["nytimes.com"] },
      { label: "The Guardian", domains: ["theguardian.com"] },
      { label: "Fox News", domains: ["foxnews.com"] },
    ],
  },
  {
    name: "Shopping",
    items: [
      {
        label: "Amazon",
        domains: [
          "amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.it", "amazon.es",
          "amazon.ca", "amazon.com.au", "amazon.in", "amazon.co.jp", "amazon.com.br", "amazon.com.mx",
        ],
      },
      { label: "eBay", domains: ["ebay.com", "ebay.co.uk", "ebay.de", "ebay.fr", "ebay.it", "ebay.com.au", "ebay.ca"] },
      { label: "AliExpress", domains: ["aliexpress.com"] },
      { label: "Temu", domains: ["temu.com"] },
      { label: "Shein", domains: ["shein.com"] },
      { label: "Etsy", domains: ["etsy.com"] },
    ],
  },
  {
    name: "Games",
    items: [
      { label: "Chess.com", domains: ["chess.com"] },
      { label: "Lichess", domains: ["lichess.org"] },
      { label: "Steam", domains: ["store.steampowered.com", "steamcommunity.com"] },
      { label: "Roblox", domains: ["roblox.com"] },
      { label: "Poki", domains: ["poki.com"] },
      { label: "CrazyGames", domains: ["crazygames.com"] },
    ],
  },
];

/** Map every preset domain -> bundled icon path. */
export const PRESET_ICON = Object.fromEntries(
  PRESET_GROUPS.flatMap((g) => g.items).flatMap((p) =>
    p.domains.map((d) => [d, `/icons/sites/${p.icon || p.domains[0]}.png`])
  )
);
