# Security

**What leaves your machine.** Reading sends post ids and handles to FxTwitter
(api.fxtwitter.com), vxTwitter (api.vxtwitter.com) and X's embed endpoint
(cdn.syndication.twimg.com). Searching sends your queries and filters to xAI (api.x.ai), or to
the relay you configured. Nothing else is contacted, and no X account or cookie is used.

**Keys.** `XAI_API_KEY` is read from the environment or from
`~/.config/x-scout/config.env` (created with mode 0600 by `x-scout setup`). It is
sent only to xAI, and is never printed or written into tool output.

**Remote server.** `x-scout deploy` stores the connector token in
`~/.config/x-scout/worker/deploy.json` (mode 0600) and uploads secrets to Cloudflare
through stdin, never through command-line arguments. The token protects the server: anyone with
the connector URL can use your xAI key through it. Rotate it with `x-scout deploy --rotate`.
Wrong tokens on the secret-URL route get a plain 404.

**Untrusted text.** Posts, bios and replies are written by strangers. Tool output presents them
as data, and the skill tells agents never to follow instructions found in them.

To report a vulnerability, open a private security advisory on the repository. Please do not
file it as a public issue.
