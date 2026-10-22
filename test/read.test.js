import { test } from "node:test";
import assert from "node:assert/strict";
import { makeContext } from "../src/util.js";
import { parseTarget, runRead } from "../src/read.js";
import { renderRead } from "../src/render.js";
import { ENV, makeFetch } from "./fake.js";

function ctxWith(fake = makeFetch()) {
  const ctx = makeContext(ENV, fake.fetch);
  ctx.retryDelayMs = 1;
  return { ctx, fake };
}

test("targets: every URL form resolves to the same post", () => {
  const forms = [
    "https://x.com/alice/status/123", "https://twitter.com/alice/status/123?s=20", "x.com/alice/status/123/photo/1",
    "https://mobile.twitter.com/alice/statuses/123", "https://fxtwitter.com/alice/status/123", "https://vxtwitter.com/i/status/123",
    "https://xcancel.com/alice/status/123", "123",
  ];
  for (const f of forms) assert.deepEqual({ ...parseTarget(f), input: undefined }, { kind: "post", id: "123", input: undefined }, f);
  assert.equal(parseTarget("@alice").kind, "profile");
  assert.equal(parseTarget("https://x.com/alice").handle, "alice");
  assert.equal(parseTarget("https://x.com/home").kind, "invalid");
  assert.equal(parseTarget("https://example.com/a/status/1").kind, "invalid");
  assert.match(parseTarget("https://x.com/i/article/123").reason, /pass the post/);
});

test("post: full FxTwitter data (quote, media, note, article, translation)", async () => {
  const { ctx, fake } = ctxWith();
  const r = await runRead({ targets: ["https://x.com/alice/status/100"], translate_to: "zh" }, ctx);
  assert.equal(r.items[0].post.author_avatar, "https://pbs.twimg.com/profile_images/1/alice_normal.jpg", "the author's avatar comes with the post");
  const it = r.items[0];
  assert.equal(it.source, "fxtwitter");
  const p = it.post;
  assert.equal(p.author, "@alice");
  assert.equal(p.created_at, "2025-10-09T08:53:20Z");
  assert.deepEqual(p.metrics, { views: 10000, likes: 100, replies: 30, reposts: 20, quotes: 5, bookmarks: 60 });
  assert.equal(p.quote.author, "@bob");
  assert.equal(p.media.length, 2);
  assert.equal(p.community_note, "context note");
  assert.match(p.article.body, /^# Title\n\nPara one\.\n\n1\. first\n\n2\. second\n\n```js/);
  assert.equal(p.translation.text, "翻译");
  assert.match(fake.calls[0].url, /lang=zh/);
  assert.match(fake.calls[0].headers["user-agent"], /^x-scout\//);
  const text = renderRead(r);
  assert.match(text, /10k views · 100 likes · 30 replies · 20 reposts · 5 quotes · 60 bookmarks/);
  assert.doesNotMatch(text, /^signals:|^source:|followers/m);
  assert.equal(p.author_followers, 1234, "full metadata remains in JSON");
  assert.match(text, /┌ quoting/);
  assert.match(text, /\[community note\] context note/);
});

test("thread and replies modes", async () => {
  const { ctx } = ctxWith();
  const t = await runRead({ targets: ["1"], mode: "thread" }, ctx);
  assert.equal(t.items[0].thread.length, 3);
  const threadText = renderRead(t);
  assert.equal(threadText.split("https://x.com/alice/status/1\n").length - 1, 1, "the target is not repeated in its thread");
  assert.match(threadText, /full text of 101/);
  assert.match(threadText, /full text of 102/);
  assert.match(threadText, /thread \(2 more posts by the author\)/);
  const r = await runRead({ targets: ["1"], mode: "replies", max_replies: 3 }, ctx);
  assert.deepEqual(r.items[0].replies.map((x) => x.author), ["@r1", "@r2", "@r3"]);
  const capped = await runRead({ targets: ["1"], mode: "replies", max_replies: 1 }, ctx);
  assert.equal(capped.items[0].replies.length, 1);
});

test("deleted post is an answer, not a fallback", async () => {
  const { ctx, fake } = ctxWith();
  const r = await runRead({ targets: ["500"] }, ctx);
  assert.equal(r.items[0].post.unavailable, "deleted");
  assert.equal(fake.calls.length, 1);
});

test("fallbacks: FxTwitter down -> vxTwitter -> X embed", async () => {
  const { ctx } = ctxWith();
  const vx = await runRead({ targets: ["200"] }, ctx);
  assert.equal(vx.items[0].source, "vxtwitter");
  assert.equal(vx.items[0].post.text, "vx full text 200");
  assert.equal(vx.items[0].fallback_from.length, 1);
  const synd = await runRead({ targets: ["300"], mode: "thread" }, ctx);
  assert.equal(synd.items[0].source, "syndication");
  assert.equal(synd.items[0].post.text_truncated, true);
  assert.match(synd.items[0].note, /needs FxTwitter/);
  assert.match(renderRead(synd), /text cut by the embed endpoint/);
  assert.match(renderRead(synd), /source: syndication.*after.*fxtwitter/);
});

test("not found everywhere: per-item error; all failed: throws", async () => {
  const { ctx } = ctxWith();
  const mixed = await runRead({ targets: ["404", "1"] }, ctx);
  assert.equal(mixed.items[0].kind, "error");
  assert.equal(mixed.items[1].kind, "post");
  await assert.rejects(runRead({ targets: ["404"] }, ctx), /not found/);
});

test("profiles, with vxTwitter fallback", async () => {
  const { ctx } = ctxWith();
  const a = await runRead({ targets: ["@alice"], profile_posts: 5 }, ctx);
  assert.equal(a.items[0].profile.followers, 1234);
  assert.equal(a.items[0].recent_posts.length, 2);
  const b = await runRead({ targets: ["https://x.com/bob"], profile_posts: 2 }, ctx);
  assert.equal(b.items[0].source, "vxtwitter");
  assert.equal(b.items[0].recent_posts.length, 2);
  assert.match(renderRead(a), /@alice · ALICE · verified\nhttps:\/\/x\.com\/alice\n1\.2k followers/);
});

test("input validation and de-duplication", async () => {
  const { ctx, fake } = ctxWith();
  await assert.rejects(runRead({ targets: [] }, ctx), /at least one/);
  await assert.rejects(runRead({ targets: Array(11).fill("1") }, ctx), /at most 10/);
  await assert.rejects(runRead({ targets: ["1"], mode: "nope" }, ctx), /mode/);
  await assert.rejects(runRead({ targets: ["1"], translate_to: "chinese!" }, ctx), /language code/);
  await assert.rejects(runRead({ targets: ["1"], source: "nitter" }, ctx), /source/);
  const r = await runRead({ targets: ["1", "https://x.com/alice/status/1", "nonsense url"] }, ctx);
  assert.equal(fake.calls.length, 1);
  assert.equal(r.items[2].kind, "error");
});
