# X's rules for automation (what agents must not do)

Sources: X developer guidelines (https://docs.x.com/developer-guidelines) and automation rules
(https://help.x.com/en/rules-and-policies/x-automation), checked 2026-10-15.

| action | rule |
|---|---|
| like | must be started by the person. Auto-liking (by keyword, hashtag, user or schedule), bulk liking and selling likes are prohibited. |
| follow / unfollow | no bulk, aggressive or automated following. Following back everyone is listed as prohibited. |
| reply | an automated reply only when the user engaged first, at most one per interaction. AI-generated replies need X's prior approval. |
| DM | no unsolicited automated DMs, including welcome messages to new followers. |
| post | scheduled posts of your own content are fine; automated accounts must be labelled. |
| bookmark | fine. |
| scraping, browser automation | permanent suspension for apps using the X API. |
| training | storing X data to train AI models is prohibited (Grok excepted). |

What this skill does instead:

- It only reads public data, through public services, and never logs in to X or touches the
  user's account or cookies.
- It recommends; the person acts. Give follow links
  (`https://x.com/intent/follow?screen_name=<handle>`) and the post links to like or mute.
- For an account the user wants to grow, it writes drafts and checks them; the user posts.
