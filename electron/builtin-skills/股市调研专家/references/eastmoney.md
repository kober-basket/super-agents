# Eastmoney Direct Endpoints

Use this reference when 东方财富 is relevant to same-day news, A-share/HK/US quote checks, sector boards, K-lines, fund flows, announcements, reports, or data-center tables. These are public web endpoints discovered from the live site and related Eastmoney pages; they are useful for research, but not guaranteed stable or licensed low-latency feeds.

## Fast-News Stack

| Use | Endpoint | Freshness | Script support | Notes |
|---|---|---:|---|---|
| Homepage rolling flashes | `https://np-weblist.eastmoney.com/comm/web/getFastNews?client=web&biz=web_home724&req_trace=...` | Near real-time | Yes | Homepage feed; usually about 10 latest items |
| Paginated 7x24 list | `https://newsapi.eastmoney.com/kuaixun/v2/api/list?column=102&limit=100&p=1` | Minutes | Yes | `limit=20` is too shallow for broad market scans; tested `limit=100` and pagination with `p=2` |
| Global fast-news list | `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&pageSize=200&req_trace=...` | Minutes | Yes | Includes fields such as `stockList`, `realSort`, `showTime`, and `summary` |
| Browser push accelerator | `https://*.newspush.eastmoney.com/sse?...` | Push | No | Treat as an accelerator only. It may emit sequence messages without full article payloads and should not be the only source |

`scripts/probe_sources.py` combines the first three feeds as `fetch_eastmoney_radar()`. For broad keywords such as `A股`, `市场`, `股市`, `行情`, or `大盘`, it scans the larger candidate pool first, marks `matched_keyword`, deduplicates by news id / normalized URL / title-time, then returns exact matches before falling back to latest flashes.

Recommended commands:

```bash
python3 scripts/probe_sources.py --keyword A股 --fetch --hours 24 --max-items 10
python3 scripts/probe_sources.py --keyword 机器人 --fetch --hours 24 --max-items 20 --eastmoney-pages 5 --eastmoney-page-size 100
```

## Quotes, Boards, And K-Lines

| Use | Endpoint pattern | Notes |
|---|---|---|
| Single security quote | `https://push2.eastmoney.com/api/qt/stock/get?secid={market}.{code}&fields=...` | Use for latest quote snapshot. A-share `secid` commonly uses `0.` for SZ and `1.` for SH |
| Lists and boards | `https://push2.eastmoney.com/api/qt/clist/get?fs=...&fields=...` | High-value for A-share lists, concept boards, industry boards, ETF lists, and market breadth screens |
| Daily/minute K-line | `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=...&klt=101&fqt=1&fields1=...&fields2=...` | Useful for historical OHLCV; verify adjustment and period (`klt`) |
| Intraday trend | `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=...&fields1=...&fields2=...` | Time-share data for intraday path and volume |
| Tick/details SSE | `https://*.push2.eastmoney.com/api/qt/stock/details/sse?secid=...` | Useful when available, but browser/SSE behavior can vary |
| Stock anomalies | `https://push2ex.eastmoney.com/getAllStockChanges?...` | Intraday abnormal moves; classify as clue, not cause |
| Board anomalies | `https://push2ex.eastmoney.com/getAllBKChanges?...` | Board/concept/industry abnormal moves; cross-check with board quote data |
| Fund flow day K-line | `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid=...` | Capital-flow methodology differs by vendor; label as Eastmoney method |

Use quote/K-line endpoints to validate price timing before attributing a move to news. If a fast-news item is published after the price move, mark it as explanation/commentary rather than trigger unless there is earlier corroboration.

DevTools-discovered concept board examples:

| Use | Endpoint pattern | Key fields |
|---|---|---|
| Concept-board ranking | `https://push2.eastmoney.com/api/qt/clist/get?fs=m:90+t:3+f:!50&fields=f12,f13,f14,f2,f3,f4,f20,f8,f104,f105,f128,f140,f136,f207,f208,f222&fid=f3&pn=1&pz=80&po=1&ut=fa5fd1943c7b386f172d6893dbfba10b` | `f12` board code, `f14` name, `f3` pct, `f8` turnover, `f104/f105` up/down count, `f128/f140` lead stock |
| Concept-board quote | `https://push2.eastmoney.com/api/qt/stock/get?secid=90.BK1145&fields=f58,f57,f43,f44,f45,f46,f47,f48,f50,f86,f113,f114,f115,f116,f117,f168,f169,f170,f171&ut=fa5fd1943c7b386f172d6893dbfba10b` | Board name/code, OHLC, volume, amount, up/down/flat count, market cap, turnover, pct |
| Concept constituents with fund flow | `https://push2.eastmoney.com/api/qt/clist/get?fs=b:BK1145&fields=f14,f12,f13,f2,f4,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f109&fid=f62&pn=1&pz=50&po=1&ut=fa5fd1943c7b386f172d6893dbfba10b` | Stock price/pct plus main, super-large, large, medium, small net flow and dynamic PE |
| Concept K-line | `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=90.BK1145&klt=101&fqt=1&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&ut=fa5fd1943c7b386f172d6893dbfba10b` | Date, open, close, high, low, volume, amount, amplitude, pct, change, turnover |
| Concept intraday fund-flow K-line | `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?lmt=0&klt=1&secid=90.BK1145&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56&ut=fa5fd1943c7b386f172d6893dbfba10b` | Minute fund-flow series |
| Concept related news | `https://np-listapi.eastmoney.com/comm/web/getListInfo?cfh=1&client=web&mTypeAndCode=90.BK1145&type=1&pageSize=5&traceId=...` | Related article title, show time, URL |

If a `push2.eastmoney.com` request returns empty response from shell, retry in the browser context with `scripts/devtools_api_probe.py`. The site often serves these as JSONP script requests even when plain command-line clients are cut off.

## Articles, Announcements, Reports, Data Center

| Use | Endpoint | Notes |
|---|---|---|
| Site news search | `https://search-api-web.eastmoney.com/search/jsonp` | Good article discovery; better context than pure fast-news alerts |
| Stock/company announcements | `https://np-anotice-stock.eastmoney.com/api/security/ann` | Use for discovery, then prefer CNINFO/exchange/company original documents for final evidence |
| Research report list | `https://reportapi.eastmoney.com/report/list` | Public report discovery; full coverage may be incomplete |
| Data-center tables | `https://datacenter-web.eastmoney.com/api/data/v1/get` | Powerful for rankings and structured tables; field names differ by report name |

## Guardrails

- Public endpoints can change fields, CORS behavior, pagination limits, or anti-crawling rules. If a request fails, fall back to AKShare wrappers, web search, and official sources.
- For `kuaixun/v2`, use `limit=100` with pagination for broad scans; `limit=20` is usually too shallow for `A股`/`市场` type queries.
- Deduplicate syndicated news before counting evidence. Reposted articles do not equal multiple confirmations.
- Treat `据悉`, `市场消息`, and unnamed-source items as unconfirmed until verified by official announcements or multiple credible publishers.
- Record request time and article time separately when writing reports.
