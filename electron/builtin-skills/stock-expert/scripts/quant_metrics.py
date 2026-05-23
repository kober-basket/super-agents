#!/usr/bin/env python3
"""Calculate evidence-bound quantitative metrics from local CSV price data."""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


def _to_float(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _returns(values: list[float]) -> list[float]:
    out: list[float] = []
    for previous, current in zip(values, values[1:]):
        if previous == 0:
            continue
        out.append(current / previous - 1.0)
    return out


def _sample_stdev(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(variance)


def _covariance(left: list[float], right: list[float]) -> float | None:
    if len(left) != len(right) or len(left) < 2:
        return None
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    return sum((a - left_mean) * (b - right_mean) for a, b in zip(left, right)) / (len(left) - 1)


def _max_drawdown(prices: list[float]) -> float | None:
    if not prices:
        return None
    peak = prices[0]
    worst = 0.0
    for price in prices:
        peak = max(peak, price)
        if peak:
            worst = min(worst, price / peak - 1.0)
    return worst


def load_csv(path: str | Path) -> list[dict[str, Any]]:
    with Path(path).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def calculate_metrics(
    rows: list[dict[str, Any]],
    risk_free_rate: float = 0.0,
    periods_per_year: int = 252,
) -> dict[str, Any]:
    dates: list[str] = []
    prices: list[float] = []
    benchmark_prices: list[float] = []
    missing: list[str] = []

    for row in rows:
        close = _to_float(row.get("close"))
        if close is None:
            continue
        dates.append(str(row.get("date") or ""))
        prices.append(close)
        benchmark_close = _to_float(row.get("benchmark_close"))
        if benchmark_close is not None:
            benchmark_prices.append(benchmark_close)

    asset_returns = _returns(prices)
    benchmark_returns = _returns(benchmark_prices) if len(benchmark_prices) == len(prices) else []
    stdev = _sample_stdev(asset_returns)
    annual_volatility = stdev * math.sqrt(periods_per_year) if stdev is not None else None

    sharpe_ratio = None
    if stdev and stdev > 0:
        periodic_rf = risk_free_rate / periods_per_year
        excess_mean = sum((value - periodic_rf) for value in asset_returns) / len(asset_returns)
        sharpe_ratio = excess_mean / stdev * math.sqrt(periods_per_year)

    beta = None
    correlation = None
    if benchmark_returns and len(benchmark_returns) == len(asset_returns):
        cov = _covariance(asset_returns, benchmark_returns)
        benchmark_var = _covariance(benchmark_returns, benchmark_returns)
        benchmark_stdev = _sample_stdev(benchmark_returns)
        if cov is not None and benchmark_var and benchmark_var > 0:
            beta = cov / benchmark_var
        if cov is not None and stdev and benchmark_stdev and stdev > 0 and benchmark_stdev > 0:
            correlation = cov / (stdev * benchmark_stdev)
    else:
        missing.append("benchmark_close")

    if len(prices) < 2:
        missing.append("close_history")
    if not asset_returns:
        missing.append("asset_returns")

    result = {
        "data_cutoff": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z"),
        "period_start": dates[0] if dates else None,
        "period_end": dates[-1] if dates else None,
        "observations": len(prices),
        "return_count": len(asset_returns),
        "price_start": prices[0] if prices else None,
        "price_end": prices[-1] if prices else None,
        "momentum": (prices[-1] / prices[0] - 1.0) if len(prices) >= 2 and prices[0] else None,
        "volatility": annual_volatility,
        "sharpe_ratio": sharpe_ratio,
        "max_drawdown": _max_drawdown(prices),
        "beta": beta,
        "correlation": correlation,
        "risk_free_rate_annual": risk_free_rate,
        "periods_per_year": periods_per_year,
        "missing": sorted(set(missing)),
        "note": "Research reference only. Metrics depend on input data quality, period, benchmark, and sampling frequency.",
    }
    return result


def print_markdown(result: dict[str, Any]) -> None:
    print(f"# Quant Metrics ({result['data_cutoff']})")
    print()
    print("| Metric | Value |")
    print("|---|---:|")
    for key in [
        "momentum",
        "volatility",
        "sharpe_ratio",
        "max_drawdown",
        "beta",
        "correlation",
    ]:
        value = result.get(key)
        print(f"| {key} | {'' if value is None else round(value, 6)} |")
    print()
    print(f"- Period: {result.get('period_start')} to {result.get('period_end')}")
    print(f"- Observations: {result.get('observations')}; returns: {result.get('return_count')}")
    print(f"- Missing: {', '.join(result.get('missing') or []) or 'none'}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Calculate stock quant metrics from a CSV file.")
    parser.add_argument("--csv", required=True, help="CSV with columns date, close, and optional benchmark_close.")
    parser.add_argument("--risk-free-rate", type=float, default=0.0, help="Annual risk-free rate as decimal, e.g. 0.04.")
    parser.add_argument("--periods-per-year", type=int, default=252, help="Annualization periods, e.g. 252 daily.")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of Markdown.")
    args = parser.parse_args()

    result = calculate_metrics(
        load_csv(args.csv),
        risk_free_rate=args.risk_free_rate,
        periods_per_year=args.periods_per_year,
    )
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print_markdown(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
