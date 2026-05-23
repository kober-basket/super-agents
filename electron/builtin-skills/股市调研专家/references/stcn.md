# 证券时报 / 人民财讯 / STCN

Use this reference when `stcn.com` can add same-day China-market evidence: 证券时报 articles, 人民财讯 7x24 flashes, company-event alerts, disclosure discovery, quote snapshots, or STCN data pages. These are public web endpoints exposed by the site, not official open APIs. They can change, throttle, or require browser-like headers.

## Endpoint Map

| Tier | Endpoint | Freshness | Use | Notes |
|---|---|---:|---|---|
| S | `https://www.stcn.com/article/list.html?type=kx` | Minutes-hours | 人民财讯 / 证券时报快讯 feed | Send `X-Requested-With: XMLHttpRequest` and a STCN referer. Script support: `fetch_stcn_fast()` in `probe_sources.py`. |
| A | `https://www.stcn.com/article/list.html?type=dt` | Hours-days | 人民财讯动态 / longer items | Same request style as `kx`; often less urgent than the fast feed. |
| B | `https://www.stcn.com/public/kx-notify.html?last_time=<unix_sec>&tab=all` | Polling only | Desktop notification check | Use after a known `last_time`; can return `请求超时`, so do not rely on it for first pull. |
| B | `https://www.stcn.com/article/category-news-rank.html?type=kx` | Intraday | Hot fast-news list | Popularity/ranking support only; not a completeness source. |
| A | `https://www.stcn.com/xinpi/list-ajax.html?pageSize=20&type=all&page=1` | Same-day | Disclosure discovery | Types include `all`, `sse`, `szse`, `kcb`, `cyb`, `bse`, `xsb`, `sgt`, `hgt`, `hk`, `jg`. PDF links often point to `https://xp.stcn.com/index/pdf?id=...`. |
| B | `https://www.stcn.com/public/hq.html?list=sh600519,sz300750,sh000001` | Intraday | Quote script snapshot | Returns `var hq_str_<code>="..."`; field order is inferred from front-end code. Treat delay/coverage as unknown. |
| B | `https://www.stcn.com/quotes/stock-info.html?stock_code=sh600519` | Intraday | Quote/five-level snapshot | Returns JSON with `cv`, `chg`, `percent`, `open`, `yesClose`, `high`, `low`, `turnoverrate`, `per`, `pbr`, `volume`, `amo`, `cap`, `fiveLevels`. |
| C | `https://www.stcn.com/quotes/time-trend.html?stock_code=sh600519` and `/quotes/kline.html?...` | Intraday/historical | Time-share and K-line | Requires session cookie, CSRF token, and encrypted `STCN-TIMESTAMP` header from `common.js`; prefer AKShare/efinance/YFinance unless you need STCN-specific quote parity. |
| B | `https://info.stcn.com/dc/sjb/newindex.jsp?p=<code>&pn=1&ps=20&st=0&sf=<n>` | Daily/intraday depending table | Data-center rankings | Positional arrays. Map fields from the page JS before using. |
| B | `https://info.stcn.com/data_center/.../*.json` | Daily/periodic | IPO, institution research, ratings, financial summaries | Derived data files; useful for discovery and cross-checks, not primary filings. |

## Fast Feed Fields

`/article/list.html?type=kx` returns JSON with:

| Field | Meaning |
|---|---|
| `id`, `pageTime` | Article/flash identifiers. |
| `title`, `content`, `source` | Headline, body, publisher/source label. |
| `time` | Millisecond timestamp. Convert to Asia/Shanghai. |
| `show_time` | Unix seconds as a string. |
| `isRed`, `red`, `isTop` | Editorial emphasis flags. |
| `tags` | Nested topic tags plus related-stock objects such as `name`, `stock_code`, `code`, `url`. |
| `share_url`, `url`, `web_url` | Article URL; relative URLs should be resolved against `https://www.stcn.com`. |
| response `page_time`, `last_time` | Pagination cursor. `last_time` is Unix seconds of the last item in the page. |

Recommended first pull:

```bash
curl -sS 'https://www.stcn.com/article/list.html?type=kx' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Referer: https://www.stcn.com/article/list/kx.html'
```

Next page:

```bash
curl -sS 'https://www.stcn.com/article/list.html?type=kx&page_time=2&last_time=<last_time>' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Referer: https://www.stcn.com/article/list/kx.html'
```

## STCN Data-Center Leads

High-value `p` values observed from STCN pages:

| Need | Endpoint / `p` examples | Notes |
|---|---|---|
| 沪深港资金 | `xcxhsgzjbshyg` | Top turnover / capital-flow-style table. Positional fields include code, name, values, date, industry. |
| 融资追击 | `xcxlrmrb1`, `xcxlrlzb`, `xcxlrhyb`, `xcxlretf` | Financing net-buy, consecutive increase, industry and ETF tables. |
| 龙虎榜 | `xcxlhbzbd`, `xcxlhbjg`, `xcxlhbsgt` | Total, institutional, Stock Connect variants. |
| 筹码动向 | `xcxgdcmdx`, `xcxgdld`, `xcxgdlz`, `xcxgdjdmx` | Shareholder-count and concentration clues. |
| 新股 | `https://info.stcn.com/data_center/jysj/json/xgfx_1.json` | IPO subscription/listing calendar. |
| 机构调研/评级 | `tssj/json/8/js_desc_1.json`, `tssj/json/12-15/declareDate_desc_1.json` | Institution visits and ratings/rating changes. |
| 个股页资金/财务 | Stock pages expose many `newindex.jsp` / `newindex2.jsp` URLs with `scode=<6-digit-code>` | Read the page JS to map array positions before citing values. |

## Use Rules

- Treat STCN fast feed as a high-value discovery source, especially for A-share company events, policy items, and source-labelled reposts from official agencies/media.
- Cross-check decision-critical claims with 财联社, 21经济网/南财快讯, 东方财富, official announcements, exchange/CNINFO, or the original source named in `source`/`content`.
- Related-stock tags are signal candidates, not proof of impact or causality.
- Distinguish publication time from event date inside `content`, for example “5月15日会见” published on `time` 5月16日.
- For monitoring, poll the fast feed conservatively, e.g. every 30-60 seconds in active windows; public endpoints can set `acw_tc`, throttle, or change format.
- For official disclosure conclusions, prefer exchange/CNINFO/company IR URLs. STCN `xinpi/list-ajax.html` is useful for discovery and PDF links.
- Quote and data-center endpoints are public finance endpoints or derived datasets; mark delayed/unknown where the page does not state latency.
