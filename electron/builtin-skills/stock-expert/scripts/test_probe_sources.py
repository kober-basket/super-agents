#!/usr/bin/env python3
"""Unit tests for probe_sources helpers."""

from __future__ import annotations

import re
import unittest
from unittest.mock import patch

import probe_sources


class EastmoneyRadarTests(unittest.TestCase):
    def test_kuaixun_v2_pages_and_filters_precise_keywords(self) -> None:
        calls: list[tuple[str, dict[str, object] | None]] = []

        def fake_request_json(url: str, params=None, referer=None):
            calls.append((url, params))
            page = int(params["p"])
            rows = {
                1: [
                    {
                        "newsid": "n1",
                        "title": "机器人板块走强",
                        "digest": "减速器、执行器方向活跃",
                        "showtime": "2026-05-17 09:30:00",
                        "url_unique": "http://finance.eastmoney.com/a/n1.html",
                        "Art_Media_Name": "东方财富",
                    },
                    {
                        "newsid": "n2",
                        "title": "海外宏观消息",
                        "digest": "与关键词无关",
                        "showtime": "2026-05-17 09:20:00",
                        "url_unique": "http://finance.eastmoney.com/a/n2.html",
                        "Art_Media_Name": "新华社",
                    },
                ],
                2: [
                    {
                        "newsid": "n3",
                        "title": "人形机器人产业链催化",
                        "digest": "核心零部件关注度提升",
                        "showtime": "2026-05-17 09:10:00",
                        "url_unique": "http://finance.eastmoney.com/a/n3.html",
                        "Art_Media_Name": "证券时报",
                    }
                ],
            }
            return {"rc": 1, "news": rows[page]}

        with patch.object(probe_sources, "request_json", side_effect=fake_request_json):
            result = probe_sources.fetch_eastmoney_kuaixun_v2(
                re.compile("机器人"),
                max_items=10,
                hours=None,
                keyword="机器人",
                pages=2,
                page_size=100,
            )

        self.assertTrue(result["ok"])
        self.assertEqual([hit["news_id"] for hit in result["hits"]], ["n1", "n3"])
        self.assertEqual([call[1]["p"] for call in calls], ["1", "2"])
        self.assertTrue(all(call[1]["limit"] == "100" for call in calls))

    def test_broad_keyword_keeps_recent_feed_with_match_flag(self) -> None:
        def fake_request_json(url: str, params=None, referer=None):
            return {
                "rc": 1,
                "news": [
                    {
                        "newsid": "n1",
                        "title": "全球市场夜间消息",
                        "digest": "最新宏观背景",
                        "showtime": "2026-05-17 01:56:00",
                        "url_unique": "http://finance.eastmoney.com/a/n1.html",
                        "Art_Media_Name": "央视新闻",
                    }
                ],
            }

        with patch.object(probe_sources, "request_json", side_effect=fake_request_json):
            result = probe_sources.fetch_eastmoney_kuaixun_v2(
                re.compile("A股"),
                max_items=10,
                hours=None,
                keyword="A股",
                pages=1,
                page_size=100,
            )

        self.assertEqual(len(result["hits"]), 1)
        self.assertFalse(result["hits"][0]["matched_keyword"])
        self.assertEqual(result["hits"][0]["media"], "央视新闻")

    def test_merge_hits_deduplicates_normalized_urls_and_sorts_newest_first(self) -> None:
        hits = [
            {
                "source": "source-a",
                "time": "2026-05-17 09:00:00",
                "title": "同一条新闻",
                "summary": "",
                "url": "http://finance.eastmoney.com/a/abc.html",
            },
            {
                "source": "source-b",
                "time": "2026-05-17 09:01:00",
                "title": "同一条新闻",
                "summary": "",
                "url": "https://finance.eastmoney.com/a/abc.html",
            },
            {
                "source": "source-c",
                "time": "2026-05-17 09:02:00",
                "title": "更新新闻",
                "summary": "",
                "url": "https://finance.eastmoney.com/a/new.html",
            },
        ]

        merged = probe_sources.merge_hits(hits)

        self.assertEqual([hit["title"] for hit in merged], ["更新新闻", "同一条新闻"])
        self.assertEqual(merged[1]["sources"], ["source-a", "source-b"])

    def test_select_radar_hits_prefers_exact_matches_for_broad_keywords(self) -> None:
        hits = [
            {
                "source": "source-a",
                "time": "2026-05-17 10:00:00",
                "title": "最新但不精确",
                "summary": "",
                "url": "https://finance.eastmoney.com/a/new.html",
                "matched_keyword": False,
            },
            {
                "source": "source-a",
                "time": "2026-05-17 09:00:00",
                "title": "A股精确命中",
                "summary": "",
                "url": "https://finance.eastmoney.com/a/exact.html",
                "matched_keyword": True,
            },
        ]

        selected, mode = probe_sources.select_radar_hits(hits, "A股", 10)

        self.assertEqual(mode, "exact")
        self.assertEqual([hit["title"] for hit in selected], ["A股精确命中"])

    def test_select_radar_hits_uses_recent_fallback_when_broad_keyword_has_no_matches(self) -> None:
        hits = [
            {
                "source": "source-a",
                "time": "2026-05-17 10:00:00",
                "title": "最新市场背景",
                "summary": "",
                "url": "https://finance.eastmoney.com/a/new.html",
                "matched_keyword": False,
            }
        ]

        selected, mode = probe_sources.select_radar_hits(hits, "A股", 10)

        self.assertEqual(mode, "recent_fallback")
        self.assertEqual([hit["title"] for hit in selected], ["最新市场背景"])

    def test_eastmoney_candidate_limit_keeps_full_scan_for_broad_keywords(self) -> None:
        self.assertEqual(probe_sources.eastmoney_candidate_limit("A股", 10, 2, 100), 200)
        self.assertEqual(probe_sources.eastmoney_candidate_limit("机器人", 10, 2, 100), 100)


if __name__ == "__main__":
    unittest.main()
