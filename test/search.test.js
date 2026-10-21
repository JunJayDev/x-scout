import { test } from "node:test";
import assert from "node:assert/strict";
import { makeContext } from "../src/util.js";
import { dayAfter, parseXaiResponse, renderSearch, runSearch, searchProvider } from "../src/search.js";
import { ENV, makeFetch } from "./fake.js";

const XAI = { ...ENV, XAI_API_KEY: "xai-test-key" };

function ctxWith(env, fake = makeFetch()) {
  const ctx = makeContext(env, fake.fetch);
  ctx.retryDelayMs = 1;
  return { ctx, fake };
}

test("provider selection", () => {
  assert.equal(searchProvider({}), null);
  assert.equal(searchProvider(XAI), "xai");
});

test("input validation", async () => {
  const { ctx } = ctxWith(XAI);
  await assert.rejects(runSearch({ queries: ["one"] }, ctx), /at least two/);
  await assert.rejects(runSearch({ queries: ["a", "A"] }, ctx), /different/);
  await assert.rejects(runSearch({ queries: ["a", "b"], from_date: "2026-02-30" }, ctx), /real date/);
  await assert.rejects(runSearch({ queries: ["a", "b"], from_date: "2026-10-02", to_date: "2026-10-01" }, ctx), /after/);
  await assert.rejects(runSearch({ queries: ["a", "b"], allowed_x_handles: ["a"], excluded_x_handles: ["b"] }, ctx), /cannot be combined/);
});

test("xai: request shape (tool, filters, inclusive to_date, cost cap)", async () => {
  const { ctx, fake } = ctxWith(XAI);
  await runSearch({ queries: ["alpha one", "beta two"], from_date: "2026-10-01", to_date: "2026-10-14", allowed_x_handles: ["@alice", "carol"], enable_image_understanding: true }, ctx);
  const calls = fake.calls.filter((c) => c.url === "https://xai.test/v1/responses");
  assert.equal(calls.length, 2);
  const b = calls[0].body;
  assert.equal(b.model, "grok-4.7");
  assert.deepEqual(b.include, ["no_inline_citations"]);
  assert.equal(b.max_turns, 2);
  assert.equal(b.store, false);
  assert.deepEqual(b.tools, [{ type: "x_search", allowed_x_handles: ["alice", "carol"], from_date: "2026-10-01", to_date: "2026-10-15", enable_image_understanding: true }]);
  assert.match(b.input[0].content, /alpha one/);
  assert.equal(calls[0].headers.authorization, "Bearer xai-test-key");
  assert.equal(dayAfter("2026-12-31"), "2027-01-01");
});

test("xai: merge, verify against X, keep unverified leads", async () => {
  const { ctx } = ctxWith(XAI);
  const r = await runSearch({ queries: ["alpha one", "beta two"] }, ctx);
  const byId = Object.fromEntries(r.results.map((h) => [h.url.match(/(\d+)$/)[1], h]));
  // post 1 is in both queries: first, verified, text from X not from the model
  assert.equal(r.results[0].url, "https://x.com/alice/status/1");
  assert.deepEqual(r.results[0].matched_queries, ["alpha one", "beta two"]);
  assert.equal(r.results[0].post.text, "full text of 1");
  assert.equal(r.results[0].lead, undefined);
  // the invented post cannot be confirmed
  assert.match(byId["404"].unverified, /not found/);
  assert.equal(byId["404"].lead.snippet, "invented");
  // cited by the tool but missing from the JSON: kept as a lead and verified
  assert.ok(byId["7"].post);
  assert.equal(r.verified, r.results.length - 1);
  assert.equal(r.rounds[0].usage.posts_fetched, 25);
  const text = renderSearch(r);
  assert.match(text, /confirmed on X, 1 not found on X/);
  assert.doesNotMatch(text, /not checked/);
  assert.match(text, /UNVERIFIED https:\/\/x\.com\/ghost\/status\/404/);
  assert.match(text, /search model's text \(may be wrong\): invented/);
  assert.match(text, /25 posts fetched by the search model/);
});

test("xai: retries a 503, fails the call on persistent 429", async () => {
  const { ctx } = ctxWith(XAI);
  const ok = await runSearch({ queries: ["flaky alpha", "beta"] }, ctx);
  assert.ok(ok.results.length > 0);
  await assert.rejects(runSearch({ queries: ["always429", "beta"] }, ctx), /HTTP 429/);
});

test("xai: response parsing ignores user links and prose", () => {
  const p = parseXaiResponse({ output_text: "Here you go: [{\"url\":\"https://x.com/a/status/5\",\"author\":\"@a\"}]", citations: [{ url: "https://x.com/i/user/1" }] });
  assert.deepEqual(p.results.map((r) => r.url), ["https://x.com/a/status/5"]);
  assert.deepEqual(parseXaiResponse({ output: [] }).results, []);
});

test("xai: citations (every post the tool looked at) only fill up to max_results", () => {
  const picked = [5, 6, 5].map((id) => ({ url: `https://x.com/a/status/${id}`, author: "@a" }));
  const citations = Array.from({ length: 60 }, (_, i) => `https://x.com/i/status/${100 + i}`);
  const p = parseXaiResponse({ output_text: JSON.stringify(picked), citations }, 4);
  assert.deepEqual(p.results.map((r) => r.url), ["https://x.com/a/status/5", "https://x.com/a/status/6", "https://x.com/i/status/100", "https://x.com/i/status/101"]);
  assert.equal(parseXaiResponse({ output_text: JSON.stringify(picked), citations }, 1).results.length, 1);
});

test("only the first 20 hits are read from X; the rest are counted as not checked", () => {
  const text = renderSearch({ provider: "xai", rounds: [], verified: 18, unverified: 2, unchecked: 7, results: [] });
  assert.match(text, /18 confirmed on X, 2 not found on X, 7 not checked \(only the first 20 are\)/);
});

test("verify=false skips reading X", async () => {
  const { ctx, fake } = ctxWith(XAI);
  const r = await runSearch({ queries: ["alpha", "beta"], verify: false }, ctx);
  assert.ok(!fake.calls.some((c) => c.url.startsWith("https://fx.test")));
  assert.equal(r.verified, undefined);
  assert.match(renderSearch(r), /not verified/);
});

test("unexpected authors, redirects, no key", async () => {
  const { ctx } = ctxWith(XAI);
  const r = await runSearch({ queries: ["beta one", "beta two"], allowed_x_handles: ["bob"] }, ctx);
  assert.ok(r.unexpected_authors.includes("@alice"));
  await assert.rejects(runSearch({ queries: ["redirect me", "b"] }, ctx), /redirected to https:\/\/moved\.test/);
  await assert.rejects(runSearch({ queries: ["a", "b"] }, ctxWith(ENV).ctx), /needs XAI_API_KEY/);
});
