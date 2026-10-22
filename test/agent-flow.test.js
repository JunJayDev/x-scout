import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMessage } from "../src/mcp.js";
import { makeContext } from "../src/util.js";
import { runRead } from "../src/read.js";
import { renderRead } from "../src/render.js";
import { ENV, makeFetch, fxStatus, fxUser } from "./fake.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const searchEnv = { ...ENV, XAI_API_KEY: "xai-test-key" };
const call = (ctx, name, args) => handleMessage({
  jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args },
}, ctx);

test("MCP: a single search finds links and returns original text without a model summary", async () => {
  const fake = makeFetch();
  const reply = await call(makeContext(searchEnv, fake.fetch), "x_search", { queries: ["beta"] });
  assert.equal(reply.result.isError, false);
  assert.match(reply.result.content[0].text, /full posts loaded/);
  assert.match(reply.result.content[0].text, /full text of 1/);
  assert.match(reply.result.content[0].text, /https:\/\/x.com\/alice\/status\/1/);
  assert.equal(fake.calls.filter(c => c.method === "POST").length, 1);
  assert.equal(fake.calls.filter(c => c.method === "GET").length, 2);
});

test("MCP: a valid empty search is successful in text and JSON, even with citations", async () => {
  for (const citations of [[], ["https://x.com/a/status/1"]]) {
    const fake = makeFetch({ "https://xai.test/": () => json({ output_text: "[]", citations }) });
    const ctx = makeContext(searchEnv, fake.fetch);
    for (const format of ["text", "json"]) {
      const reply = await call(ctx, "x_search", { queries: ["nothing fits", "no matches"], format });
      assert.equal(reply.result.isError, false);
      const text = reply.result.content[0].text;
      if (format === "json") assert.deepEqual(JSON.parse(text).results, []);
      else assert.match(text, /0 posts.*\n[\s\S]*No posts/);
    }
    assert.equal(fake.calls.length, 4);
  }
});

test("MCP: an ordinary account with About data and no hints still returns its profile", async () => {
  const now = Math.floor(Date.now() / 1000);
  const fake = makeFetch({ "https://fx.test/2/profile/healthy": url => {
    if (url.pathname.endsWith("/about")) return json({ code: 200, about_account: { based_in: "Japan", location_accurate: true, username_changes: { count: 0 } } });
    if (url.pathname.endsWith("/statuses")) return json({ code: 200, results: Array.from({ length: 12 }, (_, i) =>
      fxStatus(8000 + i, "healthy", { created_timestamp: now - i * 86400, likes: 100, bookmarks: 10, replies: 5, views: 1000 })), cursor: {} });
    return json({ code: 200, user: fxUser("healthy") });
  } });
  const ctx = makeContext(ENV, fake.fetch);
  const reply = await call(ctx, "x_audit", { account: "@healthy", format: "json" });
  assert.equal(reply.result.isError, false);
  const data = JSON.parse(reply.result.content[0].text);
  assert.equal(data.profile.handle, "@healthy");
  // The public result may omit empty optional hints; the operation must still succeed.
  assert.equal(data.hints?.length || 0, 0);
});

test("profile browsing: metadata-only makes one request, empty timelines stay explicit", async () => {
  const fake = makeFetch({ "https://fx.test/2/profile/alice/statuses": () => new Response(null, { status: 204 }) });
  const ctx = makeContext(ENV, fake.fetch);
  const bio = await runRead({ targets: ["@alice"], profile_posts: 0 }, ctx);
  assert.equal(bio.items[0].profile.handle, "@alice");
  assert.equal(fake.calls.length, 1);
  assert.equal(bio.items[0].recent_posts, undefined);
  const timeline = await runRead({ targets: ["@alice"] }, ctx);
  assert.deepEqual(timeline.items[0].recent_posts, []);
  assert.match(renderRead(timeline), /recent posts \(0\)/);
});

test("replies: empty conversations and partial page failures are distinguishable", async () => {
  const empty = makeFetch({ "https://fx.test/2/conversation/": () => json({ code: 200, status: fxStatus(1), replies: [] }) });
  const result = await runRead({ targets: ["1"], mode: "replies" }, makeContext(ENV, empty.fetch));
  assert.deepEqual(result.items[0].replies, []);
  assert.match(renderRead(result), /replies \(0, by likes\)/);
  const partial = makeFetch({ "https://fx.test/2/conversation/": url => url.searchParams.has("cursor")
    ? json({ code: 503 }, 503)
    : json({ code: 200, status: fxStatus(1), replies: [fxStatus(2)], cursor: { bottom: "next" } }) });
  const ctx = makeContext(ENV, partial.fetch);
  ctx.retryDelayMs = 1;
  const r = await runRead({ targets: ["1"], mode: "replies" }, ctx);
  assert.equal(r.items[0].replies.length, 1);
  assert.match(renderRead(r), /replies incomplete: FxTwitter error 503/);
});
