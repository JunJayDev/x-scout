// Compact text for agents. JSON is available everywhere with format=json / --json;
// text is the default because every token of tool output is paid for by every user.

import { compact } from "./util.js";
import { postSignals } from "./signals.js";

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : `${d.toISOString().slice(0, 16).replace("T", " ")}Z`;
}

function metricLine(m = {}) {
  const order = [["views", "views"], ["likes", "likes"], ["replies", "replies"], ["reposts", "reposts"], ["quotes", "quotes"], ["bookmarks", "bookmarks"]];
  return order.filter(([k]) => typeof m[k] === "number").map(([k, label]) => `${compact(m[k])} ${label}`).join(" · ");
}

function signalLine(post) {
  const s = postSignals(post);
  if (!s) return "";
  const parts = [];
  if (s.save !== undefined) parts.push(`save ${s.save}`);
  if (s.talk !== undefined) parts.push(`talk ${s.talk}`);
  if (s.spread !== undefined) parts.push(`spread ${s.spread}`);
  if (s.eng !== undefined) parts.push(`eng ${(s.eng * 100).toFixed(2)}%`);
  return parts.length ? `signals: ${parts.join(" · ")}` : "";
}

function indent(text, pad) {
  return String(text).split("\n").map((l) => (l ? pad + l : l)).join("\n");
}

export function renderPost(p, { pad = "", label = "" } = {}) {
  if (!p) return `${pad}(no post)`;
  if (p.unavailable) return `${pad}${label}unavailable (${p.unavailable})${p.url ? ` ${p.url}` : ""}`;
  const head = [
    p.author || "?",
    p.author_name && p.author_name !== (p.author || "").slice(1) ? p.author_name : "",
    typeof p.author_followers === "number" ? `${compact(p.author_followers)} followers` : "",
    when(p.created_at),
  ].filter(Boolean).join(" · ");
  const lines = [`${label}${head}`, p.url];
  if (p.replying_to) lines.push(`replying to ${p.replying_to.author}${p.replying_to.url ? ` ${p.replying_to.url}` : ""}`);
  if (p.reposted_by) lines.push(`reposted by ${p.reposted_by}`);
  const m = metricLine(p.metrics);
  if (m) lines.push(m);
  const s = signalLine(p);
  if (s) lines.push(s);
  if (p.text_truncated) lines.push("note: text cut by the embed endpoint");
  lines.push("", p.text || "");
  if (p.article) {
    lines.push("", `[X Article] ${p.article.title || ""}`);
    if (p.article.body) lines.push(p.article.body);
    else if (p.article.preview) lines.push(p.article.preview, p.article.body_unavailable ? `(${p.article.body_unavailable})` : "");
  }
  if (p.media && p.media.length) {
    lines.push("", ...p.media.map((x) => `[${x.type}] ${x.url}${x.alt ? ` alt: ${x.alt}` : ""}${x.duration_s ? ` ${Math.round(x.duration_s)}s` : ""}`));
  }
  if (p.card) lines.push(`[link] ${p.card.title || ""} ${p.card.url}`.trim());
  if (p.poll) {
    lines.push(`[poll] ${p.poll.choices.map((c) => `${c.label} ${c.percent ?? "?"}%`).join(" / ")}${p.poll.total_votes ? ` (${compact(p.poll.total_votes)} votes)` : ""}`);
  }
  if (p.community_note) lines.push(`[community note] ${p.community_note}`);
  if (p.translation) lines.push(`[translation ${p.translation.from || "?"}→${p.translation.to || "?"}] ${p.translation.text}`);
  if (p.quote_url) lines.push(`[quotes] ${p.quote_url}`);
  let out = indent(lines.join("\n"), pad);
  if (p.quote) out += `\n${pad}  ┌ quoting\n${renderPost(p.quote, { pad: `${pad}  │ ` })}`;
  return out;
}

export function renderProfile(u, pad = "") {
  if (!u) return "";
  const head = [u.handle, u.name, u.verified ? "verified" : "", u.protected ? "protected" : ""].filter(Boolean).join(" · ");
  const stats = [
    typeof u.followers === "number" ? `${compact(u.followers)} followers` : "",
    typeof u.following === "number" ? `following ${compact(u.following)}` : "",
    typeof u.posts === "number" ? `${compact(u.posts)} posts` : "",
    u.joined ? `joined ${String(u.joined).slice(0, 10)}` : "",
  ].filter(Boolean).join(" · ");
  const lines = [head, u.url, stats];
  if (u.description) lines.push(`bio: ${u.description.replace(/\s+/g, " ")}`);
  if (u.website || u.location) lines.push([u.website, u.location].filter(Boolean).join(" · "));
  return indent(lines.filter(Boolean).join("\n"), pad);
}

function sourceLine(item) {
  const parts = [`source: ${item.source}`];
  if (item.fallback_from) parts.push(`after ${item.fallback_from.join("; ")}`);
  if (item.note) parts.push(item.note);
  return parts.join(" · ");
}

export function renderRead(result) {
  const blocks = result.items.map((item, i) => {
    const n = `[${i + 1}] `;
    if (item.kind === "error") return `${n}${item.input}: ERROR ${item.error}`;
    if (item.kind === "profile") {
      const lines = [`${n}${renderProfile(item.profile)}`, sourceLine(item)];
      if (item.posts_error) lines.push(`recent posts: ${item.posts_error}`);
      if (item.recent_posts) lines.push(`recent posts (${item.recent_posts.length}):`);
      for (const [j, p] of (item.recent_posts || []).entries()) lines.push("", renderPost(p, { pad: "  ", label: `${i + 1}.${j + 1} ` }));
      return lines.join("\n");
    }
    const lines = [renderPost(item.post, { label: n }), sourceLine(item)];
    if (item.thread) {
      lines.push("", `thread (${item.thread.length} posts by the author):`);
      for (const [j, p] of item.thread.entries()) lines.push(renderPost(p, { pad: "  ", label: `t${j + 1} ` }), "");
    }
    if (item.replies) {
      lines.push("", `replies (${item.replies.length}, by ${item.replies_ranking}):`);
      for (const [j, p] of item.replies.entries()) lines.push(renderPost(p, { pad: "  ", label: `r${j + 1} ` }), "");
    }
    if (item.replies_error) lines.push(`replies incomplete: ${item.replies_error}`);
    return lines.join("\n");
  });
  return blocks.join("\n\n———\n\n");
}

export function renderAudit(a) {
  const lines = [renderProfile(a.profile), `source: ${a.source}`];
  if (a.about) {
    const ab = a.about;
    const parts = [
      ab.based_in ? `based in ${ab.based_in}${ab.location_accurate === false ? " (X: may be inaccurate)" : ""}` : "",
      typeof ab.username_changes === "number" ? `handle changed ${ab.username_changes}x${ab.username_last_changed ? `, last ${ab.username_last_changed.slice(0, 10)}` : ""}` : "",
      ab.connected_via ? `signed up via ${ab.connected_via}` : "",
    ].filter(Boolean);
    if (parts.length) lines.push(`about: ${parts.join(" · ")}`);
  }
  const s = a.sample || {};
  const o = a.originals || {};
  const acc = a.account || {};
  if (acc.posts_per_day_lifetime !== undefined) lines.push(`lifetime: ${acc.posts_per_day_lifetime} posts/day over ${acc.age_days} days`);
  lines.push(
    `sample: ${s.posts || 0} posts ${s.from ? `${s.from} → ${s.to}` : ""} · ${s.originals || 0} originals · ${s.replies || 0} replies · ${s.reposts || 0} reposts` +
      (s.posts_per_day !== undefined ? ` · ${s.posts_per_day}/day` : "") +
      (s.days_since_last_post !== undefined ? ` · last post ${s.days_since_last_post}d ago` : "")
  );
  const parts = [];
  if (o.count !== undefined) parts.push(`${o.count}${o.from ? ` (${o.from} → ${o.to})` : ""}`);
  if (o.median_views !== undefined) parts.push(`median views ${compact(o.median_views)} (p90 ${compact(o.p90_views)})`);
  if (o.median_likes !== undefined) parts.push(`median likes ${compact(o.median_likes)}`);
  if (o.likes_per_1k_followers !== undefined) parts.push(`${o.likes_per_1k_followers} likes per 1k followers`);
  if (o.save !== undefined) parts.push(`save ${o.save}`);
  if (o.talk !== undefined) parts.push(`talk ${o.talk}`);
  if (o.with_external_link !== undefined) parts.push(`${Math.round(o.with_external_link * 100)}% link out`);
  if (o.with_media !== undefined) parts.push(`${Math.round(o.with_media * 100)}% media`);
  if (o.long_posts) parts.push(`${o.long_posts} long posts`);
  if (o.articles) parts.push(`${o.articles} articles`);
  if (o.breakout !== undefined) parts.push(`best/median ${o.breakout}x`);
  if (parts.length) lines.push(`originals: ${parts.join(" · ")}`);
  const top = (title, list) => {
    if (!list || !list.length) return;
    lines.push("", title);
    for (const p of list) {
      const nums = [p.views !== undefined ? `${compact(p.views)} views` : "", p.likes !== undefined ? `${compact(p.likes)} likes` : "", p.x_median ? `${p.x_median}x median` : "", p.save !== undefined ? `save ${p.save}` : ""].filter(Boolean).join(" · ");
      lines.push(`- ${nums} · ${String(p.created_at || "").slice(0, 10)} ${p.url}`, `  ${p.text}`);
    }
  };
  top("top by views:", a.top_by_views);
  top("top by saves (bookmarks/likes):", a.top_by_saves);
  if (a.hints && a.hints.length) lines.push("", "hints (check them against the posts):", ...a.hints.map((h) => `- ${h}`));
  if (a.posts_error) lines.push(`recent posts: ${a.posts_error}`);
  return lines.join("\n");
}
