import { test } from "node:test";
import assert from "node:assert/strict";
import { SearchError, makeContext } from "../src/util.js";
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
  await assert.rejects(runSearch({ queries: [] }, ctx), /at least one/);
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
  const r = await runSearch({ queries: ["alpha one", "beta two"], verify: true }, ctx);
  const byId = Object.fromEntries(r.results.map((h) => [h.url.match(/(\d+)$/)[1], h]));
  // post 1 is in both queries: first, verified, text from X not from the model
  assert.equal(r.results[0].url, "https://x.com/alice/status/1");
  assert.deepEqual(r.results[0].matched_queries, ["alpha one", "beta two"]);
  assert.equal(r.results[0].post.text, "full text of 1");
  assert.equal(r.results[0].lead, undefined);
  // the invented post cannot be confirmed
  assert.match(byId["404"].unverified, /not found/);
  assert.equal(byId["404"].lead.snippet, "invented");
  // Viewed citations do not override the model's selected results.
  assert.equal(byId["7"], undefined);
  assert.equal(r.verified, r.results.length - 1);
  assert.equal(r.rounds[0].usage.posts_fetched, 25);
  const text = renderSearch(r);
  assert.match(text, /full posts loaded, 1 could not be loaded/);
  assert.doesNotMatch(text, /not checked/);
  assert.match(text, /https:\/\/x\.com\/ghost\/status\/404/);
  assert.match(text, /invented/);
  assert.match(text, /25 posts fetched by the search model/);
});

test("xai: retries a 503; a persistent 429 on one query is reported and the others still answer", async () => {
  const { ctx, fake } = ctxWith(XAI);
  const ok = await runSearch({ queries: ["flaky alpha", "beta"] }, ctx);
  assert.ok(ok.results.length > 0);
  assert.equal(ok.failed, undefined);
  const part = await runSearch({ queries: ["always429", "beta"] }, ctx);
  assert.ok(part.results.length > 0);
  assert.deepEqual(part.failed.map((f) => f.query), ["always429"]);
  assert.match(part.failed[0].error, /HTTP 429/);
  const text = renderSearch(part);
  assert.match(text, /posts from 1 of 2 queries/);
  assert.match(text, /FAILED, not searched: "always429": HTTP 429.*incomplete/);
  assert.ok(fake.calls.length > 0);
});

test("xai: every query failing fails the call with a known error", async () => {
  const { ctx } = ctxWith(XAI);
  await assert.rejects(runSearch({ queries: ["always429", "always429 two"] }, ctx), (err) => err instanceof SearchError && /HTTP 429/.test(err.message));
});

test("xai: a timeout is not retried, and the other queries still answer", async () => {
  const { ctx, fake } = ctxWith({ ...XAI, SEARCH_TIMEOUT_S: "0.05" });
  const r = await runSearch({ queries: ["hangs one", "beta"] }, ctx);
  assert.deepEqual(r.failed.map((f) => f.query), ["hangs one"]);
  assert.match(r.failed[0].error, /timed out after 0\.05s/);
  assert.ok(r.results.length > 0);
  assert.equal(fake.calls.filter((c) => c.body && JSON.stringify(c.body).includes("hangs one")).length, 1);   // one try, not three
});

test("xai: response parsing ignores user links and prose", () => {
  const p = parseXaiResponse({ output_text: "Here you go: [{\"url\":\"https://x.com/a/status/5\",\"author\":\"@a\"}]", citations: [{ url: "https://x.com/i/user/1" }] });
  assert.deepEqual(p.results.map((r) => r.url), ["https://x.com/a/status/5"]);
  assert.deepEqual(parseXaiResponse({ output: [] }).results, []);
});

test("xai: valid JSON selections are not padded with viewed citations", () => {
  const picked = [5, 6, 5].map((id) => ({ url: `https://x.com/a/status/${id}`, author: "@a" }));
  const citations = Array.from({ length: 60 }, (_, i) => `https://x.com/i/status/${100 + i}`);
  const p = parseXaiResponse({ output_text: JSON.stringify(picked), citations }, 4);
  assert.deepEqual(p.results.map((r) => r.url), ["https://x.com/a/status/5", "https://x.com/a/status/6"]);
  assert.equal(parseXaiResponse({ output_text: JSON.stringify(picked), citations }, 1).results.length, 1);
});

test("only the first 20 hits are read from X; the rest are counted as not checked", () => {
  const text = renderSearch({ provider: "xai", rounds: [], verified: 18, unverified: 2, unchecked: 7, results: [] });
  assert.match(text, /18 full posts loaded, 2 could not be loaded, 7 not loaded \(limit 20\)/);
});

test("verify=false skips reading X", async () => {
  const { ctx, fake } = ctxWith(XAI);
  const r = await runSearch({ queries: ["alpha", "beta"], verify: false }, ctx);
  assert.ok(!fake.calls.some((c) => c.url.startsWith("https://fx.test")));
  assert.equal(r.verified, undefined);
  assert.match(renderSearch(r), /search snippets/);
});

test("unexpected authors, redirects, no key", async () => {
  const { ctx } = ctxWith(XAI);
  const r = await runSearch({ queries: ["beta one", "beta two"], allowed_x_handles: ["bob"] }, ctx);
  assert.ok(r.unexpected_authors.includes("@alice"));
  await assert.rejects(runSearch({ queries: ["redirect me", "b"] }, ctx), /redirected to https:\/\/moved\.test/);
  await assert.rejects(runSearch({ queries: ["a", "b"] }, ctxWith(ENV).ctx), /needs XAI_API_KEY/);
});


test("search filters use snippet metadata by default and full post metadata when loaded", async () => {
  const { ctx } = ctxWith(XAI);
  const range = { queries: ["beta"], from_date: "2026-10-11", to_date: "2026-10-13" };
  const snippets = await runSearch(range, ctx);
  assert.equal(snippets.results.length, 2, "inclusive date bounds preserve both endpoints");
  const excluded = await runSearch({ ...range, excluded_x_handles: ["ALICE"] }, ctx);
  assert.deepEqual(excluded.results.map(h => h.lead.author), ["@carol"]);
  assert.equal(excluded.filtered_out, 1);
  const allowed = await runSearch({ ...range, allowed_x_handles: ["@alice"] }, ctx);
  assert.deepEqual(allowed.results.map(h => h.lead.author), ["@alice"]);
  const full = await runSearch({ ...range, verify: true }, ctx);
  assert.deepEqual(full.results, [], "real post dates are 2025, despite the model's 2026 dates");
  assert.equal(full.verified, 0);
  assert.equal(full.filtered_out, 2);
  assert.match(renderSearch(full), /omitted 2 posts outside/);
});

test("citation fallback is bounded and accepts only X post URLs", () => {
  const citations = ["https://example.com/a/status/99", "https://x.com/a/status/1", "https://x.com/a/status/2"];
  const r = parseXaiResponse({ output_text: "Here are the links", citations }, 1);
  assert.deepEqual(r.results.map(h => h.url), ["https://x.com/a/status/1"]);
  assert.deepEqual(parseXaiResponse({ output_text: "[]", citations }).results, []);
});
