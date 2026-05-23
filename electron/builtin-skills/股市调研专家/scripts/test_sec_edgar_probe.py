#!/usr/bin/env python3
"""Unit tests for sec_edgar_probe helpers."""

from __future__ import annotations

import unittest

import sec_edgar_probe


class SecEdgarProbeTests(unittest.TestCase):
    def test_extract_reader_json_from_markdown_wrapper(self) -> None:
        wrapped = """Title:

URL Source: https://data.sec.gov/submissions/CIK0000320193.json

Markdown Content:
{"cik":"0000320193","name":"Apple Inc."}
"""

        parsed = sec_edgar_probe.extract_reader_json(wrapped)

        self.assertEqual(parsed["cik"], "0000320193")
        self.assertEqual(parsed["name"], "Apple Inc.")

    def test_normalize_cik_accepts_common_forms(self) -> None:
        self.assertEqual(sec_edgar_probe.normalize_cik("CIK320193"), "0000320193")
        self.assertEqual(sec_edgar_probe.normalize_cik(1045810), "0001045810")

    def test_ticker_record_resolves_case_insensitively(self) -> None:
        ticker_map = {
            "0": {"cik_str": 1045810, "ticker": "NVDA", "title": "NVIDIA CORP"},
            "1": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
        }

        record = sec_edgar_probe.ticker_record(ticker_map, "aapl")

        self.assertIsNotNone(record)
        self.assertEqual(record["cik"], "0000320193")
        self.assertEqual(record["title"], "Apple Inc.")

    def test_summarize_filings_filters_forms_and_builds_archive_url(self) -> None:
        submissions = {
            "cik": "0000320193",
            "filings": {
                "recent": {
                    "accessionNumber": ["0000320193-26-000013", "0001140361-26-020871"],
                    "form": ["10-Q", "4"],
                    "filingDate": ["2026-05-01", "2026-05-16"],
                    "reportDate": ["2026-03-28", ""],
                    "primaryDocument": ["aapl-20260328.htm", "xslF345X05/doc4.xml"],
                    "primaryDocDescription": ["10-Q", "FORM 4"],
                }
            },
        }

        rows = sec_edgar_probe.summarize_filings(submissions, {"10-Q"}, 5)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["form"], "10-Q")
        self.assertIn("/Archives/edgar/data/320193/000032019326000013/aapl-20260328.htm", rows[0]["archive_url"])

    def test_latest_fact_picks_latest_filing_for_tag(self) -> None:
        facts = {
            "facts": {
                "us-gaap": {
                    "NetIncomeLoss": {
                        "label": "Net Income",
                        "units": {
                            "USD": [
                                {"val": 1, "filed": "2025-01-31", "end": "2024-12-28", "form": "10-Q"},
                                {"val": 2, "filed": "2026-05-01", "end": "2026-03-28", "form": "10-Q"},
                                {"val": 3, "filed": "2026-05-02", "end": "2026-03-29", "form": "8-K"},
                            ]
                        },
                    }
                }
            }
        }

        latest = sec_edgar_probe.latest_fact(facts, "us-gaap", "NetIncomeLoss", "USD", {"10-K", "10-Q"})

        self.assertEqual(latest["value"], 2)
        self.assertEqual(latest["filed"], "2026-05-01")

    def test_summarize_facts_picks_newest_candidate_tag(self) -> None:
        facts = {
            "facts": {
                "us-gaap": {
                    "RevenueFromContractWithCustomerExcludingAssessedTax": {
                        "label": "Old revenue tag",
                        "units": {"USD": [{"val": 1, "filed": "2022-03-18", "end": "2022-01-30", "form": "10-K"}]},
                    },
                    "Revenues": {
                        "label": "Revenue",
                        "units": {"USD": [{"val": 2, "filed": "2026-02-25", "end": "2026-01-25", "form": "10-K"}]},
                    },
                }
            }
        }

        summary = sec_edgar_probe.summarize_facts(facts)

        self.assertEqual(summary["revenue"]["tag"], "Revenues")
        self.assertEqual(summary["revenue"]["value"], 2)


if __name__ == "__main__":
    unittest.main()
