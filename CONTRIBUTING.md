# Contributing

Thanks for helping. signal-first stays small on purpose: one skill, one dependency-free
JavaScript code base that runs on Node and Cloudflare Workers, and plain-text references.

## Ground rules

- **No runtime dependencies.** `src/` uses only the Fetch API and, in Node-only files
  (`cli.js`, `stdio.js`, `config.js`, `deploy.js`, `doctor.js`), Node built-ins. The Worker
  bundle must not import `node:` modules.
- **Agents read the output.** Keep tool and CLI output short and dense. Every line is paid for
  by every user. JSON stays available with `format: "json"`.
- **Facts carry sources.** Claims about X's ranking code cite the file and commit; claims about
  X's rules cite the page and the date checked. Code defaults are not live values.
- **Read only.** The project never logs in to X, never handles X cookies, and never likes,
  follows, replies or posts. Pull requests that add write actions will be declined.
- **Search results are leads.** Anything a search model says is re-read from X before it is
  presented as fact.

## Development

```bash
npm install                 # dev tools only: esbuild, wrangler
node --test                 # offline; uses the fake network in test/fake.js
npm run build               # rebuild the bundles in skills/signal-first/scripts/
node bin/signal-first.js doctor
npx wrangler dev src/worker.js   # local Worker (needs MCP_TOKEN in .dev.vars)
```

Tests must not use the network. Add a fixture to `test/fake.js` instead. After changing
`src/`, run `npm run build` and commit the bundles; CI checks they match.

When you change the signals or the hints, include before/after output on two or three real
accounts in the pull request. Thresholds are judged on real accounts, not on taste.

## Ideas that fit

- More read sources with a clear fallback story.
- Better hints in `x_audit`, with evidence that they separate good accounts from noise.
- Judging guides for other languages in `skills/signal-first/references/`.
- Install notes for more agent harnesses.
