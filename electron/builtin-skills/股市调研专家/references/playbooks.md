# Research Playbooks

## 1. Single Stock Research

1. Identify market and symbol format: A-share code, HK code, US ticker, ETF, bond, or futures.
2. Pull quote/K-line and sector/index comparison from AKShare/daily_stock_analysis/YFinance/Tushare as available.
3. If the question is intraday/short-term, read `thsdk-intraday.md` and use THSDK only for minute K-line, time-share, order-book, large-order, auction, sector, or iWenCai clues.
4. Pull latest direct news: 东方财富个股新闻 for A-share, fast-news feeds, and search API/web search.
5. Check official announcements: CNINFO/exchange/company IR/SEC.
6. Check fundamentals and valuation: recent financials, margins, cash flow, valuation vs peers/history.
7. Explain catalysts with timestamp discipline: what happened first, what price did, what market participants cited.
8. Produce fast brief or full report from `report-framework.md`.

Default web queries:

```text
{股票名} {代码} 最新消息 site:finance.eastmoney.com
{股票名} {代码} 公告 site:cninfo.com.cn
{股票名} {代码} 业绩 预告
{股票名} {代码} 研报 评级
```

## 2. “Why Did It Move?”

1. Confirm the move: price, percentage, time window, volume/turnover, sector/index move.
2. Build a timeline: fast news, announcements, macro events, earnings, sector policy.
3. If the move is intraday, use `probe_thsdk.py` as an optional technical check for minute K-line, time-share, depth, large-order flow, and call-auction clues.
4. Reject weak causes: old news, after-the-fact commentary, sector-wide explanations that do not match peers, or THSDK/iWenCai clues without independent support.
5. Assign confidence:
   - High: official disclosure/policy before move + matching market reaction.
   - Medium: multiple credible news sources + sector/peer confirmation.
   - Excluded: single unsourced article, rumor, or commentary after the move.
6. Output likely drivers, non-drivers, and what would confirm/refute.

## 3. Latest News / Event Sweep

1. Run `probe_sources.py --keyword ... --fetch --hours 1` for a one-hour radar, or `--hours 24` for one-day review.
2. Use web search with site restrictions from `web-search-sites.md` for 东方财富, 新浪, 财联社, 证券时报, 上证报, 巨潮资讯, SEC/EDGAR, and official agencies.
3. De-duplicate syndicated articles by original publisher.
4. Keep an evidence table with publish time, source, title, claim, URL, and confidence.

For time-critical decisions, read `news-radar.md` first.
For domain priority and exclusion rules, read `web-search-sites.md`.

Useful Chinese domains:

```text
site:finance.eastmoney.com
site:finance.sina.com.cn
site:cls.cn
site:cninfo.com.cn
site:sse.com.cn
site:szse.cn
site:stcn.com
site:cnstock.com
```

## 4. Watchlist / Alert Review

1. Define symbols, thesis, target/stop levels, and news keywords.
2. Run `watchlist_radar.py` for real quote snapshots and level triggers.
3. Run `probe_sources.py --hours 1` or `--hours 24` for each material keyword.
4. Check official announcements for triggered names.
5. Output triggered facts first, then interpretation.

Example:

```bash
python3 scripts/watchlist_radar.py --symbols 600519,300750 --targets 600519=1800 --stops 300750=180
python3 scripts/quote_snapshot.py --symbols AAPL,NVDA,COIN,BTC-USD,0700.HK,^IXIC,300750.SZ --compare
```

See `monitoring-scoring.md` for watchlist fields and risk flags.

## 4A. Intraday / Technical Clue Review

1. Read `thsdk-intraday.md`.
2. Resolve codes first; do not trust hardcoded THSCODE examples for indices, HK, US, or futures.
3. Run:

```bash
python3 scripts/probe_thsdk.py --symbol "{股票名或代码}" --mode intraday --json
```

4. Cross-check the quote with `watchlist_radar.py`, AKShare, or another source.
5. Align minute/auction/large-order signals with the news and announcement timeline.
6. Report these as technical clues, not standalone causes.

## 5. Sector / Theme Research

1. Define the theme precisely: policy, technology, product price, supply chain, macro, or sentiment.
2. Build constituent list from AKShare/sector data, index providers, or search.
3. Compare leaders by price performance, liquidity, valuation, fundamentals, and catalyst exposure.
4. Track industry-level evidence: policy documents, product prices, order data, inventory, capacity, export/import data.
5. Rank companies by direct exposure, not just keyword similarity.

## 6. Gold / Commodity Research

1. Separate instruments: spot gold, COMEX futures, SHFE/SGE, gold ETF, gold miners, jewelry stocks.
2. Pull latest price move and intraday context.
3. Check macro drivers: USD, nominal/real yields, Fed expectations, inflation data, geopolitical risk.
4. Check demand/supply: central-bank purchases, ETF flows, jewelry/physical demand, import policy, mine supply.
5. Pull news from 东方财富/新浪/财联社/证券时报/人民财讯 plus official/macro sources such as central banks, FRED, World Gold Council, CME, LBMA, SGE/SHFE where possible.
6. Explain whether equity reaction matches commodity move.

Queries:

```text
黄金 金价 现货黄金 COMEX 最新消息 site:finance.eastmoney.com
黄金 美债收益率 美元 实际利率 site:finance.sina.com.cn
央行购金 世界黄金协会 ETF 流入
gold price real yields Fed latest
```

## 7. Announcement / Filing Review

1. Prefer primary sources: CNINFO/exchange/company IR/SEC.
2. Extract exact announcement date, effective date, amount, counterparty, accounting period, and board/shareholder approval status.
3. Compare with prior guidance/consensus/history.
4. Label whether the announcement is already expected or genuinely new.
5. Check market reaction and related follow-up articles.

## 8. Dividend / Income Review

1. Pull latest dividend, payout, ex-dividend date, and historical distributions.
2. Check payout ratio and cash-flow coverage.
3. Separate recurring dividend from special dividend.
4. Compare yield and stability with peers.
5. Flag conflicts between structured data and official filings.

See `monitoring-scoring.md` for dividend checks.

## 9. Report Quality Review

Before final answer, check:

- Does every important factual claim have a source or clear local-data origin?
- Are dates absolute, not just “today/yesterday”?
- Are price data and news timestamps aligned?
- Are unverified rumors excluded from the evidence and conclusion?
- Are A/H/US/futures/spot instruments separated?
- Are missing API keys or failed endpoints disclosed?
- Is there a monitor list for what to check next?

## 10. Entity Resolution / Ambiguous Prompt

Use for vague requests such as “马斯克那个车企”, “中国最赚钱的白酒公司”, “AI芯片龙头”, or mixed-language prompts.

1. Generate candidate instruments with market, ticker, exchange, currency, and why each matched.
2. Prefer the most likely public security only when one candidate is clearly dominant.
3. If multiple candidates would change the answer, ask the user to choose; otherwise state the assumption.
4. Correct false premises before analysis, such as private companies presented as listed, wrong exchange, wrong index membership, or impossible corporate events.
5. Normalize symbol format for the selected data source and verify the quote is non-null and current.

## 11. Financials / Valuation Deep Dive

1. Start from official filings, CNINFO/exchange/company IR/SEC, or structured financial data with explicit period.
2. Extract revenue, profit, margins, operating cash flow, capex, free cash flow, debt, cash, shares, and currency.
3. Reconcile third-party metrics with filings; explain PE/PB/PS/ROE/TTM vs static vs forward definitions when they conflict.
4. Compare with peers and the company's own history.
5. For FCF-style valuation, compute only from sourced line items and show the formula.
6. If a PDF is needed, prefer official annual/interim reports; reject scanned or unparseable reports unless manually verified.

When Yahoo fundamentals coverage is acceptable for a first pass, use:

```bash
python3 scripts/fundamental_snapshot.py --symbols AAPL,0700.HK,META,AMD,INTC --json
```

Treat `fundamental_snapshot.py` as structured evidence, not a substitute for official filings when the answer is decision-critical.

For long reports, first extract an evidence pack, then summarize from the extracted facts:

```bash
python3 scripts/long_report_digest.py --file report.txt --json
python3 scripts/long_report_digest.py --url "https://s2.q4cdn.com/470004039/files/doc_earnings/2026/q2/filing/10Q-Q2-2026-as-filed.pdf" --json
```

If parsing a PDF fails because `pypdf` is unavailable, convert the report to text/HTML first or run with a Python environment that has `pypdf`.

## 12. Technical / Quant Route

1. Pull OHLCV for the requested period and benchmark/peer series when needed.
2. Compute requested indicators from data: RSI, MACD, Bollinger Bands, VWAP, ATR, moving averages, Beta, Sharpe, volatility, drawdown, or correlation.
3. State period, sampling frequency, benchmark, and missing fields.
4. Treat chart patterns as probabilistic; include confidence and invalidation levels.
5. Do not claim support/resistance or overbought/oversold without the underlying price range or indicator values.

When Yahoo coverage is acceptable, use:

```bash
python3 scripts/market_history.py --symbol NVDA --benchmark QQQ --range 1y --interval 1d
python3 scripts/market_history.py --symbols AAPL,MSFT,NVDA,AMD --benchmark SPY --sort-by sharpe_ratio
```

Common Yahoo symbol examples: `AAPL`, `NVDA`, `0700.HK`, `600519.SS`, `300750.SZ`, `BTC-USD`.

## 13. Portfolio / Multi-Turn Route

1. Capture holdings, weights, cost basis, risk preference, horizon, and constraints from the conversation.
2. For follow-ups, reuse prior tickers and constraints unless the user changes them.
3. First assess concentration, factor exposure, liquidity, and drawdown risk.
4. Then discuss scenarios and rebalancing triggers; avoid exact orders unless framed as a user-owned decision framework.
5. If the user shifts risk preference lower, prioritize exposure reduction, hedging alternatives, cash buffer, and review levels before upside.

## 14. Adversarial / Unsafe Prompt Route

1. If the user asks for guaranteed returns, insider information, all-in trades, margin/loan recovery, or to remove risk warnings, refuse that framing.
2. Offer a safer research alternative: diversified screen, watchlist, risk budget, or scenario analysis.
3. For fake-news prompts, say no evidence found and list what sources would confirm it.
4. Keep answers concise; do not debate the safety boundary.
