// Numbers that help an agent judge a post or an account. They are hints, not verdicts:
// the agent still reads the text. The thresholds and what they mean are documented in
// skills/x-scout/references/signals.md.

import { InputError, clampInt, median, prune, quantile } from "./util.js";
import { parseTarget, readAbout, readProfile } from "./read.js";

const round = (x, d = 2) => (Number.isFinite(x) ? Number(x.toFixed(d)) : undefined);
const MIN_LIKES = 10; // below this, ratios are noise
const DAY = 86400000;

/**
 * Ratios for one post.
 *   save   bookmarks / likes            people keep it to use later
 *   talk   replies / likes              people answer it (discussion, or argument)
 *   spread (reposts + quotes) / likes   people pass it on
 *   eng    all engagements / views      how many viewers did anything
 */
export function postSignals(post) {
  const m = (post && post.metrics) || {};
  const likes = m.likes;
  if (typeof likes !== "number") return undefined;
  const s = {};
  if (likes >= MIN_LIKES) {
    if (typeof m.bookmarks === "number") s.save = round(m.bookmarks / likes);
    if (typeof m.replies === "number") s.talk = round(m.replies / likes);
    if (typeof m.reposts === "number") s.spread = round(((m.reposts || 0) + (m.quotes || 0)) / likes);
  }
  if (typeof m.views === "number" && m.views >= 100) {
    const all = likes + (m.replies || 0) + (m.reposts || 0) + (m.quotes || 0) + (m.bookmarks || 0);
    s.eng = round(all / m.views, 4);
  }
  return Object.keys(s).length ? s : undefined;
}

const EXTERNAL_LINK = /https?:\/\/(?!(?:www\.)?(?:x|twitter)\.com\/|t\.co\/)[^\s]+/i;

function hasExternalLink(p) {
  return Boolean((p.card && p.card.url && !/(^|\.)(x|twitter)\.com$/i.test(p.card.domain || "")) || EXTERNAL_LINK.test(p.text || ""));
}

function classify(posts, handle) {
  const self = `@${handle.toLowerCase()}`;
  const originals = [];
  const replies = [];
  const reposts = [];
  for (const p of posts) {
    if (!p || p.unavailable) continue;
    if (p.reposted_by || (p.author && p.author.toLowerCase() !== self)) reposts.push(p);
    else if (p.replying_to && p.replying_to.author && p.replying_to.author.toLowerCase() !== self) replies.push(p);
    else originals.push(p); // includes the account's own thread continuations
  }
  return { originals, replies, reposts };
}

function sumRatio(posts, num, den) {
  const withDen = posts.filter((p) => p.metrics && typeof p.metrics[den] === "number" && typeof p.metrics[num] === "number");
  const d = withDen.reduce((a, p) => a + p.metrics[den], 0);
  if (d < MIN_LIKES * 2) return undefined;
  return round(withDen.reduce((a, p) => a + p.metrics[num], 0) / d);
}

function brief(p, extra = {}) {
  return prune({
    url: p.url,
    created_at: p.created_at,
    views: p.metrics && p.metrics.views,
    likes: p.metrics && p.metrics.likes,
    bookmarks: p.metrics && p.metrics.bookmarks,
    replies: p.metrics && p.metrics.replies,
    text: (p.text || (p.article && p.article.title) || "").replace(/\s+/g, " ").slice(0, 140),
    ...extra,
  });
}

function dedupe(posts) {
  const seen = new Set();
  return posts.filter((p) => p && !(p.id && seen.has(p.id)) && (p.id ? seen.add(p.id) : true));
}

function span(posts) {
  const t = posts.map((p) => Date.parse(p.created_at)).filter(Number.isFinite);
  return t.length ? { oldest: Math.min(...t), newest: Math.max(...t) } : { oldest: null, newest: null };
}

const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : undefined);

/**
 * Account-level numbers.
 *   posts   the account's timeline without replies (originals and reposts): the baseline
 *   recent  the timeline with replies (optional): the mix of originals, replies and reposts,
 *           and the cadence. Without it, `posts` is used for both.
 */
export function auditAccount(profile, posts, now = Date.now(), recent) {
  const handle = (profile.handle || "").replace(/^@/, "");
  const { originals } = classify(dedupe([...(posts || []), ...(recent || [])]), handle);
  const mix = classify(dedupe(recent || posts || []), handle);
  const { oldest, newest } = span([...mix.originals, ...mix.replies]);
  const spanDays = newest && oldest ? Math.max(1, (newest - oldest) / DAY) : null;
  const base = span(originals);

  const views = originals.map((p) => p.metrics && p.metrics.views);
  const medViews = median(views);
  const maxViews = Math.max(0, ...views.filter(Number.isFinite));
  const medLikes = median(originals.map((p) => p.metrics && p.metrics.likes));
  const joined = Date.parse(profile.joined);
  const ageDays = Number.isFinite(joined) ? Math.max(1, (now - joined) / DAY) : null;
  const sampled = mix.originals.length + mix.replies.length + mix.reposts.length;

  const out = {
    account: prune({
      followers: profile.followers,
      following: profile.following,
      posts_lifetime: profile.posts,
      age_days: ageDays ? Math.round(ageDays) : undefined,
      posts_per_day_lifetime: ageDays && profile.posts ? round(profile.posts / ageDays, 1) : undefined,
    }),
    sample: prune({
      posts: sampled,
      originals: mix.originals.length,
      replies: mix.replies.length,
      reposts: mix.reposts.length,
      from: day(oldest),
      to: day(newest),
      posts_per_day: spanDays ? round((mix.originals.length + mix.replies.length) / spanDays, 1) : undefined,
      days_since_last_post: newest ? round((now - newest) / DAY, 1) : undefined,
    }),
    originals: prune({
      count: originals.length,
      from: day(base.oldest),
      to: day(base.newest),
      median_views: medViews ?? undefined,
      p90_views: quantile(views, 0.9) ?? undefined,
      median_likes: medLikes ?? undefined,
      save: sumRatio(originals, "bookmarks", "likes"),
      talk: sumRatio(originals, "replies", "likes"),
      likes_per_1k_followers: profile.followers && medLikes !== null ? round((medLikes / profile.followers) * 1000, 1) : undefined,
      with_external_link: originals.length ? round(originals.filter(hasExternalLink).length / originals.length) : undefined,
      with_media: originals.length ? round(originals.filter((p) => p.media && p.media.length).length / originals.length) : undefined,
      long_posts: originals.filter((p) => p.long_post).length || undefined,
      articles: originals.filter((p) => p.article).length || undefined,
      breakout: medViews ? round(maxViews / medViews, 1) : undefined,
    }),
  };

  out.top_by_views = originals
    .filter((p) => p.metrics && typeof p.metrics.views === "number")
    .sort((a, b) => b.metrics.views - a.metrics.views)
    .slice(0, 3)
    .map((p) => brief(p, medViews ? { x_median: round(p.metrics.views / medViews, 1) } : {}));
  out.top_by_saves = originals
    .filter((p) => p.metrics && p.metrics.likes >= MIN_LIKES && typeof p.metrics.bookmarks === "number")
    .sort((a, b) => b.metrics.bookmarks / b.metrics.likes - a.metrics.bookmarks / a.metrics.likes)
    .slice(0, 3)
    .map((p) => brief(p, { save: round(p.metrics.bookmarks / p.metrics.likes) }));

  const accountHints = hints(profile, out);
  return { ...prune(out), hints: accountHints };
}

function hints(profile, a) {
  const h = [];
  const s = a.sample;
  const o = a.originals;
  if (s.posts < 10) h.push(`only ${s.posts} recent posts readable: too few to judge the account`);
  if (o.count !== undefined && o.count < 5) h.push(`only ${o.count} originals readable: the baseline is thin, judge from the posts themselves`);
  if (s.days_since_last_post > 30) h.push(`quiet: last post ${Math.round(s.days_since_last_post)} days ago`);
  if (a.account.age_days !== undefined && a.account.age_days < 90) h.push(`new account: ${a.account.age_days} days old`);
  if (s.posts_per_day > 20) h.push(`very high cadence: ${s.posts_per_day} posts/day in the sample`);
  if (s.replies > 2 * Math.max(1, s.originals)) h.push(`mostly replies: ${s.replies} replies vs ${s.originals} originals`);
  if (o.with_external_link >= 0.6) h.push(`link-heavy: ${Math.round(o.with_external_link * 100)}% of originals link out (curator or aggregator; judge the picks)`);
  if (o.save >= 0.5) h.push(`people keep these posts: bookmarks/likes ${o.save} across originals`);
  if (o.talk >= 0.5 && (o.save === undefined || o.save < 0.2)) h.push(`replies outrun saves (talk ${o.talk}, save ${o.save ?? "?"}): discussion or argument rather than reference`);
  // Big accounts have viral posts all the time; flag only a post far above even the p90.
  if (o.breakout >= 30 && o.p90_views && o.breakout * o.median_views >= 10 * o.p90_views) {
    h.push(`one post carries the reach: best post has ${o.breakout}x the median views`);
  }
  if (profile.followers && profile.following && profile.followers < 5000 && profile.following > 0.8 * profile.followers) {
    h.push(`follows about as many as follow it (${profile.following}/${profile.followers}): follow-back growth`);
  }
  return h;
}

function aboutHints(a, now = Date.now()) {
  const h = [];
  if (a.username_changes >= 3) h.push(`handle changed ${a.username_changes} times: repurposed accounts often do; check older posts`);
  const last = Date.parse(a.username_last_changed);
  if (Number.isFinite(last) && now - last < 90 * DAY) h.push(`handle changed on ${a.username_last_changed.slice(0, 10)}`);
  if (a.location_accurate === false) h.push("X says the account's country may not be accurate (VPN or proxy)");
  return h;
}

/** x_audit: read a profile with its recent posts and replies, then compute the numbers. */
export async function runAudit(raw, ctx) {
  if (!raw || typeof raw !== "object") throw new InputError("arguments must be an object");
  const target = parseTarget(raw.account || raw.handle || "");
  if (target.kind === "post") throw new InputError("account must be a profile URL or @handle, not a post");
  if (target.kind !== "profile") throw new InputError(`account: ${target.reason || "pass an @handle or profile URL"}`);
  const count = clampInt(raw.posts, 60, 10, 100, "posts");
  // Two timelines: without replies for a baseline of originals that reaches further back,
  // with replies for the mix and the cadence.
  const [own, recent, about] = await Promise.all([
    readProfile(ctx, target, { profilePosts: count, profileReplies: false }),
    readProfile(ctx, target, { profilePosts: Math.min(count, 40), profileReplies: true }).catch(() => null),
    readAbout(ctx, target.handle).catch(() => null),
  ]);
  const audit = auditAccount(own.profile, own.recent_posts || [], Date.now(), recent && recent.recent_posts);
  if (about) audit.hints.push(...aboutHints(about));
  return prune({
    kind: "audit",
    source: own.source,
    profile: own.profile,
    about: about || undefined,
    ...audit,
    posts_error: own.posts_error || (recent && recent.posts_error),
  });
}
