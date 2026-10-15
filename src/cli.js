// Command-line interface. Agents that read skills call it from a shell; people use it to
// set up and deploy. Output is the same compact text the MCP tools return (--json for JSON).

import { ConfigError, InputError, VERSION, makeContext } from "./util.js";
import { callTool, listTools } from "./mcp.js";
import { configPath, loadEnv, writeConfigValue } from "./config.js";
import { searchProvider } from "./search.js";

const HELP = `signal-first ${VERSION}: read, search and judge X (Twitter) from any agent

Usage
  signal-first read <url|id|@handle>...   posts, threads, replies, profiles, X Articles
      --thread | --replies [--max-replies N] [--by-recency]
      --posts N [--with-replies]           recent posts for profiles (default 20)
      --translate <lang>  --source <fxtwitter|vxtwitter|syndication>
  signal-first search "<query>" "<query>"... [--from YYYY-MM-DD] [--to YYYY-MM-DD]
      [--handle h]... [--exclude h]... [--max N] [--images] [--videos] [--no-verify]
                                           needs XAI_API_KEY (signal-first setup)
  signal-first audit <@handle|url> [--posts N]
  signal-first mcp                         run as a local MCP server (stdio)
  signal-first setup                       save your xAI API key (prompt, or stdin)
  signal-first doctor                      check keys and every X source
  signal-first deploy [options]            put a remote MCP server on Cloudflare Workers
                                           (see: signal-first deploy --help)
Common
  --json      full JSON instead of compact text
  --version, --help

Docs: https://github.com/signal-first/signal-first`;

/** Minimal parser: positionals, --flag, --flag=value, --flag value, repeatable flags. */
export function parseArgv(argv, { booleans = [], repeat = [] } = {}) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("--") || a === "--") {
      pos.push(a);
      continue;
    }
    let [key, value] = a.slice(2).split(/=(.*)/s, 2);
    if (value === undefined) {
      if (booleans.includes(key) || key.startsWith("no-")) value = true;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) value = argv[++i];
      else throw new InputError(`--${key} needs a value`);
    }
    if (repeat.includes(key)) (flags[key] = flags[key] || []).push(value);
    else flags[key] = value;
  }
  return { pos, flags };
}

function int(v, name) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new InputError(`--${name} must be a whole number`);
  return n;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function promptHidden(question) {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  rl._writeToOutput = function (s) {
    if (s.startsWith(question)) process.stderr.write(question);
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolve(answer.trim());
    });
  });
}

async function run(name, args, flags, out) {
  const ctx = makeContext(loadEnv());
  const { text } = await callTool(name, { ...args, format: flags.json ? "json" : "text" }, ctx);
  out(text);
}

export async function main(argv = process.argv.slice(2), out = (s) => process.stdout.write(s + "\n")) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return out(HELP);
  if (cmd === "--version" || cmd === "-v" || cmd === "version") return out(VERSION);

  switch (cmd) {
    case "read": {
      const { pos, flags } = parseArgv(rest, { booleans: ["thread", "replies", "with-replies", "by-recency", "json"] });
      return run("x_read", {
        targets: pos,
        mode: flags.replies ? "replies" : flags.thread ? "thread" : "post",
        max_replies: int(flags["max-replies"], "max-replies"),
        reply_ranking: flags["by-recency"] ? "recency" : "likes",
        profile_posts: int(flags.posts, "posts"),
        profile_include_replies: Boolean(flags["with-replies"]),
        translate_to: flags.translate,
        source: flags.source,
      }, flags, out);
    }
    case "search": {
      const { pos, flags } = parseArgv(rest, { booleans: ["images", "videos", "json"], repeat: ["handle", "exclude"] });
      return run("x_search", {
        queries: pos,
        max_results: int(flags.max, "max"),
        from_date: flags.from,
        to_date: flags.to,
        allowed_x_handles: flags.handle,
        excluded_x_handles: flags.exclude,
        enable_image_understanding: Boolean(flags.images),
        enable_video_understanding: Boolean(flags.videos),
        verify: !flags["no-verify"],
      }, flags, out);
    }
    case "audit": {
      const { pos, flags } = parseArgv(rest, { booleans: ["json"] });
      if (pos.length !== 1) throw new InputError("audit takes one @handle or profile URL");
      return run("x_audit", { account: pos[0], posts: int(flags.posts, "posts") }, flags, out);
    }
    case "mcp": {
      const { serveStdio } = await import("./stdio.js");
      return serveStdio(loadEnv());
    }
    case "setup": {
      const key = process.stdin.isTTY
        ? await promptHidden("xAI API key (https://console.x.ai; empty to skip x_search): ")
        : await readStdin();
      if (!key) return out(`No key saved. x_read and x_audit work without one.`);
      if (!/^xai-[A-Za-z0-9_-]{10,}$/.test(key)) process.stderr.write("warning: xAI keys usually start with 'xai-'\n");
      const path = writeConfigValue("XAI_API_KEY", key);
      return out(`Saved XAI_API_KEY to ${path} (mode 600). Check it with: signal-first doctor`);
    }
    case "doctor": {
      const { doctor } = await import("./doctor.js");
      return doctor(loadEnv(), out, { configFile: configPath() });
    }
    case "deploy": {
      const { deploy } = await import("./deploy.js");
      return deploy(rest, loadEnv(), out);
    }
    case "tools": {
      const ctx = makeContext(loadEnv());
      return out(listTools(ctx).map((t) => `${t.name}: ${t.title}`).join("\n") + (searchProvider(ctx.env) ? "" : "\n(x_search: set XAI_API_KEY)"));
    }
    default:
      throw new InputError(`unknown command: ${cmd}. Run signal-first --help`);
  }
}

export async function cliEntry() {
  try {
    await main();
  } catch (err) {
    const known = err instanceof InputError || err instanceof ConfigError;
    process.stderr.write(`signal-first: ${known ? err.message : err.stack || err.message}\n`);
    process.exitCode = known ? 2 : 1;
  }
}
