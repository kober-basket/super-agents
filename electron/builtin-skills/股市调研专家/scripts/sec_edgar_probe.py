#!/usr/bin/env python3
"""Fetch SEC EDGAR JSON with an automatic reader fallback.

The preferred path is always the official SEC JSON URL. Some local networks
reset the TLS handshake before HTTP begins; in that case this script can fetch
the same official URL through Jina Reader and records that access path in the
output metadata.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.request
from typing import Any


READER_PREFIX = "https://r.jina.ai/http://r.jina.ai/http://"
DEFAULT_USER_AGENT = os.environ.get(
    "SEC_USER_AGENT",
    "stock-market-research-skill/1.0 contact=research@example.com",
)
HEADERS = {
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept": "application/json,text/plain,*/*",
}

FACT_GROUPS = [
    (
        "revenue",
        [
            ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax", "USD"),
            ("us-gaap", "Revenues", "USD"),
            ("us-gaap", "SalesRevenueNet", "USD"),
        ],
    ),
    ("net_income", [("us-gaap", "NetIncomeLoss", "USD")]),
    ("operating_income", [("us-gaap", "OperatingIncomeLoss", "USD")]),
    ("operating_cash_flow", [("us-gaap", "NetCashProvidedByUsedInOperatingActivities", "USD")]),
    ("assets", [("us-gaap", "Assets", "USD")]),
    ("liabilities", [("us-gaap", "Liabilities", "USD")]),
    ("equity", [("us-gaap", "StockholdersEquity", "USD")]),
    (
        "cash",
        [
            ("us-gaap", "CashAndCashEquivalentsAtCarryingValue", "USD"),
            ("us-gaap", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "USD"),
        ],
    ),
    ("diluted_eps", [("us-gaap", "EarningsPerShareDiluted", "USD/shares")]),
    ("shares_outstanding", [("dei", "EntityCommonStockSharesOutstanding", "shares")]),
]


def normalize_cik(value: str | int) -> str:
    text = str(value).strip().upper()
    text = re.sub(r"^CIK", "", text)
    text = re.sub(r"\D", "", text)
    if not text:
        raise ValueError("CIK is empty")
    return text.zfill(10)


def request_text(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def reader_url(url: str) -> str:
    return f"{READER_PREFIX}{url}"


def extract_reader_json(text: str) -> Any:
    body = text.split("Markdown Content:", 1)[-1].strip()
    if body.startswith("```"):
        body = re.sub(r"^```(?:json)?\s*", "", body)
        body = re.sub(r"\s*```$", "", body)

    positions = [pos for pos in (body.find("{"), body.find("[")) if pos >= 0]
    if not positions:
        raise ValueError("reader response did not contain JSON content")
    start = min(positions)
    return json.JSONDecoder().raw_decode(body[start:])[0]


def fetch_json(url: str, allow_reader: bool = True) -> dict[str, Any]:
    errors: list[str] = []
    try:
        return {
            "data": json.loads(request_text(url)),
            "meta": {
                "official_url": url,
                "access_path": "direct_sec",
                "retrieved_at": now_iso(),
            },
        }
    except Exception as exc:  # noqa: BLE001 - diagnostics are part of this helper
        errors.append(f"direct_sec:{type(exc).__name__}: {exc}")

    if not allow_reader:
        raise RuntimeError("; ".join(errors))

    proxy = reader_url(url)
    try:
        return {
            "data": extract_reader_json(request_text(proxy, timeout=45)),
            "meta": {
                "official_url": url,
                "access_path": "jina_reader_proxy",
                "reader_url": proxy,
                "retrieved_at": now_iso(),
                "direct_error": errors[-1],
                "note": "Fetched official SEC URL through Jina Reader because local direct TLS failed.",
            },
        }
    except Exception as exc:  # noqa: BLE001 - surface both failed paths
        errors.append(f"jina_reader_proxy:{type(exc).__name__}: {exc}")
        raise RuntimeError("; ".join(errors)) from exc


def fetch_company_tickers(allow_reader: bool = True) -> dict[str, Any]:
    return fetch_json("https://www.sec.gov/files/company_tickers.json", allow_reader=allow_reader)


def ticker_record(ticker_map: dict[str, Any], ticker: str) -> dict[str, Any] | None:
    wanted = ticker.strip().upper()
    for row in ticker_map.values():
        if not isinstance(row, dict):
            continue
        if str(row.get("ticker", "")).upper() == wanted:
            record = dict(row)
            record["cik"] = normalize_cik(record.get("cik_str", ""))
            return record
    return None


def resolve_ticker(ticker: str, allow_reader: bool = True) -> dict[str, Any]:
    fetched = fetch_company_tickers(allow_reader=allow_reader)
    record = ticker_record(fetched["data"], ticker)
    if not record:
        raise ValueError(f"Ticker not found in SEC ticker map: {ticker}")
    return {"record": record, "meta": fetched["meta"]}


def resolve_target(ticker: str = "", cik: str = "", allow_reader: bool = True) -> dict[str, Any]:
    if cik:
        normalized = normalize_cik(cik)
        return {"cik": normalized, "ticker": ticker.upper() if ticker else "", "title": "", "resolve_meta": None}
    if not ticker:
        raise ValueError("--ticker or --cik is required")
    resolved = resolve_ticker(ticker, allow_reader=allow_reader)
    record = resolved["record"]
    return {
        "cik": record["cik"],
        "ticker": record.get("ticker", "").upper(),
        "title": record.get("title", ""),
        "resolve_meta": resolved["meta"],
    }


def fetch_submissions(cik: str, allow_reader: bool = True) -> dict[str, Any]:
    normalized = normalize_cik(cik)
    return fetch_json(f"https://data.sec.gov/submissions/CIK{normalized}.json", allow_reader=allow_reader)


def fetch_companyfacts(cik: str, allow_reader: bool = True) -> dict[str, Any]:
    normalized = normalize_cik(cik)
    return fetch_json(
        f"https://data.sec.gov/api/xbrl/companyfacts/CIK{normalized}.json",
        allow_reader=allow_reader,
    )


def summarize_filings(submissions: dict[str, Any], forms: set[str], limit: int) -> list[dict[str, Any]]:
    recent = submissions.get("filings", {}).get("recent", {})
    accessions = recent.get("accessionNumber") or []
    cik_int = int(normalize_cik(submissions.get("cik", "")))
    rows: list[dict[str, Any]] = []
    for idx, accession in enumerate(accessions):
        form = array_get(recent, "form", idx)
        if forms and form.upper() not in forms:
            continue
        primary_document = array_get(recent, "primaryDocument", idx)
        accession_no_dash = str(accession).replace("-", "")
        archive_url = ""
        if primary_document:
            archive_url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{accession_no_dash}/{primary_document}"
        rows.append(
            {
                "filed": array_get(recent, "filingDate", idx),
                "report_date": array_get(recent, "reportDate", idx),
                "form": form,
                "accession_number": accession,
                "primary_document": primary_document,
                "primary_doc_description": array_get(recent, "primaryDocDescription", idx),
                "archive_url": archive_url,
            }
        )
        if len(rows) >= limit:
            break
    return rows


def latest_fact(
    companyfacts: dict[str, Any],
    taxonomy: str,
    tag: str,
    unit: str = "",
    forms: set[str] | None = None,
) -> dict[str, Any] | None:
    fact = companyfacts.get("facts", {}).get(taxonomy, {}).get(tag)
    if not isinstance(fact, dict):
        return None
    units = fact.get("units", {})
    if not isinstance(units, dict):
        return None
    unit_names = [unit] if unit and unit in units else list(units)
    candidates: list[dict[str, Any]] = []
    for unit_name in unit_names:
        for row in units.get(unit_name, []) or []:
            if forms and str(row.get("form", "")).upper() not in forms:
                continue
            if row.get("val") is None:
                continue
            candidate = {
                "taxonomy": taxonomy,
                "tag": tag,
                "label": fact.get("label", ""),
                "unit": unit_name,
                "value": row.get("val"),
                "start": row.get("start", ""),
                "end": row.get("end", ""),
                "filed": row.get("filed", ""),
                "fy": row.get("fy"),
                "fp": row.get("fp", ""),
                "form": row.get("form", ""),
                "accession_number": row.get("accn", ""),
                "frame": row.get("frame", ""),
            }
            candidates.append(candidate)
    if not candidates:
        return None
    candidates.sort(key=lambda row: (row.get("filed", ""), row.get("end", ""), row.get("start", "")))
    return candidates[-1]


def summarize_facts(companyfacts: dict[str, Any]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for metric, candidates in FACT_GROUPS:
        selected_candidates = []
        for taxonomy, tag, unit in candidates:
            fact = latest_fact(companyfacts, taxonomy, tag, unit, {"10-K", "10-Q"})
            if fact:
                selected_candidates.append(fact)
        output[metric] = sorted(selected_candidates, key=fact_sort_key)[-1] if selected_candidates else None
    return output


def selected_facts(companyfacts: dict[str, Any], tags: list[str], unit: str, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw_tag in tags:
        taxonomy, tag = split_tag(raw_tag)
        fact = latest_fact(companyfacts, taxonomy, tag, unit, {"10-K", "10-Q"})
        if fact:
            rows.append(fact)
        if len(rows) >= limit:
            break
    return rows


def fact_sort_key(row: dict[str, Any]) -> tuple[str, str, str]:
    return (str(row.get("filed", "")), str(row.get("end", "")), str(row.get("start", "")))


def split_tag(value: str) -> tuple[str, str]:
    text = value.strip()
    if ":" in text:
        taxonomy, tag = text.split(":", 1)
        return taxonomy, tag
    return "us-gaap", text


def array_get(data: dict[str, Any], key: str, idx: int) -> str:
    values = data.get(key) or []
    if not isinstance(values, list) or idx >= len(values):
        return ""
    return "" if values[idx] is None else str(values[idx])


def now_iso() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def build_summary(ticker: str, cik: str, limit: int, forms: set[str], allow_reader: bool) -> dict[str, Any]:
    target = resolve_target(ticker=ticker, cik=cik, allow_reader=allow_reader)
    submissions = fetch_submissions(target["cik"], allow_reader=allow_reader)
    facts = fetch_companyfacts(target["cik"], allow_reader=allow_reader)
    company = submissions["data"]
    ticker_value = target["ticker"] or (company.get("tickers") or [""])[0]
    return {
        "source": "SEC EDGAR official JSON",
        "retrieved_at": now_iso(),
        "company": {
            "cik": normalize_cik(company.get("cik", target["cik"])),
            "name": company.get("name") or company.get("entityName") or target["title"],
            "ticker": ticker_value,
            "exchange": (company.get("exchanges") or [""])[0],
            "sic": company.get("sic", ""),
            "sic_description": company.get("sicDescription", ""),
            "fiscal_year_end": company.get("fiscalYearEnd", ""),
        },
        "recent_filings": summarize_filings(company, forms, limit),
        "latest_facts": summarize_facts(facts["data"]),
        "access": {
            "ticker_map": target["resolve_meta"],
            "submissions": submissions["meta"],
            "companyfacts": facts["meta"],
        },
        "note": "Research reference only. SEC facts are official XBRL/company submission data; check filing documents for context and restatements.",
    }


def output_json(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def add_target_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--ticker", default="", help="SEC ticker, e.g. AAPL or NVDA.")
    parser.add_argument("--cik", default="", help="CIK number. Overrides ticker resolution when set.")
    parser.add_argument("--no-reader-fallback", action="store_true", help="Disable Jina Reader fallback.")


def parse_forms(value: str) -> set[str]:
    return {item.strip().upper() for item in value.split(",") if item.strip()}


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch SEC EDGAR official JSON with reader fallback.")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("resolve")
    p.add_argument("--ticker", required=True)
    p.add_argument("--no-reader-fallback", action="store_true")

    p = sub.add_parser("filings")
    add_target_args(p)
    p.add_argument("--forms", default="10-K,10-Q,8-K", help="Comma-separated SEC form filter.")
    p.add_argument("--limit", type=int, default=10)

    p = sub.add_parser("facts")
    add_target_args(p)
    p.add_argument(
        "--tags",
        default="RevenueFromContractWithCustomerExcludingAssessedTax,Revenues,NetIncomeLoss,Assets,Liabilities,StockholdersEquity",
        help="Comma-separated XBRL tags, optionally taxonomy:tag.",
    )
    p.add_argument("--unit", default="", help="Optional unit filter, e.g. USD or shares.")
    p.add_argument("--limit", type=int, default=20)

    p = sub.add_parser("summary")
    add_target_args(p)
    p.add_argument("--forms", default="10-K,10-Q,8-K")
    p.add_argument("--limit", type=int, default=8)

    args = parser.parse_args()
    allow_reader = not getattr(args, "no_reader_fallback", False)

    if args.command == "resolve":
        output_json(resolve_ticker(args.ticker, allow_reader=allow_reader))
        return 0

    target = resolve_target(
        ticker=getattr(args, "ticker", ""),
        cik=getattr(args, "cik", ""),
        allow_reader=allow_reader,
    )
    if args.command == "filings":
        submissions = fetch_submissions(target["cik"], allow_reader=allow_reader)
        output_json(
            {
                "company": {
                    "cik": normalize_cik(submissions["data"].get("cik", target["cik"])),
                    "name": submissions["data"].get("name", target["title"]),
                    "ticker": target["ticker"] or (submissions["data"].get("tickers") or [""])[0],
                },
                "filings": summarize_filings(submissions["data"], parse_forms(args.forms), args.limit),
                "access": {"resolve": target["resolve_meta"], "submissions": submissions["meta"]},
            }
        )
    elif args.command == "facts":
        facts = fetch_companyfacts(target["cik"], allow_reader=allow_reader)
        output_json(
            {
                "company": {
                    "cik": normalize_cik(facts["data"].get("cik", target["cik"])),
                    "name": facts["data"].get("entityName", target["title"]),
                    "ticker": target["ticker"],
                },
                "facts": selected_facts(
                    facts["data"],
                    [item.strip() for item in args.tags.split(",") if item.strip()],
                    args.unit,
                    args.limit,
                ),
                "access": {"resolve": target["resolve_meta"], "companyfacts": facts["meta"]},
            }
        )
    elif args.command == "summary":
        output_json(build_summary(args.ticker, args.cik, args.limit, parse_forms(args.forms), allow_reader))
    else:
        raise AssertionError(args.command)
    return 0


if __name__ == "__main__":
    sys.exit(main())
