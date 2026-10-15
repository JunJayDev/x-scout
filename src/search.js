// x_search: find posts by meaning, then confirm every hit against X.
//
// X's own search matches words, not meaning, and needs a login. Grok's x_search tool (xAI API)
// searches X semantically. Search models can misquote or invent, so a hit is only a lead:
// each post is re-read from X (read.js) and the verbatim text, author, time and metrics come
// from there. Hits that cannot be confirmed stay in the result, marked unverified.
//
// Providers:
//   xai    XAI_API_KEY (default)  POST https://api.x.ai/v1/responses with the x_search tool
//   relay  X_SEARCH_ENDPOINT + X_SEARCH_API_KEY: a service that takes {query, max_results,
//          from_date, to_date, allowed_x_handles, ...} and returns {provider, results:[{url,
//          author, published_at, snippet}]} (documented in references/relay-protocol.md)

import { InputError, cleanHandles, compact, exactDate, mapLimit, prune, sleep, str } from "./util.js";
import { readPost, statusId } from "./read.js";
import { renderPost } from "./render.js";

const XAI_BASE = "https://api.x.ai/v1";
export const DEFAULT_XAI_MODEL = "grok-4.7";
const DEFAULT_MAX_TURNS = 2; // tool rounds per query; each round can fetch dozens of posts ($5 per 1k)
const RETRY = new Set([429, 500, 502, 503, 504]);
const VERIFY_LIMIT = 20;

export function searchProvider(env = {}) {
  if (env.XAI_API_KEY) return "xai";
  if (env.X_SEARCH_ENDPOINT && env.X_SEARCH_API_KEY) return "relay";
  return null;
}

export function parseSearchArgs(raw) {
  if (!raw || typeof raw !== "object") throw new InputError("arguments must be an object");
  const queries = (Array.isArray(raw.queries) ? raw.queries : []).map((q) => String(q).trim()).filter(Boolean);
  if (queries.length < 2) throw new InputError("give at least two materially different queries");
  if (queries.length > 5) throw new InputError("give at most five queries");
  if (new Set(queries.map((q) => q.toLowerCase())).size !== queries.length) throw new InputError("queries must be different");
  const maxResults = raw.max_results === undefined ? 10 : Number(raw.max_results);
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 20) throw new InputError("max_results must be an integer between 1 and 20");
  const fromDate = exactDate(raw.from_date, "from_date");
  const toDate = exactDate(raw.to_date, "to_date");
  if (fromDate && toDate && fromDate > toDate) throw new InputError("from_date must not be after to_date");
  const allowed = cleanHandles(raw.allowed_x_handles);
  const excluded = cleanHandles(raw.excluded_x_handles);
  if (allowed.length && excluded.length) throw new InputError("allowed_x_handles and excluded_x_handles cannot be combined");
  if (allowed.length > 20 || excluded.length > 20) throw new InputError("at most 20 handles");
  return {
    queries,
    maxResults,
    fromDate,
    toDate,
    allowed,
    excluded,
    image: raw.enable_image_understanding === true,
    video: raw.enable_video_understanding === true,
    verify: raw.verify !== false,
  };
}

async function postJson(ctx, url, body, headers, timeoutMs) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await ctx.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "user-agent": ctx.userAgent, ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
        // A redirect would turn the POST into a GET; report it instead.
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        throw new Error(`HTTP ${res.status}: redirected to ${res.headers.get("location") || "(no location)"}; use the final URL`);
      }
      const text = await res.text();
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
        if (!RETRY.has(res.status) || attempt === 2) throw lastError;
      } else {
        try {
          return JSON.parse(text);
        } catch {
          throw new Error(`not JSON: ${text.slice(0, 200)}`);
        }
      }
    } catch (err) {
      const retryable = err.name === "AbortError" || err.name === "TypeError";
      lastError = err.name === "AbortError" ? new Error(`timed out after ${timeoutMs / 1000}s`) : err;
      if (!retryable || attempt === 2) throw lastError;
    } finally {
      clearTimeout(timer);
    }
    await sleep((ctx.retryDelayMs ?? 1000) * 2 ** attempt);
  }
  throw lastError || new Error("request failed");
}

// --- xAI -----------------------------------------------------------------------------------

function xaiPrompt(query, args) {
  return [
    `Search X for posts that answer: ${query}`,
    `Return up to ${args.maxResults} posts you actually found with the x_search tool, most useful first.`,
    "Prefer original, first-hand, specific posts over reposts, aggregators and engagement bait.",
    "Answer with only a JSON array, no prose. Each item:",
    '{"url": "https://x.com/<handle>/status/<id>", "author": "@handle", "date": "YYYY-MM-DD", "text": "the post text, verbatim, up to 280 characters"}',
    "Never invent a URL. If nothing fits, answer [].",
  ].join("\n");
}

/** Our to_date is inclusive; xAI's is exclusive. */
export function dayAfter(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function xaiTool(args) {
  return prune({
    type: "x_search",
    allowed_x_handles: args.allowed.length ? args.allowed : undefined,
    excluded_x_handles: args.excluded.length ? args.excluded : undefined,
    from_date: args.fromDate || undefined,
    to_date: args.toDate ? dayAfter(args.toDate) : undefined,
    enable_image_understanding: args.image || undefined,
    enable_video_understanding: args.video || undefined,
  });
}

/** Pull post URLs out of an xAI Responses API reply: citations, annotations, and the model's JSON. */
export function parseXaiResponse(data) {
  const cited = new Set();
  const addUrl = (u) => {
    const url = typeof u === "string" ? u : u && u.url;
    if (url && statusId(url)) cited.add(url);
  };
  for (const c of data.citations || []) addUrl(c);
  let text = "";
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const c of item.content || []) {
      if (c.type === "output_text" || c.type === "text") {
        text += c.text || "";
        for (const a of c.annotations || []) addUrl(a);
      }
    }
  }
  if (!text && typeof data.output_text === "string") text = data.output_text;
  let claimed = [];
  const m = text.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) claimed = arr.filter((x) => x && typeof x === "object" && statusId(x.url));
    } catch {
      claimed = [];
    }
  }
  const results = claimed.map((x) => ({
    url: str(x.url),
    author: str(x.author),
    published_at: str(x.date),
    snippet: str(x.text),
    cited: [...cited].some((u) => statusId(u) === statusId(x.url)),
  }));
  // Cited by the tool but missing from the JSON: keep them as leads too.
  for (const u of cited) {
    if (!results.some((r) => statusId(r.url) === statusId(u))) results.push({ url: u, cited: true });
  }
  const u = data.usage || {};
  const tools = u.server_side_tool_usage_details || {};
  const usage = prune({
    posts_fetched: tools.x_posts_fetched,
    users_fetched: tools.x_users_fetched,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
  });
  return { results, usage };
}

async function searchXai(ctx, args, query) {
  const base = (ctx.env.XAI_API_BASE || XAI_BASE).replace(/\/+$/, "");
  const data = await postJson(
    ctx,
    `${base}/responses`,
    {
      model: ctx.env.XAI_MODEL || DEFAULT_XAI_MODEL,
      input: [{ role: "user", content: xaiPrompt(query, args) }],
      tools: [xaiTool(args)],
      include: ["no_inline_citations"],
      max_turns: Number(ctx.env.XAI_MAX_TURNS) || DEFAULT_MAX_TURNS,
      store: false,
    },
    { authorization: `Bearer ${ctx.env.XAI_API_KEY}` },
    (Number(ctx.env.SEARCH_TIMEOUT_S) || 120) * 1000
  );
  return parseXaiResponse(data);
}

// --- relay -----------------------------------------------------------------------------------

async function searchRelay(ctx, args, query) {
  const payload = prune({
    query,
    max_results: args.maxResults,
    from_date: args.fromDate || undefined,
    to_date: args.toDate || undefined,
    allowed_x_handles: args.allowed.length ? args.allowed : undefined,
    excluded_x_handles: args.excluded.length ? args.excluded : undefined,
    enable_image_understanding: args.image || undefined,
    enable_video_understanding: args.video || undefined,
  });
  const data = await postJson(
    ctx,
    ctx.env.X_SEARCH_ENDPOINT,
    payload,
    { authorization: `Bearer ${ctx.env.X_SEARCH_API_KEY}` },
    (Number(ctx.env.SEARCH_TIMEOUT_S) || 170) * 1000
  );
  const results = (Array.isArray(data.results) ? data.results : [])
    .filter((r) => r && statusId(r.url))
    .map((r) => ({ url: str(r.url), author: str(r.author), published_at: str(r.published_at), snippet: str(r.snippet), cited: true }));
  return { results, provider_detail: data.provider };
}

// --- run -------------------------------------------------------------------------------------

export async function runSearch(raw, ctx) {
  const args = parseSearchArgs(raw);
  const provider = searchProvider(ctx.env);
  const search = provider === "xai" ? searchXai : searchRelay;

  // Queries run in parallel. One failed query fails the call: a partial answer would look complete.
  const settled = await Promise.allSettled(args.queries.map((q) => search(ctx, args, q)));
  const failures = settled.map((s, i) => (s.status === "rejected" ? `query ${JSON.stringify(args.queries[i])}: ${s.reason.message}` : null)).filter(Boolean);
  if (failures.length) throw new Error(failures.join("; "));

  const merged = new Map();
  const rounds = [];
  settled.forEach((s, i) => {
    const q = args.queries[i];
    rounds.push(prune({ query: q, hits: s.value.results.length, usage: s.value.usage }));
    for (const r of s.value.results) {
      const id = statusId(r.url);
      let e = merged.get(id);
      if (!e) merged.set(id, (e = { id, url: r.url, matched_queries: [], lead: {} }));
      if (!e.matched_queries.includes(q)) e.matched_queries.push(q);
      e.cited = e.cited || r.cited;
      for (const k of ["author", "published_at", "snippet"]) if (!e.lead[k] && r[k]) e.lead[k] = r[k];
    }
  });

  let hits = [...merged.values()];
  // Posts that more queries agree on first, then the order the search returned them.
  hits.sort((a, b) => b.matched_queries.length - a.matched_queries.length);

  let verifiedCount = 0;
  if (args.verify) {
    const toCheck = hits.slice(0, VERIFY_LIMIT);
    await mapLimit(toCheck, 5, async (h) => {
      try {
        const r = await readPost(ctx, { kind: "post", id: h.id, input: h.url }, {});
        if (r.post && !r.post.unavailable) {
          h.post = r.post;
          h.source = r.source;
          verifiedCount++;
        } else {
          h.unverified = `X says the post is unavailable (${(r.post && r.post.unavailable) || "unknown"})`;
        }
      } catch (err) {
        h.unverified = `could not read it from X: ${err.message}`;
      }
    });
    for (const h of hits.slice(VERIFY_LIMIT)) h.unverified = `not checked (only the first ${VERIFY_LIMIT} are verified)`;
  }

  const allowed = new Set(args.allowed.map((h) => `@${h.toLowerCase()}`));
  const unexpected = [
    ...new Set(
      hits
        .map((h) => (h.post && h.post.author) || h.lead.author)
        .filter((a) => allowed.size && a && !allowed.has(a.toLowerCase()))
    ),
  ];

  return prune({
    kind: "search",
    provider,
    rounds,
    filters: prune({
      allowed_x_handles: args.allowed,
      excluded_x_handles: args.excluded,
      from_date: args.fromDate,
      to_date: args.toDate,
    }),
    verified: args.verify ? verifiedCount : undefined,
    unverified: args.verify ? hits.length - verifiedCount : undefined,
    unexpected_authors: unexpected,
    results: hits.map((h) =>
      prune({
        url: (h.post && h.post.url) || h.url,
        matched_queries: h.matched_queries,
        post: h.post,
        source: h.source,
        unverified: h.unverified,
        // Only the search model's words, kept when X could not confirm them.
        lead: h.post ? undefined : prune({ ...h.lead }),
      })
    ),
  });
}

export function renderSearch(r) {
  const head = [
    `${r.results.length} posts from ${r.rounds.length} queries (${r.provider})`,
    r.verified !== undefined ? `${r.verified} confirmed on X, ${r.unverified} not` : "not verified",
  ];
  const lines = [head.join(" · ")];
  for (const q of r.rounds) {
    const u = q.usage || {};
    lines.push(`- "${q.query}": ${q.hits} hits${u.posts_fetched !== undefined ? ` · ${u.posts_fetched} posts fetched by the search model` : ""}`);
  }
  if (r.unexpected_authors && r.unexpected_authors.length) lines.push(`unexpected authors (outside allowed_x_handles): ${r.unexpected_authors.join(", ")}`);
  r.results.forEach((h, i) => {
    lines.push("", `———`);
    const label = `[${i + 1}] `;
    if (h.post) {
      lines.push(renderPost(h.post, { label }));
    } else {
      const l = h.lead || {};
      lines.push(`${label}UNVERIFIED ${h.url}`, `why: ${h.unverified || "not checked"}`);
      if (l.author || l.published_at) lines.push(`search model says: ${[l.author, l.published_at].filter(Boolean).join(" · ")}`);
      if (l.snippet) lines.push(`search model's text (may be wrong): ${l.snippet}`);
    }
    lines.push(`matched: ${h.matched_queries.map((q) => `"${q}"`).join(", ")}`);
  });
  if (!r.results.length) lines.push("", "No posts. Try other wording, the other language, concrete names, or a wider date range.");
  return lines.join("\n");
}

export { compact };
