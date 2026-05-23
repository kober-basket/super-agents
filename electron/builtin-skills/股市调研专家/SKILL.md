---
name: stock-market-research-expert
description: Use when researching stocks, sectors, indices, commodities, macro catalysts, market news, filings, fundamentals, technicals, sentiment, or producing market research reports.
---

# 股市调研专家

## Overview

Use this skill to produce evidence-based stock market research in Chinese or English. It is optimized for A-share/HK/US equities, sectors, indices, gold/commodities, macro events, company news, announcements, and investment-style research reports.

Default posture: gather fresh evidence first, separate facts from inference, and label uncertainty. Keep conclusions evidence-scoped and avoid unsupported personalized trade directives. Use verified-data mode by default: simulated news, hardcoded rankings, social-media rumors, and generated trading advice must not enter the evidence pool.

## Quick Trigger

Use this skill when the user asks to:

- analyze a stock, ETF, index, sector, theme, commodity, market event, or macro driver
- find latest market news, causes of a move, catalysts, risks, or sentiment
- compare several securities or build a watchlist
- generate a stock research report, daily brief, event memo, or post-market review
- investigate Chinese finance sources such as 东方财富, 新浪财经, 财联社, 证券时报/人民财讯, 同花顺, 巨潮资讯, exchanges, or US/global sources

## Research Workflow

1. **Clarify scope only when necessary.** Infer reasonable defaults for market, horizon, report depth, and language. Ask a question only when the target is ambiguous enough to change the result.
2. **Plan source mix before collecting data.** Use structured data for prices/fundamentals, direct finance feeds for breaking news, web search for article discovery, and official disclosures for announcements.
3. **Collect fresh data.** For latest news or market-moving events, browse or query live sources. Use exact dates and times in the user's timezone when available.
4. **Cross-check important claims.** Verify price moves, policy/news catalysts, earnings, announcements, and market-wide claims with at least two sources where practical.
5. **Analyze by dimension.** Cover market context, price/volume, technicals, fundamentals, valuation, capital flows, news/catalysts, sentiment, peer comparison, risks, and scenarios as relevant.
6. **Write the report.** Lead with conclusions and evidence, then show supporting data, source reliability, and what to monitor next.
7. **Disclose limits.** State missing data, stale endpoints, API-key gaps, crawler risk, delayed quotes, or unverified claims excluded from analysis.
8. **Reject polluted inputs.** If a tool or source uses fake examples, static fallback data, social buzz, rumor scoring, or strategy simulation, do not use it as evidence.

## Source Selection

Prefer sources in this order:

1. **Local projects if present**
   - Use `scripts/inventory_sources.py` to discover optional local `akshare` and `daily_stock_analysis` checkouts. Override locations with `AKSHARE_ROOT` and `DAILY_STOCK_ANALYSIS_ROOT` if they are not in the common local paths.
   - `akshare`: public financial data interface, useful for A/H/US market data, China finance data, announcements, research reports, news, macro, futures, funds, and bonds.
   - `daily_stock_analysis`: analysis pipeline with data-provider fallback, news search providers, AI reports, and notification/reporting logic.
2. **Official or primary sources**
   - Exchanges, 巨潮资讯/CNINFO, company IR, SEC/EDGAR, central banks, statistics agencies, futures exchanges, World Gold Council, FRED, treasury/FX/commodity official sources.
3. **Direct finance/news feeds**
   - 东方财富, 新浪财经, 财联社, 证券时报/人民财讯, 同花顺, 富途, 南财快讯/21经济网, 财新数据通, CCTV, 百度财经日历.
   - For China market-sensitive breaking news, use 南财快讯/21经济网 `timestream` as a high-freshness discovery source. Use 21经济网 search, channel pages, quotes, and calendars as support only; see `references/21jingji.md`.
   - For A-share company/event flashes and disclosure-adjacent items, include 证券时报/人民财讯 `article/list.html?type=kx`; see `references/stcn.md`.
4. **Optional intraday/technical adapters**
   - THSDK-style 同花顺 access for minute K-lines, time-share, order book, large-order flow, call auction, sector/concept clues, iWenCai-style screening, and 7x24 headlines. Treat as technical/signal support, not primary evidence.
5. **Search APIs / web search**
   - Use for cross-site article discovery, very recent news, topic research, and when direct feeds miss coverage. Prefer site-restricted searches for known finance domains.

Read these references as needed:

- `references/data-sources.md`: source inventory, API-key requirements, reliability labels, and local project mapping.
- `references/eastmoney.md`: 东方财富快讯、行情、K线、异动、公告、研报和数据中心 endpoint map with freshness and guardrails.
- `references/browser-discovered-apis.md`: Chrome DevTools-discovered APIs for Eastmoney, Yahoo, CME, HKEX, and 10jqka browser-only or session-protected data.
- `references/guardrails.md`: safety boundaries, hallucination traps, multi-turn state rules, data conflicts, quantitative minimums, and structured-output contracts.
- `references/21jingji.md`: 21经济网/南财快讯 endpoint map, freshness rules, field handling, and public-endpoint guardrails.
- `references/stcn.md`: 证券时报/人民财讯 endpoint map, fast-news fields, disclosure/quote/data-center leads, and public-endpoint guardrails.
- `references/monitoring-scoring.md`: watchlists, alert rules, dividend checks, risk flags, batch scans, and evidence-bound scoring.
- `references/news-radar.md`: intraday and one-hour news monitoring, source tiers, freshness rules, and decision-risk handling.
- `references/playbooks.md`: step-by-step research routes for stock, sector, commodity, news, announcement, and move-causality tasks.
- `references/report-framework.md`: brief/report templates, scoring table, and quality checks.
- `references/thsdk-intraday.md`: optional THSDK intraday/technical adapter, account model, validated capability classes, and guardrails.
- `references/web-search-sites.md`: web-search site whitelist, priority tiers, query patterns, and exclusion rules.

## Routing And Context

Classify each request before gathering data. Decide the intent first, then collect the minimum evidence for that intent before writing:

- **Quote / latest / today / now:** use live data and timestamp every snapshot.
- **Why moved / news / event:** build a dated timeline before inferring causality.
- **Sector / theme / industry board:** measure board strength, internal leadership, subsegment dispersion, turnover/fund flow when available, catalysts, stage, and benchmark context.
- **Financials / valuation:** prefer filings and explicit periods; reconcile units and metric definitions.
- **Technical / quantitative:** compute indicators from retrieved OHLCV; never invent RSI/MACD/Beta/Sharpe values.
- **Comparison / screening / portfolio:** define universe, market, currency, horizon, risk profile, and missing constraints.
- **Unsafe or adversarial:** follow `guardrails.md`; refuse certainty, insider, leverage-recovery, and rule-bypass requests.

Maintain conversation state when the user provides holdings, risk preference, horizon, constraints, or previously discussed tickers. For follow-ups like “那它呢/如果只能留一个/估值方面呢”, reuse the active context, state the assumption briefly, and ask only if multiple plausible targets remain.

## Entity And Symbol Resolution

Resolve names before analysis:

- Map Chinese/English names, aliases, indices, ETFs, commodities, crypto, and vague descriptions to candidate instruments.
- If ambiguity changes the answer, show 2-5 candidates with market, ticker, currency, and why each matched.
- Normalize formats by data source: A-share exchange suffix/prefix, HK leading-zero rules, US tickers, futures symbols, and index symbols.
- Correct false premises explicitly, e.g. unlisted companies, wrong exchange, impossible index membership, or fake corporate events.
- For mixed-language prompts, keep the user's output language unless they request otherwise.

## News Method

For current news, combine two paths:

- **Direct feeds:** scan finance fast-news APIs and filter keywords, e.g. `黄金|金价|贵金属|COMEX|央行购金|避险`.
  - Use 东方财富快讯雷达 from `probe_sources.py` for Eastmoney: it combines homepage rolling news, paginated `kuaixun/v2`, and `getFastNewsList`; see `references/eastmoney.md`.
  - Include 南财快讯/21经济网 for China market-sensitive topics when timeliness matters; record item time fields and cross-check material claims.
  - Include 证券时报/人民财讯 for A-share company events, policy items, source-labelled reposts, and disclosure-adjacent flashes; record `time`/`show_time`, `source`, and related-stock tags.
- **Targeted search:** use queries like `关键词 site:finance.eastmoney.com`, `关键词 site:finance.sina.com.cn`, `关键词 site:cls.cn`, plus broad search for official or original sources.
- **Site discipline:** for decision-critical web search, prefer the whitelist and evidence rules in `references/web-search-sites.md`; exclude social chatter, SEO reposts, AI summaries, and unverifiable snippets from the evidence pool.

For each material news item, capture:

- title, publisher, publish time, URL
- exact claim or event
- affected securities/themes
- evidence status: confirmed / likely but needs confirmation / excluded unverified claim / market commentary
- whether price action happened before or after the news

## Report Standard

A complete report should contain:

1. **结论先行:** one-paragraph thesis, rating-free unless the user asks for a framework.
2. **关键事实表:** price snapshot, move, volume/turnover, valuation, latest financials, event dates.
3. **催化因素:** confirmed catalysts, possible catalysts, and rejected weak explanations.
4. **技术与资金:** trend, support/resistance, volume confirmation, northbound/sector/fund-flow signals if available.
5. **基本面:** revenue/profit/margins, business drivers, industry cycle, peer comparison.
6. **新闻与公告:** dated evidence with links and source reliability.
7. **情景分析:** bull/base/bear cases with observable triggers.
8. **风险:** data quality, policy, liquidity, valuation, earnings, macro, event, and unverified-claim risk.
9. **后续跟踪:** 3-7 concrete signals to monitor.

## Output Routing

Do not force every request into one template. Choose the structure by intent, then use tables where they clarify facts, ranking, mechanisms, or timelines.

| User intent | Minimum evidence | Default structure |
|---|---|---|
| Latest macro news / daily market brief / broad "what is happening now" | Cross-asset snapshot, official/latest data release, event timeline, policy/central-bank items | 今日主线 -> 关键仪表盘 -> 事件时间线 -> 资产影响矩阵 -> 我的判断 -> 跟踪信号 |
| Sector / theme / industry board overview, e.g. robot sector, AI, gold stocks | Board move versus benchmark, breadth/limit-up count if available, leading subsegments, representative names, catalysts, stage | 板块结论 -> 板块强度表 -> 产业链/子板块拆解 -> 核心标的表 -> 驱动因素 -> 阶段判断 -> 跟踪信号 |
| Single stock / ETF research | Quote, relative move, volume/liquidity, latest filing/news, fundamentals/valuation, technical context | 结论先行 -> 关键事实表 -> 催化与公告 -> 技术与资金 -> 基本面/估值 -> 情景分析 -> 风险 -> 跟踪信号 |
| Why moved / intraday abnormal move | Timestamped price path, volume confirmation, news/announcement timeline, market/sector context, rejected weak claims | 异动结论 -> 时间线 -> 价格成交验证 -> 已确认催化 -> 弱证据/排除项 -> 后续验证点 |
| Comparison / screening / watchlist | Defined universe, comparable metrics, price/fundamental snapshots, risk constraints, ranking method | 结论 -> 对比表 -> 分项评分或排序依据 -> 共同催化与差异风险 -> 适用情景 -> 跟踪清单 |

For sector / theme requests, emphasize internal structure over macro context:

1. **板块强度表:** sector/index change, relative strength versus benchmark, turnover, limit-up count, advancing/declining names, and data timestamp when available.
2. **产业链/子板块拆解:** upstream components, midstream product/system, downstream applications, materials/processes, and which subgroups led or lagged.
3. **核心标的表:** ticker/name, market, subsegment, latest move, evidence-backed catalyst, purity/quality caveat, and risk.
4. **阶段判断:** classify as first-day activation, low-level repair, main uptrend, high-level divergence, or retreat; state the evidence and uncertainty.
5. **跟踪信号:** leaders' persistence, breadth, turnover, fund flow, announcements/orders, policy/industry events, and benchmark risk appetite.

Timeline rows must include a freshness label:

| Label | Meaning |
|---|---|
| 今日发生 | News, market action, official comments, or policy events that happened on the current date. |
| 最新发布 | Newly released data or reports whose statistical period may be earlier, such as April CPI released in May. |
| 待公布 | Scheduled releases, meetings, filings, votes, or events that could change the thesis. |

Prefer tables for facts, rankings, comparisons, and mechanisms. Use short prose for thesis, interpretation, caveats, and risk disclosure. If data periods differ from publication dates, state both dates in the table.

## Quality Gates

- Use current data for “today/latest/now” requests; do not rely on memory.
- Cite sources for news, filings, macro claims, and live market facts.
- Include data timestamp, timezone, market session state, currency, and whether quotes are delayed when known.
- For 21经济网/南财快讯, distinguish request time from business time: fast news uses `inputtime`/`updatetime`, quotes use `quoteDateTime`, articles use `pressdate`/`issuedate`/`updatetime`, and calendar endpoints use the requested event date.
- For STCN/人民财讯, fast news uses `time` in milliseconds and `show_time` in Unix seconds; disclosure lists use `time` dates; quote snapshots do not state delay, so label latency as unknown unless verified.
- For latest macro or market briefs, distinguish event date, publication date, and statistical period; never imply a lagged monthly dataset is a same-day event.
- Do not infer causality from price movement alone; mark it as correlation unless supported by evidence.
- Do not expose API keys or secrets; only report whether required environment variables are present.
- Do not over-trust crawler endpoints. If a direct feed fails, fall back to search and say so.
- Do not use simulated/generated news, hardcoded fallback rankings, social buzz, rumor scanners, or auto trading strategy output as market evidence.
- Treat THSDK/iWenCai/order-book/large-order/call-auction outputs as optional intraday clues unless independently confirmed.
- Avoid generic “利好/利空” labels without mechanism, magnitude, and time horizon.
- Separate A-share, HK, US, futures, spot commodity, and ETF symbols carefully.
- For conflicting PE/PB/ROE/price data, explain source methodology and prefer official filings or primary market data.
- When asked for JSON, output valid JSON only, with null for unavailable fields and a `data_cutoff` field.
- For aggressive prompts such as “all in”, “贷款炒股”, “保证赚钱”, “内幕消息”, or “不要风险提示”, refuse the unsafe framing and offer a risk-controlled research alternative.

## Local Scripts

Use bundled scripts before serious research when local execution is available. They use Python standard library only unless noted. Resolve `scripts/...` and `references/...` relative to this skill directory; do not rely on the folder name or the caller's current working directory.

Inventory local capabilities and configured keys:

```bash
python3 scripts/inventory_sources.py
python3 scripts/inventory_sources.py --full
```

Sweep live finance-news sources for a keyword:

```bash
python3 scripts/probe_sources.py --keyword 黄金 --fetch --max-items 5
```

One-hour decision radar:

```bash
python3 scripts/probe_sources.py --keyword 宁德时代 --fetch --hours 1 --max-items 10
```

Check a real A-share quote watchlist and optional target/stop levels:

```bash
python3 scripts/watchlist_radar.py --symbols 600519,300750 --targets 600519=1800 --stops 300750=180
```

Fetch Yahoo quote snapshots for US/HK/A-share/crypto/index symbols, including latest price, change, intraday high/low, market phase, and relative ranking:

```bash
python3 scripts/quote_snapshot.py --symbols AAPL,NVDA,COIN,BTC-USD,0700.HK,^IXIC,300750.SZ --compare --json
```

Fetch official SEC EDGAR filings and XBRL facts for US names. The script tries SEC direct first and, if local TLS is reset, falls back to Jina Reader while preserving the official SEC URL and labelling the access path:

```bash
python3 scripts/sec_edgar_probe.py summary --ticker NVDA --limit 8
python3 scripts/sec_edgar_probe.py filings --ticker AAPL --forms 10-K,10-Q,8-K --limit 10
python3 scripts/sec_edgar_probe.py facts --ticker AAPL --tags RevenueFromContractWithCustomerExcludingAssessedTax,NetIncomeLoss,Assets
```

Probe optional THSDK intraday/technical signals when `thsdk` is installed:

```bash
python3 scripts/probe_thsdk.py --symbol 300033 --mode intraday --json
```

Calculate evidence-bound quant metrics from a CSV containing `date,close` and optional `benchmark_close`:

```bash
python3 scripts/quant_metrics.py --csv prices.csv --risk-free-rate 0.03 --json
```

Fetch Yahoo OHLCV for US/HK/A-share Yahoo symbols and compute technical indicators plus quant metrics:

```bash
python3 scripts/market_history.py --symbol AAPL --benchmark SPY --range 1y --interval 1d --json
python3 scripts/market_history.py --symbol 0700.HK --range 6mo --interval 1d
python3 scripts/market_history.py --symbol 600519.SS --range 6mo --interval 1d
python3 scripts/market_history.py --symbols AAPL,MSFT,NVDA,AMD --benchmark SPY --sort-by sharpe_ratio
```

Fetch compact Yahoo fundamentals for financial statement metrics, PE, margins, FCF, and leverage checks:

```bash
python3 scripts/fundamental_snapshot.py --symbols AAPL,0700.HK,META,AMD,INTC --json
python3 scripts/fundamental_snapshot.py --symbols AAPL,NVDA,TSLA,META,AMD,0700.HK,9988.HK,600519.SS,300750.SZ
```

Probe browser-only APIs when normal HTTP requests fail or a site requires JSONP/session cookies:

```bash
python3 scripts/devtools_api_probe.py eastmoney-concepts --keyword 机器人
python3 scripts/devtools_api_probe.py eastmoney-constituents --board-code BK1145
python3 scripts/devtools_api_probe.py yahoo-quote --symbols AAPL,NVDA,0700.HK,GC=F
python3 scripts/devtools_api_probe.py cme-gold
python3 scripts/devtools_api_probe.py hkex-stock --code 00700
python3 scripts/devtools_api_probe.py ths-concepts --keyword 算力
```

Extract an evidence pack from a long financial report. Text and HTML work with standard Python; PDF extraction requires `pypdf`:

```bash
python3 scripts/long_report_digest.py --file report.txt --json
python3 scripts/long_report_digest.py --url "https://s2.q4cdn.com/470004039/files/doc_earnings/2026/q2/filing/10Q-Q2-2026-as-filed.pdf" --json
```

Generate a Markdown research-pack skeleton from live news hits:

```bash
python3 scripts/build_report_skeleton.py --target 黄金 --type commodity --fetch
```

Do not treat these scripts as final analysis. Treat them as evidence-gathering accelerators, then cross-check with web search, official sources, and the user's requested scope.
