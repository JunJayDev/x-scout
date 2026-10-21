// `x-scout deploy`: put the MCP server on Cloudflare Workers (free plan is enough) so
// claude.ai, ChatGPT and phone apps can use it as a remote connector.
//
// Steps: find wrangler (or fetch it with npx) → make sure you are logged in → write a
// wrangler config next to the saved state → deploy → upload secrets through stdin →
// smoke-test from the public URL → print the connector URL. Re-running keeps the same token.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDir } from "./config.js";
import { InputError, sleep } from "./util.js";
import { parseArgv } from "./cli.js";

const HELP = `x-scout deploy: a remote MCP server on your Cloudflare account

Usage: x-scout deploy [--name x-scout] [--rotate] [--no-search] [--dry-run] [--check]

  --name NAME    Worker name (default x-scout); the URL is https://NAME.<you>.workers.dev
  --rotate       new connector token (the old URL stops working)
  --no-search    do not upload XAI_API_KEY even if it is set (x_read and x_audit only)
  --dry-run      build and validate, upload nothing
  --check        only test the deployed server

Needs Node 18+ and a Cloudflare account. Logging in opens a browser once; in CI set
CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID) instead. x_search is enabled when
XAI_API_KEY is set (environment or x-scout setup).`;

const COMPAT_DATE = "2025-09-01";

function stateDir(env) {
  return join(configDir(env), "worker");
}

function loadState(env) {
  const p = join(stateDir(env), "deploy.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function saveState(env, state) {
  const dir = stateDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "deploy.json"), JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

/** The Worker entry: a bundled worker.mjs next to this file (skill folder), or src/worker.js. */
export function workerEntry() {
  for (const name of ["./worker.mjs", "./worker.js"]) {
    const p = fileURLToPath(new URL(name, import.meta.url));
    if (existsSync(p)) return p;
  }
  throw new Error("cannot find the Worker source (worker.mjs or worker.js) next to the CLI");
}

function wranglerToml(name, main) {
  return [
    `name = ${JSON.stringify(name)}`,
    `main = ${JSON.stringify(main)}`,
    `compatibility_date = "${COMPAT_DATE}"`,
    "workers_dev = true",
    "",
  ].join("\n");
}

function run(cmd, args, { input, env, quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env,
      stdio: [input === undefined ? "inherit" : "pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      if (!quiet) process.stderr.write(d);
    });
    child.stderr.on("data", (d) => {
      out += d;
      if (!quiet) process.stderr.write(d);
    });
    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    }
    child.on("error", (err) => resolve({ code: 127, out: String(err.message) }));
    child.on("close", (code) => resolve({ code, out }));
  });
}

async function findWrangler(env) {
  const local = await run("wrangler", ["--version"], { env, quiet: true, input: "" });
  if (local.code === 0) return ["wrangler"];
  return ["npx", "--yes", "wrangler@4"];
}

async function rpc(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: null, text };
  }
}

async function smokeTest(base, token, withSearch, out) {
  const url = `${base}/mcp/${token}`;
  let tools = null;
  for (let i = 0; i < 8 && !tools; i++) {
    const r = await rpc(url, { jsonrpc: "2.0", id: 1, method: "tools/list" }).catch(() => null);
    if (r && r.json && r.json.result) tools = r.json.result.tools.map((t) => t.name);
    else await sleep(3000); // new secrets take a few seconds to reach every location
  }
  if (!tools) throw new Error(`the Worker does not answer tools/list at ${base}; check: wrangler tail`);
  out(`  tools: ${tools.join(", ")}`);
  const read = await rpc(url, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "x_read", arguments: { targets: ["https://x.com/jack/status/20"] } } });
  const readText = read.json && read.json.result && read.json.result.content[0].text;
  out(`  x_read: ${read.json && !read.json.result.isError ? "ok" : "FAILED"} ${String(readText || read.text || "").split("\n")[0].slice(0, 100)}`);
  if (withSearch && !tools.includes("x_search")) out("  x_search: missing, although XAI_API_KEY was uploaded");
  return tools;
}

export async function deploy(argv, env, out) {
  const { flags } = parseArgv(argv, { booleans: ["rotate", "dry-run", "check", "help"] });
  if (flags.help) return out(HELP);
  const name = flags.name || "x-scout";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new InputError("--name: lowercase letters, digits and dashes");

  const state = loadState(env);
  if (flags.check) {
    if (!state.url || !state.token) throw new InputError("nothing deployed yet from this machine");
    await smokeTest(state.url, state.token, Boolean(state.search), out);
    return;
  }

  const xaiKey = flags["no-search"] ? "" : env.XAI_API_KEY || "";
  const token = flags.rotate || !state.token || state.name !== name ? randomBytes(24).toString("hex") : state.token;
  const dir = stateDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const configFile = join(dir, "wrangler.toml");
  writeFileSync(configFile, wranglerToml(name, workerEntry()));

  const childEnv = { ...process.env, WRANGLER_SEND_METRICS: "false" };
  const wrangler = await findWrangler(childEnv);
  const w = (args, opts = {}) => run(wrangler[0], [...wrangler.slice(1), ...args, "--config", configFile], { env: childEnv, ...opts });

  if (flags["dry-run"]) {
    const r = await w(["deploy", "--dry-run", "--outdir", join(dir, "dist")]);
    if (r.code !== 0) throw new Error("wrangler could not build the Worker (see above)");
    return out(`Dry run ok: the Worker builds. Nothing was uploaded. Config: ${configFile}`);
  }

  out("Checking the Cloudflare login...");
  const who = await w(["whoami"], { quiet: true, input: "" });
  if (!/logged in|associated with the email|API Token/i.test(who.out) || /not authenticated/i.test(who.out)) {
    if (env.CLOUDFLARE_API_TOKEN) throw new Error(`CLOUDFLARE_API_TOKEN is set but wrangler cannot use it:\n${who.out.slice(0, 400)}`);
    out("Not logged in. A browser window opens: sign in to Cloudflare (a free account works) and click Allow.");
    const login = await w(["login"]);
    if (login.code !== 0) throw new Error("wrangler login failed. Run `npx wrangler login` yourself, then deploy again.");
  }

  out(`Deploying Worker "${name}"...`);
  const dep = await w(["deploy"], { input: "" });
  if (dep.code !== 0) {
    if (/workers\.dev subdomain/i.test(dep.out)) {
      throw new Error("your Cloudflare account has no workers.dev subdomain yet. Open https://dash.cloudflare.com → Workers & Pages once (it creates one), then run deploy again.");
    }
    throw new Error("wrangler deploy failed (see above)");
  }
  const url = (dep.out.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev/) || [])[0] || state.url;
  if (!url) throw new Error("deployed, but wrangler printed no workers.dev URL. Find it in the Cloudflare dashboard.");

  out("Uploading secrets...");
  const secrets = { MCP_TOKEN: token };
  if (xaiKey) secrets.XAI_API_KEY = xaiKey;
  for (const [k, v] of Object.entries(secrets)) {
    const r = await w(["secret", "put", k], { input: v, quiet: true });
    if (r.code !== 0) throw new Error(`could not set the ${k} secret:\n${r.out.slice(0, 400)}`);
  }
  if (!xaiKey && state.search) {
    await w(["secret", "delete", "XAI_API_KEY"], { input: "y\n", quiet: true });
  }
  saveState(env, { name, url, token, search: Boolean(xaiKey), deployed_at: new Date().toISOString() });

  out("Testing from the public URL...");
  await smokeTest(url, token, Boolean(xaiKey), out);

  out(`
Done. Your connector URL (the token in it is the password; keep it private):

  ${url}/mcp/${token}

claude.ai (web, desktop, phone): add a custom connector with this URL; no sign-in needed.
ChatGPT: in developer mode, create a connector with this URL and no authentication.
Claude Code: claude mcp add --transport http x-scout ${url}/mcp --header "Authorization: Bearer ${token}"
${xaiKey ? "x_search is on." : "x_search is off (no XAI_API_KEY). Turn it on: x-scout setup, then deploy again."}
New token: x-scout deploy --rotate · Test again: x-scout deploy --check`);
}
