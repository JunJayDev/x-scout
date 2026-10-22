# Changelog

## 0.1.0 (unreleased)

First release.

- `x_read`: any X link, post id or @handle without login. Posts with full text, counts
  (views, likes, replies, reposts, quotes, bookmarks), quoted post, media, link card, poll,
  community note, translation and the full body of X Articles; author threads; replies with
  paging; profiles with recent posts. Falls back from FxTwitter to vxTwitter to X's embed
  endpoint and says what the fallback could not provide. Posts carry the author's avatar
  (`author_avatar`) and profiles theirs (`avatar`) when the source gives one.
- `x_search`: 1-5 queries through xAI's `x_search` tool, merged by post. Returns search
  originals by default: Grok returns links only, then public readers load up to 20 posts
  under one 8-second read budget. Supported Grok models use low reasoning effort.
  `verify: false` / `--no-verify` retains model snippets without separate reads.
  Link selection prioritizes query relevance, specific substance and original sources,
  reduces near-duplicates and generic promotions, and retains useful differing views.
  No extra review call or output scoring is added; weak matches need not fill the result cap.
  Valid empty selections stay empty, without padding from viewed citations. Date and handle
  filters use available metadata, with loaded posts taking precedence. Inclusive date range,
  cost cap per query, posts-fetched report. `XAI_API_BASE` supports compatible Responses APIs.
  A query that fails for a passing reason (timeout, rate limit, network) is reported as `FAILED, not
  searched` and the other queries still answer; a bad key or URL, or every query failing, fails the
  call with a short message, not a stack. A timeout is not retried: three tries of 120 s took six
  minutes to fail (found while using x-scout to research its own search words).
- Skills carry `metadata.improve-repo` and an "Improve this skill" section: when a run fails because of
  the skill, whoever has write access fixes it at the source, tests it, and opens a pull request.
- `x_audit`: account numbers from two timelines (originals for the baseline, with replies for
  the mix): cadence, median and p90 views, likes per 1k followers, save and talk ratios,
  link-out share, breakout, top posts by views and by saves, and hints.
- Compact reading output: content, links and interaction counts; no per-post analysis ratios,
  follower counts or routine source lines. Fallback, truncation and incomplete-read warnings
  remain visible. Thread targets are shown once, and searches omit repeated matched-query
  lines. JSON retains full metadata. Shorter MCP descriptions keep existing arguments intact.
- Optional `postSignals(post)` library helper: `save` (bookmarks/likes), `talk`, `spread`, `eng`.
- One code base for the CLI, a local stdio MCP server, a Cloudflare Worker (remote MCP) and a
  library. Compact text output by default, JSON on request. No runtime dependencies.
- `x-scout deploy`: Cloudflare Worker in one command, secrets through stdin, smoke test,
  connector URL for claude.ai, ChatGPT and Claude Code. `setup`, `doctor`.
- The skill: read a post, search once or visit a profile, then fetch more only when needed.
  Account judging, draft advice and source tracking remain optional references.
- Empty searches and audits with no hints no longer throw. Requested empty profile/reply
  lists stay explicit, and reply pagination failures report partial results.
- Account audits include X's "About this account" (country, whether X trusts it, sign-up
  source, handle changes) with hints for repurposed accounts.
- Claude Code plugin with the skill and the MCP server; it asks for an optional xAI key and
  keeps it in the system keychain. Codex plugin manifest for the skill. `INSTALL.md`, written
  for agents that install it for you.
