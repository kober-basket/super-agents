#!/usr/bin/env python3
"""Build a Markdown research-pack skeleton from live finance-news hits."""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import probe_sources  # noqa: E402


TYPE_CHECKLISTS = {
    "stock": [
        "确认交易所、代码、名称、所属行业和可比公司。",
        "补充价格/K线、成交额、换手率、资金流和指数/板块相对表现。",
        "核查公告、业绩、研报和主要新闻催化。",
    ],
    "sector": [
        "定义主题边界和成分股池。",
        "比较龙头、弹性标的、估值、业绩和政策/价格催化。",
        "区分真正受益公司和仅有题材关联的公司。",
    ],
    "commodity": [
        "区分现货、期货、ETF、生产商股票和下游股票。",
        "补充美元、利率、供需、库存、政策和地缘风险。",
        "检查商品价格与相关权益资产是否同向反应。",
    ],
    "macro": [
        "优先查官方政策/数据发布时间和原文。",
        "映射到利率、汇率、行业需求、风险偏好和流动性。",
        "列出最直接受影响资产和二阶影响。",
    ],
}


def collect_news(
    target: str,
    max_items: int,
    hours: float | None,
    eastmoney_pages: int = 3,
    eastmoney_page_size: int = 100,
) -> list[dict]:
    pattern = probe_sources.keyword_pattern(target)
    sources = [
        probe_sources.safe_fetch(
            "东方财富快讯雷达",
            lambda: probe_sources.fetch_eastmoney_radar(
                target,
                pattern,
                max_items,
                hours,
                eastmoney_pages,
                eastmoney_page_size,
            ),
        ),
        probe_sources.safe_fetch("东方财富站内新闻搜索", lambda: probe_sources.fetch_eastmoney_search(target, max_items, hours)),
        probe_sources.safe_fetch("新浪财经7x24", lambda: probe_sources.fetch_sina_fast(pattern, max_items, hours)),
        probe_sources.safe_fetch("财联社电报", lambda: probe_sources.fetch_cls(pattern, max_items, hours)),
        probe_sources.safe_fetch("证券时报/人民财讯快讯", lambda: probe_sources.fetch_stcn_fast(pattern, max_items, hours)),
        probe_sources.safe_fetch("南财快讯/21经济网", lambda: probe_sources.fetch_21jingji_fast(pattern, max_items, hours)),
        probe_sources.safe_fetch("同花顺财经直播", lambda: probe_sources.fetch_ths_fast(pattern, max_items, hours)),
        probe_sources.safe_fetch("富途牛牛快讯", lambda: probe_sources.fetch_futu_fast(pattern, max_items, hours)),
    ]
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for source in sources:
        for hit in source.get("hits", []):
            key = (hit.get("title", ""), hit.get("url", ""))
            if key in seen:
                continue
            seen.add(key)
            rows.append(hit)
    return rows


def md_escape(value: object) -> str:
    return str(value or "").replace("|", "\\|").replace("\n", " ").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a market research Markdown skeleton.")
    parser.add_argument("--target", required=True, help="Stock, sector, commodity, index, or event to research.")
    parser.add_argument("--type", default="stock", choices=sorted(TYPE_CHECKLISTS), help="Research target type.")
    parser.add_argument("--fetch", action="store_true", help="Fetch direct finance-news hits.")
    parser.add_argument("--max-items", type=int, default=5, help="Max news hits per source.")
    parser.add_argument("--hours", type=float, default=None, help="Only keep news hits within this many hours.")
    parser.add_argument("--eastmoney-pages", type=int, default=3, help="Eastmoney kuaixun v2 pages to scan.")
    parser.add_argument("--eastmoney-page-size", type=int, default=100, help="Eastmoney kuaixun v2 page size, capped at 100.")
    args = parser.parse_args()

    now = dt.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")
    news = (
        collect_news(args.target, args.max_items, args.hours, args.eastmoney_pages, args.eastmoney_page_size)
        if args.fetch
        else []
    )
    checklist = TYPE_CHECKLISTS[args.type]

    print(f"# {args.target} 股市调研包")
    print()
    print(f"- 生成时间: {now}")
    print(f"- 研究类型: {args.type}")
    if args.fetch and args.hours:
        print(f"- 数据状态: 直接新闻源已抓取，窗口 {args.hours:g} 小时")
    elif args.fetch:
        print("- 数据状态: 直接新闻源已抓取")
    else:
        print("- 数据状态: 未抓取新闻，仅生成框架")
    print("- 结论状态: 待补充行情、公告、基本面与交叉验证")
    print()
    print("## 1. 初步结论")
    print()
    print("- 待写: 用 2-4 句话说明最可能的主线、证据强度和最大不确定性。")
    print()
    print("## 2. 已抓取新闻")
    print()
    print("| 时间 | 来源 | 标题 | 摘要 | 链接 |")
    print("|---|---|---|---|---|")
    if news:
        for hit in news:
            print(
                "| {time} | {source} | {title} | {summary} | {url} |".format(
                    time=md_escape(hit.get("time")),
                    source=md_escape(hit.get("source")),
                    title=md_escape(hit.get("title")),
                    summary=md_escape(hit.get("summary"))[:220],
                    url=md_escape(hit.get("url")),
                )
            )
    else:
        print("| 待补充 | 待补充 | 待补充 | 待补充 | 待补充 |")
    print()
    print("## 3. 必查清单")
    print()
    for item in checklist:
        print(f"- {item}")
    print("- 用 web search 补充东方财富/新浪/财联社/证券时报/公告/官方来源。")
    print("- 对关键事实做至少一次交叉验证。")
    print()
    print("## 4. 待补数据")
    print()
    print("- 行情: 最新价格、涨跌幅、成交额、关键技术位、相对表现。")
    print("- 基本面: 最新财报、估值、盈利质量、行业周期。")
    print("- 公告/政策: 官方链接、发布时间、事件生效时间。")
    print("- 风险: 数据源延迟、未证实消息、政策、流动性、估值、业绩。")
    print()
    print("## 5. 后续跟踪")
    print()
    print("1. 待补充")
    print("2. 待补充")
    print("3. 待补充")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
