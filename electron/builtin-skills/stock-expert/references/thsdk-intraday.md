# THSDK Intraday Adapter

Use this reference when the user asks about intraday moves, minute K-lines, order book, large-order flow, call auction, sector heat, iWenCai-style screening, or market microstructure clues.

## Positioning

THSDK is an optional intraday and technical-data adapter. Treat it as a same-day signal source, not as a primary source for corporate facts, filings, financial statements, or investment conclusions.

Good uses:

- A-share minute K-lines, intraday time-share, tick-like snapshots, five-level order book, large-order flow, and call-auction anomalies.
- Sector and concept lists, constituent discovery, and quick sector heat checks.
- iWenCai natural-language screening as a candidate generator.
- Same-day technical confirmation after news or price moves are already identified.

Avoid using it for:

- Official announcements, earnings confirmation, regulatory/policy facts, financial-statement facts, or final causal attribution.
- Low-latency trading decisions without a licensed feed.
- Unverified iWenCai-style screening results as direct evidence.

## Account And Cost Model

THSDK does not use an API-key string by default.

| Mode | Config | Expected use | Caveat |
|---|---|---|---|
| Temporary visitor | No config | Smoke tests and light research | May fail, be delayed, have market/field limits, or change without notice |
| THS account | `THS_USERNAME`, `THS_PASSWORD`, optional `THS_MAC` | More stable use if available | Account permissions determine data access |
| Official iFinD API | iFinD username/password or refresh token | Professional structured data | Separate official product; do not confuse with THSDK |

Never expose account values. Only report whether required environment variables are present.

## Validated Capability Classes

These classes were verified as structurally useful in visitor mode. Future runs may vary by permissions, market hours, and server-side changes.

| Capability | Methods | Use in reports |
|---|---|---|
| Code resolution | `search_symbols`, `complete_ths_code` | Resolve Chinese names/codes before fetching data |
| A-share quotes | `market_data_cn` | Price/volume cross-check and intraday context |
| K-lines | `klines` with `1m/5m/15m/30m/60m/120m/day` | Technical context; support/resistance; volume pattern |
| Intraday/time-share | `intraday_data`, `min_snapshot` | Timeline of same-day move |
| Order book/tick | `depth`, `tick_level1`, `tick_super_level1` | Liquidity and order-book clues; filter invalid sentinel values |
| Large-order flow | `big_order_flow` | Funding-pressure clue, not standalone proof |
| Call auction | `call_auction`, `call_auction_anomaly` | Opening pressure and unusual auction behavior |
| Sector/concept | `ths_industry`, `ths_concept`, `block_constituents`, `market_data_block` | Sector mapping and heat clues |
| News/flash | `news` | Same-day headline supplement; cross-check with direct feeds and web search |
| iWenCai screening | `wencai_nlp` | Candidate generation and field discovery; verify before conclusion |

## Rules

- Resolve codes first. Do not rely on hardcoded THSCODE examples for indices, HK stocks, or special markets; call list/search methods and then fetch.
- For A-share batch quote calls, group by market prefix. Do not mix `USHA`, `USZA`, and `USTM` in one `market_data_cn` request.
- Use valid K-line intervals: `1m`, `5m`, `15m`, `30m`, `60m`, `120m`, `day`, `week`, `month`, `quarter`, `year`.
- Filter invalid sentinel values such as `2147483648` and `4294967295` before interpreting order-book, tick, and indicator fields.
- If a call returns empty data during non-trading hours, say so and fall back to daily K-line, previous trading day, or another source.
- Treat large-order flow, call-auction anomalies, sector heat, and iWenCai results as clues. Cross-check with price/volume, announcements, direct news feeds, and web search before making a conclusion.
- For HK/US/global quotes, prefer Longbridge/YFinance/official sources when available; use THSDK as a supplement because permissions and code formats can be uneven.

## Recommended Workflow

1. Run a small smoke check:

```bash
python3 scripts/probe_thsdk.py --symbol 同花顺 --mode smoke --json
```

2. For a same-day move, run:

```bash
python3 scripts/probe_thsdk.py --symbol 300033 --mode intraday --json
```

3. Compare the quote with `watchlist_radar.py` or another quote source.
4. Match intraday timestamps against news/announcement timelines.
5. Report THSDK output as `optional THSDK intraday signal`, not as primary evidence.
