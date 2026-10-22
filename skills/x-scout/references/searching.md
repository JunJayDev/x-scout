# Searching X

## How `x_search` works

Each query goes to xAI's Responses API with the `x_search` tool. Grok decides how to search:
keyword search with X's operators (Top or Latest), semantic search, user search, or fetching a
thread. By default, x-scout returns the model's selected post links, authors, dates and
snippets. It does not make a separate read request for every hit. A valid empty selection
stays empty; citations are only a fallback when no JSON array can be parsed.

Use `x_read` for selected results that need full text, threads or replies. Use `verify: true`
(CLI `--verify`) to load up to 20 full posts in the search call. This retrieves content and
metrics, not a truth judgment. It adds latency. Missing full posts retain their snippets and
a read error. Dates and handle filters are applied to available metadata; loaded post
metadata takes precedence over the search model's metadata.

Cost: xAI bills about $5 per 1,000 posts its model fetches and $10 per 1,000 profiles, plus
tokens. Each query is capped at 2 tool rounds (`XAI_MAX_TURNS`); a query usually fetches a few
dozen posts. The tool reports `posts fetched` per query.

## Writing queries

Good posts name things. Search the way the post you want would be written.

| instead of | try |
|---|---|
| "is Bun good for production" | "bun 1.3 production" / "migrated from node to bun" / "bun segfault" |
| "AI video tools" | "remotion agent" / "seedance 2 prompt" / "made this ad with" |
| "what do people think of X's algorithm" | "x-algorithm repo" / "param.rs weights" / "推荐算法 开源 权重" |

- Start with one query. Use up to 5 different queries when a broader search is useful.
- Try another language when useful. Chinese, Japanese and English queries find different posts.
- Names of the people who would know: put them in `allowed_x_handles` (up to 20) for a focused
  pass, then run a second pass without the filter for reactions.
- Dates: `from_date` and `to_date` are inclusive (`YYYY-MM-DD`). Use them for "what happened
  after the release".
- Images or videos matter (charts, demos)? Turn on image or video understanding; it costs more.

## Without an xAI key

- Web search with `site:x.com` plus names, or the user's links. Then `x_read` each post.
- `x_read @handle` with `profile_posts: 50` reads an account's recent posts directly.
- `mode: replies` on a central post shows who else is talking; their profiles are the next hop.

## After the search

- Show the useful snippets with links; no scoring or author audit is required.
- Read selected links only for details the snippets do not provide. Reuse full posts already
  returned by an earlier read or by `verify: true`.
- If results are poor, change wording or widen the date range. Retry only failed queries
  when the other queries succeeded.
