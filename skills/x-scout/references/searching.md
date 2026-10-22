# Searching X

## How `x_search` works

Each query goes to xAI's Responses API with the `x_search` tool. Grok decides how to search:
keyword search with X's operators (Top or Latest), semantic search, user search, or fetching a
thread. By default, it returns selected post links only, without copying or summarizing the
post text. x-scout loads up to 20 originals through its public readers, five at a time, within
a shared 8-second budget. Failed reads retain the link and a reason. A valid empty selection
stays empty; citations are only a fallback when no JSON array can be parsed.

For Grok 4.5, 4.6 and 4.7, requests explicitly use low reasoning effort; the upstream default
is high. Other model overrides do not receive this setting. See the [xAI reasoning guide](https://docs.x.ai/developers/model-capabilities/text/reasoning).

`verify: false` (CLI `--no-verify`) retains the model-snippet mode without separate reads.
`verify` is a legacy parameter name: loading original content does not fact-check its claims.
Date and handle filters use the available metadata, preferring loaded original posts.

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

- Show useful posts with links; no scoring or author audit is required.
- Reuse originals already returned. Read again only for a missing post, thread or replies.
- If results are poor, change wording or widen the date range. Retry only failed queries
  when the other queries succeeded.
