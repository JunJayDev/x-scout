**English** · [中文](README.zh-CN.md)

# x-scout

X (Twitter) research for AI agents: read any post without login, search with every hit checked on X, judge value apart from reach.

[![CI](https://github.com/JunJayDev/x-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/JunJayDev/x-scout/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

x-scout provides AI agents with three MCP tools (`x_read`, `x_search`, `x_audit`), an evaluation skill that scores substance separately from engagement metrics, and a CLI. It runs locally via stdio MCP, CLI, or Claude Code plugin, or deploys to your own Cloudflare account for claude.ai, ChatGPT, and mobile apps. Reading and auditing require no account and no API key; semantic search uses xAI's Grok to find leads and re-reads every hit directly from X.

```text
$ x-scout audit @karpathy
@karpathy · Andrej Karpathy · verified
4.4M followers · following 1.1k · 10k posts · joined 2009-04-21
originals: 51 (2026-02-24 → 2026-10-11) · median views 1.4M (p90 7.8M) · save 0.61 · talk 0.05 · 31 long posts

top by views:
- 67M views · 28k likes · 47.7x median · 2026-03-24
  Software horror: litellm PyPI supply chain attack. Simple `pip install litellm` was enough to ...
top by saves (bookmarks/likes):
- 22M views · 61k likes · save 1.78 · 2026-04-02
  LLM Knowledge Bases Something I'm finding very useful recently: using LLMs to build personal ...
```

The post that travelled furthest was news (47.7x the account's median views). The post people kept, with more bookmarks than likes, was a method. X's open-source ranking code weighs a reply 5, a copied link 20, a like 0.66 and a bookmark 0: what spreads is what makes people react, what is useful is what people save. x-scout scores the two apart.

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
[1] @karpathy · Andrej Karpathy · 4.4M followers · 2026-04-02 20:42Z
https://x.com/karpathy/status/2039805659525644595
22M views · 61k likes · 2.9k replies · 7.4k reposts · 2.2k quotes · 108k bookmarks
signals: save 1.78 · talk 0.05 · spread 0.16 · eng 0.83%

LLM Knowledge Bases
...
```

## Tools

| Tool | Capabilities | Key |
|---|---|---|
| `x_read` | 1-10 post URLs, IDs, profile URLs or @handles. Mode: `post`, `thread`, `replies`. Profiles with up to 100 recent posts. Optional translation. | None |
| `x_search` | 2-5 queries, `from_date`/`to_date` (inclusive), up to 20 allowed or excluded handles, image and video understanding, `max_results` up to 20 per query. First 20 hits re-read from X; unconfirmed hits are kept and marked unverified. | `XAI_API_KEY` |
| `x_audit` | Reads an account's last 10-100 posts: cadence, mix, median and p90 views, likes per 1k followers, save and talk ratios, link-out share, breakout multiplier, top posts by views and by saves, X's "About this account", hints. | None |

All three tools take `format: "json"` for structured output.

Signals computed on every post:
- `save`: bookmarks / likes (measures retention and reference value)
- `talk`: replies / likes (elevated talk with low save flags debate or bait)
- `spread`: (reposts + quotes) / likes (amplification rate)
- `eng`: engagements / views (interaction density)

## How judging works

The evaluation skill ([`SKILL.md`](skills/x-scout/SKILL.md)) defines a systematic loop:

1. **Identify primary sources**: Determine who would know first-hand (maintainers, incident responders, benchmark authors).
2. **Search by technical terms**: Query specific names, versions, and mechanisms across languages.
3. **Read primary sources**: Inspect full posts and replies with `x_read`. Corrections and clarifications appear in replies.
4. **Separate value and reach**: Reach measures exposure; value measures substance (first-hand, specific, checkable, novel, actionable). Identify flags like engagement bait, recycled lists, uncredited screenshots, borrowed reach, and synthetic padding.
5. **Audit accounts**: Run `x_audit` before citing an account as authoritative. Compare posts to the creator's own baseline, not celebrity accounts.
6. **Report findings**: Attribute URLs, authors, and dates. Disclose unverified leads.
7. **Persist verdicts**: Record judged accounts in a local sources file (`x-sources.md`).

Reference documentation:
- [judging.md](skills/x-scout/references/judging.md): Value scoring sheet, warning flags, account evaluation criteria.
- [signals.md](skills/x-scout/references/signals.md): Metric definitions and distortion cases.
- [x-algorithm.md](skills/x-scout/references/x-algorithm.md): Weights from X's open-source ranking code (reply: 5, copied link: 20, like: 0.66, bookmark: 0).
- [x-rules.md](skills/x-scout/references/x-rules.md): Platform automation rules and restrictions.

**Draft evaluation**: The skill evaluates post drafts against the same standards: verifying substance first, then checking structure against algorithmic factors without writing engagement bait.

**Platform safety**: x-scout never logs in and never executes actions on X (no automated likes, bulk follows, or unapproved AI reply bots). It recommends links; the user clicks.

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
- Search quality depends on Grok and varies between runs; every hit is re-read from X for verification.
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
