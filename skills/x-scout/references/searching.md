# Searching X

## How `x_search` works

Each query goes to xAI's Responses API with the `x_search` tool. Grok decides how to search:
keyword search with X's operators (Top or Latest), semantic search, user search, or fetching a
thread. It returns the posts it found. Then every post is read again from X, and the text,
author, time and counts in the answer come from X, not from Grok. Posts that cannot be read
(deleted, invented, protected) stay in the result as unverified leads.

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

- 2-5 queries, each different in wording, language, or the names it uses.
- Add the other language. Chinese, Japanese and English X are different rooms.
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

- Read every post you will cite with `x_read` (the search result is already verified, but
  threads, replies and quoted posts are not included).
- Prefer posts that several queries found (`matched` lists them).
- An unverified hit is not evidence. If it matters, try to find it another way.
