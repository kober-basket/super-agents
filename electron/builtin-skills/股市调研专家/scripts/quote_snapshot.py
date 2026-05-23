#!/usr/bin/env python3
"""Fetch Yahoo chart quote snapshots and compare current moves."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json,text/plain,*/*"}


def fetch_yahoo_chart(symbol: str, range_: str = "1d", interval: str = "1m") -> dict[str, Any]:
    encoded = urllib.parse.quote(symbol, safe="")
    params = urllib.parse.urlencode({"range": range_, "interval": interval, "includePrePost": "true"})
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?{params}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def parse_yahoo_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    chart = payload.get("chart", {})
    if chart.get("error"):
        raise ValueError(f"Yahoo chart error: {chart['error']}")
    results = chart.get("result") or []
    if not results:
        raise ValueError("Yahoo chart payload has no result")

    result = results[0]
    meta = result.get("meta", {})
    timestamps = result.get("timestamp") or []
    quote = (result.get("indicators", {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []

    latest_time, latest_close = latest_non_null(timestamps, closes)
    price = _to_float(meta.get("regularMarketPrice")) or latest_close
    previous_close = _to_float(meta.get("chartPreviousClose")) or _to_float(meta.get("previousClose"))
    change = price - previous_close if price is not None and previous_close not in (None, 0) else None
    change_percent = (change / previous_close * 100) if change is not None and previous_close not in (None, 0) else None

    offset = int(meta.get("gmtoffset") or 0)
    return {
        "symbol": meta.get("symbol", ""),
        "name": meta.get("shortName") or meta.get("longName") or "",
        "currency": meta.get("currency", ""),
        "exchange": meta.get("exchangeName", ""),
        "instrument_type": meta.get("instrumentType", ""),
        "price": _round(price),
        "previous_close": _round(previous_close),
        "change": _round(change),
        "change_percent": _round(change_percent),
        "day_high": _round(_max_number(quote.get("high") or [])),
        "day_low": _round(_min_number(quote.get("low") or [])),
        "volume": _last_non_null(quote.get("volume") or []),
        "intraday_points": len(timestamps),
        "latest_bar_time": format_timestamp(latest_time, offset) if latest_time is not None else "",
        "regular_market_time": format_timestamp(meta.get("regularMarketTime"), offset)
        if meta.get("regularMarketTime") is not None
        else "",
        "market_phase": market_phase_at(meta, latest_time),
        "source": "Yahoo chart endpoint",
    }


def latest_non_null(timestamps: list[Any], values: list[Any]) -> tuple[int | None, float | None]:
    for index in range(min(len(timestamps), len(values)) - 1, -1, -1):
        value = _to_float(values[index])
        if value is not None:
            return int(timestamps[index]), value
    return None, None


def market_phase_at(meta: dict[str, Any], timestamp: int | None) -> str:
    if timestamp is None:
        return "unknown"
    periods = meta.get("currentTradingPeriod") or {}
    for phase in ("regular", "pre", "post"):
        period = periods.get(phase) or {}
        start = period.get("start")
        end = period.get("end")
        if isinstance(start, int) and isinstance(end, int) and start <= timestamp < end:
            return phase
    return "closed"


def format_timestamp(timestamp: Any, offset_seconds: int) -> str:
    try:
        value = int(timestamp)
    except (TypeError, ValueError):
        return ""
    timezone = dt.timezone(dt.timedelta(seconds=offset_seconds))
    return dt.datetime.fromtimestamp(value, timezone).isoformat(timespec="seconds")


def build_payload(quotes: list[dict[str, Any]], compare: bool = False) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "retrieved_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "count": len(quotes),
        "quotes": quotes,
        "note": "Research reference only. Yahoo quotes may be delayed; cross-check decision-critical data.",
    }
    if compare:
        ranked = sorted(
            quotes,
            key=lambda item: item.get("change_percent") if item.get("change_percent") is not None else float("-inf"),
            reverse=True,
        )
        payload["ranking_by_change_percent"] = [
            {
                "symbol": item.get("symbol"),
                "name": item.get("name"),
                "change_percent": item.get("change_percent"),
                "price": item.get("price"),
                "currency": item.get("currency"),
            }
            for item in ranked
        ]
    return payload


def render_markdown(payload: dict[str, Any]) -> str:
    lines = [
        f"# Quote Snapshot ({payload['retrieved_at']})",
        "",
        "| Symbol | Name | Price | Change % | High | Low | Phase | Latest bar | Source |",
        "|---|---|---:|---:|---:|---:|---|---|---|",
    ]
    for quote in payload["quotes"]:
        lines.append(
            "| {symbol} | {name} | {price} {currency} | {change_percent} | {day_high} | {day_low} | {phase} | {latest} | {source} |".format(
                symbol=quote.get("symbol", ""),
                name=_md_cell(quote.get("name", "")),
                price=quote.get("price", ""),
                currency=quote.get("currency", ""),
                change_percent=quote.get("change_percent", ""),
                day_high=quote.get("day_high", ""),
                day_low=quote.get("day_low", ""),
                phase=quote.get("market_phase", ""),
                latest=quote.get("latest_bar_time", ""),
                source=quote.get("source", ""),
            )
        )
    if payload.get("ranking_by_change_percent"):
        lines.extend(["", "## Ranking By Change %", "", "| Rank | Symbol | Change % | Price |", "|---:|---|---:|---:|"])
        for index, item in enumerate(payload["ranking_by_change_percent"], start=1):
            lines.append(f"| {index} | {item['symbol']} | {item['change_percent']} | {item['price']} {item['currency']} |")
    lines.extend(["", payload["note"], ""])
    return "\n".join(lines)


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _round(value: float | None) -> float | None:
    return round(value, 6) if value is not None else None


def _last_non_null(values: list[Any]) -> Any:
    for value in reversed(values):
        if value is not None:
            return value
    return None


def _max_number(values: list[Any]) -> float | None:
    numbers = [_to_float(value) for value in values]
    present = [value for value in numbers if value is not None]
    return max(present) if present else None


def _min_number(values: list[Any]) -> float | None:
    numbers = [_to_float(value) for value in values]
    present = [value for value in numbers if value is not None]
    return min(present) if present else None


def _md_cell(value: object) -> str:
    return str(value or "").replace("|", "\\|").replace("\n", "<br>").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch quote snapshots from Yahoo chart data.")
    parser.add_argument("--symbols", default="", help="Comma-separated Yahoo symbols, e.g. AAPL,NVDA,BTC-USD,^IXIC.")
    parser.add_argument("--range", dest="range_", default="1d", help="Yahoo chart range, default 1d.")
    parser.add_argument("--interval", default="1m", help="Yahoo chart interval, default 1m.")
    parser.add_argument("--fixture", default="", help="Read one Yahoo chart JSON fixture instead of fetching.")
    parser.add_argument("--compare", action="store_true", help="Rank returned symbols by change percent.")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of Markdown.")
    args = parser.parse_args()

    quotes: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    if args.fixture:
        payload = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
        quotes.append(parse_yahoo_snapshot(payload))
    else:
        symbols = [item.strip() for item in args.symbols.split(",") if item.strip()]
        if not symbols:
            parser.error("--symbols is required unless --fixture is provided")
        for symbol in symbols:
            try:
                quotes.append(parse_yahoo_snapshot(fetch_yahoo_chart(symbol, args.range_, args.interval)))
            except Exception as exc:  # noqa: BLE001 - diagnostic utility
                errors.append({"symbol": symbol, "error": f"{type(exc).__name__}: {exc}"})

    payload = build_payload(quotes, compare=args.compare)
    if errors:
        payload["errors"] = errors

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(payload))
        if errors:
            print("## Errors")
            for error in errors:
                print(f"- {error['symbol']}: {error['error']}")
    return 0 if quotes else 1


if __name__ == "__main__":
    sys.exit(main())
