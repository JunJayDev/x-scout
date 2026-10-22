// x_search: Grok finds links; public readers return original post content.
// verify=false keeps the legacy model-snippet path without separate post reads.
//
// XAI_API_KEY turns it on: POST <XAI_API_BASE>/responses with the x_search tool. XAI_API_BASE
// defaults to https://api.x.ai/v1; set it for any endpoint that speaks xAI's Responses API.

import { ConfigError, InputError, SearchError, cleanHandles, compact, exactDate, mapLimit, prune, sleep, str } from "./util.js";
import { parseTarget, readPost, statusId } from "./read.js";
import { renderPost } from "./render.js";

const XAI_BASE = "https://api.x.ai/v1";
export const DEFAULT_XAI_MODEL = "grok-4.7";
const DEFAULT_MAX_TURNS = 2; // tool rounds per query; each round can fetch dozens of posts ($5 per 1k)
const RETRY = new Set([429, 500, 502, 503, 504]);
const VERIFY_LIMIT = 20;
const READ_BUDGET_MS = 8000;

export function searchProvider(env = {}) {
  return env.XAI_API_KEY ? "xai" : null;
}

export function parseSearchArgs(raw) {
  if (!raw || typeof raw !== "object") throw new InputError("arguments must be an object");
  const queries = (Array.isArray(raw.queries) ? raw.queries : []).map((q) => String(q).trim()).filter(Boolean);
  if (queries.length < 1) throw new InputError("give at least one query");
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
        lastError = Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`), { transient: RETRY.has(res.status) });
        if (!RETRY.has(res.status) || attempt === 2) throw lastError;
      } else {
        try {
          return JSON.parse(text);
        } catch {
          throw new Error(`not JSON: ${text.slice(0, 200)}`);
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        // The whole time allowance is spent; trying again twice would triple the wait.
        throw Object.assign(new Error(`timed out after ${timeoutMs / 1000}s`), { transient: true });
      }
      const retryable = err.name === "TypeError";
      lastError = retryable ? Object.assign(err, { transient: true }) : err;
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
    "Follow the query's topic and intent; include reactions or discussion when requested.",
    "Answer with only a JSON array, no prose. Each item:",
    args.verify
      ? '{"url": "https://x.com/<handle>/status/<id>"}. Return links only; do not copy, summarize or analyze post text.'
      : '{"url": "https://x.com/<handle>/status/<id>", "author": "@handle", "date": "YYYY-MM-DD", "text": "the post text, verbatim, up to 280 characters"}',
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

/**
 * The model's selected results are authoritative, including an empty array.
 * Fall back to citations only when there is no usable JSON array.
 */
export function parseXaiResponse(data, maxResults = 20) {
  const cited = new Set();
  const isPostUrl = (url) => statusId(url) && parseTarget(url).kind === "post";
  const addUrl = (u) => {
    const url = typeof u === "string" ? u : u && u.url;
    if (url && isPostUrl(url)) cited.add(url);
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
  let parsed = false;
  const m = text.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) {
        parsed = true;
        claimed = arr.filter((x) => x && typeof x === "object" && isPostUrl(x.url));
      }
    } catch {
      claimed = [];
    }
  }
  const results = [];
  const has = (url) => results.some((r) => statusId(r.url) === statusId(url));
  for (const x of claimed) {
    if (results.length >= maxResults) break;
    if (has(x.url)) continue;
    results.push({
      url: str(x.url),
      author: str(x.author),
      published_at: str(x.date),
      snippet: str(x.text),
      cited: [...cited].some((u) => statusId(u) === statusId(x.url)),
    });
  }
  for (const u of parsed ? [] : cited) {
    if (results.length >= maxResults) break;
    if (!has(u)) results.push({ url: u, cited: true });
  }
  const u = data.usage || {};
  const tools = u.server_side_tool_usage_details || {};
  const usage = prune({
    posts_fetched: tools.x_posts_fetched,
    users_fetched: tools.x_users_fetched,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    reasoning_tokens: u.output_tokens_details?.reasoning_tokens,
  });
  return { results, usage };
}

async function searchXai(ctx, args, query) {
  const base = (ctx.env.XAI_API_BASE || XAI_BASE).replace(/\/+$/, "");
  const model = ctx.env.XAI_MODEL || DEFAULT_XAI_MODEL;
  const data = await postJson(
    ctx,
    `${base}/responses`,
    {
      model,
      // These models support low effort; their upstream default is high.
      // Leave other model overrides untouched rather than assume parameter support.
      reasoning: ["grok-4.5", "grok-4.6", "grok-4.7"].includes(model) ? { effort: "low" } : undefined,
      input: [{ role: "user", content: xaiPrompt(query, args) }],
      tools: [xaiTool(args)],
      include: ["no_inline_citations"],
      max_turns: Number(ctx.env.XAI_MAX_TURNS) || DEFAULT_MAX_TURNS,
      store: false,
    },
    { authorization: `Bearer ${ctx.env.XAI_API_KEY}` },
    (Number(ctx.env.SEARCH_TIMEOUT_S) || 120) * 1000
  );
  return parseXaiResponse(data, args.maxResults);
}

// --- run -------------------------------------------------------------------------------------

// Apply requested filters to available metadata; full post metadata wins over snippets.
function matchesFilters(hit, args) {
  const author = (hit.post?.author || hit.lead.author || "").replace(/^@/, "").toLowerCase();
  if (author && args.allowed.length && !args.allowed.some((h) => h.toLowerCase() === author)) return false;
  if (author && args.excluded.some((h) => h.toLowerCase() === author)) return false;
  const time = Date.parse(hit.post?.created_at || hit.lead.published_at);
  if (Number.isFinite(time)) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (args.fromDate && date < args.fromDate) return false;
    if (args.toDate && date > args.toDate) return false;
  }
  return true;
}

export async function runSearch(raw, ctx) {
  const args = parseSearchArgs(raw);
  const provider = searchProvider(ctx.env);
  if (!provider) throw new ConfigError("x_search needs XAI_API_KEY");

  // Queries run in parallel. A query that fails for a passing reason (timeout, rate limit, network) is reported
  // and the others still answer; a setup problem (bad key, wrong URL) or every query failing fails the call.
  const settled = await Promise.allSettled(args.queries.map((q) => searchXai(ctx, args, q)));
  const failed = settled
    .map((s, i) => (s.status === "rejected" ? { query: args.queries[i], error: s.reason.message, transient: Boolean(s.reason.transient) } : null))
    .filter(Boolean);
  if (failed.some((f) => !f.transient) || failed.length === args.queries.length) {
    throw new SearchError(failed.map((f) => `query ${JSON.stringify(f.query)}: ${f.error}`).join("; "));
  }

  const merged = new Map();
  const rounds = [];
  settled.forEach((s, i) => {
    if (s.status === "rejected") return;
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

  if (args.verify) {
    const readCtx = { ...ctx, deadline: Math.min(ctx.deadline ?? Infinity, Date.now() + READ_BUDGET_MS) };
    const toCheck = hits.slice(0, VERIFY_LIMIT);
    await mapLimit(toCheck, 5, async (h) => {
      h.checked = true;
      try {
        const r = await readPost(readCtx, { kind: "post", id: h.id, input: h.url }, {});
        if (r.post && !r.post.unavailable) {
          h.post = r.post;
          h.source = r.source;
        } else {
          h.unverified = `X says the post is unavailable (${(r.post && r.post.unavailable) || "unknown"})`;
        }
      } catch (err) {
        h.unverified = `could not read it from X: ${err.message}`;
      }
    });
    for (const h of hits.slice(VERIFY_LIMIT)) h.unverified = `not loaded (limit ${VERIFY_LIMIT})`;
  }

  const allowed = new Set(args.allowed.map((h) => `@${h.toLowerCase()}`));
  const unexpected = [
    ...new Set(
      hits
        .map((h) => (h.post && h.post.author) || h.lead.author)
        .filter((a) => allowed.size && a && !allowed.has(a.toLowerCase()))
    ),
  ];

  const filtered = hits.filter((h) => matchesFilters(h, args));
  const filteredOut = hits.length - filtered.length;
  hits = filtered;

  return {
    ...prune({
      kind: "search",
      provider,
      rounds,
      failed: failed.length ? failed.map(({ query, error }) => ({ query, error })) : undefined,
      filters: prune({
        allowed_x_handles: args.allowed,
        excluded_x_handles: args.excluded,
        from_date: args.fromDate,
        to_date: args.toDate,
      }),
      verified: args.verify ? hits.filter((h) => h.post).length : undefined,
      unverified: args.verify ? hits.filter((h) => h.checked && !h.post).length : undefined,
      unchecked: args.verify ? hits.filter((h) => !h.checked).length : undefined,
      filtered_out: filteredOut || undefined,
      unexpected_authors: unexpected,
    }),
    results: hits.map((h) =>
      prune({
        url: (h.post && h.post.url) || h.url,
        matched_queries: h.matched_queries,
        post: h.post,
        source: h.source,
        unverified: h.unverified,
        // Keep snippets until full post content is loaded.
        lead: h.post ? undefined : prune({ ...h.lead }),
      })
    ),
  };
}

export function renderSearch(r) {
  const asked = r.rounds.length + (r.failed ? r.failed.length : 0);
  const head = [
    `${r.results.length} posts from ${r.rounds.length}${r.failed ? ` of ${asked}` : ""} queries (${r.provider})`,
    r.verified === undefined
      ? "search snippets"
      : [`${r.verified} full posts loaded`, r.unverified ? `${r.unverified} could not be loaded` : "", r.unchecked ? `${r.unchecked} not loaded (limit ${VERIFY_LIMIT})` : ""].filter(Boolean).join(", "),
  ];
  const lines = [head.join(" · ")];
  for (const q of r.rounds) {
    const u = q.usage || {};
    lines.push(`- "${q.query}": ${q.hits} hits${u.posts_fetched !== undefined ? ` · ${u.posts_fetched} posts fetched by the search model` : ""}`);
  }
  for (const f of r.failed || []) lines.push(`FAILED, not searched: "${f.query}": ${f.error}. This list is incomplete; run that query again.`);
  if (r.filtered_out) lines.push(`omitted ${r.filtered_out} posts outside the requested dates or handles`);
  r.results.forEach((h, i) => {
    lines.push("", `———`);
    const label = `[${i + 1}] `;
    if (h.post) {
      lines.push(renderPost(h.post, { label }));
    } else {
      const l = h.lead || {};
      lines.push(`${label}${[l.author, l.published_at].filter(Boolean).join(" · ")}`, h.url);
      if (h.unverified) lines.push(`full post unavailable: ${h.unverified}`);
      if (l.snippet) lines.push(l.snippet);
    }
  });
  if (!r.results.length) lines.push("", "No posts. Try other wording, the other language, concrete names, or a wider date range.");
  return lines.join("\n");
}

export { compact };
