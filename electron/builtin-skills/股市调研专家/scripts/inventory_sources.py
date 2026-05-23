#!/usr/bin/env python3
"""Inventory local stock-research capabilities without importing project dependencies."""

from __future__ import annotations

import json
import os
import re
import sys
import argparse
from pathlib import Path
from typing import Any


DEFAULT_GITHUB_ROOT = Path.home() / "Desktop" / "github"
AKSHARE_ROOT = Path(os.environ.get("AKSHARE_ROOT", str(DEFAULT_GITHUB_ROOT / "akshare"))).expanduser()
DAILY_ROOT = Path(os.environ.get("DAILY_STOCK_ANALYSIS_ROOT", str(DEFAULT_GITHUB_ROOT / "daily_stock_analysis"))).expanduser()

ENV_GROUPS = {
    "structured_data": ["TUSHARE_TOKEN"],
    "broker_or_market_api": [
        "LONGBRIDGE_APP_KEY",
        "LONGBRIDGE_APP_SECRET",
        "LONGBRIDGE_ACCESS_TOKEN",
        "TICKFLOW_API_KEY",
    ],
    "thsdk_optional": [
        "THS_USERNAME",
        "THS_PASSWORD",
        "THS_MAC",
    ],
    "search_news": [
        "ANSPIRE_API_KEYS",
        "BOCHA_API_KEYS",
        "SERPAPI_API_KEYS",
        "TAVILY_API_KEYS",
        "BRAVE_API_KEYS",
        "MINIMAX_API_KEYS",
        "SEARXNG_BASE_URLS",
    ],
    "llm": [
        "OPENAI_API_KEY",
        "DEEPSEEK_API_KEY",
        "GEMINI_API_KEY",
        "ANTHROPIC_API_KEY",
        "AIHUBMIX_API_KEY",
        "ANSPIRE_API_KEYS",
    ],
}

AKSHARE_PATTERNS = {
    "news": r"news|快讯|财联社|新浪财经|东方财富|同花顺|南财|21经济|21jingji|futu|cctv|baidu",
    "quotes": r"hist|quote|行情|kline|stock_zh|stock_hk|stock_us",
    "fundamentals": r"financial|indicator|balance|income|cash|财务|利润|资产负债",
    "announcements": r"公告|notice|cninfo|disclosure",
    "research_reports": r"research|report|研报",
    "macro": r"macro|央行|统计局|gdp|cpi|pmi|rate|fx|bond|债",
    "funds_etf": r"fund|etf|基金",
    "commodity_futures": r"futures|commodity|期货|黄金|gold|贵金属",
}

DAILY_PATTERNS = {
    "data_providers": r"class .*Fetcher|Fetcher|tushare|akshare|efinance|yfinance|longbridge|baostock|pytdx",
    "search_providers": r"class .*SearchProvider|Anspire|Bocha|Tavily|Brave|SerpAPI|MiniMax|SearXNG",
    "agent_tools": r"ToolDefinition|search_stock_news|stock_news",
    "config_keys": r"API_KEYS|TOKEN|BASE_URLS|SECRET|KEY",
}


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def scan_functions(root: Path, rel_globs: list[str], patterns: dict[str, str]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {key: [] for key in patterns}
    if not root.exists():
        return out

    files: list[Path] = []
    for rel_glob in rel_globs:
        files.extend(root.glob(rel_glob))

    for path in sorted(set(files)):
        if not path.is_file():
            continue
        text = read_text(path)
        rel = str(path.relative_to(root))
        defs = re.findall(r"^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", text, re.M)
        classes = re.findall(r"^class\s+([a-zA-Z_][a-zA-Z0-9_]*)", text, re.M)
        haystack = f"{rel}\n{text[:5000]}"
        for category, pattern in patterns.items():
            if re.search(pattern, haystack, re.I):
                out[category].append(
                    {
                        "file": rel,
                        "defs": defs[:12],
                        "classes": classes[:8],
                    }
                )
    return {key: value for key, value in out.items() if value}


def env_status() -> dict[str, dict[str, bool]]:
    return {
        group: {name: bool(os.environ.get(name)) for name in names}
        for group, names in ENV_GROUPS.items()
    }


def project_status(root: Path) -> dict[str, Any]:
    return {
        "path": str(root),
        "present": root.exists(),
        "readme": (root / "README.md").exists(),
        "git": (root / ".git").exists(),
    }


def build_inventory(include_capabilities: bool = False) -> dict[str, Any]:
    inventory = {
        "projects": {
            "akshare": project_status(AKSHARE_ROOT),
            "daily_stock_analysis": project_status(DAILY_ROOT),
        },
        "skill_scripts": {
            "probe_sources": "Live public finance-news feed sweep with optional 1h/24h window.",
            "probe_thsdk": "Optional THSDK intraday/technical smoke probe when thsdk is installed.",
            "watchlist_radar": "Real A-share Tencent quote snapshot and target/stop checker.",
            "build_report_skeleton": "Markdown research-pack skeleton from real news hits.",
            "inventory_sources": "Local project and environment capability inventory.",
        },
        "environment": env_status(),
    }
    if include_capabilities:
        inventory["akshare_capabilities"] = scan_functions(
            AKSHARE_ROOT,
            [
                "akshare/news/*.py",
                "akshare/stock/*.py",
                "akshare/stock_feature/*.py",
                "akshare/macro/*.py",
                "akshare/futures/*.py",
                "akshare/fund/*.py",
                "akshare/bond/*.py",
            ],
            AKSHARE_PATTERNS,
        )
        inventory["daily_stock_analysis_capabilities"] = scan_functions(
            DAILY_ROOT,
            [
                "data_provider/*.py",
                "src/*.py",
                "src/agent/tools/*.py",
                "config/*.py",
            ],
            DAILY_PATTERNS,
        )
    return inventory


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventory local stock-research capabilities.")
    parser.add_argument("--full", action="store_true", help="Also scan local project functions/classes; output can be large.")
    args = parser.parse_args()
    inventory = build_inventory(include_capabilities=args.full)
    try:
        print(json.dumps(inventory, ensure_ascii=False, indent=2))
    except BrokenPipeError:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
