# Data Sources

## Coverage Summary

This skill is designed to answer most personal/small-team market-research questions when combined with AKShare, daily_stock_analysis, web search, and at least one search API. It is not a substitute for Wind/Choice/Bloomberg/Refinitiv-grade licensed data, tick-level trading feeds, or paid full-text research databases.

| Research need | Coverage with current stack | Best sources | API key needed? | Main weakness |
|---|---|---|---|---|
| A-share daily/intraday quotes | Good | AKShare, efinance, Tushare, Pytdx, Baostock | Optional Tushare | Public endpoints can break or delay |
| HK/US quotes | Medium-good | YFinance, Longbridge, AKShare | Longbridge optional/stronger | Free data may be delayed/adjusted |
| Futures/commodities | Medium-good | AKShare, exchanges, search/news | Usually no, vendor optional | Real-time/continuous contracts need validation |
| Stock news | Good | 东方财富个股新闻, 财联社, 证券时报/人民财讯, 南财快讯/21经济网, 新浪, 同花顺, Futu, search APIs | Direct feeds no; search APIs yes | Duplicates, syndication, causality risk |
| Macro/policy news | Good | official agencies, CCTV, 财联社, 新浪, web search | Search API recommended | Need primary-source confirmation |
| Announcements/filings | Good for discovery | CNINFO, exchanges, company IR, SEC/EDGAR | Usually no | PDF parsing and table extraction may need extra work |
| Financial statements | Medium-good | Tushare, AKShare, company filings, YFinance | Tushare recommended | Units/periods/restatements must be checked |
| Valuation/peer comparison | Medium | AKShare, Tushare, YFinance, filings | Optional | Industry mapping and denominator quality |
| Fund flows/capital flows | Medium | 东方财富/AKShare, Tushare | Optional | Methodologies differ by source |
| Research reports | Partial | 东方财富研报, web search, broker sites | Often no for discovery, paid for full access | Full text coverage limited |
| Sentiment from real retrieved news | Medium | Direct news feeds, search APIs, dated articles | Search API optional | Use only real articles/announcements; no social rumor feeds |
| Watchlist/alerts | Good for A-share quote checks | `watchlist_radar.py`, AKShare, direct news feeds | No | Quote snapshots should be cross-checked for decisions |
| Intraday technical/盘口 clues | Optional-good | THSDK adapter, Tencent quote, AKShare | THSDK no API key; optional THS account | Visitor mode can be limited; signals are not primary evidence |
| iWenCai-style screening | Optional | THSDK `wencai_nlp`, web/search cross-check | THSDK no API key; optional THS account | Use as candidate generation only |
| Real-time trading decisions | Not enough | Licensed low-latency feeds | Yes | Free stack is not suitable |

For one-hour or same-day news monitoring, read `news-radar.md`. For 东方财富 direct endpoints, read `eastmoney.md`. For browser-only or session-protected APIs discovered with Chrome DevTools, read `browser-discovered-apis.md`. For web-search site selection and exclusion rules, read `web-search-sites.md`. For THSDK intraday and order-book use, read `thsdk-intraday.md`. Treat public fast-news endpoints as decision support, not a licensed real-time news terminal.

## API-Key Classification

| Class | Examples | Use | Need key? |
|---|---|---|---|
| Direct public finance endpoints | 东方财富, 新浪, 财联社, 证券时报/人民财讯, 同花顺, 富途, 百度财经日历, CNINFO pages | News, quotes, calendars, disclosures | Usually no |
| Public wrappers | AKShare, efinance, Baostock, Pytdx, YFinance | Structured data access | Usually no |
| Direct quote endpoints | Tencent quote endpoint, 东方财富 quote endpoints, STCN `/public/hq.html` and `/quotes/stock-info.html` | Quick price snapshots and cross-checks | Usually no |
| Browser-session endpoints | Eastmoney JSONP, Yahoo crumb/session quote APIs, CME session-protected gold quotes, HKEX title search, 10jqka concept pages | Data hidden behind browser sessions, JSONP, cookies, or anti-bot checks | Usually no, but needs Chrome/browser context |
| SEC fallback reader | SEC `company_tickers.json`, `submissions/CIK*.json`, `api/xbrl/companyfacts/CIK*.json` via `scripts/sec_edgar_probe.py` | US ticker-to-CIK, latest filings, XBRL fundamentals when local TLS to `*.sec.gov` is reset | No; direct SEC first, Jina Reader fallback second |
| Optional THSDK adapter | THSDK with visitor mode or `THS_USERNAME`/`THS_PASSWORD`/`THS_MAC` | Minute K-line, order book, large-order flow, call auction, sector/concept, iWenCai leads | No API key; optional account credentials |
| Higher-quality structured APIs | Tushare, Longbridge, TickFlow | Formal data, HK/US brokerage-grade access, better stability | Yes |
| Search/news APIs | Anspire, Bocha, SerpAPI, Tavily, Brave, MiniMax | Latest articles, cross-site discovery, snippets, source links | Usually yes |
| Self-hosted search | SearXNG | Private fallback search | Base URL needed; no third-party key if self-hosted |
| LLM/report generation | OpenAI-compatible, DeepSeek, Gemini, Claude, AIHubMix, Ollama | Summarization, reasoning, report writing | Cloud models yes; Ollama no |

## Local Projects

### AKShare

Use a local `akshare` checkout when present. Discover it with `scripts/inventory_sources.py`; set `AKSHARE_ROOT` if it is not in the common local path.

High-value modules and functions:

| Need | Source | Functions / files | Key | Reliability |
|---|---|---|---|---|
| A-share historical quotes | 东方财富 | `akshare/stock_feature/stock_hist_em.py` | No | Good for research; public endpoint can change |
| Individual stock news | 东方财富站内搜索 | `stock_news_em(symbol)` in `akshare/news/news_stock.py` | No | Useful; crawler/JSONP endpoint may break |
| Fast finance news | 东方财富 | `fetch_eastmoney_radar()` in `probe_sources.py`; see `references/eastmoney.md` | No | Stronger than the old single feed: scans homepage rolling news, `kuaixun/v2` pagination, and `getFastNewsList`, then deduplicates and exact-filters broad market terms |
| Fast finance news | 新浪财经 | `stock_info_global_sina()` | No | Good 7x24 supplement |
| Fast finance news | 财联社 | `stock_info_global_cls(symbol="全部"|"重点")` | No | Strong for China event/news flashes |
| Fast finance news | 证券时报/人民财讯 | `fetch_stcn_fast()` in `probe_sources.py`; see `references/stcn.md` | No | High-value STCN fast feed with source labels, full content, topic tags, related-stock tags, and disclosure-adjacent company items |
| Fast finance news | 南财快讯/21经济网 | `fetch_21jingji_fast()` in `probe_sources.py`; see `references/21jingji.md` | No | High-value `timestream` feed with related-stock fields and risk flags; public web endpoints can change |
| Fast finance news | 同花顺 | `stock_info_global_ths()` | No | Useful supplement |
| Fast finance news | 富途牛牛 | `stock_info_global_futu()` | No | Useful for HK/US/global context |
| Data/news articles | 财新数据通 | `stock_news_main_cx()` | No | Quality source; coverage/API stability should be checked |
| CCTV macro/policy | 央视新闻联播 | `news_cctv(date)` | No | Good policy context, not real-time |
| Economic calendars | 百度 | `news_economic_baidu`, `news_report_time_baidu`, dividend/suspend calendars | Optional cookie | Useful event calendar |
| Research reports | 东方财富 | `stock_research_report_em` module | No | Good public report discovery, not complete institutional coverage |
| Announcements | CNINFO/exchanges via AKShare modules | Search `rg "cninfo|公告|notice"` | No | Prefer official URL when possible |
| Macro data | Statistics/central-bank/exchange modules | Search `rg "macro|央行|统计局|bond|rate|fx"` | No/sometimes | Prefer official source for final citation |
| Fund/ETF data | Eastmoney/Tiantian fund modules | Search `rg "fund|etf|基金"` | No | Public endpoint stability varies |
| Bond/rates | ChinaMoney/CBond/NAFMII modules | Search `rg "bond|债|利率"` | No | Fields and calendars need checks |

### daily_stock_analysis

Use a local `daily_stock_analysis` checkout when present. Discover it with `scripts/inventory_sources.py`; set `DAILY_STOCK_ANALYSIS_ROOT` if it is not in the common local path.

Strengths:

- Fetcher fallback order in `data_provider/base.py`: efinance, AKShare, Tushare, Pytdx, Baostock, YFinance, Longbridge, TickFlow depending configuration.
- News search pipeline in `src/search_service.py`: Anspire, Bocha, Tavily, Brave, SerpAPI, MiniMax, SearXNG.
- Agent search tool in `src/agent/tools/search_tools.py`: `search_stock_news`.
- Report generation and notification pipeline useful for recurring watchlists.

Useful API-key environment variables:

| Category | Env names | Notes |
|---|---|---|
| China structured data | `TUSHARE_TOKEN` | Better formal data coverage than pure public crawling; permissions/points vary |
| HK/US brokerage data | Longbridge credentials | Better for tradable HK/US quotes; requires account/API setup |
| Market/search news | `ANSPIRE_API_KEYS`, `BOCHA_API_KEYS`, `SERPAPI_API_KEYS`, `TAVILY_API_KEYS`, `BRAVE_API_KEYS`, `MINIMAX_API_KEYS`, `SEARXNG_BASE_URLS` | At least one recommended for latest articles |
| AI model | OpenAI-compatible, DeepSeek, Gemini, Claude, AIHubMix, Anspire, Ollama local | Needed for report generation if local model not used |

## Source Strategy by Task

| Task | First choice | Backup | Notes |
|---|---|---|---|
| Latest A-share news | 财联社 + 证券时报/人民财讯 + 南财快讯/21经济网 + 东方财富快讯雷达 + 东方财富站内新闻 | 新浪/同花顺/Futu + web search | Always capture publish time |
| 1h news radar | 财联社 + 证券时报/人民财讯 + 南财快讯/21经济网 + 东方财富快讯雷达 + 同花顺 + 新浪 + Futu | Web search and official announcements | Use `probe_sources.py --hours 1`; mark rumors |
| A-share concept/theme strength | 东方财富 concept board API + 10jqka concept map/detail pages | AKShare/THSDK/web search | Use `devtools_api_probe.py` when shell requests fail |
| Stock price/K-line | AKShare/efinance/Tushare | YFinance for global | Treat free quotes as delayed unless confirmed |
| Why did it move | Price/volume data + sector data + fast news + announcements | THSDK intraday clues + web search and official/source articles | Do not assert causality without evidence |
| Intraday move/盘口 | `probe_thsdk.py` + `watchlist_radar.py` | AKShare/Tencent/official news | THSDK signals must be cross-checked |
| Announcements/filings | CNINFO/exchange/company IR/SEC EDGAR via `sec_edgar_probe.py` | Search API | Prefer official documents; for SEC, keep `access_path` in the evidence record |
| Financials/fundamentals | Tushare/AKShare/company filings/SEC XBRL via `sec_edgar_probe.py` | YFinance/official reports | Reconcile units and reporting periods |
| Gold/commodities | Exchange/spot quotes + 东方财富/新浪/财联社 + macro sources | WGC/FRED/central banks/search | Track USD, real rates, geopolitics, ETF flows, central bank demand |
| Macro/policy | Official agencies/central banks + news sources | Search API | Use exact release dates |
| Research reports | 东方财富 report modules + search | Broker/public PDFs | Full reports may require login/payment |
| Sentiment | Real retrieved news + dated announcements + search API articles | Direct finance-news feeds | Never use simulated/news-like examples or social rumors |

For web search, use the source tiers and domain whitelist in `web-search-sites.md`; do not count random repost sites, AI summaries, or social posts as evidence.

## Minimum Source Sets

Use these minimums unless the user explicitly wants a fast answer:

| Task | Minimum evidence |
|---|---|
| “最新消息” | 2 direct/news sources or 1 direct source + 1 web-search article |
| “为什么涨/跌” | Price move + timestamped news/events + sector/index comparison |
| Full stock report | Quotes/K-line + fundamentals + announcements + latest news + peer/sector context |
| Commodity/gold report | Spot/futures move + USD/rates context + finance news + official/macro source where possible |
| Earnings/financial report | Original filing or official financial data + at least one data wrapper/vendor cross-check |
| Policy event analysis | Original policy/regulator text + news coverage + affected sector/security list |

If minimum evidence is not available, state what is missing and downgrade confidence.

## Reliability Labels

Use these labels in reports:

- **Primary:** exchange, regulator, company filing, official agency, central bank.
- **Structured vendor/API:** Tushare, Longbridge, official market APIs, verified data vendors.
- **Public finance endpoint:** 东方财富, 新浪, 财联社, 证券时报/人民财讯, 同花顺, Futu, YFinance, AKShare wrappers.
- **Optional technical adapter:** THSDK-style minute K-line, order-book, large-order, auction, sector, and iWenCai signals.
- **Search result/article:** news articles and indexed pages; verify original source.
- **Excluded/no-evidence:** simulated examples, social rumors, screenshots, unsourced posts, hardcoded rankings, auto trading strategy output.

## Red Flags

- News is copied across many sites but has one original source.
- Article timestamp is after the main price move.
- Quote source does not specify delay, adjustment, currency, or exchange.
- THSDK code examples are hardcoded instead of resolving symbols through search/list methods first.
- Order-book/tick fields contain sentinel values such as `2147483648` or `4294967295` but are interpreted as real values.
- Financial metric source does not state reporting period or unit.
- Search snippet says more than the linked article supports.
- “据悉/传闻/市场消息” is being treated as confirmed instead of excluded until verified.
- Commodity news confuses spot, futures, ETF, and producer equities.

## Search Query Recipes

Chinese:

```text
{股票名} {代码} 最新消息 site:finance.eastmoney.com
{股票名} {代码} 公告 site:cninfo.com.cn
{主题} 财联社 快讯
{主题} site:finance.sina.com.cn
{行业} 政策 催化 A股
```

English/global:

```text
{ticker} latest news earnings guidance
{company} SEC 10-Q 8-K latest
gold price real yields Fed latest
{sector} ETF flows analyst revisions
```
