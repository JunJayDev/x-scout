# Installing x-scout (for agents)

You are an agent asked to install x-scout. Do the steps for the harness you run in, then
verify. Ask the human only where it says so.

## 1. Pick the install

| you are | do |
|---|---|
| Claude Code | `/plugin install x-scout --marketplace JunJayDev/x-scout` (older versions: `/plugin marketplace add JunJayDev/x-scout`, then `/plugin install x-scout@x-scout`). If you cannot run slash commands, run `claude mcp add x-scout -- npx -y github:JunJayDev/x-scout mcp` and copy `skills/x-scout/` into `~/.claude/skills/`. |
| Codex | `codex mcp add x-scout -- npx -y github:JunJayDev/x-scout mcp`, and copy `skills/x-scout/` into `~/.codex/skills/` (or `.agents/skills/` in the project). |
| Cursor, Claude Desktop, other MCP clients | add a stdio server: command `npx`, args `-y github:JunJayDev/x-scout mcp`. |
| an agent that reads skills but has no MCP | copy `skills/x-scout/` into your skills folder. The skill runs `node scripts/x-scout.mjs` from that folder. |

Requirements: Node 18 or newer (`node --version`). No other install.

## 2. Search key (optional; ask the human)

Reading and auditing work now. Searching needs an xAI API key. Ask: "Do you want X search?
It needs an xAI API key from https://console.x.ai; xAI bills about $5 per 1,000 posts it
fetches." If they give you a key, save it without echoing it:

```bash
printf '%s' "$KEY" | npx -y github:JunJayDev/x-scout setup
```

If they use an endpoint that speaks xAI's API instead of xAI itself, add `--base-url <url>`
(and `--model <name>` if its model is not `grok-4.7`).

Never write the key into the repository, a chat log or a command line that is saved in history.

## 3. Remote server (only if they use claude.ai, ChatGPT or a phone)

```bash
npx -y github:JunJayDev/x-scout deploy
```

A browser opens for Cloudflare. Tell the human: "Sign in to Cloudflare (a free account works)
and click Allow." In CI, `CLOUDFLARE_API_TOKEN` replaces the login. The command prints a
connector URL. Give it to the human privately; it contains a password. They add it in claude.ai
as a custom connector, or in ChatGPT as a developer-mode connector.

If deploy says the account has no workers.dev subdomain, tell the human to open
https://dash.cloudflare.com → Workers & Pages once, then run deploy again.

## 4. Verify

```bash
npx -y github:JunJayDev/x-scout doctor
npx -y github:JunJayDev/x-scout read https://x.com/jack/status/20
```

`doctor` prints `ok` for each read source and for the key, or says what to fix. A read of that
post returns "just setting up my twttr". For the remote server: `npx -y github:JunJayDev/x-scout deploy --check`.

## 5. Tell the human

One line each: what was installed and where; whether search is on; the connector URL if you
deployed (privately); anything that failed and what they need to do.
