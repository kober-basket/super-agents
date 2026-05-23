#!/usr/bin/env python3
"""Fetch Yahoo chart OHLCV data and compute technical/quant metrics."""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import quant_metrics  # noqa: E402


def fetch_yahoo_chart(symbol: str, range_: str = "1y", interval: str = "1d") -> dict[str, Any]:
    encoded = urllib.parse.quote(symbol, safe="")
    query = urllib.parse.urlencode(
        {
            "range": range_,
            "interval": interval,
            "events": "history",
            "includeAdjustedClose": "true",
        }
    )
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def parse_yahoo_chart(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise ValueError(f"Yahoo chart error: {chart['error']}")
    results = chart.get("result") or []
    if not results:
        raise ValueError("Yahoo chart payload has no result")
    result = results[0]
    timestamps = result.get("timestamp") or []
    indicators = result.get("indicators") or {}
    quote = (indicators.get("quote") or [{}])[0]
    adjclose_values = ((indicators.get("adjclose") or [{}])[0]).get("adjclose") or []
    rows: list[dict[str, Any]] = []

    for index, timestamp in enumerate(timestamps):
        close = _pick(quote, "close", index)
        if close is None:
            continue
        rows.append(
            {
                "date": datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m-%d"),
                "open": _pick(quote, "open", index),
                "high": _pick(quote, "high", index),
                "low": _pick(quote, "low", index),
                "close": close,
                "adjclose": _list_pick(adjclose_values, index) if adjclose_values else close,
                "volume": _pick(quote, "volume", index),
            }
        )

    meta = dict(result.get("meta") or {})
    return rows, meta


def _pick(mapping: dict[str, list[Any]], key: str, index: int) -> Any:
    return _list_pick(mapping.get(key) or [], index)


def _list_pick(values: list[Any], index: int) -> Any:
    try:
        return values[index]
    except IndexError:
        return None


def compute_indicators(rows: list[dict[str, Any]]) -> dict[str, Any]:
    closes = [float(row["close"]) for row in rows if row.get("close") is not None]
    highs = [float(row["high"]) for row in rows if row.get("high") is not None]
    lows = [float(row["low"]) for row in rows if row.get("low") is not None]
    latest = closes[-1] if closes else None

    macd_line, signal_line, histogram = _macd(closes)
    boll_mid, boll_upper, boll_lower = _bollinger(closes, 20)

    return {
        "latest_close": latest,
        "sma_20": _sma(closes, 20),
        "sma_50": _sma(closes, 50),
        "rsi_14": _rsi(closes, 14),
        "macd": macd_line,
        "macd_signal": signal_line,
        "macd_histogram": histogram,
        "bollinger_mid": boll_mid,
        "bollinger_upper": boll_upper,
        "bollinger_lower": boll_lower,
        "atr_14": _atr(highs, lows, closes, 14),
    }


def _sma(values: list[float], window: int) -> float | None:
    if len(values) < window:
        return None
    return sum(values[-window:]) / window


def _rsi(values: list[float], window: int) -> float | None:
    if len(values) <= window:
        return None
    gains: list[float] = []
    losses: list[float] = []
    for previous, current in zip(values[-window - 1 : -1], values[-window:]):
        change = current - previous
        gains.append(max(change, 0.0))
        losses.append(abs(min(change, 0.0)))
    avg_gain = sum(gains) / window
    avg_loss = sum(losses) / window
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _ema_series(values: list[float], window: int) -> list[float]:
    if not values:
        return []
    alpha = 2.0 / (window + 1.0)
    ema_values = [values[0]]
    for value in values[1:]:
        ema_values.append(value * alpha + ema_values[-1] * (1.0 - alpha))
    return ema_values


def _macd(values: list[float]) -> tuple[float | None, float | None, float | None]:
    if len(values) < 26:
        return None, None, None
    ema_12 = _ema_series(values, 12)
    ema_26 = _ema_series(values, 26)
    macd_values = [fast - slow for fast, slow in zip(ema_12, ema_26)]
    signal_values = _ema_series(macd_values, 9)
    line = macd_values[-1]
    signal = signal_values[-1]
    return line, signal, line - signal


def _bollinger(values: list[float], window: int) -> tuple[float | None, float | None, float | None]:
    if len(values) < window:
        return None, None, None
    sample = values[-window:]
    mean = sum(sample) / window
    variance = sum((value - mean) ** 2 for value in sample) / window
    stdev = math.sqrt(variance)
    return mean, mean + 2 * stdev, mean - 2 * stdev


def _atr(highs: list[float], lows: list[float], closes: list[float], window: int) -> float | None:
    if len(highs) < window + 1 or len(lows) < window + 1 or len(closes) < window + 1:
        return None
    true_ranges: list[float] = []
    for idx in range(1, len(closes)):
        true_ranges.append(
            max(
                highs[idx] - lows[idx],
                abs(highs[idx] - closes[idx - 1]),
                abs(lows[idx] - closes[idx - 1]),
            )
        )
    return sum(true_ranges[-window:]) / window


def build_payload(
    rows: list[dict[str, Any]],
    meta: dict[str, Any],
    benchmark_rows: list[dict[str, Any]] | None = None,
    risk_free_rate: float = 0.0,
) -> dict[str, Any]:
    metric_rows: list[dict[str, Any]] = []
    benchmark_by_date = {row["date"]: row for row in benchmark_rows or []}
    for row in rows:
        metric_row = {"date": row["date"], "close": row.get("adjclose") or row.get("close")}
        benchmark_row = benchmark_by_date.get(row["date"])
        if benchmark_row:
            metric_row["benchmark_close"] = benchmark_row.get("adjclose") or benchmark_row.get("close")
        metric_rows.append(metric_row)

    return {
        "data_cutoff": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z"),
        "meta": {
            "symbol": meta.get("symbol"),
            "currency": meta.get("currency"),
            "exchange": meta.get("exchangeName") or meta.get("fullExchangeName"),
            "timezone": meta.get("exchangeTimezoneName"),
        },
        "history_count": len(rows),
        "latest": rows[-1] if rows else None,
        "technical_indicators": compute_indicators(rows),
        "quant_metrics": quant_metrics.calculate_metrics(metric_rows, risk_free_rate=risk_free_rate),
        "history": rows,
        "note": "Research reference only. Yahoo Finance data may be delayed or adjusted; cross-check decision-critical values.",
    }


def build_batch_payload(
    entries: list[tuple[str, list[dict[str, Any]], dict[str, Any]]],
    benchmark_rows: list[dict[str, Any]] | None = None,
    risk_free_rate: float = 0.0,
    sort_by: str = "sharpe_ratio",
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for requested_symbol, rows, meta in entries:
        payload = build_payload(rows, meta, benchmark_rows=benchmark_rows, risk_free_rate=risk_free_rate)
        quant = payload["quant_metrics"]
        technical = payload["technical_indicators"]
        latest = payload["latest"] or {}
        items.append(
            {
                "symbol": meta.get("symbol") or requested_symbol,
                "requested_symbol": requested_symbol,
                "currency": meta.get("currency"),
                "exchange": meta.get("exchangeName") or meta.get("fullExchangeName"),
                "latest_date": latest.get("date"),
                "latest_close": latest.get("close"),
                "momentum": quant.get("momentum"),
                "volatility": quant.get("volatility"),
                "sharpe_ratio": quant.get("sharpe_ratio"),
                "max_drawdown": quant.get("max_drawdown"),
                "beta": quant.get("beta"),
                "correlation": quant.get("correlation"),
                "rsi_14": technical.get("rsi_14"),
                "sma_20": technical.get("sma_20"),
                "history_count": payload["history_count"],
                "missing": quant.get("missing", []),
            }
        )

    reverse = sort_by not in {"volatility", "max_drawdown", "beta_low"}
    key_name = "beta" if sort_by == "beta_low" else sort_by
    items.sort(key=lambda item: _sort_value(item.get(key_name), reverse), reverse=reverse)
    return {
        "data_cutoff": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z"),
        "count": len(items),
        "sort_by": sort_by,
        "items": items,
        "note": "Research reference only. Batch rankings depend on symbol universe, benchmark, period, and data quality.",
    }


def _sort_value(value: Any, reverse: bool) -> float:
    if value is None:
        return float("-inf") if reverse else float("inf")
    return float(value)


def print_markdown(payload: dict[str, Any], max_rows: int) -> None:
    meta = payload["meta"]
    print(f"# Market History: {meta.get('symbol') or ''}")
    print()
    print(f"- Data cutoff: {payload['data_cutoff']}")
    print(f"- Exchange: {meta.get('exchange')}; Currency: {meta.get('currency')}; Timezone: {meta.get('timezone')}")
    print(f"- History rows: {payload['history_count']}")
    print()
    print("## Technical Indicators")
    print()
    print("| Indicator | Value |")
    print("|---|---:|")
    for key, value in payload["technical_indicators"].items():
        print(f"| {key} | {'' if value is None else round(value, 6)} |")
    print()
    print("## Recent Rows")
    print()
    print("| Date | Open | High | Low | Close | Volume |")
    print("|---|---:|---:|---:|---:|---:|")
    for row in payload["history"][-max_rows:]:
        print(f"| {row['date']} | {row.get('open')} | {row.get('high')} | {row.get('low')} | {row.get('close')} | {row.get('volume')} |")
    print()


def print_batch_markdown(payload: dict[str, Any]) -> None:
    print(f"# Market History Batch ({payload['data_cutoff']})")
    print()
    print(f"- Count: {payload['count']}")
    print(f"- Sort by: {payload['sort_by']}")
    print()
    print("| Symbol | Date | Close | Momentum | Volatility | Sharpe | Max DD | Beta | RSI14 | Missing |")
    print("|---|---|---:|---:|---:|---:|---:|---:|---:|---|")
    for item in payload["items"]:
        print(
            "| {symbol} | {date} | {close} | {momentum} | {volatility} | {sharpe} | {drawdown} | {beta} | {rsi} | {missing} |".format(
                symbol=item.get("symbol", ""),
                date=item.get("latest_date", ""),
                close=_fmt(item.get("latest_close")),
                momentum=_fmt(item.get("momentum")),
                volatility=_fmt(item.get("volatility")),
                sharpe=_fmt(item.get("sharpe_ratio")),
                drawdown=_fmt(item.get("max_drawdown")),
                beta=_fmt(item.get("beta")),
                rsi=_fmt(item.get("rsi_14")),
                missing=", ".join(item.get("missing") or []),
            )
        )
    print()


def _fmt(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return str(round(float(value), 6))
    return str(value)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch Yahoo OHLCV and compute technical/quant metrics.")
    parser.add_argument("--symbol", default="", help="Yahoo symbol, e.g. AAPL, NVDA, 0700.HK, 600519.SS.")
    parser.add_argument("--symbols", default="", help="Comma-separated Yahoo symbols for batch ranking.")
    parser.add_argument("--benchmark", default="", help="Optional Yahoo benchmark symbol for beta/correlation, e.g. SPY.")
    parser.add_argument("--range", default="1y", help="Yahoo range, e.g. 6mo, 1y, 5y.")
    parser.add_argument("--interval", default="1d", help="Yahoo interval, e.g. 1d, 1wk.")
    parser.add_argument("--risk-free-rate", type=float, default=0.0, help="Annual risk-free rate as decimal.")
    parser.add_argument("--fixture", default="", help="Read Yahoo chart payload from a fixture JSON instead of network.")
    parser.add_argument("--json", action="store_true", help="Output JSON.")
    parser.add_argument("--max-rows", type=int, default=10, help="Recent rows to show in Markdown output.")
    parser.add_argument(
        "--sort-by",
        default="sharpe_ratio",
        choices=["sharpe_ratio", "momentum", "volatility", "max_drawdown", "beta", "beta_low", "rsi_14"],
        help="Batch sort metric.",
    )
    args = parser.parse_args()

    benchmark_rows = None
    if args.benchmark:
        benchmark_payload = fetch_yahoo_chart(args.benchmark, args.range, args.interval)
        benchmark_rows, _ = parse_yahoo_chart(benchmark_payload)

    if args.symbols:
        entries = []
        for symbol in [item.strip() for item in args.symbols.split(",") if item.strip()]:
            rows, meta = parse_yahoo_chart(fetch_yahoo_chart(symbol, args.range, args.interval))
            entries.append((symbol, rows, meta))
        output = build_batch_payload(
            entries,
            benchmark_rows=benchmark_rows,
            risk_free_rate=args.risk_free_rate,
            sort_by=args.sort_by,
        )
        if args.json:
            print(json.dumps(output, ensure_ascii=False, indent=2))
        else:
            print_batch_markdown(output)
        return 0

    if args.fixture:
        payload = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
    elif args.symbol:
        payload = fetch_yahoo_chart(args.symbol, args.range, args.interval)
    else:
        parser.error("Either --symbol or --fixture is required")

    rows, meta = parse_yahoo_chart(payload)
    output = build_payload(rows, meta, benchmark_rows=benchmark_rows, risk_free_rate=args.risk_free_rate)

    if args.json:
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print_markdown(output, args.max_rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
