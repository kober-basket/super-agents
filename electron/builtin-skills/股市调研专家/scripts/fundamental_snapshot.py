#!/usr/bin/env python3
"""Fetch Yahoo fundamentals timeseries and compute compact financial metrics."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


METRIC_TYPES = [
    "quarterlyTotalRevenue",
    "quarterlyNetIncome",
    "quarterlyOperatingCashFlow",
    "quarterlyCapitalExpenditure",
    "quarterlyTotalAssets",
    "quarterlyTotalLiabilitiesNetMinorityInterest",
    "quarterlyStockholdersEquity",
    "trailingPeRatio",
]
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json,text/plain,*/*"}


def fetch_yahoo_fundamentals(symbol: str, years: int = 4) -> dict[str, Any]:
    period2 = int(time.time())
    period1 = period2 - int(years * 365.25 * 24 * 60 * 60)
    encoded_symbol = urllib.parse.quote(symbol, safe="")
    params = urllib.parse.urlencode(
        {
            "symbol": symbol,
            "type": ",".join(METRIC_TYPES),
            "merge": "false",
            "period1": period1,
            "period2": period2,
        }
    )
    url = f"https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{encoded_symbol}?{params}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def parse_fundamentals(symbol: str, payload: dict[str, Any]) -> dict[str, Any]:
    series = payload.get("timeseries", {})
    if series.get("error"):
        raise ValueError(f"Yahoo fundamentals error: {series['error']}")
    rows = series.get("result") or []
    metrics: dict[str, dict[str, Any]] = {}
    for row in rows:
        metric = _metric_name(row)
        if not metric or metric not in METRIC_TYPES:
            continue
        values = row.get(metric) or []
        latest = _latest_metric_value(values)
        if latest:
            metrics[metric] = latest

    latest_period = max(
        [
            item["as_of_date"]
            for key, item in metrics.items()
            if key.startswith("quarterly") and item.get("as_of_date")
        ],
        default="",
    )
    return {
        "symbol": symbol,
        "latest_period": latest_period,
        "metrics": metrics,
        "derived": compute_derived(metrics),
        "missing_metrics": [metric for metric in METRIC_TYPES if metric not in metrics],
        "source": "Yahoo fundamentals-timeseries endpoint",
    }


def compute_derived(metrics: dict[str, dict[str, Any]]) -> dict[str, Any]:
    revenue = _raw(metrics, "quarterlyTotalRevenue")
    net_income = _raw(metrics, "quarterlyNetIncome")
    operating_cash_flow = _raw(metrics, "quarterlyOperatingCashFlow")
    capex = _raw(metrics, "quarterlyCapitalExpenditure")
    assets = _raw(metrics, "quarterlyTotalAssets")
    liabilities = _raw(metrics, "quarterlyTotalLiabilitiesNetMinorityInterest")
    equity = _raw(metrics, "quarterlyStockholdersEquity")

    free_cash_flow = None
    if operating_cash_flow is not None and capex is not None:
        free_cash_flow = operating_cash_flow + capex if capex < 0 else operating_cash_flow - capex

    return {
        "free_cash_flow": _money(free_cash_flow, _currency(metrics, "quarterlyOperatingCashFlow")),
        "net_margin": _ratio(net_income, revenue),
        "liabilities_to_assets": _ratio(liabilities, assets),
        "liabilities_to_equity": _ratio(liabilities, equity),
        "quarterly_roe": _ratio(net_income, equity),
    }


def build_payload(items: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "retrieved_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "count": len(items),
        "items": items,
        "note": "Research reference only. Yahoo fundamentals may lag filings; verify decision-critical facts with official reports.",
    }


def render_markdown(payload: dict[str, Any]) -> str:
    lines = [
        f"# Fundamental Snapshot ({payload['retrieved_at']})",
        "",
        "| Symbol | Period | Revenue | Net income | FCF | PE | Net margin | Liabilities/assets | Missing |",
        "|---|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for item in payload["items"]:
        metrics = item["metrics"]
        derived = item["derived"]
        lines.append(
            "| {symbol} | {period} | {revenue} | {net_income} | {fcf} | {pe} | {margin} | {lev} | {missing} |".format(
                symbol=item["symbol"],
                period=item.get("latest_period", ""),
                revenue=_display_metric(metrics.get("quarterlyTotalRevenue")),
                net_income=_display_metric(metrics.get("quarterlyNetIncome")),
                fcf=_display_metric(derived.get("free_cash_flow")),
                pe=_display_metric(metrics.get("trailingPeRatio")),
                margin=_display_ratio(derived.get("net_margin")),
                lev=_display_ratio(derived.get("liabilities_to_assets")),
                missing=", ".join(item.get("missing_metrics", [])) or "-",
            )
        )
    lines.extend(["", payload["note"], ""])
    return "\n".join(lines)


def _metric_name(row: dict[str, Any]) -> str:
    types = row.get("meta", {}).get("type") or []
    return str(types[0]) if types else ""


def _latest_metric_value(values: list[dict[str, Any]]) -> dict[str, Any] | None:
    parsed = []
    for value in values:
        reported = value.get("reportedValue") or {}
        raw = reported.get("raw")
        if raw is None:
            continue
        parsed.append(
            {
                "as_of_date": value.get("asOfDate", ""),
                "period_type": value.get("periodType", ""),
                "currency": value.get("currencyCode", ""),
                "raw": raw,
                "fmt": reported.get("fmt", str(raw)),
            }
        )
    parsed.sort(key=lambda item: item.get("as_of_date", ""))
    return parsed[-1] if parsed else None


def _raw(metrics: dict[str, dict[str, Any]], key: str) -> float | None:
    value = metrics.get(key, {}).get("raw")
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _currency(metrics: dict[str, dict[str, Any]], key: str) -> str:
    return str(metrics.get(key, {}).get("currency", ""))


def _money(raw: float | None, currency: str = "") -> dict[str, Any] | None:
    if raw is None:
        return None
    return {"raw": raw, "fmt": _compact_number(raw), "currency": currency}


def _ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator


def _compact_number(value: float) -> str:
    abs_value = abs(value)
    if abs_value >= 1_000_000_000:
        return f"{value / 1_000_000_000:.2f}B"
    if abs_value >= 1_000_000:
        return f"{value / 1_000_000:.2f}M"
    return f"{value:.2f}"


def _display_metric(metric: dict[str, Any] | None) -> str:
    if not metric:
        return "N/A"
    value = metric.get("fmt")
    currency = metric.get("currency", "")
    return f"{value} {currency}".strip()


def _display_ratio(value: float | None) -> str:
    return "N/A" if value is None else f"{value * 100:.2f}%"


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch compact financial metrics from Yahoo fundamentals timeseries.")
    parser.add_argument("--symbols", default="", help="Comma-separated Yahoo symbols, e.g. AAPL,META,0700.HK.")
    parser.add_argument("--symbol", default="", help="Single symbol, useful with --fixture.")
    parser.add_argument("--years", type=int, default=4, help="Years of history to request.")
    parser.add_argument("--fixture", default="", help="Read one Yahoo fundamentals JSON fixture instead of fetching.")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of Markdown.")
    args = parser.parse_args()

    items: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    if args.fixture:
        symbol = args.symbol or "FIXTURE"
        payload = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
        items.append(parse_fundamentals(symbol, payload))
    else:
        symbols = [item.strip() for item in args.symbols.split(",") if item.strip()]
        if args.symbol:
            symbols.append(args.symbol.strip())
        if not symbols:
            parser.error("--symbols or --symbol is required unless --fixture is provided")
        for symbol in dict.fromkeys(symbols):
            try:
                items.append(parse_fundamentals(symbol, fetch_yahoo_fundamentals(symbol, args.years)))
            except Exception as exc:  # noqa: BLE001 - diagnostic utility
                errors.append({"symbol": symbol, "error": f"{type(exc).__name__}: {exc}"})

    output = build_payload(items)
    if errors:
        output["errors"] = errors
    if args.json:
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(output))
        if errors:
            print("## Errors")
            for error in errors:
                print(f"- {error['symbol']}: {error['error']}")
    return 0 if items else 1


if __name__ == "__main__":
    sys.exit(main())
