import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseArgv } from "../src/cli.js";
import { loadEnv, readConfigFile, writeConfigValue } from "../src/config.js";
import { ENV, makeFetch } from "./fake.js";

test("argv parsing", () => {
  const { pos, flags } = parseArgv(["a", "--thread", "--max", "3", "--handle", "x", "--handle=y", "--no-verify", "--", "--literal"], {
    booleans: ["thread"], repeat: ["handle"],
  });
  assert.deepEqual(pos, ["a", "--literal"]);
  assert.deepEqual(flags, { thread: true, max: "3", handle: ["x", "y"], "no-verify": true });
  assert.throws(() => parseArgv(["--max"]), /needs a value/);
});

test("config file: written 0600, read back, env wins", () => {
  const dir = mkdtempSync(join(tmpdir(), "xs-"));
  const env = { X_SCOUT_CONFIG: join(dir, "c", "config.env") };
  const path = writeConfigValue("XAI_API_KEY", "xai-file", env);
  // Windows has no POSIX permission bits: files read back as 0666 whatever was asked for.
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readConfigFile(path), { XAI_API_KEY: "xai-file" });
  assert.equal(loadEnv(env).XAI_API_KEY, "xai-file");
  assert.equal(loadEnv({ ...env, XAI_API_KEY: "xai-env" }).XAI_API_KEY, "xai-env");
  assert.equal(loadEnv({ ...env, XAI_API_KEY: "${user_config.xai_api_key}" }).XAI_API_KEY, "xai-file");
  writeConfigValue("XAI_API_KEY", null, env);
  assert.equal(readFileSync(path, "utf8").trim(), "");
});

test("read and audit through the CLI with the fake network", async (t) => {
  const fake = makeFetch();
  t.mock.method(globalThis, "fetch", fake.fetch);
  const saved = { ...process.env };
  Object.assign(process.env, ENV, { X_SCOUT_CONFIG: join(tmpdir(), "xs-none", "config.env") });
  delete process.env.XAI_API_KEY;
  try {
    let out = "";
    await main(["read", "https://x.com/alice/status/1", "--thread"], (s) => (out += s));
    assert.match(out, /thread \(3 posts by the author\)/);
    out = "";
    await main(["read", "1", "--json"], (s) => (out += s));
    assert.equal(JSON.parse(out).items[0].post.id, "1");
    out = "";
    await main(["audit", "@dana", "--posts", "50"], (s) => (out += s));
    assert.match(out, /originals: 14 \(.*\) · median views/);
    await assert.rejects(main(["search", "a", "b"], () => {}), /needs an xAI API key/);
    await assert.rejects(main(["frobnicate"], () => {}), /unknown command/);
    out = "";
    await main(["--version"], (s) => (out += s));
    assert.match(out, /^\d+\.\d+\.\d+$/);
  } finally {
    process.env = saved;
  }
});

test("CLI: one query works, full post loading is opt-in, --no-verify stays compatible", async (t) => {
  const fake = makeFetch();
  t.mock.method(globalThis, "fetch", fake.fetch);
  const saved = { ...process.env };
  Object.assign(process.env, ENV, { XAI_API_KEY: "xai-test-key", X_SCOUT_CONFIG: join(tmpdir(), "xs-none", "config.env") });
  try {
    let out = "";
    await main(["search", "beta", "--json"], s => out = s);
    assert.equal(fake.calls.length, 1);
    assert.equal(JSON.parse(out).results[0].lead.snippet, "post 1");
    await main(["search", "beta", "--verify", "--json"], s => out = s);
    assert.equal(JSON.parse(out).results[0].post.text, "full text of 1");
    const before = fake.calls.length;
    await main(["search", "beta", "--no-verify", "--json"], s => out = s);
    assert.equal(fake.calls.length - before, 1);
    assert.equal(JSON.parse(out).results[0].post, undefined);
  } finally {
    process.env = saved;
  }
});
