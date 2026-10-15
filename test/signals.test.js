import { test } from "node:test";
import assert from "node:assert/strict";
import { makeContext } from "../src/util.js";
import { auditAccount, postSignals, runAudit } from "../src/signals.js";
import { renderAudit } from "../src/render.js";
import { ENV, makeFetch } from "./fake.js";

test("post signals need enough likes and views", () => {
  assert.deepEqual(postSignals({ metrics: { likes: 441, bookmarks: 397, replies: 268, reposts: 28, quotes: 27, views: 113000 } }), {
    save: 0.9, talk: 0.61, spread: 0.12, eng: 0.0103,
  });
  assert.equal(postSignals({ metrics: { likes: 3, bookmarks: 3, views: 50 } }), undefined);
  assert.deepEqual(postSignals({ metrics: { likes: 3, views: 500 } }), { eng: 0.006 });
  assert.equal(postSignals({}), undefined);
});

test("audit: classifies posts and computes baselines", async () => {
  const fake = makeFetch();
  const ctx = makeContext(ENV, fake.fetch);
  const a = await runAudit({ account: "https://x.com/dana" }, ctx);
  assert.equal(a.sample.originals, 14);
  assert.equal(a.sample.replies, 5);
  assert.equal(a.sample.reposts, 1);
  assert.equal(a.originals.median_views, 1065); // 12 originals at 1000-1110 views, one at 10k, one at 120k
  assert.ok(a.originals.breakout >= 10);
  assert.equal(a.top_by_views[0].text, "the big one");
  assert.ok(a.originals.with_external_link > 0);
  assert.ok(a.hints.some((h) => /follow-back/.test(h)));
  assert.ok(a.hints.some((h) => /keep these posts/.test(h)));
  const timelines = fake.calls.filter((c) => c.url.includes("/statuses"));
  assert.equal(timelines.length, 2);
  assert.ok(timelines.some((c) => /with_replies=1/.test(c.url)));
  assert.ok(timelines.some((c) => !/with_replies/.test(c.url)));
  assert.equal(a.top_by_views.filter((p) => p.text === "the big one").length, 1); // pinned duplicate removed
  assert.equal(a.originals.count, 14);
  const text = renderAudit(a);
  assert.match(text, /sample: 20 posts/);
  assert.match(text, /top by views:\n- 120k views/);
  assert.match(text, /hints \(check them against the posts\):/);
});

test("audit: rejects posts and bad input", async () => {
  const ctx = makeContext(ENV, makeFetch().fetch);
  await assert.rejects(runAudit({ account: "https://x.com/a/status/1" }, ctx), /not a post/);
  await assert.rejects(runAudit({ account: "" }, ctx), /handle/);
  await assert.rejects(runAudit({ account: "@dana", posts: 5 }, ctx), /between 10 and 100/);
});

test("audit hints: quiet, new, reply-heavy, link-heavy", () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  const profile = { handle: "@q", followers: 100000, following: 10, posts: 50, joined: "2026-09-01T00:00:00Z" };
  const old = "2026-08-01T00:00:00Z";
  const posts = [
    ...Array.from({ length: 3 }, (_, i) => ({ id: `${i}`, author: "@q", created_at: old, text: "see https://news.example/a", metrics: { likes: 50, views: 1000 } })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, author: "@q", created_at: old, replying_to: { author: "@other" }, metrics: { likes: 1 } })),
  ];
  const a = auditAccount(profile, posts, now);
  const h = a.hints.join("\n");
  assert.match(h, /quiet: last post 75 days ago/);
  assert.match(h, /new account: 44 days old/);
  assert.match(h, /mostly replies: 8 replies vs 3 originals/);
  assert.match(h, /link-heavy: 100%/);
});
