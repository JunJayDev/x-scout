// Read X posts, threads, replies and profiles without logging in.
//
// x.com needs a login and JavaScript, so agents cannot fetch it. Three public sources can:
//   1. FxTwitter API v2 (api.fxtwitter.com): full data, threads, replies, profiles, timelines.
//   2. vxTwitter API (api.vxtwitter.com): single posts and profiles with recent posts.
//   3. X's own embed endpoint (cdn.syndication.twimg.com): single posts; long posts are cut.
// They are tried in that order. Every item says which source answered and what a fallback
// could not provide.

import { InputError, clampInt, getJson, mapLimit, prune, withQuery } from "./util.js";

const FX_BASE = "https://api.fxtwitter.com";
const VX_BASE = "https://api.vxtwitter.com";
const SYND_BASE = "https://cdn.syndication.twimg.com";
export const READ_SOURCES = ["fxtwitter", "vxtwitter", "syndication"];
const ARTICLE_MAX_CHARS = 40000;

const X_HOSTS = new Set([
  "x.com", "twitter.com", "fxtwitter.com", "fixupx.com", "vxtwitter.com", "fixvx.com",
  "twittpr.com", "xcancel.com", "nitter.net", "nitter.poast.org",
]);
const RESERVED_PATHS = new Set([
  "i", "home", "explore", "search", "notifications", "messages", "settings", "hashtag",
  "intent", "share", "compose", "login", "logout", "signup", "tos", "privacy", "jobs",
]);

/** A post URL, a numeric id, a profile URL or an @handle. */
export function parseTarget(raw) {
  const input = String(raw || "").trim();
  if (/^\d{1,25}$/.test(input)) return { kind: "post", id: input, input };
  const handle = input.match(/^@([A-Za-z0-9_]{1,15})$/);
  if (handle) return { kind: "profile", handle: handle[1], input };
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return { kind: "invalid", input, reason: "not a URL, post id or @handle" };
  }
  const host = url.hostname.toLowerCase().replace(/^(www|mobile|m|api|d)\./, "");
  if (!X_HOSTS.has(host)) return { kind: "invalid", input, reason: "not an X/Twitter link" };
  const status = url.pathname.match(/\/status(?:es)?\/(\d+)/);
  if (status) return { kind: "post", id: status[1], input };
  if (/^\/i\/article\//.test(url.pathname)) {
    return { kind: "invalid", input, reason: "bare X Article links cannot be resolved; pass the post that shares the article" };
  }
  const first = url.pathname.split("/").filter(Boolean)[0] || "";
  if (/^[A-Za-z0-9_]{1,15}$/.test(first) && !RESERVED_PATHS.has(first.toLowerCase())) {
    return { kind: "profile", handle: first, input };
  }
  return { kind: "invalid", input, reason: "no post id or profile in this link" };
}

export function statusId(url) {
  const m = String(url || "").match(/\/status(?:es)?\/(\d+)/);
  return m ? m[1] : "";
}

// --- FxTwitter --------------------------------------------------------------------------------

function fxGet(ctx, path, params = {}) {
  return getJson(ctx, withQuery(ctx.env.FX_API_BASE || FX_BASE, path, params));
}

function fxFailed(res) {
  return !res.data || (res.data.code && res.data.code !== 200) || res.status >= 400;
}

function fxError(res, what) {
  const code = (res.data && res.data.code) || res.status;
  const msg = (res.data && (res.data.message || res.data.reason)) || (res.text || "").slice(0, 200);
  if (code === 404) return `${what} not found (deleted, or the id/handle is wrong)`;
  if (code === 401) return `${what} is private or unavailable`;
  return `FxTwitter error ${code || "network"}${msg ? `: ${msg}` : ""}`;
}

function isoFromEpoch(seconds) {
  return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}

function articleToMarkdown(content) {
  if (!content || !Array.isArray(content.blocks)) return null;
  const entities = new Map();
  for (const e of content.entityMap || []) if (e && e.key !== undefined) entities.set(String(e.key), e.value);
  const out = [];
  let n = 0;
  for (const b of content.blocks) {
    const text = b.text || "";
    if (b.type !== "ordered-list-item") n = 0;
    switch (b.type) {
      case "header-one": out.push(`# ${text}`); break;
      case "header-two": out.push(`## ${text}`); break;
      case "header-three": out.push(`### ${text}`); break;
      case "unordered-list-item": out.push(`- ${text}`); break;
      case "ordered-list-item": out.push(`${++n}. ${text}`); break;
      case "blockquote": out.push(`> ${text}`); break;
      case "code-block": out.push("```\n" + text + "\n```"); break;
      case "atomic": {
        for (const r of b.entityRanges || []) {
          const v = entities.get(String(r.key));
          if (v && v.type === "MARKDOWN" && v.data && v.data.markdown) out.push(v.data.markdown);
          else if (v && v.type === "MEDIA") out.push("[media]");
        }
        break;
      }
      default:
        if (text) out.push(text);
    }
  }
  let body = out.join("\n\n");
  if (body.length > ARTICLE_MAX_CHARS) body = body.slice(0, ARTICLE_MAX_CHARS) + "\n\n[article truncated]";
  return body;
}

/** FxTwitter status -> our post shape. */
export function normPost(s, depth = 0) {
  if (!s || typeof s !== "object") return null;
  if (s.type === "tombstone") {
    return prune({ unavailable: s.reason || "unavailable", id: s.id, url: s.url, message: s.message });
  }
  const a = s.author || {};
  const handle = a.screen_name || null;
  const out = {
    url: handle && s.id ? `https://x.com/${handle}/status/${s.id}` : s.url,
    id: s.id,
    author: handle ? `@${handle}` : null,
    author_name: a.name,
    author_avatar: a.avatar_url || undefined,
    author_followers: typeof a.followers === "number" ? a.followers : undefined,
    author_verified: a.verification && a.verification.verified ? true : undefined,
    created_at: typeof s.created_timestamp === "number" ? isoFromEpoch(s.created_timestamp) : s.created_at,
    lang: s.lang,
    text: s.text,
    metrics: prune({
      views: s.views, likes: s.likes, replies: s.replies, reposts: s.reposts,
      quotes: s.quotes, bookmarks: s.bookmarks,
    }),
  };
  if (s.replying_to && s.replying_to.screen_name) {
    out.replying_to = prune({
      author: `@${s.replying_to.screen_name}`,
      url: s.replying_to.status ? `https://x.com/${s.replying_to.screen_name}/status/${s.replying_to.status}` : undefined,
    });
  }
  if (s.reposted_by && s.reposted_by.screen_name) out.reposted_by = `@${s.reposted_by.screen_name}`;
  if (s.quote && depth < 2) out.quote = normPost(s.quote, depth + 1);
  const media = [];
  const m = s.media || {};
  for (const p of m.photos || []) media.push(prune({ type: p.type || "photo", url: p.url, alt: p.altText }));
  for (const v of m.videos || []) media.push(prune({ type: v.type || "video", url: v.url, thumbnail: v.thumbnail_url, duration_s: v.duration }));
  if (m.external && m.external.url) media.push({ type: "external_video", url: m.external.url });
  out.media = media;
  if (s.card && s.card.url) out.card = prune({ title: s.card.title, description: s.card.description, url: s.card.url, domain: s.card.domain });
  if (s.poll && Array.isArray(s.poll.choices)) {
    out.poll = prune({
      choices: s.poll.choices.map((c) => ({ label: c.label, votes: c.count, percent: c.percentage })),
      total_votes: s.poll.total_votes,
      ends_at: s.poll.ends_at,
    });
  }
  if (s.community_note && s.community_note.text) out.community_note = s.community_note.text;
  if (s.article) {
    out.article = prune({ title: s.article.title, preview: s.article.preview_text, body: articleToMarkdown(s.article.content) });
  }
  if (s.translation && s.translation.text) {
    out.translation = prune({ text: s.translation.text, from: s.translation.source_lang, to: s.translation.target_lang });
  }
  if (s.is_note_tweet) out.long_post = true;
  if (s.possibly_sensitive) out.possibly_sensitive = true;
  return prune(out);
}

function normUser(u) {
  if (!u) return null;
  return prune({
    handle: u.screen_name ? `@${u.screen_name}` : null,
    url: u.screen_name ? `https://x.com/${u.screen_name}` : u.url,
    name: u.name,
    avatar: u.avatar_url || undefined,
    description: u.description,
    location: u.location,
    website: u.website && u.website.url,
    followers: u.followers,
    following: u.following,
    posts: u.statuses,
    likes_given: u.likes,
    joined: u.joined ? toIso(u.joined) : undefined,
    verified: u.verification && u.verification.verified ? true : undefined,
    protected: u.protected ? true : undefined,
  });
}

function toIso(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().replace(".000Z", "Z");
}

function threadOf(data, mainId) {
  const posts = ((data && data.thread) || []).map((p) => normPost(p)).filter(Boolean);
  // Only worth returning when there is more than the post itself.
  return posts.length > 1 || (posts.length === 1 && posts[0].id !== mainId) ? posts : undefined;
}

async function readPostFx(ctx, target, opts) {
  const lang = opts.translateTo || undefined;
  if (opts.mode === "replies") {
    const replies = [];
    let first = null;
    let cursor;
    for (let page = 0; page < 5 && replies.length < opts.maxReplies; page++) {
      const res = await fxGet(ctx, `/2/conversation/${target.id}`, { ranking_mode: opts.ranking, cursor, lang });
      if (fxFailed(res)) {
        if (page === 0) throw new Error(fxError(res, "post"));
        break;
      }
      first = first || res.data;
      for (const r of res.data.replies || []) replies.push(normPost(r));
      cursor = res.data.cursor && res.data.cursor.bottom;
      if (!cursor) break;
    }
    return prune({
      kind: "post",
      post: normPost(first.status),
      thread: threadOf(first, target.id),
      replies: replies.filter(Boolean).slice(0, opts.maxReplies),
      replies_ranking: opts.ranking,
    });
  }
  const path = opts.mode === "thread" ? `/2/thread/${target.id}` : `/2/status/${target.id}`;
  const res = await fxGet(ctx, path, { lang });
  if (fxFailed(res)) throw new Error(fxError(res, "post"));
  return prune({
    kind: "post",
    post: normPost(res.data.status),
    thread: opts.mode === "thread" ? threadOf(res.data, target.id) : undefined,
  });
}

async function readProfileFx(ctx, target, opts) {
  const res = await fxGet(ctx, `/2/profile/${encodeURIComponent(target.handle)}`);
  if (fxFailed(res) || !res.data.user) throw new Error(fxError(res, `profile @${target.handle}`));
  const out = { kind: "profile", profile: normUser(res.data.user) };
  if (opts.profilePosts > 0) {
    const posts = [];
    let cursor;
    for (let page = 0; page < 5 && posts.length < opts.profilePosts; page++) {
      const r = await fxGet(ctx, `/2/profile/${encodeURIComponent(target.handle)}/statuses`, {
        count: Math.min(100, opts.profilePosts - posts.length),
        cursor,
        with_replies: opts.profileReplies ? "1" : undefined,
        lang: opts.translateTo || undefined,
      });
      if (r.status === 204) break;
      if (fxFailed(r)) {
        out.posts_error = fxError(r, "timeline");
        break;
      }
      for (const p of r.data.results || []) {
        if (p && p.type === "thread" && Array.isArray(p.statuses)) p.statuses.forEach((x) => posts.push(normPost(x)));
        else posts.push(normPost(p));
      }
      cursor = r.data.cursor && r.data.cursor.bottom;
      if (!cursor) break;
    }
    // A pinned post appears first and again in its place.
    const seen = new Set();
    out.recent_posts = posts.filter((p) => p && !(p.id && seen.has(p.id)) && (p.id ? seen.add(p.id) : true)).slice(0, opts.profilePosts);
  }
  return prune(out);
}

/**
 * X's "About this account" (via FxTwitter): country, whether X trusts it, how the account
 * signed up, and how often the handle changed. Returns null when unavailable.
 */
export async function readAbout(ctx, handle) {
  const res = await fxGet(ctx, `/2/profile/${encodeURIComponent(handle)}/about`);
  const a = res.data && res.data.about_account;
  if (fxFailed(res) || !a) return null;
  const changes = a.username_changes || {};
  return prune({
    based_in: a.based_in,
    location_accurate: typeof a.location_accurate === "boolean" ? a.location_accurate : undefined,
    connected_via: a.source,
    username_changes: typeof changes.count === "number" ? changes.count : undefined,
    username_last_changed: changes.last_changed_at ? toIso(changes.last_changed_at) : undefined,
  });
}

// --- vxTwitter ----------------------------------------------------------------------------

function normVx(t) {
  if (!t || typeof t !== "object" || !t.tweetID) return null;
  const media = (t.media_extended || [])
    .filter((m) => m && m.url && m.type !== "txt" && m.type !== "rtf")
    .map((m) => prune({ type: m.type === "image" ? "photo" : m.type, url: m.url, alt: m.altText, thumbnail: m.type === "image" ? undefined : m.thumbnail_url }));
  const poll = t.pollData && Array.isArray(t.pollData.options) && t.pollData.options.length
    ? { choices: t.pollData.options.map((o) => prune({ label: o.name, votes: o.votes, percent: o.percent })) }
    : undefined;
  return prune({
    url: t.user_screen_name ? `https://x.com/${t.user_screen_name}/status/${t.tweetID}` : t.tweetURL,
    id: t.tweetID,
    author: t.user_screen_name ? `@${t.user_screen_name}` : null,
    author_name: t.user_name,
    author_avatar: t.user_profile_image_url || undefined,
    created_at: typeof t.date_epoch === "number" ? isoFromEpoch(t.date_epoch) : t.date,
    lang: t.lang,
    text: t.text,
    metrics: prune({ likes: t.likes, replies: t.replies, reposts: t.retweets }),
    replying_to: t.replyingTo
      ? prune({ author: `@${t.replyingTo}`, url: t.replyingToID ? `https://x.com/${t.replyingTo}/status/${t.replyingToID}` : undefined })
      : undefined,
    quote_url: t.qrtURL || undefined,
    media,
    poll,
    community_note: t.communityNote || undefined,
    article: t.article ? prune({ title: t.article.title, preview: t.article.preview_text, body_unavailable: "vxTwitter returns only the article preview" }) : undefined,
    translation: t.translation && t.translation.text ? prune({ text: t.translation.text, from: t.translation.source_language, to: t.translation.destination_language }) : undefined,
    possibly_sensitive: t.possibly_sensitive ? true : undefined,
  });
}

async function readPostVx(ctx, target) {
  const res = await getJson(ctx, withQuery(ctx.env.VX_API_BASE || VX_BASE, `/i/status/${target.id}`));
  if (res.status !== 200 || !res.data || !res.data.tweetID) {
    throw new Error(res.status === 404 ? "post not found" : `vxTwitter error ${res.status || "network"}${res.data && res.data.error ? `: ${res.data.error}` : ""}`);
  }
  return { kind: "post", post: normVx(res.data) };
}

async function readProfileVx(ctx, target, opts) {
  const res = await getJson(ctx, withQuery(ctx.env.VX_API_BASE || VX_BASE, `/${encodeURIComponent(target.handle)}`, {
    with_tweets: opts.profilePosts > 0 ? "true" : undefined,
  }));
  const u = res.data;
  if (res.status !== 200 || !u || !u.screen_name) {
    throw new Error(res.status === 404 ? `profile @${target.handle} not found` : `vxTwitter error ${res.status || "network"}${u && u.error ? `: ${u.error}` : ""}`);
  }
  const out = {
    kind: "profile",
    profile: prune({
      handle: `@${u.screen_name}`,
      url: `https://x.com/${u.screen_name}`,
      name: u.name,
      description: u.description,
      location: u.location,
      followers: u.followers_count,
      following: u.following_count,
      posts: u.tweet_count,
      joined: u.created_at ? toIso(u.created_at) : undefined,
      protected: u.protected ? true : undefined,
    }),
  };
  if (opts.profilePosts > 0) {
    out.recent_posts = (u.latest_tweets || []).map(normVx).filter(Boolean).slice(0, opts.profilePosts);
  }
  return prune(out);
}

// --- X's embed endpoint (as used by vercel/react-tweet) ---------------------------------------

function syndToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, "");
}

function normSynd(t, depth = 0) {
  if (!t || typeof t !== "object" || !t.id_str) return null;
  const u = t.user || {};
  const media = (t.mediaDetails || []).map((m) => {
    const variants = (m.video_info && m.video_info.variants) || [];
    const best = variants.filter((v) => v.content_type === "video/mp4").sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    return prune({
      type: m.type === "animated_gif" ? "gif" : m.type || "photo",
      url: best ? best.url : m.media_url_https,
      thumbnail: best ? m.media_url_https : undefined,
      alt: m.ext_alt_text,
    });
  });
  return prune({
    url: u.screen_name ? `https://x.com/${u.screen_name}/status/${t.id_str}` : undefined,
    id: t.id_str,
    author: u.screen_name ? `@${u.screen_name}` : null,
    author_name: u.name,
    author_avatar: u.profile_image_url_https || undefined,
    author_verified: u.is_blue_verified || u.verified ? true : undefined,
    created_at: t.created_at ? toIso(t.created_at) : undefined,
    lang: t.lang,
    text: t.text,
    text_truncated: t.note_tweet ? true : undefined,
    metrics: prune({ likes: t.favorite_count, replies: t.conversation_count ?? t.reply_count, reposts: t.retweet_count }),
    replying_to: t.in_reply_to_screen_name
      ? prune({ author: `@${t.in_reply_to_screen_name}`, url: t.in_reply_to_status_id_str ? `https://x.com/${t.in_reply_to_screen_name}/status/${t.in_reply_to_status_id_str}` : undefined })
      : undefined,
    quote: t.quoted_tweet && depth < 1 ? normSynd(t.quoted_tweet, depth + 1) : undefined,
    media,
    possibly_sensitive: t.possibly_sensitive ? true : undefined,
  });
}

async function readPostSynd(ctx, target) {
  const url = withQuery(ctx.env.SYND_API_BASE || SYND_BASE, "/tweet-result", {
    id: target.id,
    lang: "en",
    token: syndToken(target.id),
  });
  const res = await getJson(ctx, url);
  if (res.status === 404 || (res.status === 200 && res.data && Object.keys(res.data).length === 0)) {
    throw new Error("post not found");
  }
  if (res.status !== 200 || !res.data) throw new Error(`X embed endpoint error ${res.status || "network"}`);
  if (res.data.__typename === "TweetTombstone") {
    return { kind: "post", post: { unavailable: "unavailable", id: target.id } };
  }
  const post = normSynd(res.data);
  if (!post) throw new Error("X embed endpoint returned no post");
  return { kind: "post", post };
}

// --- source chain -----------------------------------------------------------------------

const POST_READERS = { fxtwitter: readPostFx, vxtwitter: readPostVx, syndication: readPostSynd };
const PROFILE_READERS = { fxtwitter: readProfileFx, vxtwitter: readProfileVx };

async function readWithFallback(readers, ctx, target, opts) {
  const order = opts.source === "auto" ? READ_SOURCES.filter((s) => readers[s]) : [opts.source];
  if (!order.every((s) => readers[s])) {
    throw new Error(`source ${opts.source} cannot read ${target.kind === "post" ? "posts" : "profiles"}`);
  }
  const failures = [];
  for (const src of order) {
    try {
      const result = await readers[src](ctx, target, opts);
      result.source = src;
      if (failures.length) result.fallback_from = failures;
      if (src !== "fxtwitter" && target.kind === "post" && opts.mode !== "post") {
        result.note = `mode=${opts.mode} needs FxTwitter; returning the single post only`;
      }
      return result;
    } catch (err) {
      failures.push(`${src}: ${err.message}`);
    }
  }
  throw new Error(failures.join(" | "));
}

export const readPost = (ctx, target, opts) => readWithFallback(POST_READERS, ctx, target, readOptions(opts));
export const readProfile = (ctx, target, opts) => readWithFallback(PROFILE_READERS, ctx, target, readOptions(opts));

/** Defaults for callers inside the package (search verification, audit). */
function readOptions(opts = {}) {
  return {
    mode: "post",
    maxReplies: 20,
    ranking: "likes",
    profilePosts: 0,
    profileReplies: false,
    translateTo: "",
    source: "auto",
    ...opts,
  };
}

/** Parse and validate tool arguments for x_read. */
export function parseReadArgs(raw) {
  if (!raw || typeof raw !== "object") throw new InputError("arguments must be an object");
  const list = Array.isArray(raw.targets) ? raw.targets : raw.targets ? [raw.targets] : [];
  const targets = list.map(parseTarget);
  if (targets.length === 0) throw new InputError("targets must contain at least one X link, post id or @handle");
  if (targets.length > 10) throw new InputError("at most 10 targets per call");
  const mode = raw.mode || "post";
  if (!["post", "thread", "replies"].includes(mode)) throw new InputError("mode must be post, thread or replies");
  const opts = readOptions({
    mode,
    maxReplies: clampInt(raw.max_replies, 20, 1, 100, "max_replies"),
    ranking: raw.reply_ranking === "recency" ? "recency" : "likes",
    profilePosts: clampInt(raw.profile_posts, 20, 0, 100, "profile_posts"),
    profileReplies: raw.profile_include_replies === true,
    translateTo: raw.translate_to ? String(raw.translate_to).trim().toLowerCase() : "",
    source: raw.source === undefined || raw.source === null || raw.source === "" ? "auto" : String(raw.source),
  });
  if (opts.source !== "auto" && !READ_SOURCES.includes(opts.source)) {
    throw new InputError("source must be auto, fxtwitter, vxtwitter or syndication");
  }
  if (opts.translateTo && !/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(opts.translateTo)) {
    throw new InputError("translate_to must be a language code such as zh, ja or en");
  }
  return { targets, opts };
}

/** x_read: read up to 10 targets; one failing target does not fail the others. */
export async function runRead(raw, ctx) {
  const { targets, opts } = parseReadArgs(raw);
  // De-duplicate identical targets but keep the caller's order.
  const seen = new Map();
  const items = await mapLimit(targets, 5, async (t) => {
    if (t.kind === "invalid") return { kind: "error", input: t.input, error: t.reason };
    const key = t.kind === "post" ? `post:${t.id}` : `profile:${t.handle.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.set(
        key,
        (t.kind === "post" ? readPost(ctx, t, opts) : readProfile(ctx, t, opts)).catch((err) => ({
          kind: "error",
          error: err.message,
        }))
      );
    }
    return { input: t.input, ...(await seen.get(key)) };
  });
  const errors = items.filter((i) => i.kind === "error");
  if (errors.length === items.length) {
    throw new Error(errors.map((e) => `${e.input}: ${e.error}`).join("; "));
  }
  return { mode: opts.mode, items };
}
