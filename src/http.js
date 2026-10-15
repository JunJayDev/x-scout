// Streamable HTTP transport (stateless, JSON responses) for remote MCP clients such as
// claude.ai, ChatGPT and Claude Code. Used by the Cloudflare Worker; any runtime with the
// Fetch API can host it.

import { constantTimeEqual, makeContext } from "./util.js";
import { handleMessage, rpcError } from "./mcp.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * env.MCP_TOKEN protects the server. Clients authenticate with either
 *   POST /mcp/<token>                          (secret URL, for connector UIs without headers)
 *   POST /mcp + Authorization: Bearer <token>
 */
export async function handleHttp(request, env, fetchImpl) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    return new Response("signal-first MCP server. POST JSON-RPC to /mcp.\n", { headers: { "content-type": "text/plain" } });
  }
  const match = path.match(/^\/mcp(?:\/([A-Za-z0-9_-]+))?$/);
  if (!match) return new Response("Not found\n", { status: 404 });
  if (!env.MCP_TOKEN) return json({ error: "server not configured: set the MCP_TOKEN secret" }, 503);

  const pathToken = match[1];
  if (pathToken !== undefined) {
    // A wrong secret URL looks like a missing route.
    if (!constantTimeEqual(pathToken, env.MCP_TOKEN)) return new Response("Not found\n", { status: 404 });
  } else {
    const bearer = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (!bearer || !constantTimeEqual(bearer[1].trim(), env.MCP_TOKEN)) return json({ error: "unauthorized" }, 401);
  }
  // Stateless: no server-initiated SSE stream and no sessions to delete.
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }
  const batch = Array.isArray(body);
  const messages = batch ? body : [body];
  if (messages.length === 0) return json(rpcError(null, -32600, "Invalid Request"), 400);

  const ctx = makeContext(env, fetchImpl);
  const replies = (await Promise.all(messages.map((m) => handleMessage(m, ctx)))).filter(Boolean);
  if (replies.length === 0) return new Response(null, { status: 202 });
  return json(batch ? replies : replies[0], 200);
}
