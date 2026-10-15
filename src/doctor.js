// `signal-first doctor`: is everything this machine needs in place? Costs nothing:
// reading uses free public sources, and the xAI check asks for key metadata, not a search.

import { makeContext } from "./util.js";
import { readPost, readProfile } from "./read.js";
import { searchProvider } from "./search.js";

async function check(label, fn, out) {
  const t = Date.now();
  try {
    const detail = await fn();
    out(`ok    ${label}${detail ? `: ${detail}` : ""} (${Date.now() - t} ms)`);
    return true;
  } catch (err) {
    out(`FAIL  ${label}: ${err.message}`);
    return false;
  }
}

export async function doctor(env, out, { configFile } = {}) {
  const ctx = makeContext(env);
  const major = Number(process.versions.node.split(".")[0]);
  out(`${major >= 18 ? "ok   " : "FAIL "} Node ${process.versions.node}${major >= 18 ? "" : " (needs 18 or newer)"}`);
  const post = { kind: "post", id: "20", input: "20" };
  let ok = 0;
  for (const source of ["fxtwitter", "vxtwitter", "syndication"]) {
    if (await check(`read via ${source}`, async () => {
      const r = await readPost(ctx, post, { source });
      return `${r.post.author} "${(r.post.text || "").slice(0, 30)}"`;
    }, out)) ok++;
  }
  await check("profile and recent posts", async () => {
    const r = await readProfile(ctx, { kind: "profile", handle: "jack", input: "@jack" }, { profilePosts: 3 });
    return `${r.profile.handle}, ${(r.recent_posts || []).length} posts via ${r.source}`;
  }, out);
  if (!ok) out("      no read source answered: check your network or proxy");

  const provider = searchProvider(env);
  if (provider === "xai") {
    await check("xAI API key", async () => {
      const base = (env.XAI_API_BASE || "https://api.x.ai/v1").replace(/\/+$/, "");
      const res = await ctx.fetch(`${base}/api-key`, { headers: { authorization: `Bearer ${env.XAI_API_KEY}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status} ${body.error || body.code || ""}`.trim());
      const blocked = body.api_key_blocked || body.api_key_disabled || body.team_blocked;
      if (blocked) throw new Error("the key or its team is blocked or disabled");
      return `${body.name || "key"} works${body.acls ? `, scopes: ${[].concat(body.acls).join(" ")}` : ""}`;
    }, out);
  } else if (provider === "relay") {
    out(`ok    search via relay ${new URL(env.X_SEARCH_ENDPOINT).host} (not tested: a test search costs money)`);
  } else {
    out(`off   x_search: no XAI_API_KEY. Run: signal-first setup${configFile ? ` (saves to ${configFile})` : ""}`);
  }
}
