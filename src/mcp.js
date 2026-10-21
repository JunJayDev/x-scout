// MCP over JSON-RPC, independent of transport. stdio.js and http.js feed messages in here.

import { InputError, ConfigError, VERSION } from "./util.js";
import { runRead } from "./read.js";
import { runAudit } from "./signals.js";
import { runSearch, searchProvider } from "./search.js";
import { renderAudit, renderRead } from "./render.js";
import { renderSearch } from "./search.js";

export const SERVER_INFO = { name: "x-scout", title: "x-scout (X for agents)", version: VERSION };
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const FORMAT = {
  type: "string",
  enum: ["text", "json"],
  default: "text",
  description: "text (compact, default) or json (full structure).",
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export const X_READ_TOOL = {
  name: "x_read",
  title: "Read X posts and profiles",
  description:
    "Read X/Twitter links without login. Web fetch cannot open x.com or twitter.com, so use this " +
    "for every X link the user gives and for the full text, thread or replies of a post you found.\n" +
    "Targets: post URLs (x.com, twitter.com, fxtwitter, vxtwitter...), numeric post ids, profile URLs or @handles.\n" +
    "- Posts: verbatim full text, author and follower count, UTC time, views/likes/replies/reposts/quotes/bookmarks, " +
    "quoted post, media, link card, poll, community note, the full body of X Articles, and signals " +
    "(save = bookmarks/likes, talk = replies/likes, spread = (reposts+quotes)/likes, eng = engagements/views).\n" +
    "- mode=thread unrolls the author's own thread; mode=replies adds top replies (paged).\n" +
    "- Profiles: bio, counts and recent posts.\n" +
    "Quote text as returned. Deleted, private or suspended posts come back as unavailable.",
  inputSchema: {
    type: "object",
    properties: {
      targets: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: 10,
        description: "X post URLs, numeric post ids, profile URLs or @handles (1-10).",
      },
      mode: { type: "string", enum: ["post", "thread", "replies"], default: "post", description: "For posts: the post, the author's thread, or thread + replies." },
      max_replies: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Replies per post in mode=replies." },
      reply_ranking: { type: "string", enum: ["likes", "recency"], default: "likes" },
      profile_posts: { type: "integer", minimum: 0, maximum: 100, default: 20, description: "Recent posts to include for profile targets." },
      profile_include_replies: { type: "boolean", default: false, description: "Include the account's replies in profile posts." },
      translate_to: { type: "string", description: "Optional language code (zh, ja, en...) to attach a translation." },
      source: { type: "string", enum: ["auto", "fxtwitter", "vxtwitter", "syndication"], default: "auto", description: "Leave as auto. Force one only for debugging." },
      format: FORMAT,
    },
    required: ["targets"],
    additionalProperties: false,
  },
  annotations: { title: "Read X posts and profiles", ...READ_ONLY },
};

export const X_AUDIT_TOOL = {
  name: "x_audit",
  title: "Audit an X account",
  description:
    "Numbers for deciding whether an X account is worth reading, following or citing: reads the profile and " +
    "its last 10-100 posts and replies, then reports cadence, originals vs replies vs reposts, median and p90 views " +
    "of originals, likes per 1k followers, save and talk ratios, share of posts that link out, the best post " +
    "against the median (breakout), the top posts by views and by saves, and hints. Hints are prompts to check, " +
    "not verdicts: read the top posts before you judge. Reach is not quality; judge them separately.",
  inputSchema: {
    type: "object",
    properties: {
      account: { type: "string", minLength: 1, description: "@handle or profile URL." },
      posts: { type: "integer", minimum: 10, maximum: 100, default: 60, description: "How many recent posts and replies to read." },
      format: FORMAT,
    },
    required: ["account"],
    additionalProperties: false,
  },
  annotations: { title: "Audit an X account", ...READ_ONLY },
};

export const X_SEARCH_TOOL = {
  name: "x_search",
  title: "Search X",
  description:
    "Find X posts by meaning, through Grok's x_search (xAI). Then every hit is checked against X itself: " +
    "verbatim text, author, time and engagement come from the post, not from the search model, and hits that " +
    "cannot be confirmed are marked unverified.\n" +
    "- Pass 2-5 materially different queries: other wording, the other language, the concrete names a good " +
    "post would use (products, people, numbers) rather than the problem you have.\n" +
    "- Use handles and dates when known. allowed_x_handles limits the search to those accounts.\n" +
    "- Cite post URLs, authors and dates. Report unverified hits and unexpected authors instead of dropping them.",
  inputSchema: {
    type: "object",
    properties: {
      queries: { type: "array", items: { type: "string", minLength: 1 }, minItems: 2, maxItems: 5, description: "2-5 materially different queries." },
      max_results: { type: "integer", minimum: 1, maximum: 20, default: 10, description: "Posts to ask for per query (1-20)." },
      from_date: { type: "string", description: "Start date, YYYY-MM-DD." },
      to_date: { type: "string", description: "End date, YYYY-MM-DD (inclusive)." },
      allowed_x_handles: { type: "array", items: { type: "string" }, maxItems: 20, description: "Only posts from these accounts (max 20). Not with excluded_x_handles." },
      excluded_x_handles: { type: "array", items: { type: "string" }, maxItems: 20, description: "Skip posts from these accounts (max 20)." },
      enable_image_understanding: { type: "boolean", description: "Let the search model look at images in posts." },
      enable_video_understanding: { type: "boolean", description: "Let the search model look at videos in posts." },
      verify: { type: "boolean", default: true, description: "Check each hit against X (recommended)." },
      format: FORMAT,
    },
    required: ["queries"],
    additionalProperties: false,
  },
  annotations: { title: "Search X", ...READ_ONLY },
};

export function instructions(ctx) {
  const search = searchProvider(ctx.env)
    ? "x_search finds posts by meaning (2-5 different queries) and checks every hit against X."
    : "x_search is off: set XAI_API_KEY (an xAI API key) where this server runs to turn it on.";
  return (
    "x-scout lets you read, search and judge X (Twitter). Web fetch cannot open x.com links: use x_read " +
    "for every X post or profile link. " + search + " Before you trust, cite or recommend an account, run " +
    "x_audit and read its top posts. Judge information value (original, first-hand, specific, checkable, " +
    "useful) and reach (views, spread) separately: a post can travel far and say nothing."
  );
}

export function listTools(ctx) {
  return searchProvider(ctx.env) ? [X_READ_TOOL, X_SEARCH_TOOL, X_AUDIT_TOOL] : [X_READ_TOOL, X_AUDIT_TOOL];
}

const RUNNERS = {
  x_read: { run: runRead, render: renderRead },
  x_audit: { run: runAudit, render: renderAudit },
  x_search: { run: runSearch, render: renderSearch },
};

/** Run a tool and return { text, data } or throw. Shared by MCP and the CLI. */
export async function callTool(name, args, ctx) {
  const r = RUNNERS[name];
  if (!r) throw new InputError(`unknown tool: ${name}`);
  if (name === "x_search" && !searchProvider(ctx.env)) {
    throw new ConfigError("x_search needs an xAI API key: set XAI_API_KEY (https://console.x.ai), then restart the server");
  }
  const data = await r.run(args || {}, ctx);
  const format = args && args.format === "json" ? "json" : "text";
  return { data, text: format === "json" ? JSON.stringify(data) : r.render(data) };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Handle one JSON-RPC message. Returns the reply, or null for notifications and responses. */
export async function handleMessage(msg, ctx) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
    return rpcError(msg && msg.id !== undefined ? msg.id : null, -32600, "Invalid Request");
  }
  if (typeof msg.method !== "string") return null; // a response to us; nothing to say
  if (!("id" in msg)) return null; // notification
  const { id } = msg;
  const params = msg.params || {};
  switch (msg.method) {
    case "initialize": {
      const requested = params.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: instructions(ctx),
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: listTools(ctx) });
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "resources/templates/list":
      return rpcResult(id, { resourceTemplates: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    case "tools/call": {
      if (!RUNNERS[params.name]) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const { text } = await callTool(params.name, params.arguments, ctx);
        return rpcResult(id, { content: [{ type: "text", text }], isError: false });
      } catch (err) {
        return rpcResult(id, { content: [{ type: "text", text: `${params.name} failed: ${err.message}` }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export { rpcError };
