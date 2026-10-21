# x-scout

**Agents can't open x.com, and when they search X they find whatever is loudest. x-scout
lets them read any X link, search X by meaning with every hit checked against X itself, and
judge posts and accounts on value, not reach.**

It is an agent skill with three tools: `x_read`, `x_search` and `x_audit`. Install it as a
Claude Code plugin, run it as a local MCP server for any client, call it as a CLI, or put it
on your own Cloudflare account in one command and use it from claude.ai, ChatGPT and your
phone. Reading needs no key and no X account. Searching needs an xAI API key.

[中文说明](README.zh-CN.md)

## Why

On X, the people who build things often post first: the maintainer explains the bug, the
founder shares the real numbers, the researcher posts the chart before the paper. The same
feed is full of reach bought with hooks, follow-back rings, recycled threads and AI slop.

Agents are bad at both halves. They cannot read X at all, because x.com needs a login and
JavaScript. When they do find posts, through web search or a search model, they treat what
travelled furthest as what matters, and quote search summaries as if they were the posts.

X's own open-source ranking code shows why reach and value come apart. A reply weighs 5, a
copied link 20, a like 0.66. Bookmarks, the plainest sign that a post is worth keeping, weigh
nothing ([details](skills/x-scout/references/x-algorithm.md)). What spreads is what makes
people react. What is useful is what people save.

On one account, the difference looks like this:

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

The post that travelled furthest was news. The post people kept, with more bookmarks than
likes, was a method. An agent that ranks by views reads the first; one that wants to learn
should read the second.

## What it does differently

- **Reads X without logging in.** Posts with full text and every count (views, likes, replies,
  reposts, quotes, bookmarks), threads, replies, quoted posts, polls, community notes and the
  full text of X Articles; profiles with recent posts. Three public sources with fallbacks, and
  each answer says which source it came from and what a fallback could not provide.
- **Search hits are leads, not quotes.** `x_search` asks Grok's `x_search` tool, then re-reads
  every hit from X. Text, author, time and counts come from the post itself. A hit X cannot
  confirm stays in the answer, marked unverified, with the search model's words labelled as such.
- **Two scores, never one.** The skill judges value (first-hand, specific, checkable, new,
  useful) and reach (views, spread) separately, and names the flags: bait, recycled lists,
  borrowed reach, AI slop. Every post carries three ratios: `save` (bookmarks/likes), `talk`
  (replies/likes) and `spread` (reposts and quotes per like).
- **Accounts against their own baseline.** `x_audit` reads an account's originals and its
  replies, then compares each post with the account's own median, not with famous accounts.
  One viral post is not a track record.
- **Recommends, never acts.** X forbids automated likes, bulk follows and AI reply bots
  without approval. x-scout never logs in and never touches your account. It gives you
  the links; you click.
- **Written for agents to read.** Tool output is compact text: no empty fields, short numbers,
  the post text verbatim. JSON is one flag away.

## Install

Pick one. An agent can do any of these for you: tell it "install x-scout, following
https://github.com/JunJayDev/x-scout/blob/main/INSTALL.md". The only human steps are pasting
an xAI key (optional) and, for the remote server, clicking "Allow" on Cloudflare once.

**Claude Code plugin** (skill and tools together)

```
/plugin install x-scout --marketplace JunJayDev/x-scout
```

On Claude Code older than 2.1.275: `/plugin marketplace add JunJayDev/x-scout`, then
`/plugin install x-scout@x-scout`. The plugin asks for an optional xAI key and keeps it
in your system keychain.

**Codex plugin** (the skill): `codex plugin marketplace add JunJayDev/x-scout`, then install
x-scout from the plugin list. For the tools, add the MCP server below.

**Any MCP client** (Codex, Cursor, Claude Desktop, Claude Code without the plugin...)

```bash
claude mcp add x-scout -- npx -y x-scout mcp      # Claude Code
codex mcp add x-scout -- npx -y x-scout mcp       # Codex
```

Other clients: command `npx`, arguments `-y x-scout mcp`. Requires Node 18 or newer.

**Skill only.** Copy [`skills/x-scout/`](skills/x-scout/) into your agent's skills
folder (`~/.claude/skills/`, `.agents/skills/`...). It is self-contained: the agent runs
`node scripts/x-scout.mjs <command>` from it, with nothing to install.

**claude.ai, ChatGPT, phones** (a remote MCP server on your Cloudflare account; the free plan
is enough)

```bash
npx -y x-scout deploy
```

It logs you in to Cloudflare (a browser opens once), deploys, uploads secrets through stdin,
tests the server from its public URL and prints a connector URL. Add it in claude.ai as a
custom connector, or in ChatGPT as a connector in developer mode; no sign-in needed. Connectors
added on the web work in the mobile apps too. `--rotate` issues a new URL; `--check` tests it again.

**Turn on search** (optional): get an API key at [console.x.ai](https://console.x.ai), then

```bash
npx -y x-scout setup      # saves it to ~/.config/x-scout/config.env (mode 600)
npx -y x-scout doctor     # checks the key and every read source
```

Or set `XAI_API_KEY` in the environment. Run `deploy` again to give the remote server the key.

## Quick start

```bash
x-scout read https://x.com/karpathy/status/2039805659525644595
x-scout read <post-url> --replies --max-replies 30      # the corrections live in replies
x-scout read @handle --posts 30
x-scout audit @handle
x-scout search "bun 1.3 production" "migrated from node to bun" --from 2026-09-01
x-scout search "remotion agent" "AI 视频 剪辑 agent" --handle remotion --json
```

A read looks like this:

```text
[1] @karpathy · Andrej Karpathy · 4.4M followers · 2026-04-02 20:42Z
https://x.com/karpathy/status/2039805659525644595
22M views · 61k likes · 2.9k replies · 7.4k reposts · 2.2k quotes · 108k bookmarks
signals: save 1.78 · talk 0.05 · spread 0.16 · eng 0.83%

LLM Knowledge Bases
...
```

## Tools

| tool | does | key |
|---|---|---|
| `x_read` | 1-10 post URLs, ids, profile URLs or @handles. `mode`: `post`, `thread`, `replies`. Profiles with up to 100 recent posts. Optional translation. | none |
| `x_search` | 2-5 queries, `from_date`/`to_date` (inclusive), up to 20 allowed or excluded handles, image and video understanding. Every hit re-read from X. | `XAI_API_KEY` |
| `x_audit` | an account's last 10-100 posts: cadence, mix, median and p90 views, likes per 1k followers, save and talk, link-out share, breakout, top posts by views and by saves, X's "About this account", hints. | none |

All three take `format: "json"` for the full structure. The skill
([`SKILL.md`](skills/x-scout/SKILL.md)) tells the agent when to use which, how to write
queries, and how to judge what comes back.

## How judging works

The skill's loop: decide who would know first-hand; search the way a good post is written
(names, versions, numbers, in each language); read the source, including replies; judge value
and reach separately; audit the account before citing it; answer with URLs, authors and dates;
remember verdicts in a sources file. The details are short and worth reading:

- [judging.md](skills/x-scout/references/judging.md): the value sheet, the flags, verdicts for accounts.
- [signals.md](skills/x-scout/references/signals.md): what each number means and when it lies.
- [x-algorithm.md](skills/x-scout/references/x-algorithm.md): what X's ranking code rewards, checked file by file.
- [x-rules.md](skills/x-scout/references/x-rules.md): what X forbids automated tools to do.

The same judgment applies to your own drafts: the skill checks a post for value first, then
for what X's code is known to reward, and says so when a draft is bait.

## What it costs

| | cost |
|---|---|
| reading and auditing | free. Public services; FxTwitter allows 1,000 requests a minute per IP. |
| searching | xAI bills about $5 per 1,000 posts its model fetches, plus tokens. Each query is capped at 2 search rounds; the output reports how many posts were fetched. |
| remote server | Cloudflare Workers free plan: 100,000 requests a day. |
| tokens | a short post is under 100 tokens; a long post or an X Article costs about what its text costs; an audit is roughly 600-1,000. |

## Limits

- Reading depends on public services run by others (FxTwitter, vxTwitter) and on X's embed
  endpoint. Any of them can break or close; the fallbacks cover single posts best. FxTwitter's
  own search has been down since 2026-10-09, which is why search goes through xAI.
- Fallback sources lack views and bookmarks, and X's embed endpoint cuts long posts. The output
  says so.
- Reply lists are shorter than X's count: hidden, protected and deleted replies are missing.
- Search quality depends on Grok. Results vary between runs; that is why every hit is checked.
- No For You feed, no notifications, no DMs, and no actions on X, by design.
- The judging is a method for agents, not a classifier. It can be wrong; the
  [judging issue template](.github/ISSUE_TEMPLATE/judging.md) is for those cases.

## Library

```js
import { makeContext, runRead, runAudit } from "x-scout";
const ctx = makeContext(process.env);
const { items } = await runRead({ targets: ["https://x.com/jack/status/20"] }, ctx);
```

`x-scout/worker` exports the Cloudflare Worker, if you want to host it yourself.

## Related projects

Reading X for agents is a busy space. Judging what you read is not. x-scout is the one
that keeps value and reach apart, checks every search hit against X, compares accounts with
their own baseline, and applies the same judgment to your drafts. Star counts as of 2026-10-15.

- [FxEmbed](https://github.com/FxEmbed/FxEmbed) (FxTwitter): the main read source here. If you
  read a lot, its maintainers ask you to self-host.
- [x-reader](https://github.com/runesleo/x-reader) and [x-md](https://github.com/pc-style/x-md):
  read X (and more) for agents, with MCP servers and skills. x-md also searches without a key
  through an account pool it runs; x-reader's install guide for agents inspired [INSTALL.md](INSTALL.md).
- [Agent-Reach](https://github.com/Panniantong/Agent-Reach): one installer for reading many
  platforms. Its X search uses your own X cookies; x-scout never touches your account.
- [twitterapi.io MCP](https://github.com/kaitoInfra/twitterapi-io-mcp-server): a paid X data
  API with read tools; a good choice when you need volume.
- [bangermeter](https://github.com/itsryanlenk/bangermeter): scores a post's reach with X's
  published weights, citing source lines. x-scout describes reach and scores value.
- [twag](https://github.com/clifton/twag): LLM triage of tweets with capped scores (restating a
  known view caps the score) and rolling account averages.
- [bullshit-detector](https://github.com/SerhiiKorniienko/bullshit-detector): checks a text claim
  by claim. The judging sheet borrows two of its questions: what is the author selling, and
  which claims carry the post.
- [Bouncer](https://github.com/imbue-ai/bouncer): filters your feed with categories you write in
  plain words. It acts on a timeline; x-scout answers questions.

Part of a series on media literacy for agents. [github-scout](https://github.com/JunJayDev/github-scout)
does the same for GitHub: before an agent builds something, it finds what open source already
solved.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Tests run offline:
`node --test`.

## License

MIT. See [LICENSE](LICENSE).
