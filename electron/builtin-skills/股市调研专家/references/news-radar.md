# News Radar

Use this reference when the user needs same-day or one-hour market news. The goal is not to be omniscient; it is to reduce latency while keeping source quality and false-positive risk visible.

## Freshness Tiers

| Tier | Window | Primary use | Sources | Confidence rule |
|---|---:|---|---|---|
| Breaking radar | 0-60 min | Decision alert, move explanation, risk warning | 财联社电报, 证券时报/人民财讯, 南财快讯/21经济网, 东方财富7x24, 新浪7x24, 同花顺财经直播, 富途快讯 | Treat as early signal; verify before strong conclusion |
| Intraday review | 1-24h | Daily catalysts, post-market review, morning/evening brief | Direct feeds + 东方财富站内新闻 + site-restricted web search | Usually enough for directional read |
| Deep context | 1-7d | Background, sector theme, earnings/policy digestion | Official announcements, company IR, broker reports, major media, search APIs | Prefer primary source and longer-form articles |
| Structural research | >7d | Industry cycle, fundamentals, valuation | Filings, official data, AKShare/Tushare/YFinance, research reports | News becomes context, not catalyst |

## No-Key Fast Feeds

These can often be queried directly or through AKShare. They are best-effort public endpoints and can fail or change.

| Source | Best for | Typical freshness | Script support | Notes |
|---|---|---:|---|---|
| 东方财富快讯雷达 | A-share, macro, global markets, commodities | Minutes | Yes | Combines homepage rolling news, `kuaixun/v2` pagination, and `getFastNewsList`; see `eastmoney.md` |
| 东方财富站内新闻搜索 | Stock/topic articles and syndicated news | Minutes-hours | Yes | Better for article context than pure alerts |
| 财联社电报 | China market/policy/event flashes | Minutes | Yes | Very useful for intraday catalysts; some items are rumor/“据悉” |
| 证券时报 / 人民财讯 | A-share company/event flashes, policy items, source-labelled reposts, disclosure-adjacent news | Minutes-hours | Yes | Use `article/list.html?type=kx`; read `stcn.md` for field and freshness rules |
| 南财快讯 / 21经济网 | China market/policy/company/global flashes, related-stock clues, 21世纪经济报道 articles | Minutes-hours | Yes | Use `timestream` as fast feed; read `21jingji.md` for field and freshness rules |
| 新浪财经7x24 | Macro/global/commodity fast news | Minutes | Yes | Good supplement; can be sparse for niche A-share names |
| 同花顺财经直播 | A-share and market-wide flashes | Minutes | Yes | Useful as cross-check against Eastmoney/CLS |
| 富途牛牛快讯 | HK/US/global market flashes | Minutes | Yes | Good for HK/US and overnight context |
| 巨潮资讯/交易所公告 | Official A-share disclosures | Minutes-hours | Via web/AKShare/search | Primary source; not always instant in wrappers |
| SEC/EDGAR/company IR | US official filings | Minutes-hours | Via web/search | Primary source for US names |

## Keyed Sources Worth Adding

| Source type | Examples | Why add | Cost expectation |
|---|---|---|---|
| Chinese search/news API | Anspire, Bocha, SerpAPI Baidu, Tavily | Finds fresh articles across 东方财富/新浪/财联社/证券时报/上证报/公告 pages | Usually free trial/paid quota |
| Structured China data | Tushare | More stable A-share data, news/announcement-style endpoints depending permission | Account/points/paid tiers |
| Broker/market API | Longbridge, TickFlow | Better HK/US quote freshness and structured access | Account/API plan |
| Paid professional news | 财联社付费产品, Wind/Choice, Bloomberg/Refinitiv | Lower latency, broader licensed coverage | Paid/professional |

## One-Hour Radar Procedure

1. Run:

```bash
python3 scripts/probe_sources.py --keyword "{关键词}" --fetch --hours 1 --max-items 10 --eastmoney-pages 3 --eastmoney-page-size 100
```

2. If hits exist, classify each:
   - `official`: exchange/company/regulator/agency.
   - `confirmed media`: named credible publisher and link.
   - `flash/commentary`: 7x24 headline, market desk interpretation.
   - `excluded unverified`: “据悉/传闻/市场消息/知情人士” without confirmation.
3. If the topic is broad, such as `A股` or `市场`, inspect 东方财富雷达 `meta.selection_mode`: `exact` means keyword hits were found inside the larger feed scan, while `recent_fallback` means it returned latest market flashes because no exact broad-keyword match appeared.
4. If the topic is China market-sensitive, pay special attention to 南财快讯/21经济网 `timestream` hits and 证券时报/人民财讯 hits from the script; for sector/theme context, use STCN tags/related stocks and 21经济网 channels as support, not causality proof.
5. Cross-check the top 1-3 items with web search using `web-search-sites.md`, and for stock-specific claims, official announcements.
6. Compare with price/volume and sector move. Do not call it the cause unless timing and source quality support it.
7. Output should say: “1小时内看到什么、证据等级、可能影响路径、还缺什么确认”。

## One-Day Review Procedure

1. Run direct feed scan with `--hours 24`.
2. Add web search:

```text
{关键词} 最新消息 site:finance.eastmoney.com
{关键词} site:finance.sina.com.cn
{关键词} 财联社
{股票名} {代码} 公告 site:cninfo.com.cn
```

3. Use `web-search-sites.md` to prioritize official/credible domains and exclude social chatter, SEO reposts, AI summaries, and unverifiable snippets.
4. De-duplicate syndicated articles.
5. Build a timeline sorted by publish time.
6. Separate:
   - market price facts
   - official events
   - media-reported events
   - analyst/commentary explanations
   - excluded unverified claims

## Decision-Risk Rules

- A one-hour alert can justify attention, not a confident conclusion by itself.
- If news is urgent but only from one public feed, mark confidence no higher than medium.
- If a source says “据悉/知情人士”, exclude it from the conclusion until confirmed by company, exchange, regulator, or multiple credible outlets.
- If the article timestamp is after the price move, say it may be explanation/commentary rather than trigger.
- For commodity and macro news, check USD/rates/futures price reaction before connecting to equities.
- For A-share limit-up explanations, separate official catalyst from market narrative.
