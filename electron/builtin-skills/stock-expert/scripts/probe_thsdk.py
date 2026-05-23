#!/usr/bin/env python3
"""Optional THSDK smoke probe for intraday and technical market signals."""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime
from typing import Any, Callable


THS_ENV = ["THS_USERNAME", "THS_PASSWORD", "THS_MAC"]
A_SHARE_PREFIXES = ("USHA", "USZA", "USTM")


def env_status() -> dict[str, bool]:
    return {name: bool(os.environ.get(name)) for name in THS_ENV}


def load_thsdk():
    try:
        from thsdk import THS  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on optional package
        return None, {"type": type(exc).__name__, "message": str(exc)}
    logging.disable(logging.CRITICAL)
    return THS, None


def clean_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): clean_value(val) for key, val in value.items()}
    if isinstance(value, list):
        return [clean_value(item) for item in value]
    return value


def summarize_response(resp: Any, sample_limit: int) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "ok": bool(resp),
        "error": getattr(resp, "error", ""),
    }
    data = getattr(resp, "data", None)
    if isinstance(data, list):
        summary["rows"] = len(data)
        summary["sample"] = clean_value(data[:sample_limit])
    elif isinstance(data, dict):
        summary["keys"] = list(data.keys())[:20]
    elif data is not None:
        summary["data_type"] = type(data).__name__

    try:
        df = resp.df
        summary["df_shape"] = list(df.shape)
        summary["df_columns"] = [str(col) for col in list(df.columns)[:20]]
    except Exception:
        pass

    extra = getattr(resp, "extra", None)
    if extra:
        summary["extra_keys"] = list(extra.keys())[:20]
    return summary


def choose_candidate(candidates: list[dict[str, Any]]) -> tuple[str | None, dict[str, Any]]:
    if not candidates:
        return None, {"strategy": "none", "warning": "no candidates returned"}
    a_shares = [
        item
        for item in candidates
        if str(item.get("THSCODE", "")).startswith(A_SHARE_PREFIXES)
        or any(market in str(item.get("MarketDisplay", "")) for market in ["沪A", "深A", "北交所"])
    ]
    pool = a_shares or candidates
    selected = pool[0]
    return str(selected.get("THSCODE") or selected.get("代码") or ""), {
        "strategy": "prefer_a_share" if a_shares else "first_candidate",
        "selected": clean_value(selected),
        "candidate_count": len(candidates),
    }


def resolve_symbol(ths: Any, symbol: str, sample_limit: int) -> tuple[str | None, dict[str, Any]]:
    raw = symbol.strip()
    upper = raw.upper()
    if re.match(r"^[A-Z]{4}[A-Z0-9]+$", upper):
        return upper, {"input_type": "thscode", "selected": upper}

    if re.fullmatch(r"\d{6}", raw):
        resp = ths.complete_ths_code(raw)
        summary = summarize_response(resp, sample_limit)
        data = getattr(resp, "data", None)
        if bool(resp) and isinstance(data, list) and data:
            code = data[0].get("代码")
            if code:
                summary["input_type"] = "six_digit_code"
                summary["selected"] = code
                return str(code), summary

    resp = ths.search_symbols(raw)
    summary = summarize_response(resp, sample_limit)
    data = getattr(resp, "data", None)
    if bool(resp) and isinstance(data, list):
        selected, selection = choose_candidate(data)
        summary.update(selection)
        return selected, summary
    return None, summary


def quote_call(ths: Any, thscode: str, query_key: str) -> Any:
    if thscode.startswith(A_SHARE_PREFIXES):
        return ths.market_data_cn(thscode, query_key)
    if thscode.startswith("USHI") or thscode.startswith("USZI"):
        return ths.market_data_index(thscode, query_key)
    if thscode.startswith("UHK"):
        return ths.market_data_hk(thscode, query_key)
    if thscode.startswith("UN"):
        return ths.market_data_us(thscode, query_key)
    if thscode.startswith("UFX"):
        return ths.market_data_forex(thscode, query_key)
    if thscode.startswith("UCF"):
        return ths.market_data_future(thscode, query_key)
    return ths.query_securities(thscode)


def run_call(name: str, fn: Callable[[], Any], sample_limit: int) -> dict[str, Any]:
    started = time.time()
    try:
        resp = fn()
        out = summarize_response(resp, sample_limit)
    except Exception as exc:
        out = {"ok": False, "exception": type(exc).__name__, "message": str(exc)}
    out["elapsed_sec"] = round(time.time() - started, 3)
    return out


def markdown_report(result: dict[str, Any]) -> str:
    lines = [
        "# THSDK Probe",
        "",
        f"- available: {result.get('available')}",
        f"- retrieved_at: {result.get('retrieved_at')}",
        f"- env_present: {result.get('env_present')}",
        f"- note: {result.get('note')}",
    ]
    if not result.get("available"):
        lines.append(f"- error: {result.get('error')}")
        return "\n".join(lines)

    resolved = result.get("resolved", {})
    lines.extend(
        [
            "",
            "## Resolved Symbol",
            "",
            f"- requested: {resolved.get('requested')}",
            f"- selected: {resolved.get('selected')}",
            f"- strategy: {resolved.get('strategy') or resolved.get('input_type')}",
        ]
    )
    lines.extend(["", "## Calls", ""])
    for name, payload in result.get("calls", {}).items():
        lines.append(f"### {name}")
        lines.append("")
        lines.append(f"- ok: {payload.get('ok')}")
        if payload.get("error"):
            lines.append(f"- error: {payload.get('error')}")
        if payload.get("rows") is not None:
            lines.append(f"- rows: {payload.get('rows')}")
        if payload.get("df_columns"):
            lines.append(f"- columns: {', '.join(payload.get('df_columns', [])[:8])}")
        if payload.get("elapsed_sec") is not None:
            lines.append(f"- elapsed_sec: {payload.get('elapsed_sec')}")
        lines.append("")
    return "\n".join(lines).rstrip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe optional THSDK intraday/technical capabilities.")
    parser.add_argument("--symbol", default="同花顺", help="Chinese name, 6-digit code, or THSCODE.")
    parser.add_argument("--mode", choices=["smoke", "quote", "kline", "intraday", "deep"], default="smoke")
    parser.add_argument("--query-key", default="基础数据")
    parser.add_argument("--interval", default="5m")
    parser.add_argument("--count", type=int, default=78)
    parser.add_argument("--sample-limit", type=int, default=2)
    parser.add_argument("--wencai-query", default="")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    result: dict[str, Any] = {
        "available": False,
        "retrieved_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "env_present": env_status(),
        "source_tier": "optional_thsdk_intraday_signal",
        "note": "Use as intraday/technical clue only; cross-check decision-critical facts with primary and independent sources.",
    }

    THS, import_error = load_thsdk()
    if import_error:
        result["error"] = import_error
        result["install_hint"] = "Install optional dependency with: pip install thsdk"
        print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else markdown_report(result))
        return 0

    ths = THS()
    try:
        conn = ths.connect(max_retries=1)
        result["connect"] = summarize_response(conn, args.sample_limit)
        if not conn:
            print(json.dumps(result, ensure_ascii=False, indent=2, default=str) if args.json else markdown_report(result))
            return 0
        result["available"] = True

        thscode, resolved = resolve_symbol(ths, args.symbol, args.sample_limit)
        result["resolved"] = {"requested": args.symbol, "selected": thscode, **resolved}
        calls: dict[str, Any] = {}
        result["calls"] = calls

        if not thscode:
            result["warning"] = "Could not resolve symbol."
        else:
            if args.mode in ["smoke", "quote", "deep"]:
                calls["quote"] = run_call("quote", lambda: quote_call(ths, thscode, args.query_key), args.sample_limit)
            if args.mode in ["smoke", "kline", "deep"]:
                calls["kline_day"] = run_call(
                    "kline_day",
                    lambda: ths.klines(thscode, interval="day", count=min(args.count, 20)),
                    args.sample_limit,
                )
            if args.mode in ["kline", "deep"]:
                calls[f"kline_{args.interval}"] = run_call(
                    f"kline_{args.interval}",
                    lambda: ths.klines(thscode, interval=args.interval, count=args.count),
                    args.sample_limit,
                )
            if args.mode in ["intraday", "deep"] and thscode.startswith(A_SHARE_PREFIXES):
                calls["intraday_data"] = run_call("intraday_data", lambda: ths.intraday_data(thscode), args.sample_limit)
                calls["depth"] = run_call("depth", lambda: ths.depth(thscode), args.sample_limit)
                calls["big_order_flow"] = run_call("big_order_flow", lambda: ths.big_order_flow(thscode), args.sample_limit)
                calls["call_auction"] = run_call("call_auction", lambda: ths.call_auction(thscode), args.sample_limit)
            if args.mode == "deep":
                calls["ths_industry"] = run_call("ths_industry", ths.ths_industry, args.sample_limit)
                calls["ths_concept"] = run_call("ths_concept", ths.ths_concept, args.sample_limit)
                calls["news"] = run_call("news", ths.news, args.sample_limit)
                if args.wencai_query:
                    calls["wencai_nlp"] = run_call("wencai_nlp", lambda: ths.wencai_nlp(args.wencai_query), args.sample_limit)
    finally:
        try:
            ths.disconnect()
        except Exception:
            pass

    print(json.dumps(result, ensure_ascii=False, indent=2, default=str) if args.json else markdown_report(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
