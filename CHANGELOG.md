# Changelog

## 0.1.0 (unreleased)

First release.

- `x_read`: any X link, post id or @handle without login. Posts with full text, counts
  (views, likes, replies, reposts, quotes, bookmarks), quoted post, media, link card, poll,
  community note, translation and the full body of X Articles; author threads; replies with
  paging; profiles with recent posts. Falls back from FxTwitter to vxTwitter to X's embed
  endpoint and says what the fallback could not provide. Posts carry the author's avatar
  (`author_avatar`) and profiles theirs (`avatar`) when the source gives one.
- `x_search`: 2-5 queries through xAI's `x_search` tool, merged by post, then every hit
  re-read from X. Text, author, time and counts come from X; hits that cannot be confirmed
  are kept as unverified leads. Inclusive date range, handle filters, cost cap per query,
  posts-fetched report. A relay protocol for self-hosted search services.
- `x_audit`: account numbers from two timelines (originals for the baseline, with replies for
  the mix): cadence, median and p90 views, likes per 1k followers, save and talk ratios,
  link-out share, breakout, top posts by views and by saves, and hints.
- Signals on every post: `save` (bookmarks/likes), `talk`, `spread`, `eng`.
- One code base for the CLI, a local stdio MCP server, a Cloudflare Worker (remote MCP) and a
  library. Compact text output by default, JSON on request. No runtime dependencies.
- `signal-first deploy`: Cloudflare Worker in one command, secrets through stdin, smoke test,
  connector URL for claude.ai, ChatGPT and Claude Code. `setup`, `doctor`.
- The skill: the loop (decide who would know, search like a good post is written, read the
  source, judge value and reach apart, audit, answer, remember), a judging sheet, the
  signals, verified notes on X's open-source ranking code, X's automation rules, a sources file.
- Account audits include X's "About this account" (country, whether X trusts it, sign-up
  source, handle changes) with hints for repurposed accounts.
- Claude Code plugin with the skill and the MCP server; it asks for an optional xAI key and
  keeps it in the system keychain. Codex plugin manifest for the skill. `INSTALL.md`, written
  for agents that install it for you.
