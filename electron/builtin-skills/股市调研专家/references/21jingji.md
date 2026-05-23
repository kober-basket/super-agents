# 21经济网 / 南财快讯

Use this reference when 21经济网 (`21jingji.com`) or 南财快讯 can add high-freshness market evidence. Treat these as public web endpoints exposed by the site, not official open APIs. They can change, throttle, encrypt, or return stale data.

## Source Priority

| Priority | Source | Freshness | Best use | Decision rule |
|---|---|---:|---|---|
| S | 南财快讯 `https://api.21jingji.com/timestream/getListweb?page=1` | Minutes to hours, often 7x24 | Breaking policy/company/global/sector items, intraday event radar | Use first for fast discovery; cross-check material claims. |
| S | Fast-news fields `stocks`, `stock_data`, `important`, `warning`, `riskrating`, `isCredible`, `sourceLink` | Same as item | Link news to affected A-share names and risk flags | Preserve raw fields; do not over-interpret numeric sentiment without validation. |
| A | Site search `https://so.21jingji.com/elk/search/searchWeb/?keywords={keyword}&page=1&callback=...` | Index latency likely minutes-hours | Topic and company context over recent days/weeks | Use for sector/theme background, not first alerting. |
| A | Channel pages `https://m.21jingji.com/channel/{capital|finance|politics|global}?page={n}&type=json` | Article flow, minutes-hours | Securities, finance, macro, global article context | Needs short-lived authorization token; not a breaking feed. |
| B | Quote snapshot `https://m.21jingji.com/plus/stock/api/quote?callback=cb&stockIdList=000001.SS,399001.SZ` | Trading-session snapshot; stale off-session | Add index/stock market context to news | Always judge freshness by `quoteDateTime`, not request time. |
| B | Calendar endpoints `xgsg`, `xgss`, `tfp`, `xs`, `qqds`, `jjsj`, `xjj` | Calendar/batch updates | IPO, listing, halt/resume, holiday, global events, macro data schedule, new funds | Use for morning risk/event table, not real-time catalysts. |
| D | `https://m.21jingji.com/datablock/data/market.json?callback=...` | Low | Brand/activity modules | Do not use as market evidence. |

## Fast News

Primary endpoint:

```text
https://api.21jingji.com/timestream/getListweb?page=1
https://api.21jingji.com/timestream/getListweb?page=1&callback=cb
```

Use the non-callback URL when possible because it returns JSON directly. Use the callback form only when a client needs JSONP parsing.

Observed payloads may expose rows under top-level `list` or `data`; handle both and keep the site's `encode` flag as endpoint metadata rather than analysis evidence.

Useful fields:

| Field | Meaning | How to use |
|---|---|---|
| `id`, `url` | Item identity and article/detail URL | Keep for de-duplication and citation. |
| `title`, `content` | Fast-news headline/body | Quote or summarize only the supported claim. |
| `inputtime`, `updatetime` | Item business time | Use as event freshness; do not replace with request time. |
| `timestream` | Feed/category marker | Keep when building a fast-news timeline. |
| `keywords` | Topic tags | Use for filtering and clustering. |
| `important`, `warning`, `redMark`, `riskrating` | Site risk/importance flags | Preserve as source metadata, not as your own investment rating. |
| `source`, `sourceLink`, `isCredible` | Attribution and confidence clues | Use to decide whether primary-source confirmation is required. |
| `stocks`, `stock`, `stock_data` | Related securities and quote-like fields | Use for candidate linkage; verify prices separately before analysis. |

Recommended normalized record:

```json
{
  "source": "21jingji_timestream",
  "title": "...",
  "url": "...",
  "inputtime": "YYYY-MM-DD HH:MM:SS",
  "updatetime": "YYYY-MM-DD HH:MM:SS",
  "claim": "...",
  "related_stocks": [],
  "flags": {
    "important": null,
    "warning": null,
    "riskrating": null,
    "isCredible": null
  },
  "evidence_status": "confirmed_media"
}
```

## Search

Search is useful for topic context, but it is not the first source for breaking alerts.

```text
https://so.21jingji.com/elk/search/getSearchKey?callback=cb
https://so.21jingji.com/elk/search/searchWeb/?keywords={keyword}&page=1&callback=cb
```

The search result payload may return an encrypted `list`. Observed handling: AES-128-CBC, key from `getSearchKey`, IV `21jingji_search_`, PKCS7 padding. If decryption fails, fall back to normal web search with `site:21jingji.com`.

## Channel Articles

Channel pages are useful for securities, finance, macro, and global article context.

Observed flow:

1. Request a short-lived bearer token from `https://m.21jingji.com/reader/cbhChannelAuth?`.
2. POST to `https://m.21jingji.com/channel/{slug}?page={n}&type=json` with `Authorization: Bearer ...`.
3. Common slugs include `capital`, `finance`, `politics`, and `global`.

Important fields include `id`, `catid`, `title`, `url`, `inputtime`, `updatetime`, `pressdate`, `issuedate`, `keywords`, `source`, `api`, `listthumb`, and `mp`. Use `pressdate`/`issuedate`/`updatetime` as business time and keep request time separate.

## Quotes

Use only as market context or a quick cross-check:

```text
https://m.21jingji.com/plus/stock/api/quote?callback=cb&stockIdList=000001.SS,399001.SZ
```

Freshness must be judged from `quoteDateTime`. During market close or weekends, the endpoint can correctly return the last trading session rather than a same-day snapshot. Do not treat it as trading-grade real-time data.

## Calendar

Useful event endpoints:

```text
https://m.21jingji.com/plus/economiccalendar/api/xgsg?date=YYYY-MM-DD
https://m.21jingji.com/plus/economiccalendar/api/xgss?date=YYYY-MM-DD
https://m.21jingji.com/dynamic/economiccalendar/tfp?date=YYYY-MM-DD
https://m.21jingji.com/dynamic/economiccalendar/xs?date=YYYY-MM-DD
https://m.21jingji.com/dynamic/economiccalendar/qqds?date=YYYY-MM-DD
https://m.21jingji.com/dynamic/economiccalendar/jjsj?date=YYYY-MM-DD
https://m.21jingji.com/dynamic/economiccalendar/xjj?date=YYYY-MM-DD
```

Calendar endpoints are event schedules or batch-updated data. `{"status":-2,"msg":"没有此数据"}` means no data for that date, not necessarily a request failure.

## Freshness Rules

| Data type | Refresh expectation | Required timestamp check |
|---|---:|---|
| 南财快讯 timestream | Check on demand or every 30-60 seconds for active monitoring | `inputtime`, `updatetime`, and current timezone. |
| Channel article list | Check every 5-15 minutes during research | `pressdate`, `issuedate`, `updatetime`. |
| Search | Check on demand; index may lag by minutes-hours | Article publish time, not search request time. |
| Quote snapshot | 30 seconds to 3 minutes only during active sessions; stale off-session | `quoteDateTime`, exchange session state. |
| Calendar | Daily or event-date based | Requested `date` and returned event date. |

## Guardrails

- These are public web endpoints, not guaranteed APIs. If they fail, fall back to 财联社, 东方财富, 新浪, 同花顺, official announcements, and web search.
- Keep request frequency low, respect cache headers, and avoid parallel hammering.
- Do not expose bearer tokens, cookies, or decrypted payload internals in final reports.
- Do not call a claim official unless the linked source is a regulator, exchange, company filing, official agency, or original announcement.
- Downgrade or exclude “据悉/传闻/市场消息/知情人士” unless confirmed by primary sources or multiple credible outlets.
- For stock linkage, use `stocks` and `stock_data` only to generate candidates; verify quote, announcement, and business relevance separately.
