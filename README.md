**English** · [中文](README.zh-CN.md)

# x-scout

X (Twitter) for AI agents: read posts, search topics and browse profiles without login.

[![CI](https://github.com/JunJayDev/x-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/JunJayDev/x-scout/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

x-scout provides a CLI, MCP tools and a self-contained agent skill. Open a post, search with
one query, or visit an account's profile and recent posts. No mandatory scoring or account
audits. Reading is free and needs no key; search uses xAI's Grok and requires an API key.

```bash
x-scout read https://x.com/jack/status/20
x-scout search "bun 1.3 production"
x-scout read @jack --posts 10
```

Runs locally through CLI, stdio MCP or Claude Code plugin, or on your own Cloudflare Worker
for remote clients. No runtime dependencies. Optional `x_audit` provides account statistics
when the user asks for deeper analysis.

## Install

You can let an agent install x-scout for you: *"install x-scout, following https://github.com/JunJayDev/x-scout/blob/main/INSTALL.md"*.

Recommended installation path by client:
- **Claude Code**: install the marketplace plugin for tools and skill together.
- **Codex**: configure the MCP server for tools and marketplace plugin for the skill.
- **Cursor, VS Code, Claude Desktop, and other MCP clients**: configure the stdio MCP server.
- **claude.ai, ChatGPT, and phones**: deploy a remote worker to Cloudflare in one command.
- **Agents without MCP support**: copy the self-contained skill folder.

<details>
<summary>Claude Code</summary>

Install the plugin (bundles skill and MCP server, prompts for an optional xAI key and stores it in the system keychain):

```bash
/plugin install x-scout --marketplace JunJayDev/x-scout
```

On Claude Code versions older than 2.1.275:

```bash
/plugin marketplace add JunJayDev/x-scout
/plugin install x-scout@x-scout
```

Or add the MCP server alone without the plugin:

```bash
claude mcp add x-scout -- npx -y github:JunJayDev/x-scout mcp
```

</details>

<details>
<summary>Codex</summary>

Add the MCP server for tools:

```bash
codex mcp add x-scout -- npx -y github:JunJayDev/x-scout mcp
```

Add the skill via the marketplace:

```bash
codex plugin marketplace add JunJayDev/x-scout
```

Then install `x-scout` from the plugin list.

</details>

<details>
<summary>Cursor</summary>

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "x-scout": {
      "command": "npx",
      "args": ["-y", "github:JunJayDev/x-scout", "mcp"]
    }
  }
}
```

To enable search in Cursor, add `"env": {"XAI_API_KEY": "xai-..."}` inside the `x-scout` block.

</details>

<details>
<summary>VS Code</summary>

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "x-scout": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:JunJayDev/x-scout", "mcp"]
    }
  }
}
```

</details>

<details>
<summary>Claude Desktop and other MCP clients</summary>

Standard configuration for clients supporting stdio MCP (command `npx`, arguments `["-y", "github:JunJayDev/x-scout", "mcp"]`):

```json
{
  "mcpServers": {
    "x-scout": {
      "command": "npx",
      "args": ["-y", "github:JunJayDev/x-scout", "mcp"]
    }
  }
}
```

To enable search, add `"env": {"XAI_API_KEY": "xai-..."}` inside the server entry. Requires Node 18 or newer.

</details>

<details>
<summary>claude.ai, ChatGPT and phones (remote deploy)</summary>

Deploy a remote MCP server to your own Cloudflare account (the free plan is sufficient):

```bash
npx -y github:JunJayDev/x-scout deploy
```

A browser opens once to log in to Cloudflare. The command deploys the worker, pipes secrets via stdin, runs a smoke test against the public URL, and outputs a connector URL:
`https://x-scout.<your-subdomain>.workers.dev/mcp/<token>`

Add this URL in claude.ai as a custom connector, or in ChatGPT as a developer-mode connector. No client login is required. Connectors added on the web sync to mobile apps.

Run with `--rotate` to generate a new token, or `--check` to re-test the endpoint. Run `deploy` again after updating keys.

</details>

<details>
<summary>Skill only</summary>

Copy [`skills/x-scout/`](skills/x-scout/) into your agent's skills directory (`~/.claude/skills/`, `~/.codex/skills/`, or `.agents/skills/`). The skill is self-contained: the agent executes `node scripts/x-scout.mjs <command>` directly using Node 18 or newer, with no packages to install.

</details>

### Turn on search

Reading and auditing operate without configuration. To turn on semantic search:

1. Obtain an API key from [console.x.ai](https://console.x.ai).
2. Save and test credentials:

```bash
npx -y github:JunJayDev/x-scout setup      # saves to ~/.config/x-scout/config.env (mode 600)
npx -y github:JunJayDev/x-scout doctor     # tests key and read sources
```

Alternatively, set `XAI_API_KEY` in your environment. Run `deploy` again to sync the key to your remote worker.

Without a key, reading and auditing remain fully functional, and the skill falls back to web searches (`site:x.com ...`) followed by `x_read`.

Advanced options: `setup --base-url <url>` (or `XAI_API_BASE`) configures custom endpoints speaking xAI's Responses API; `XAI_MODEL` specifies the model (default: `grok-4.7`). `SEARCH_TIMEOUT_S` sets how long one query may take (default 120); three queries took 3.5 minutes in one test, so raise it if queries come back as `FAILED, not searched`. `deploy` forwards these settings to your remote server.

## Quick start

Install the CLI globally:

```bash
npm install -g https://github.com/JunJayDev/x-scout/archive/refs/heads/main.tar.gz
```

Or invoke directly with `npx -y github:JunJayDev/x-scout <command>`.

```bash
x-scout read https://x.com/karpathy/status/2039805659525644595
x-scout read <post-url> --replies --max-replies 30      # inspect corrections and nuance
x-scout read @handle --posts 30
x-scout audit @handle
x-scout search "bun 1.3 production" "migrated from node to bun" --from 2026-09-01
x-scout search "remotion agent" "AI 视频 剪辑 agent" --handle remotion --json      # one query per language
```

Real output of `x-scout read`:

```text
[1] @karpathy · Andrej Karpathy · 2026-04-02 20:42Z
https://x.com/karpathy/status/2039805659525644595
22M views · 61k likes · 2.9k replies · 7.4k reposts · 2.2k quotes · 108k bookmarks

LLM Knowledge Bases
...
```

## Tools

| Tool | Capabilities | Key |
|---|---|---|
| `x_read` | 1-10 post URLs, IDs, profile URLs or @handles. Mode: `post`, `thread`, `replies`. Profiles with up to 100 recent posts. Optional translation. | None |
| `x_search` | 1-5 queries; links, authors, dates and snippets by default. Inclusive dates, up to 20 allowed or excluded handles, image/video understanding, up to 20 results per query. `verify: true` optionally loads up to 20 full posts. | `XAI_API_KEY` |
| `x_audit` | Reads an account's last 10-100 posts: cadence, mix, median and p90 views, likes per 1k followers, save and talk ratios, link-out share, breakout multiplier, top posts by views and by saves, X's "About this account", hints. | None |

All three tools take `format: "json"` for structured output.

Default text keeps the post content and interaction counts. Analysis ratios and routine
source details are omitted; fallback and incomplete-content warnings stay visible. Threads
show the target post once. Full metadata is available with `--json`.

For optional analysis, the library exports `postSignals(post)` to compute:
- `save`: bookmarks / likes (measures retention and reference value)
- `talk`: replies / likes (elevated talk with low save flags debate or bait)
- `spread`: (reposts + quotes) / likes (amplification rate)
- `eng`: engagements / views (interaction density)

## Agent workflow

The [skill](skills/x-scout/SKILL.md) starts with the user's request:

1. Open a supplied link with `x_read`, or run one `x_search` query.
2. Show useful content with source links. Search snippets are enough for browsing; use
   `x_read` on selected posts for full text, exact quotes, threads or replies.
3. Stop when the request is answered. Add queries, account analysis or source tracking only
   when needed for the user's task.

For profiles, `x_read` returns the bio, counts and 20 recent posts by default. Set
`profile_posts: 0` (CLI `--posts 0`) for just the bio and counts, or choose up to 100 posts.

Search no longer fetches each result by default. To load full posts and metrics in the same
call, set `verify: true` (CLI `--verify`); this adds requests for up to 20 posts. The existing
`--no-verify` option still works. Fetching a post does not fact-check its claims.

Optional account and draft analysis references: [judging](skills/x-scout/references/judging.md),
[signals](skills/x-scout/references/signals.md), [ranking code](skills/x-scout/references/x-algorithm.md).
They are not part of the default browsing flow.

**Read only:** x-scout never logs in and never likes, follows, replies or posts on X.
It provides links and leaves actions to the user. See [platform rules](skills/x-scout/references/x-rules.md).

## Costs

| Operation | Cost |
|---|---|
| Reading & auditing | Free. Uses public endpoints; FxTwitter allows 1,000 requests per minute per IP. |
| Searching | xAI bills about $5 per 1,000 posts fetched by the model, plus tokens. Queries cap at 2 search rounds and usually fetch 10 to 60 posts (duration: 30s to 2.5m). Output reports posts fetched. |
| Remote server | Cloudflare Workers free plan includes 100,000 requests per day. |
| Token footprint | Short post under 100 tokens; account audit roughly 600-1,000 tokens. |

## Limits

- Reading relies on public services (FxTwitter, vxTwitter) and X's embed endpoint. Fallbacks lack views and bookmarks, and X's embed truncates long posts.
- Retrieved replies exclude hidden, protected, or deleted items.
- Search snippets come from Grok and may be incomplete or paraphrased. Read the selected post when exact wording matters. Full-post loading is optional.
- No For You feed, notifications, direct messages, or write actions on X, by design.
- Evaluation is an agent methodology, not an absolute classifier. Report incorrect assessments via the [judging issue template](.github/ISSUE_TEMPLATE/judging.md).

## Library

Install the package:

```bash
npm install github:JunJayDev/x-scout
```

```javascript
import { makeContext, runRead, runAudit } from "x-scout";

const ctx = makeContext(process.env);
const { items } = await runRead({ targets: ["https://x.com/jack/status/20"] }, ctx);
```

`x-scout/worker` exports the Cloudflare Worker handler for custom deployments.

## Related projects

- [FxEmbed](https://github.com/FxEmbed/FxEmbed): Primary reading backend. Maintainers request self-hosting under high volume.
- [x-reader](https://github.com/runesleo/x-reader) and [x-md](https://github.com/pc-style/x-md): Reading tools and skills for agents; x-md offers keyless search via pooled accounts; x-reader provided the model for [INSTALL.md](INSTALL.md).
- [Agent-Reach](https://github.com/Panniantong/Agent-Reach): Multi-platform reader for agents. X search requires personal cookies; x-scout never touches user accounts.
- [twitterapi.io MCP](https://github.com/kaitoInfra/twitterapi-io-mcp-server): Paid X data API with read tools for bulk collection.
- [bangermeter](https://github.com/itsryanlenk/bangermeter): Scores reach potential using X's published ranking weights. x-scout describes reach and scores value.
- [twag](https://github.com/clifton/twag): LLM tweet triage with score caps on restated opinions and rolling account averages.
- [bullshit-detector](https://github.com/SerhiiKorniienko/bullshit-detector): Claim-by-claim text verification. The judging rubric borrows two diagnostic questions from it.
- [Bouncer](https://github.com/imbue-ai/bouncer): Feed filtering using plain-language categories. Acts on timelines; x-scout answers questions.

Part of an agent media literacy series. [github-scout](https://github.com/JunJayDev/github-scout) applies the same methodology to GitHub: identifying existing open-source solutions before an agent writes code.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Tests run offline: `node --test`.

## License

MIT. See [LICENSE](LICENSE).
