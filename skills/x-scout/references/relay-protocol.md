# Relay protocol (advanced)

Instead of calling xAI directly, `x_search` can call any HTTP service you run that speaks this
protocol. Set `X_SEARCH_ENDPOINT` and `X_SEARCH_API_KEY`. `XAI_API_KEY` takes precedence when
both are set.

Request: `POST <X_SEARCH_ENDPOINT>` with `Authorization: Bearer <X_SEARCH_API_KEY>` and one
query per request:

```json
{"query": "bun 1.3 production", "max_results": 10, "from_date": "2026-10-01", "to_date": "2026-10-14",
 "allowed_x_handles": ["jarredsumner"], "enable_image_understanding": false}
```

Only `query` and `max_results` are always present. Dates are passed through as given.

Response:

```json
{"provider": "grok-native", "results": [
  {"url": "https://x.com/user/status/123", "author": "@user", "published_at": "2026-10-13T08:00:00Z", "snippet": "..."}
]}
```

Only `results[].url` is required. Every result is re-read from X, as with xAI. Redirects are
reported as errors instead of followed, so a POST is never silently turned into a GET. 429 and
5xx are retried twice.
