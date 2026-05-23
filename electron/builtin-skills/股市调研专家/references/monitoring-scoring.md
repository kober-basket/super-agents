# Monitoring And Scoring

This reference captures reusable research patterns inside this skill only. All inputs must be real retrieved data. Do not use simulated examples, hardcoded rankings, social rumors, or generated trading advice.

## Watchlist Radar

Use watchlists to monitor facts, not to generate automatic buy/sell calls.

Minimum fields:

| Field | Meaning |
|---|---|
| symbol | Market symbol, e.g. `600519`, `sh600519`, `300750`, `AAPL`, `hk00700` |
| name | Optional display name |
| thesis | Why the asset is being watched |
| target | Optional price level to watch |
| stop | Optional risk level to watch |
| news_keywords | Optional keywords for 1h/24h news radar |
| evidence_to_check | Announcement, earnings, macro release, sector data, product price |

Alert types:

- Price target hit.
- Stop/risk level hit.
- 1h/24h confirmed news event.
- Announcement/filing published.
- Earnings/report date approaching.
- Abnormal volume or post-spike risk flag.

Required output:

- Triggered facts.
- Source and timestamp.
- Whether each trigger is confirmed, needs confirmation, or excluded.
- What to verify next.

## Batch Scan

Use batch scans to narrow candidates, not to finalize conclusions.

Recommended dimensions:

| Dimension | Data |
|---|---|
| Price move | latest price, daily change, 5d/20d move |
| Liquidity | turnover, volume, volume vs average |
| Trend | moving averages, 52-week range, RSI if calculated |
| Fundamentals | revenue/profit/margins/cash flow where available |
| Valuation | PE/PB/PS/EV metrics where meaningful |
| Catalyst | confirmed news, announcements, policy events |
| Risk | disclosure, post-spike, pre-earnings, macro exposure |

Reject candidates if their only “signal” is a buzzword, unsourced article, static ranking, or model-generated score without evidence.

When Yahoo coverage is acceptable for fresh quote comparison, use:

```bash
python3 scripts/quote_snapshot.py --symbols AAPL,NVDA,COIN,BTC-USD,0700.HK,^IXIC,300750.SZ --compare --json
```

For financial metrics and valuation fields, use:

```bash
python3 scripts/fundamental_snapshot.py --symbols AAPL,0700.HK,META,AMD,INTC --json
```

## Dividend / Income Check

Use for dividend stocks, banks, utilities, consumer staples, REIT-like assets, and income portfolios.

Check:

- Dividend yield.
- Payout ratio.
- Free cash flow or operating cash flow coverage.
- 3-5 year dividend stability/growth.
- Ex-dividend and record dates.
- Special dividends vs recurring dividends.
- Debt and earnings cyclicality.

Evidence should come from official filings, exchange/company announcements, AKShare/Tushare/YFinance-style structured data, or company IR. If fields conflict, prefer official filings and show the conflict.

## Portfolio State And Risk Preference

When the user provides positions, preserve the state across follow-ups inside the active conversation.

Minimum state:

| Field | Meaning |
|---|---|
| holdings | Asset, weight/shares, cost basis if provided |
| risk_preference | Conservative, medium, aggressive, or user's own wording |
| horizon | Intraday, weeks, months, long-term |
| drawdown_limit | Explicit stop/review level or implied tolerance |
| constraints | Currency, market, liquidity, tax, income need, no-leverage rule |

Position-sizing outputs must be frameworks, not orders. Prefer ranges and triggers:

- Core/satellite split rather than all-in.
- Rebalance bands rather than exact forced trades.
- Review triggers tied to price, valuation, earnings, news, or macro data.
- Explicit refusal for leverage-recovery or gambling-style prompts.

## Evidence-Bound Scoring

Scores are allowed only when every scored dimension has evidence. Missing evidence should produce `N/A`, not a guessed score.

Suggested weights:

| Dimension | Weight | Evidence |
|---|---:|---|
| Technical trend | 15% | K-line, moving averages, relative strength |
| Fundamentals | 20% | Financial statements, margins, growth, cash flow |
| Valuation | 15% | Valuation vs history/peers |
| Catalyst quality | 20% | Confirmed news/announcement/policy |
| News quality | 10% | Source reliability, timestamp, cross-check |
| Liquidity/risk | 10% | Turnover, volatility, disclosure/macro risk |
| Sector/macro alignment | 10% | Sector data, macro variables, product prices |

Report scores as a research aid:

```text
Score: 68/100
Confidence: medium
Missing: no confirmed fund-flow data, latest filing not parsed
Not a buy/sell recommendation
```

## Quant Metrics

Use only retrieved price/return data. Always state benchmark, period, sampling frequency, and data source.

When local execution is available, prefer the bundled script:

```bash
python3 scripts/quant_metrics.py --csv prices.csv --risk-free-rate 0.03 --json
```

If a CSV is not already available and Yahoo Finance coverage is acceptable for the market, fetch OHLCV and calculate indicators in one step:

```bash
python3 scripts/market_history.py --symbol AAPL --benchmark SPY --range 1y --interval 1d --json
python3 scripts/market_history.py --symbols AAPL,MSFT,NVDA,AMD --benchmark SPY --sort-by beta_low
```

CSV columns:

| Column | Required | Meaning |
|---|---|---|
| date | Recommended | Observation date/time |
| close | Yes | Asset closing price |
| benchmark_close | Optional | Benchmark close for Beta/correlation |

| Metric | Minimum inputs | Output notes |
|---|---|---|
| Beta | Asset returns + benchmark returns | Benchmark and regression/covariance period |
| Sharpe Ratio | Asset returns + risk-free proxy | Excess return period and annualization |
| Volatility | Return series | Annualized or raw, with frequency |
| Max drawdown | Price/return series | Start/end dates of drawdown |
| Momentum | Price series | 1m/3m/6m/12m or user-specified window |
| Correlation | Two return series | Period and sample size |

If a metric cannot be computed from available data, mark `N/A`; do not approximate from memory.

## Risk Flag Library

| Flag | Trigger | Action |
|---|---|---|
| Pre-event | Earnings, policy release, court/regulatory decision soon | Check official calendar; avoid false certainty |
| Post-spike | Sharp recent rise/fall | Verify volume and whether catalyst is already priced |
| Thin liquidity | Low turnover or large spread | Discount signal quality |
| One-source news | Only one credible article/feed item | Cross-check before conclusion |
| After-price news | Article appears after the move | Treat as explanation, not cause |
| Unverified claim | “据悉/传闻/市场消息/知情人士” without confirmation | Exclude from conclusion |
| Data conflict | Sources disagree on price/financial metric | Show conflict; prefer primary source |

## Clean Output Rule

For decision-critical monitoring, output the fact table first:

| Time | Asset | Trigger | Source | Status | Next verification |
|---|---|---|---|---|---|

Then provide interpretation. Do not lead with a score or recommendation before facts.
