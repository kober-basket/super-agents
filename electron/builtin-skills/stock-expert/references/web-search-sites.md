# Web Search Sites

Use this reference when web search is needed for latest market news, official confirmation, filings, macro releases, or article discovery. Store site rules here, not one-off article URLs or historical news results.

## Source Tiers

| Tier | Use first for | Examples | Evidence handling |
|---|---|---|---|
| Primary | Official facts, announcements, filings, policy, macro data | Exchanges, regulators, company IR, SEC/EDGAR, central banks, statistics agencies, futures exchanges | Can support factual conclusions if the date, issuer, and document are clear |
| Credible finance media | Same-day news, market reaction, background, interviews, analyst commentary | 东方财富, 新浪财经, 财联社, 证券时报, 上证报, 中证网, 第一财经, Reuters, Bloomberg, CNBC, MarketWatch, Investing, Nasdaq | Use for context and timelines; verify material claims with primary sources when possible |
| Licensed/paywalled/professional | Low-latency or deeper licensed coverage | Bloomberg, Refinitiv, Wind, Choice, 财联社付费产品, broker terminals | Mention only if accessible; do not invent unavailable details |
| Sentiment/lead only | Market chatter and early leads | 雪球, 股吧, 微博, forums, short-video platforms, self-media | Do not use as factual evidence unless independently verified |
| Excluded | Pollution risk | SEO repost sites, AI summary sites, unsourced screenshots, pages without time/source, trading-signal pages | Exclude from evidence pool |

## Site Whitelist

### A-share primary

| Need | Sites |
|---|---|
| Company announcements | `cninfo.com.cn`, `sse.com.cn`, `szse.cn`, `bse.cn` |
| Regulation and policy | `csrc.gov.cn`, `pbc.gov.cn`, `mof.gov.cn`, `ndrc.gov.cn`, `stats.gov.cn` |
| Exchange data/context | `sse.com.cn`, `szse.cn`, `bse.cn`, `chinabond.com.cn`, `chinamoney.com.cn` |

### HK/US primary

| Need | Sites |
|---|---|
| HK filings | `hkexnews.hk`, `hkex.com.hk`, company IR |
| US filings | `sec.gov`, company IR |
| Listing/exchange context | `nasdaq.com`, `nyse.com` |

### Commodities and macro primary

| Need | Sites |
|---|---|
| Gold/futures | `cmegroup.com`, `lbma.org.uk`, `sge.com.cn`, `shfe.com.cn`, `worldgoldcouncil.org` |
| US macro/rates | `federalreserve.gov`, `fred.stlouisfed.org`, `treasury.gov`, `bls.gov`, `bea.gov` |
| China macro | `pbc.gov.cn`, `stats.gov.cn`, `customs.gov.cn`, `mof.gov.cn`, `ndrc.gov.cn` |

### China finance media

| Need | Sites |
|---|---|
| Fast market news and articles | `finance.eastmoney.com`, `eastmoney.com`, `finance.sina.com.cn`, `cls.cn`, `10jqka.com.cn` |
| Securities newspapers | `stcn.com`, `cnstock.com`, `cs.com.cn` |
| Business/financial context | `yicai.com`, `caixin.com`, `wallstreetcn.com` |

### Global finance media

| Need | Sites |
|---|---|
| Global stock/commodity news | `reuters.com`, `bloomberg.com`, `cnbc.com`, `marketwatch.com`, `investing.com`, `nasdaq.com` |
| Longer context | `wsj.com`, `ft.com`, `barrons.com` |

## Search Patterns

### Latest news

```text
{股票名} {代码} 最新消息 site:finance.eastmoney.com
{股票名} {代码} site:finance.sina.com.cn
{股票名} {代码} 财联社
{ticker} latest news earnings guidance
```

### Announcements and filings

```text
{股票名} {代码} 公告 site:cninfo.com.cn
{股票名} {代码} site:sse.com.cn OR site:szse.cn
{company} investor relations results
{ticker} 8-K 10-Q site:sec.gov
```

### Move explanation

```text
{股票名} {代码} 异动 原因 site:finance.eastmoney.com
{股票名} {代码} 涨 跌 公告
{行业} 政策 催化 A股 site:stcn.com OR site:cnstock.com
{ticker} shares move after earnings Reuters
```

### Gold and commodities

```text
黄金 金价 现货黄金 COMEX 最新消息 site:finance.eastmoney.com
gold price real yields Fed latest
gold ETF flows World Gold Council
COMEX gold CME latest
央行购金 世界黄金协会
```

### Macro and policy

```text
{主题} 政策 site:gov.cn OR site:ndrc.gov.cn OR site:pbc.gov.cn
{指标} 国家统计局
Fed rate decision statement site:federalreserve.gov
{indicator} FRED latest
```

## Evidence Rules

- Prefer site-restricted search before broad search for decision-critical questions.
- For latest or same-day claims, capture publish time, timezone if available, publisher, URL, and whether the page is original or syndicated.
- For material claims, try to attach one primary source or two independent credible media sources.
- If a web result is only a search snippet and the page cannot be opened or verified, do not use the snippet as evidence.
- If media articles repeat one original source, count them as one source.
- If a source says `据悉`, `传闻`, `市场消息`, or unnamed sources, mark it as unconfirmed unless verified elsewhere.
- If article time is after the price move, treat it as explanation/commentary unless there is earlier supporting evidence.
- For paywalled sources, use only visible facts and do not infer hidden article details.

## Exclusion Rules

Do not cite or rely on:

- forum posts, stock bars, social-media posts, screenshots, or short videos as factual evidence
- AI-generated market summaries without original links
- pages without publication time or publisher
- SEO reposts that do not name the original source
- trading-signal pages, auto-strategy pages, or promotional content
- stale pages when the user asks for latest/current/today
