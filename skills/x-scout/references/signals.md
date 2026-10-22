# What the numbers mean

The optional `x_audit` tool and library function `postSignals(post)` compute ratios from public counts.
Ordinary read/search text omits these ratios. They are prompts to look closer, never
verdicts. Thresholds below are rules of thumb from reading many posts, not laws.

## Per post

| signal | formula | read it as |
|---|---|---|
| `save` | bookmarks / likes | people keep it to use later. ≥ 0.5 is high: guides, data, lists people will return to. Under 0.1 is normal for jokes and news. |
| `talk` | replies / likes | people answer. High with high `save`: a useful discussion. High with low `save`: an argument, bait, or a giveaway. |
| `spread` | (reposts + quotes) / likes | people pass it on. Quotes mean they add their own take, often to disagree. |
| `eng` | all engagements / views | share of viewers who did anything. Varies a lot by topic and language. |

Ratios appear only with at least 10 likes (and 100 views for `eng`); below that they are noise.

Caveats:

- `replies` counts every reply, including the author's own. An author who answers everyone
  inflates `talk`. Read the replies (`mode: replies`) to see who is talking.
- Bookmarks are private. A high `save` means many saved it, not who.
- Old posts may have no view count. Counts from the fallback sources (vxTwitter, the embed
  endpoint) lack views and bookmarks.
- X's ranking gives bookmarks no weight (see `x-algorithm.md`). That is why `save` is a good
  value signal: nobody games a number the algorithm ignores.

## Per account (`x_audit`)

| number | read it as |
|---|---|
| sample mix (originals / replies / reposts) | what the account mostly does now. Mostly replies is fine for an expert who answers questions; check the replies. |
| posts per day | over ~20 a day, ask how anyone writes that much. |
| originals: median and p90 views | the account's normal reach. Compare a post against this, not against famous accounts. |
| likes per 1k followers | how many followers still react. Very low: bought, inactive or follow-back followers. |
| `save`, `talk` across originals | the account's habit, not one post's luck. |
| share linking out | high means a curator or aggregator: judge the picks and whether they add anything. |
| best / median (`breakout`) | ≥ 30 and the best post ≥ 10x the p90: one post carries the reach. Read it and ask why it travelled. Big accounts have viral posts all the time; that alone means little. |
| following ≈ followers, both small | follow-back growth. Not a sin, but the follower count says little. |
| account age, lifetime posts per day | very new accounts and sudden bursts deserve a closer look. |
| about: country, handle changes, sign-up | X's own "About this account". Three or more handle changes, or a recent one, often means a repurposed account: read its older posts. "May be inaccurate" means X thinks the country is masked (VPN or proxy). A country is context, not a verdict. |

The audit reads two timelines: posts without replies (a baseline of originals that reaches
further back) and posts with replies (the current mix and cadence). Pinned posts are counted
once.
