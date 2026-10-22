// Small helpers shared by every runtime (Node, Cloudflare Workers, Bun, Deno).
// Nothing here may import a Node built-in.

export const VERSION = "0.1.0";
export const HOMEPAGE = "https://github.com/JunJayDev/x-scout";

/** A caller mistake (bad arguments). Reported as is, never retried. */
export class InputError extends Error {}

/** Missing key or endpoint. The message says how to fix it. */
export class ConfigError extends Error {}

// The search provider failed (timeout, rate limit, network). The message says what to do; no stack is needed.
export class SearchError extends Error {}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runtime context: the environment (keys, overrides) and the fetch to use.
 * Tests pass a fake fetch; Workers pass their env bindings.
 */
export function makeContext(env = {}, fetchImpl) {
  if (!fetchImpl && typeof globalThis.fetch !== "function") throw new Error("no fetch available: use Node 18 or newer");
  // Workers reject fetch called as a method of another object ("Illegal invocation").
  const f = fetchImpl || ((input, init) => globalThis.fetch(input, init));
  return { env: env || {}, fetch: f, userAgent: `x-scout/${VERSION} (+${HOMEPAGE})` };
}

/** Drop empty values so outputs carry only what is known. */
export function prune(obj) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete obj[k];
    else if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) delete obj[k];
  }
  return obj;
}

export function str(v) {
  return v === undefined || v === null ? "" : String(v).trim();
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function clampInt(value, dflt, min, max, name) {
  if (value === undefined || value === null || value === "") return dflt;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new InputError(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function exactDate(value, name) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).trim();
  if (!DATE_RE.test(s)) throw new InputError(`${name}: use YYYY-MM-DD`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new InputError(`${name}: not a real date`);
  }
  return s;
}

export function cleanHandles(value) {
  if (value === undefined || value === null) return [];
  const list = (Array.isArray(value) ? value : [value]).flatMap((h) => String(h).split(/[\s,]+/));
  return list.map((h) => h.trim().replace(/^@+/, "")).filter(Boolean);
}

export function withQuery(base, path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ).toString();
  return `${String(base).replace(/\/+$/, "")}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * GET a JSON document. Retries once on 429, 5xx and network errors.
 * Never throws: returns { status, data, text } (status 0 = network error or timeout).
 */
export async function getJson(ctx, url, { headers = {}, timeoutMs = 25000 } = {}) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = (ctx.deadline ?? Infinity) - Date.now();
    if (remaining <= 0) return { status: 0, data: null, text: "read time budget exhausted" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
    try {
      const res = await ctx.fetch(url, {
        headers: { accept: "application/json", "user-agent": ctx.userAgent, ...headers },
        signal: controller.signal,
      });
      if (res.status === 204) return { status: 204, data: null, text: "" };
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      const result = { status: res.status, data, text };
      if ((res.status === 429 || res.status >= 500) && attempt === 0) last = result;
      else return result;
    } catch (err) {
      last = { status: 0, data: null, text: err.name === "AbortError" ? "timed out" : err.message };
      if (attempt === 1) return last;
    } finally {
      clearTimeout(timer);
    }
    if (Date.now() >= (ctx.deadline ?? Infinity)) return { status: 0, data: null, text: "read time budget exhausted" };
    await sleep(Math.min(ctx.retryDelayMs ?? 800, (ctx.deadline ?? Infinity) - Date.now()));
  }
  return last;
}

export function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/** 1234 -> "1.2k", 113400 -> "113k", 2500000 -> "2.5M". */
export function compact(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "?";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (abs < 1e6) return `${Math.round(n / 1000)}k`;
  if (abs < 1e7) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(n / 1e6)}M`;
}

export function median(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function quantile(values, q) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.floor(q * v.length))];
}
