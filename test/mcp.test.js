import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { handleHttp } from "../src/http.js";
import { serveStdio } from "../src/stdio.js";
import { SERVER_INFO } from "../src/mcp.js";
import { VERSION } from "../src/util.js";
import { ENV, makeFetch } from "./fake.js";
import { readFileSync } from "node:fs";

const TOKEN = "test-token_ABC123";
const env = { ...ENV, MCP_TOKEN: TOKEN };

async function rpc(body, { path = "/mcp", token = TOKEN, header = true, method = "POST", e = env, fake = makeFetch() } = {}) {
  const headers = { "content-type": "application/json" };
  if (header && token) headers.authorization = `Bearer ${token}`;
  const req = new Request(`https://w.test${path}`, { method, headers, body: method === "POST" ? JSON.stringify(body) : undefined });
  const res = await handleHttp(req, e, fake.fetch);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

test("version is the same everywhere", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  const plugin = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url)));
  assert.equal(pkg.version, VERSION);
  assert.equal(plugin.version, VERSION);
  assert.equal(SERVER_INFO.version, VERSION);
});

test("http auth: bearer, secret URL, wrong token, missing config", async () => {
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { header: false })).status, 401);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { token: "nope" })).status, 401);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { path: "/mcp/wrong", header: false })).status, 404);
  const ok = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { path: `/mcp/${TOKEN}`, header: false });
  assert.deepEqual(ok.json, { jsonrpc: "2.0", id: 1, result: {} });
  assert.equal((await rpc(null, { method: "GET" })).status, 405);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { e: ENV })).status, 503);
});

test("initialize, notifications, batches, unknown methods", async () => {
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.json.result.protocolVersion, "2025-06-18");
  assert.equal(init.json.result.serverInfo.name, "signal-first");
  assert.match(init.json.result.instructions, /x_search is off/);
  const fallback = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(fallback.json.result.protocolVersion, "2025-11-25");
  assert.equal((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const batch = await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }, { jsonrpc: "2.0", id: 2, method: "nope" }]);
  assert.equal(batch.json.length, 2);
  assert.equal(batch.json[1].error.code, -32601);
});

test("tools/list shows x_search only with a key", async () => {
  const names = async (e) => (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { e })).json.result.tools.map((t) => t.name);
  assert.deepEqual(await names(env), ["x_read", "x_audit"]);
  assert.deepEqual(await names({ ...env, XAI_API_KEY: "xai-test-key" }), ["x_read", "x_search", "x_audit"]);
});

test("tools/call: text by default, json on request, errors as isError", async () => {
  const call = (name, args) => rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name, arguments: args } });
  const text = await call("x_read", { targets: ["1"] });
  assert.equal(text.json.result.isError, false);
  assert.match(text.json.result.content[0].text, /^\[1\] @alice/);
  const json = await call("x_read", { targets: ["1"], format: "json" });
  assert.equal(JSON.parse(json.json.result.content[0].text).items[0].post.id, "1");
  const bad = await call("x_read", { targets: [] });
  assert.equal(bad.json.result.isError, true);
  const off = await call("x_search", { queries: ["a", "b"] });
  assert.match(off.json.result.content[0].text, /needs an xAI API key/);
  const unknown = await call("x_nope", {});
  assert.equal(unknown.json.error.code, -32602);
});

test("stdio transport", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let out = "";
  output.on("data", (d) => (out += d));
  const done = serveStdio({ ...ENV }, { input, output });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  input.write("not json\n");
  input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
  input.end();
  await done;
  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.equal(lines.find((l) => l.id === 1).result.serverInfo.name, "signal-first");
  assert.equal(lines.find((l) => l.error).error.code, -32700);
  assert.equal(lines.find((l) => l.id === 2).result.tools.length, 2);
});

test("default fetch is not called as a method of the context (Workers: Illegal invocation)", async (t) => {
  const { makeContext } = await import("../src/util.js");
  t.mock.method(globalThis, "fetch", function () {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return Promise.resolve(new Response("{}"));
  });
  const ctx = makeContext({});
  await ctx.fetch("https://a.test/");
});
