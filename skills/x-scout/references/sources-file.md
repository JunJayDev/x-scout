# The sources file

Judging an account takes several reads. Write the verdict down so nobody pays for it twice.
Default location: `x-sources.md` at the root of the user's project (ask once if unsure). It is
plain Markdown so people edit it too.

```markdown
# X sources

| account | verdict | topics | why | example | checked |
|---|---|---|---|---|---|
| @handle | follow | ai video, remotion | maintains the tool; posts benchmarks with code | https://x.com/handle/status/123 | 2026-10-15 |
| @other | mute | ai tools | daily "10 tools" lists, no first-hand use; save 0.04 | https://x.com/other/status/456 | 2026-10-15 |
```

- **verdict**: read, follow, watch, mute or skip (see `judging.md`).
- **why**: one line with evidence, preferably a number from `x_audit` or a post.
- **checked**: re-audit accounts after about three months; people change.
- Before searching a topic, read the rows for it. Use `follow` and `read` accounts as
  `allowed_x_handles` for a first, focused search pass.
- Follow and mute are done by the user. List the intent links for them:
  `https://x.com/intent/follow?screen_name=<handle>`.
