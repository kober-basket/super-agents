# Report Framework

## One-Hour Alert

Use when the user says news is decision-critical, asks “1小时内/刚刚/盘中/突发”, or wants a catalyst radar.

```markdown
**1小时新闻雷达**
观察窗口: {YYYY-MM-DD HH:mm} 至 {YYYY-MM-DD HH:mm} {TZ}
关键词: {target / keywords}

| 时间 | 来源 | 事件 | 证据等级 | 可能影响路径 | 链接 |
|---|---|---|---|---|---|

**初步判断**
- Confirmed:
- Likely:
- Excluded unverified claims:

**交易/决策风险**
- 尚未确认:
- 价格是否已反应:
- 需要继续盯:

```

## Fast Brief

Use for quick questions like “黄金现在怎么了” or “这票今天为什么涨”.

```markdown
**结论**
[1-3 sentences. Distinguish confirmed facts from likely interpretation.]

**最新事实**
| 时间 | 来源 | 事实 | 链接 |
|---|---|---|---|

**价格/资金**
- 最新价格/涨跌幅/成交额:
- 关键技术位置:
- 板块或同类资产表现:

**可能原因**
1. Confirmed catalyst:
2. Secondary factor:
3. Weak/unverified factor:

**后续看点**
- [observable signal]
- [data release / filing / earnings / policy event]

```

## Full Research Report

Use when the user asks for a report, a serious comparison, or a decision memo.

```markdown
# {Target} 股市调研报告

生成时间: {YYYY-MM-DD HH:mm TZ}
研究范围: {market / symbols / horizon}
数据截止: {latest observed timestamp}

## 1. 核心结论

- Thesis:
- Main evidence:
- Biggest uncertainty:
- What would change the view:

## 2. 关键数据快照

| Item | Value | Time/Period | Source |
|---|---:|---|---|

## 3. 价格、成交与技术结构

- Trend:
- Support/resistance:
- Volume/turnover confirmation:
- Relative strength vs sector/index:

## 4. 新闻、公告与催化

| Time | Source | Event | Confirmed? | Impact path |
|---|---|---|---|---|

## 5. 基本面与估值

- Business drivers:
- Latest financials:
- Margin/cash-flow/quality:
- Valuation vs history/peers:

## 6. 行业与宏观环境

- Sector cycle:
- Policy:
- Rates/FX/commodity inputs:
- Supply-demand:

## 7. 情景分析

| Scenario | Conditions | Upside/downside mechanism | Signals to watch |
|---|---|---|---|
| Bull | | | |
| Base | | | |
| Bear | | | |

## 8. 风险与反证

- Data quality:
- Event risk:
- Earnings/fundamental risk:
- Valuation/liquidity risk:
- What evidence would disprove the thesis:

## 9. 后续跟踪清单

1. 
2. 
3. 

## 10. 来源与可信度

| Source | Type | Reliability | Notes |
|---|---|---|---|

```

## Scoring Template

Only score when useful. Keep scores explainable and evidence-tied.

| Dimension | Weight | Score | Evidence |
|---|---:|---:|---|
| Trend/technical | 15% | | |
| Fundamentals | 20% | | |
| Valuation | 15% | | |
| Catalyst strength | 20% | | |
| News/sentiment quality | 10% | | |
| Liquidity/risk | 10% | | |
| Macro/sector alignment | 10% | | |

Only provide buy/sell or allocation decision frameworks when the user explicitly asks for that lens; keep them evidence-tied and avoid certainty language.

## Comparison Template

Use for “A vs B”, multi-stock tables, or mixed-language comparison requests.

```markdown
**对比结论**
[1-3 sentences. State the chosen lens: valuation, growth, risk, technicals, or portfolio fit.]

数据截止: {YYYY-MM-DD HH:mm TZ}
口径: {currency / exchange / quote delay / financial period}

| Item | {Asset A} | {Asset B} | Interpretation |
|---|---:|---:|---|
| Price move | | | |
| Revenue/profit growth | | | |
| Margin/cash flow | | | |
| Valuation | | | |
| Balance-sheet risk | | | |
| Catalyst/risk | | | |

**不确定性**
- Missing/conflicting data:
- What would change the view:

```

## Portfolio / Position Response

Use when the user gives holdings, asks whether to sell/keep one, mentions losses, or asks for allocation.

```markdown
**组合判断**
[Tie answer to stated risk preference, horizon, drawdown tolerance, and concentration.]

已知条件: {holdings / risk preference / horizon / constraints}
数据截止: {YYYY-MM-DD HH:mm TZ}

| Holding/theme | Current role | Key risk | Evidence to check | Possible action framework |
|---|---|---|---|---|

**调仓框架**
- Risk budget:
- Diversification issue:
- Rebalance trigger:
- Stop/review trigger:

**不做的事**
- 不基于传闻、保证收益、贷款加仓或单票 all-in 给建议。

```

## JSON Output Contract

When the user requests JSON, output valid JSON only:

```json
{
  "data_cutoff": "YYYY-MM-DD HH:mm TZ",
  "market": "US/HK/A-share/other",
  "assumptions": [],
  "items": [
    {
      "symbol": "string",
      "name": "string",
      "currency": "string|null",
      "price": null,
      "change_percent": null,
      "thesis": "string",
      "risks": [],
      "confidence": "low|medium|high"
    }
  ],
  "sources": [],
  "confidence_notes": []
}
```

No Markdown fences, comments, trailing commas, or prose outside JSON in the final answer.

## Risk Flags

Use these as flags, not automatic conclusions:

| Flag | Trigger | Evidence required |
|---|---|---|
| Pre-earnings | Earnings/report date within 14 calendar days | Official calendar or company/exchange source |
| Post-spike | Large recent move, e.g. >15% in 5 trading days | Price/K-line source |
| Overbought/oversold | RSI/extreme range/near 52-week high or low | Calculated from quote history |
| Volume anomaly | Turnover or volume materially above recent average | K-line/volume source |
| News shock | Confirmed event inside 1h/24h window | Dated news and preferably official/source article |
| Disclosure risk | Announcement, inquiry letter, suspension, litigation, penalty | Official disclosure |
| Macro risk | Rates, FX, commodity, policy, geopolitics affecting thesis | Primary or credible news source |

Never let a flag become a recommendation by itself. It is a prompt for deeper verification.

## Gold / Commodity Checklist

For gold, silver, oil, copper, and related equities:

- Spot and futures price, daily move, intraday range.
- USD index, US Treasury yields, real yields, Fed expectations.
- Geopolitical and safe-haven events.
- ETF flows and central-bank demand where available.
- Physical demand/import policy for large consumers.
- Related equities/ETFs: miners, jewelry, commodity ETFs, futures contracts.
- Local market basis: SHFE/SGE vs international spot if relevant.

## Evidence Discipline

- A headline is evidence of publication, not proof of causality.
- A price move is evidence of market reaction, not proof of why it moved.
- Analyst commentary is interpretation; mark it lower than official filings or data.
- If the same article is syndicated across sites, count it as one source family.
- If timestamps conflict, state the conflict and prefer the original publisher.
