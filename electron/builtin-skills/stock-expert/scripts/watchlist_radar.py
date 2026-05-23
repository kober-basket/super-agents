#!/usr/bin/env python3
"""Real-data A-share quote watchlist and target/stop checker."""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime
from typing import Any


def normalize_a_symbol(symbol: str) -> str:
    value = symbol.strip().lower()
    if value.startswith(("sh", "sz", "bj")):
        return value
    if value.startswith(("6", "5", "9")):
        return f"sh{value}"
    if value.startswith(("8", "4")):
        return f"bj{value}"
    return f"sz{value}"


def parse_levels(raw: str | None) -> dict[str, float]:
    levels: dict[str, float] = {}
    if not raw:
        return levels
    for item in raw.split(","):
        if not item.strip():
            continue
        if "=" not in item:
            raise ValueError(f"Invalid level '{item}', expected SYMBOL=PRICE")
        symbol, price = item.split("=", 1)
        levels[normalize_a_symbol(symbol)] = float(price)
    return levels


def fetch_tencent_quote(symbol: str) -> dict[str, Any] | None:
    normalized = normalize_a_symbol(symbol)
    url = f"https://qt.gtimg.cn/q={normalized}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as response:
        raw = response.read()
    try:
        text = raw.decode("gbk", errors="ignore").strip()
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="ignore").strip()
    match = re.search(r'"([^"]+)"', text)
    if not match:
        return None
    fields = match.group(1).split("~")
    if len(fields) < 35:
        return None

    def to_float(index: int) -> float | None:
        try:
            return float(fields[index]) if fields[index] else None
        except (IndexError, ValueError):
            return None

    def to_int(index: int) -> int | None:
        try:
            return int(fields[index]) if fields[index] else None
        except (IndexError, ValueError):
            return None

    return {
        "symbol": normalized,
        "name": fields[1],
        "code": fields[2],
        "price": to_float(3),
        "previous_close": to_float(4),
        "open": to_float(5),
        "volume": to_int(6),
        "change": to_float(31),
        "change_percent": to_float(32),
        "high": to_float(33),
        "low": to_float(34),
        "source": "Tencent quote endpoint",
        "retrieved_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z"),
    }


def status_for_quote(quote: dict[str, Any], targets: dict[str, float], stops: dict[str, float]) -> list[str]:
    symbol = quote["symbol"]
    price = quote.get("price")
    statuses: list[str] = []
    if price is None:
        return ["no_price"]
    if symbol in targets and price >= targets[symbol]:
        statuses.append(f"target_hit:{targets[symbol]}")
    if symbol in stops and price <= stops[symbol]:
        statuses.append(f"stop_hit:{stops[symbol]}")
    if quote.get("change_percent") is not None and abs(quote["change_percent"]) >= 5:
        statuses.append("large_daily_move")
    return statuses or ["watch"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Check real A-share quotes against watch levels.")
    parser.add_argument("--symbols", required=True, help="Comma-separated symbols, e.g. 600519,300750,sh688981.")
    parser.add_argument("--targets", default="", help="Comma-separated levels, e.g. 600519=1800,300750=250.")
    parser.add_argument("--stops", default="", help="Comma-separated levels, e.g. 600519=1500,300750=180.")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of Markdown.")
    args = parser.parse_args()

    targets = parse_levels(args.targets)
    stops = parse_levels(args.stops)
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for raw_symbol in [item.strip() for item in args.symbols.split(",") if item.strip()]:
        try:
            quote = fetch_tencent_quote(raw_symbol)
            if not quote:
                errors.append({"symbol": raw_symbol, "error": "no quote returned"})
                continue
            quote["status"] = status_for_quote(quote, targets, stops)
            rows.append(quote)
        except Exception as exc:  # noqa: BLE001 - diagnostic utility
            errors.append({"symbol": raw_symbol, "error": f"{type(exc).__name__}: {exc}"})

    output = {
        "retrieved_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z"),
        "quotes": rows,
        "errors": errors,
        "note": "Research reference only. Cross-check decision-critical quotes with another source.",
    }

    if args.json:
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0

    print(f"# Watchlist Radar ({output['retrieved_at']})")
    print()
    print("| Symbol | Name | Price | Change % | High | Low | Status | Source |")
    print("|---|---|---:|---:|---:|---:|---|---|")
    for quote in rows:
        print(
            "| {symbol} | {name} | {price} | {change_percent} | {high} | {low} | {status} | {source} |".format(
                symbol=quote.get("symbol", ""),
                name=quote.get("name", ""),
                price=quote.get("price", ""),
                change_percent=quote.get("change_percent", ""),
                high=quote.get("high", ""),
                low=quote.get("low", ""),
                status=", ".join(quote.get("status", [])),
                source=quote.get("source", ""),
            )
        )
    if errors:
        print()
        print("## Errors")
        for error in errors:
            print(f"- {error['symbol']}: {error['error']}")
    print()
    print("Research reference only. Cross-check decision-critical quotes with another source.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
