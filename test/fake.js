// A fake network for offline tests: FxTwitter, vxTwitter, the X embed endpoint, xAI and a relay.
// Every request is recorded in `calls`.

export const ENV = {
  FX_API_BASE: "https://fx.test",
  VX_API_BASE: "https://vx.test",
  SYND_API_BASE: "https://synd.test",
  XAI_API_BASE: "https://xai.test/v1",
};

export function fxUser(h, extra = {}) {
  return {
    screen_name: h, name: h.toUpperCase(), followers: 1234, following: 5, statuses: 99, likes: 10,
    description: `bio of ${h}`, joined: "Tue Mar 21 20:50:14 +0000 2006", verification: { verified: true },
    avatar_url: `https://pbs.twimg.com/profile_images/1/${h}_normal.jpg`, ...extra,
  };
}

export function fxStatus(id, h = "alice", extra = {}) {
  return {
    type: "status", id: String(id), url: `https://x.com/${h}/status/${id}`, text: `full text of ${id}`,
    created_timestamp: 1760000000, likes: 100, reposts: 20, quotes: 5, replies: 30, views: 10000, bookmarks: 60,
    lang: "en", author: fxUser(h), media: {}, ...extra,
  };
}

function syndToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, "");
}

const ARTICLE = {
  title: "My Article", preview_text: "preview", content: { blocks: [
    { key: "a", type: "header-one", text: "Title", entityRanges: [] },
    { key: "b", type: "unstyled", text: "Para one.", entityRanges: [] },
    { key: "c", type: "ordered-list-item", text: "first", entityRanges: [] },
    { key: "d", type: "ordered-list-item", text: "second", entityRanges: [] },
    { key: "e", type: "atomic", text: " ", entityRanges: [{ key: 0, offset: 0, length: 1 }] },
  ], entityMap: [{ key: "0", value: { type: "MARKDOWN", data: { markdown: "```js\ncode()\n```" } } }] },
};

/** Timeline for the audit tests: originals, replies, a repost, one breakout post. */
export function auditTimeline() {
  const t0 = 1760000000;
  const posts = [];
  for (let i = 0; i < 12; i++) {
    posts.push(fxStatus(1000 + i, "dana", { created_timestamp: t0 - i * 86400, views: 1000 + i * 10, likes: 20, bookmarks: 14, replies: 4 }));
  }
  posts.push(fxStatus(2000, "dana", { created_timestamp: t0 - 3600, views: 120000, likes: 900, bookmarks: 800, replies: 300, text: "the big one" }));
  for (let i = 0; i < 5; i++) {
    posts.push(fxStatus(3000 + i, "dana", { created_timestamp: t0 - i * 7200, replying_to: { screen_name: "someone", status: "9" }, likes: 1, views: 50 }));
  }
  posts.push({ ...fxStatus(4000, "zed"), reposted_by: { screen_name: "dana" } });
  posts.push(fxStatus(5000, "dana", { created_timestamp: t0 - 200000, text: "read this https://example.com/post", likes: 15, bookmarks: 1 }));
  return posts;
}

function json(status, data) {
  return new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export function makeFetch(overrides = {}) {
  const calls = [];
  const flaky = new Map();
  async function fetch(input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: url.toString(), method: init.method || "GET", headers: init.headers || {}, body });
    for (const [prefix, fn] of Object.entries(overrides)) {
      if (url.toString().startsWith(prefix)) return fn(url, init, body);
    }
    const p = url.pathname;
    let m;
    if (url.host === "fx.test") {
      if ((m = p.match(/^\/2\/status\/(\d+)$/))) {
        const id = m[1];
        if (id === "100") {
          return json(200, { code: 200, status: fxStatus(100, "alice", {
            quote: fxStatus(90, "bob"),
            media: { photos: [{ type: "photo", url: "https://pbs.twimg.com/a.jpg", altText: "alt" }], videos: [{ type: "video", url: "https://video.twimg.com/v.mp4", thumbnail_url: "https://pbs.twimg.com/t.jpg", duration: 12.5 }] },
            community_note: { text: "context note" },
            article: ARTICLE,
            translation: url.searchParams.get("lang") ? { text: "翻译", source_lang: "en", target_lang: url.searchParams.get("lang") } : undefined,
          }) });
        }
        if (id === "500") return json(200, { code: 200, status: { type: "tombstone", reason: "deleted", id: "500" } });
        if (id === "404") return json(404, { code: 404, message: "NOT_FOUND" });
        if (["200", "300"].includes(id)) return json(503, { code: 503, message: "upstream busy" });
        return json(200, { code: 200, status: fxStatus(id) });
      }
      if ((m = p.match(/^\/2\/(thread|conversation)\/(200|300)$/))) return json(503, { code: 503 });
      if ((m = p.match(/^\/2\/thread\/(\d+)$/))) return json(200, { code: 200, status: fxStatus(m[1]), thread: [fxStatus(m[1]), fxStatus(101), fxStatus(102)] });
      if ((m = p.match(/^\/2\/conversation\/(\d+)$/))) {
        if (!url.searchParams.get("cursor")) {
          return json(200, { code: 200, status: fxStatus(m[1]), thread: [fxStatus(m[1])], replies: [fxStatus(201, "r1"), fxStatus(202, "r2")], cursor: { bottom: "c2" } });
        }
        return json(200, { code: 200, status: fxStatus(m[1]), replies: [fxStatus(203, "r3")], cursor: { bottom: null } });
      }
      if (p === "/2/profile/alice") return json(200, { code: 200, user: fxUser("alice") });
      if (p === "/2/profile/alice/statuses") return json(200, { code: 200, results: [fxStatus(11), fxStatus(12)], cursor: { bottom: null } });
      if (p === "/2/profile/dana/about") {
        return json(200, { code: 200, about_account: { based_in: "Japan", location_accurate: false, source: "Japan App Store", username_changes: { count: 4, last_changed_at: "2026-09-30T00:00:00.000Z" } } });
      }
      if (p === "/2/profile/dana") return json(200, { code: 200, user: fxUser("dana", { followers: 2000, following: 1900, statuses: 500, joined: "Mon Sep 01 00:00:00 +0000 2025" }) });
      if (p === "/2/profile/dana/statuses") {
        const all = auditTimeline();
        const withReplies = url.searchParams.get("with_replies") === "1";
        // The pinned post comes first and again in its place, as on X.
        const results = withReplies ? all : [all[12], ...all.filter((x) => !x.replying_to)];
        return json(200, { code: 200, results, cursor: { bottom: null } });
      }
      if (p.startsWith("/2/profile/bob")) return json(503, { code: 503, message: "busy" });
      if (p.startsWith("/2/profile/")) return json(404, { code: 404, message: "User not found" });
    }
    if (url.host === "vx.test") {
      if ((m = p.match(/^\/i\/status\/(\d+)$/))) {
        if (m[1] === "200") {
          return json(200, { tweetID: "200", user_screen_name: "carol", user_name: "Carol", text: "vx full text 200", date_epoch: 1760000000,
            likes: 5, retweets: 1, replies: 0, qrtURL: "https://twitter.com/i/status/9", media_extended: [{ type: "image", url: "https://pbs.twimg.com/x.jpg" }],
            replyingTo: "dave", replyingToID: "7", lang: "en" });
        }
        if (m[1] === "300") return json(500, { error: "boom" });
        return json(404, { error: "Tweet not found" });
      }
      if (p === "/bob") {
        return json(200, { screen_name: "bob", name: "Bob", description: "vx bio", followers_count: 7, following_count: 8, tweet_count: 9,
          created_at: "Mon Jan 01 00:00:00 +0000 2018", latest_tweets: url.searchParams.get("with_tweets") ? [
            { tweetID: "21", user_screen_name: "bob", text: "t21", date_epoch: 1760000000, likes: 1, retweets: 0, replies: 0, media_extended: [] },
            { tweetID: "22", user_screen_name: "bob", text: "t22", date_epoch: 1760000100, likes: 2, retweets: 0, replies: 0, media_extended: [] }] : undefined });
      }
      return json(404, { error: "User not found" });
    }
    if (url.host === "synd.test" && p === "/tweet-result") {
      const id = url.searchParams.get("id");
      if (url.searchParams.get("token") !== syndToken(id)) return json(403, { error: "bad token" });
      if (id === "300") {
        return json(200, { __typename: "Tweet", id_str: "300", text: "truncated text…", note_tweet: { id: "n" }, created_at: "2026-10-01T00:00:00.000Z",
          lang: "en", favorite_count: 4, conversation_count: 2, user: { screen_name: "erin", name: "Erin", is_blue_verified: true }, mediaDetails: [] });
      }
      return json(404, {});
    }
    if (url.host === "xai.test" && p === "/v1/responses") {
      if (init.headers.authorization !== "Bearer xai-test-key") return json(401, { error: "bad key" });
      const prompt = body.input[0].content;
      if (prompt.includes("always429")) return json(429, { error: "rate limited" });
      if (prompt.includes("flaky")) {
        const n = (flaky.get(prompt) || 0) + 1;
        flaky.set(prompt, n);
        if (n === 1) return json(503, { error: "try again" });
      }
      const alpha = prompt.includes("alpha");
      const items = alpha
        ? [{ url: "https://x.com/alice/status/1", author: "@alice", date: "2026-10-13", text: "post 1" },
          { url: "https://x.com/ghost/status/404", author: "@ghost", date: "2026-10-12", text: "invented" }]
        : [{ url: "https://x.com/alice/status/1", author: "@alice", date: "2026-10-13", text: "post 1" },
          { url: "https://x.com/carol/status/4", author: "@carol", date: "2026-10-11", text: "post 4" }];
      return json(200, {
        id: "resp_1",
        output: [
          { type: "custom_tool_call", name: "x_semantic_search", input: "{}" },
          { type: "message", content: [{ type: "output_text", text: "```json\n" + JSON.stringify(items) + "\n```", annotations: [{ type: "url_citation", url: "https://x.com/i/status/7" }] }] },
        ],
        citations: ["https://x.com/i/status/1", "https://x.com/i/user/55"],
        usage: { input_tokens: 1200, output_tokens: 300, server_side_tool_usage_details: { x_posts_fetched: 25, x_users_fetched: 0 } },
      });
    }
    if (url.host === "relay.test" && p === "/v1/x_search") {
      if (init.headers.authorization !== "Bearer relay-key") return json(401, { error: "bad key" });
      if (body.query.includes("redirect")) return new Response(null, { status: 302, headers: { location: "https://moved.test/v1/x_search" } });
      return json(200, { provider: "grok-native", results: [
        { url: "https://x.com/alice/status/1", author: "@alice", published_at: "2026-10-13T08:00:00Z", snippet: "post 1" },
        { url: "https://x.com/i/status/12", author: "", published_at: "", snippet: "" },
      ] });
    }
    return json(404, { error: `no fake for ${url}` });
  }
  return { fetch, calls };
}
