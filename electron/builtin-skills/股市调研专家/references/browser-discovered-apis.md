# Browser-Discovered Market APIs

Use this reference when a normal HTTP client fails, keyword hits are weak, or a finance site hides useful data behind JSONP, same-site cookies, or browser-only anti-bot checks. These endpoints were discovered with Chrome DevTools network inspection.

## Workflow

1. Open the relevant page with Chrome DevTools CLI.
2. Capture network requests with `chrome-devtools list_network_requests`.
3. Inspect useful requests with `chrome-devtools get_network_request --reqid ...`.
4. If command-line requests fail but the browser succeeds, use `scripts/devtools_api_probe.py` or an equivalent browser-context fetch.

## Eastmoney

Best for A-share, concept boards, industry boards, board constituents, K-lines, intraday paths, fund flow, related news, announcements, reports, and fast news.

| Data | Browser/API pattern | Notes |
|---|---|---|
| Concept ranking | `push2.eastmoney.com/api/qt/clist/get?fs=m:90+t:3+f:!50...` | Use `f:!50`; omitting it can break parity with the page |
| Board constituents | `push2.eastmoney.com/api/qt/clist/get?fs=b:BK1145...` | Sort by `fid=f62` for main net inflow |
| Board quote | `push2.eastmoney.com/api/qt/stock/get?secid=90.BK1145...` | Includes board up/down/flat count and turnover |
| Board K-line | `push2his.eastmoney.com/api/qt/stock/kline/get?secid=90.BK1145...` | Use `klt=101` for daily |
| Board intraday fund flow | `push2.eastmoney.com/api/qt/stock/fflow/kline/get?secid=90.BK1145...` | Minute fund-flow series |
| Related board news | `np-listapi.eastmoney.com/comm/web/getListInfo?mTypeAndCode=90.BK1145...` | Good context; still verify material claims |

Reusable probes:

```bash
python3 scripts/devtools_api_probe.py eastmoney-concepts --keyword 机器人
python3 scripts/devtools_api_probe.py eastmoney-concepts --keyword 算力
python3 scripts/devtools_api_probe.py eastmoney-constituents --board-code BK1145
```

## Yahoo Finance

Best for US/HK quote snapshots, global ETFs/futures, chart history, fundamentals, and global news discovery.

| Data | Endpoint | Session requirement |
|---|---|---|
| Chart / OHLCV | `https://query1.finance.yahoo.com/v8/finance/chart/NVDA?range=5d&interval=1m&includePrePost=true&events=div,splits` | Usually works without crumb |
| Fundamentals time series | `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/NVDA?...` | Usually works without crumb |
| Search + news | `https://query1.finance.yahoo.com/v1/finance/search?q=AI%20infrastructure&quotesCount=5&newsCount=5...` | Usually works without crumb |
| Multi quote | `https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL,NVDA,0700.HK,GC=F&crumb=...` | Needs browser crumb/session when direct returns 401/429 |
| Quote summary | `https://query2.finance.yahoo.com/v10/finance/quoteSummary/NVDA?modules=price,summaryDetail,financialData,defaultKeyStatistics,assetProfile&crumb=...` | Needs browser crumb/session when direct returns 401/429 |

Reusable probe:

```bash
python3 scripts/devtools_api_probe.py yahoo-quote --symbols AAPL,NVDA,0700.HK,9988.HK,GC=F,GLD
```

## CME Gold

Best for official COMEX gold futures price, contract chain, 10-minute delayed quote status, and CME volatility index.

| Data | Endpoint | Notes |
|---|---|---|
| Gold futures chain | `https://www.cmegroup.com/CmeWS/mvc/quotes/v2/437?isProtected&_t=...` | Product id `437`; response states quote delay |
| Front contract by number | `POST https://www.cmegroup.com/CmeWS/mvc/quotes/v2/contracts-by-number?isProtected&_t=...` with `{"productIds":["437"],"contractsNumber":[1],"type":"VOLUME","showQuarterly":[0]}` | Returns front contract |
| Gold CVOL | `https://www.cmegroup.com/services/cvol?symbol=GCVL&isProtected&_t=...` | CME volatility metrics |

Plain shell requests may return `403` because of Akamai/session checks. Use:

```bash
python3 scripts/devtools_api_probe.py cme-gold
```

## HKEX

Best for official HK announcements and filing PDFs.

| Data | Endpoint | Notes |
|---|---|---|
| Resolve stock code to stock id | `https://www1.hkexnews.hk/search/prefix.do?callback=callback&lang=ZH&type=A&name=00700&market=SEHK` | JSONP; returns `stockId`, code, and name |
| Announcement title search | `https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh&category=0&market=SEHK&searchType=0&documentType=-1&t1code=-2&t2Gcode=-2&t2code=-2&stockId=7609&from=YYYYMMDD&to=YYYYMMDD&title=` | HTML result page with publish time and PDF links |

Reusable probe:

```bash
python3 scripts/devtools_api_probe.py hkex-stock --code 00700
```

## SEC EDGAR

Best for official US filings, ticker-to-CIK resolution, company submissions, and XBRL fundamentals. In this local environment, direct TLS to `*.sec.gov` can be reset before HTTP begins. Use direct SEC first; when that fails, use the scripted reader fallback and keep the access metadata.

| Data | Official URL | Fallback behavior |
|---|---|---|
| Ticker map | `https://www.sec.gov/files/company_tickers.json` | `sec_edgar_probe.py` tries direct SEC, then Jina Reader |
| Company submissions | `https://data.sec.gov/submissions/CIK0000320193.json` | Returns recent forms, report dates, primary docs, and archive URLs |
| XBRL company facts | `https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json` | Returns official fact tags; summaries keep tag/unit/form/filed fields |

Reusable probes:

```bash
python3 scripts/sec_edgar_probe.py resolve --ticker NVDA
python3 scripts/sec_edgar_probe.py summary --ticker AAPL --limit 8
python3 scripts/sec_edgar_probe.py facts --ticker AAPL --tags RevenueFromContractWithCustomerExcludingAssessedTax,NetIncomeLoss,Assets
```

Guardrail: when `access_path` is `jina_reader_proxy`, cite the SEC `official_url` as the underlying source and mention the proxy only as transport. Do not treat the reader as an independent confirmation source.

## 10jqka

Best for concept-name discovery when a keyword is too narrow or Eastmoney naming differs.

| Data | Page / endpoint | Notes |
|---|---|---|
| Concept map | `https://q.10jqka.com.cn/gn/` | DOM contains concept names and detail codes |
| Concept detail | `https://q.10jqka.com.cn/gn/detail/code/309068/` | HTML contains definition, board stats, constituent rankings, net inflow, turnover, and top members |
| Concept minute data | `https://d.10jqka.com.cn/v4/time/bk_886050/last.js` | Detail pages reveal `bk_...` market code |

Useful keyword expansion for weak hits:

| Theme | Expand to |
|---|---|
| AI算力 | `东数西算(算力)`, `算力租赁`, `液冷服务器`, `数据中心`, `共封装光学(CPO)`, `铜缆高速连接`, `高带宽内存`, `英伟达概念`, `AI应用`, `人工智能` |
| 机器人 | `机器人概念`, `人形机器人`, `机器人执行器`, `减速器`, `机器视觉`, `传感器`, `工业母机`, `伺服`, `具身智能` |
| 黄金 | `黄金概念`, `金属回收`, `避险`, `央行购金`, `COMEX`, `美元指数`, `实际利率` |

Reusable probe:

```bash
python3 scripts/devtools_api_probe.py ths-concepts --keyword 算力
python3 scripts/devtools_api_probe.py ths-concepts --keyword 机器人
```

## Current Limitations

- SEC direct `*.sec.gov` may return connection-closed/TLS errors in this environment. `scripts/sec_edgar_probe.py` now handles this by falling back to Jina Reader for the same official URL and marking `access_path=jina_reader_proxy`.
- Browser-protected endpoints should be labelled as public web endpoints, not licensed data feeds.
- For decision-critical claims, use browser-discovered APIs for discovery and primary/official sources for confirmation.
