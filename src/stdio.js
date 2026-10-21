// stdio transport: newline-delimited JSON-RPC on stdin/stdout, for local MCP clients
// (Claude Code, Codex, Cursor, Claude Desktop...). Logs go to stderr only.

import { createInterface } from "node:readline";
import { makeContext } from "./util.js";
import { handleMessage, rpcError } from "./mcp.js";

export function serveStdio(env = process.env, { input = process.stdin, output = process.stdout } = {}) {
  const ctx = makeContext(env);
  const rl = createInterface({ input, crlfDelay: Infinity });
  const write = (msg) => output.write(JSON.stringify(msg) + "\n");
  const pending = new Set();
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write(rpcError(null, -32700, "Parse error"));
      return;
    }
    const messages = Array.isArray(msg) ? msg : [msg];
    const job = Promise.all(messages.map((m) => handleMessage(m, ctx)))
      .then((replies) => {
        const out = replies.filter(Boolean);
        if (out.length) write(Array.isArray(msg) ? out : out[0]);
      })
      .catch((err) => process.stderr.write(`x-scout: ${err.stack || err}\n`))
      .finally(() => pending.delete(job));
    pending.add(job);
  });
  return new Promise((resolve) => rl.on("close", () => Promise.all(pending).then(resolve)));
}
