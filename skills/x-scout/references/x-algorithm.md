# What X's open-source ranking code says

Source: https://github.com/xai-org/x-algorithm, commit `92f0918f6cb52837cb53a8c790c68f906b2c0db1`
(2026-10-15), read without running it. These are **code defaults**: the live values come from
feature switches that are not in the repository, and a second ranker (`vm-ranker`) has its own
defaults (for example like 0.5 there). Use this to understand reach. Do not sell it as a recipe.

## How a post is scored

- A model (Phoenix) predicts the probability that *this viewer* will take each action. The
  score is the sum of weight × probability. The weights do not multiply raw counts
  (`xai-value-model/scoring.rs:57-59`), so "one reply is worth 7.6 likes" is a misreading.
- Weights (`home-mixer/params/param.rs:320-438`): like 0.66, reply 5, quote 5, repost 1, share 2,
  DM share 5, copy link 20, follow author 4, click 0.3, open link 0.2, dwell 0.05, photo expand
  0.05, video open 0.02. Negative: not interested −52.3, mute −58.8, block −31.2, report −234.
- **No bookmark weight.** Video quality views and profile clicks weigh 0.
- When viewer and author follow each other, the reply weight on the author's original posts
  rises by 15 (5 → 20) (`param.rs:322-333`).

## What gets in, what is pushed down

- Posts older than 48 hours are dropped from For You (`home-mixer/params/config.rs:40`).
- Muted and blocked authors, and posts matching muted words, are removed.
- Posts from accounts you don't follow are multiplied by 0.75. Each further post from the same
  author in one feed decays: about 0.63 for the second, 0.44 for the third, floor 0.25.
- Out-of-network replies and reposts are excluded by default: strangers see your main post,
  not the rest of your thread (`filters/oon_retweet_reply_filter.rs`).
- No penalty for external links was found; opening a link has a small positive weight.
- Posts already shown to the viewer are filtered out.

## Cold start for small accounts

`home-mixer/scorers/author_cold_start.rs`: an original post by an author with ≤ 50,000
followers, at most 2 hours old and with fewer than 200 home impressions, can be lifted to about
the 16th slot of a feed. Candidates are sampled by their like rate (prior 1.5%, updated with
likes / home impressions). The first two hours matter.

## Quality labels

- An LLM classifier (Grox, Gemma 4 based, multimodal) labels original posts with a summary,
  tags, topics, `isHighQuality`, `isSpam`, NSFW flags and a `slop_score`. Its prompts are not
  published "to reduce gameability". In this code, `slop_score` and `isHighQuality` are not
  used by the home ranking path.
- Accounts labelled `llm_slop_user` get `SpamHighRecall` for 30 days
  (`abuse-enforcement-service/.../enforcement_user.yaml`). That label drops their posts from
  recommendations to non-followers; followers still see them.
- Account credibility (`user-cred-v2`) is a PageRank over the follow graph, with recent likes
  and reposts shaping it and linked account pairs filtered out.

## What this means for judging

Reach rewards replies, quotes, shares and copied links, and novelty within 48 hours. None of
that measures whether a post is true or useful. Bookmarks, the best plain signal of usefulness,
carry no ranking weight. Keep value and reach apart.
