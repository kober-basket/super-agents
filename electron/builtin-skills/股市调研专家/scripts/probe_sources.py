#!/usr/bin/env python3
"""Probe local market-research sources and optional public finance-news feeds."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


DEFAULT_GITHUB_ROOT = Path.home() / "Desktop" / "github"
DEFAULT_AKSHARE_ROOT = Path(os.environ.get("AKSHARE_ROOT", str(DEFAULT_GITHUB_ROOT / "akshare"))).expanduser()
DEFAULT_DAILY_ROOT = Path(os.environ.get("DAILY_STOCK_ANALYSIS_ROOT", str(DEFAULT_GITHUB_ROOT / "daily_stock_analysis"))).expanduser()

KEY_ENV_NAMES = [
    "TUSHARE_TOKEN",
    "ANSPIRE_API_KEYS",
    "BOCHA_API_KEYS",
    "SERPAPI_API_KEYS",
    "TAVILY_API_KEYS",
    "BRAVE_API_KEYS",
    "MINIMAX_API_KEYS",
    "SEARXNG_BASE_URLS",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
]

DEFAULT_KEYWORDS = [
    "黄金",
    "金价",
    "贵金属",
    "COMEX",
    "伦敦金",
    "沪金",
    "央行购金",
    "避险资产",
    "实际利率",
]

BROAD_MARKET_KEYWORDS = {
    "",
    "a股",
    "A股",
    "股市",
    "市场",
    "行情",
    "大盘",
    "盘面",
    "今日",
    "今天",
    "最新",
    "快讯",
    "财经",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36",
    "Accept": "application/json,text/plain,*/*",
}
CN_TZ = ZoneInfo("Asia/Shanghai")


def clean_text(value: Any) -> str:
    text = re.sub(r"<[^>]+>", "", str(value or ""))
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def request_text(
    url: str,
    params: dict[str, Any] | None = None,
    referer: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> str:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    headers = dict(HEADERS)
    if referer:
        headers["Referer"] = referer
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=12) as response:
        return response.read().decode("utf-8", errors="replace")


def request_json(
    url: str,
    params: dict[str, Any] | None = None,
    referer: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> Any:
    return json.loads(request_text(url, params=params, referer=referer, extra_headers=extra_headers))


def keyword_pattern(keyword: str) -> re.Pattern[str]:
    terms = [keyword.strip()] if keyword.strip() else []
    if keyword.strip() in {"黄金", "金价", "gold", "Gold"}:
        terms.extend(DEFAULT_KEYWORDS)
    terms = [re.escape(term) for term in dict.fromkeys(terms) if term]
    return re.compile("|".join(terms), re.IGNORECASE) if terms else re.compile(".+")


def parse_time(value: Any) -> dt.datetime | None:
    text = clean_text(value)
    if not text:
        return None
    if re.fullmatch(r"\d{10,13}", text):
        timestamp = int(text)
        if timestamp > 10_000_000_000:
            timestamp = timestamp // 1000
        return dt.datetime.fromtimestamp(timestamp, CN_TZ)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S"):
        try:
            return dt.datetime.strptime(text, fmt).replace(tzinfo=CN_TZ)
        except ValueError:
            pass
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            t = dt.datetime.strptime(text, fmt).time()
            today = dt.datetime.now(CN_TZ).date()
            return dt.datetime.combine(today, t, CN_TZ)
        except ValueError:
            pass
    return None


def display_time(value: Any) -> str:
    parsed = parse_time(value)
    if parsed:
        return parsed.strftime("%Y-%m-%d %H:%M:%S")
    return clean_text(value)


def add_hit(
    hits: list[dict[str, Any]],
    source: str,
    title: str,
    summary: str = "",
    when: str = "",
    url: str = "",
    extra: dict[str, Any] | None = None,
) -> None:
    parsed = parse_time(when)
    now = dt.datetime.now(CN_TZ)
    age_minutes = int((now - parsed).total_seconds() // 60) if parsed else None
    clean_title = clean_text(title)
    clean_summary = clean_text(summary)
    if not clean_title and clean_summary:
        clean_title = clean_summary[:80]
    hit = {
        "source": source,
        "time": display_time(when),
        "age_minutes": age_minutes,
        "title": clean_title,
        "summary": clean_summary,
        "url": normalize_url(url),
    }
    if extra:
        hit.update({key: value for key, value in extra.items() if value not in (None, "", [])})
    hits.append(hit)


def is_broad_market_keyword(keyword: str) -> bool:
    return clean_text(keyword) in BROAD_MARKET_KEYWORDS


def normalize_url(url: Any) -> str:
    text = clean_text(url)
    if text.startswith("http://finance.eastmoney.com/"):
        text = text.replace("http://finance.eastmoney.com/", "https://finance.eastmoney.com/", 1)
    return text.rstrip("/")


def hit_sort_time(hit: dict[str, Any]) -> dt.datetime:
    parsed = parse_time(hit.get("time"))
    if parsed:
        return parsed
    return dt.datetime.min.replace(tzinfo=CN_TZ)


def hit_identity(hit: dict[str, Any]) -> str:
    news_id = clean_text(hit.get("news_id"))
    if news_id:
        return f"news_id:{news_id}"
    url = normalize_url(hit.get("url"))
    if url:
        return f"url:{url}"
    return f"title:{clean_text(hit.get('time'))}:{clean_text(hit.get('title'))}"


def merge_hits(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for hit in hits:
        key = hit_identity(hit)
        source = clean_text(hit.get("source"))
        if key not in merged:
            item = dict(hit)
            item["sources"] = [source] if source else []
            merged[key] = item
            continue

        item = merged[key]
        if source and source not in item["sources"]:
            item["sources"].append(source)
        item["matched_keyword"] = bool(item.get("matched_keyword")) or bool(hit.get("matched_keyword"))

        if hit_sort_time(hit) > hit_sort_time(item):
            sources = item["sources"]
            matched_keyword = item["matched_keyword"]
            merged[key] = dict(hit)
            merged[key]["sources"] = sources
            merged[key]["matched_keyword"] = matched_keyword
        elif clean_text(hit.get("summary")) and clean_text(hit.get("summary")) not in clean_text(item.get("summary")):
            item["summary"] = " | ".join(part for part in [item.get("summary", ""), hit.get("summary", "")] if part)

    for item in merged.values():
        if item.get("sources"):
            item["source"] = " / ".join(item["sources"])
    return sorted(merged.values(), key=hit_sort_time, reverse=True)


def select_radar_hits(hits: list[dict[str, Any]], keyword: str, max_items: int) -> tuple[list[dict[str, Any]], str]:
    sorted_hits = sorted(hits, key=hit_sort_time, reverse=True)
    if not is_broad_market_keyword(keyword):
        return sorted_hits[:max_items], "strict"

    exact_hits = [hit for hit in sorted_hits if hit.get("matched_keyword")]
    if exact_hits:
        return exact_hits[:max_items], "exact"
    return sorted_hits[:max_items], "recent_fallback"


def eastmoney_candidate_limit(keyword: str, max_items: int, pages: int, page_size: int) -> int:
    normalized_page_size = min(max(1, page_size), 100)
    if is_broad_market_keyword(keyword):
        return max(max_items, max(1, pages) * normalized_page_size)
    return max(max_items * 2, normalized_page_size)


def should_keep_news(pattern: re.Pattern[str], haystack: str, keyword: str) -> tuple[bool, bool]:
    matched = bool(pattern.search(haystack))
    return matched or is_broad_market_keyword(keyword), matched


def filter_by_hours(hits: list[dict[str, Any]], hours: float | None) -> list[dict[str, Any]]:
    if hours is None:
        return hits
    max_minutes = int(hours * 60)
    return [
        hit
        for hit in hits
        if isinstance(hit.get("age_minutes"), int) and 0 <= hit["age_minutes"] <= max_minutes
    ]


def fetch_eastmoney_home_fast(
    pattern: re.Pattern[str],
    max_items: int,
    hours: float | None = None,
    keyword: str = "",
) -> dict[str, Any]:
    source = "东方财富首页滚动快讯"
    params = {
        "client": "web",
        "biz": "web_home724",
        "req_trace": str(int(time.time() * 1000)),
    }
    data = request_json("https://np-weblist.eastmoney.com/comm/web/getFastNews", params)
    rows = data.get("data", [])
    hits: list[dict[str, Any]] = []
    for row in rows if isinstance(rows, list) else []:
        title = clean_text(row.get("title"))
        summary = clean_text(row.get("summary") or row.get("digest"))
        media = clean_text(row.get("mediaName"))
        haystack = " ".join([title, summary, media])
        keep, matched = should_keep_news(pattern, haystack, keyword)
        if not keep:
            continue
        url = row.get("url") or f"https://finance.eastmoney.com/a/{row.get('code')}.html"
        add_hit(
            hits,
            source,
            title,
            summary,
            row.get("showTime", ""),
            url,
            {
                "media": media,
                "news_id": row.get("code"),
                "matched_keyword": matched,
                "feed": "web_home724",
            },
        )
    return {"source": source, "ok": True, "hits": filter_by_hours(hits, hours)[:max_items]}


def fetch_eastmoney_kuaixun_v2(
    pattern: re.Pattern[str],
    max_items: int,
    hours: float | None = None,
    keyword: str = "",
    pages: int = 3,
    page_size: int = 100,
) -> dict[str, Any]:
    source = "东方财富7x24快讯(v2分页)"
    page_count = max(1, pages)
    limit = str(min(max(1, page_size), 100))
    hits: list[dict[str, Any]] = []
    for page in range(1, page_count + 1):
        params = {"column": "102", "limit": limit, "p": str(page)}
        data = request_json("https://newsapi.eastmoney.com/kuaixun/v2/api/list", params)
        rows = data.get("news", [])
        if not isinstance(rows, list) or not rows:
            break
        for row in rows:
            title = clean_text(row.get("title") or row.get("simtitle"))
            summary = clean_text(row.get("digest") or row.get("simdigest"))
            media = clean_text(row.get("Art_Media_Name") or row.get("mediaName"))
            haystack = " ".join([title, summary, media, clean_text(row.get("column"))])
            keep, matched = should_keep_news(pattern, haystack, keyword)
            if not keep:
                continue
            add_hit(
                hits,
                source,
                title,
                summary,
                row.get("showtime") or row.get("ordertime") or "",
                row.get("url_unique") or row.get("url_w") or row.get("url_m") or "",
                {
                    "media": media,
                    "news_id": row.get("newsid") or row.get("id"),
                    "sort": row.get("sort"),
                    "matched_keyword": matched,
                    "feed": "kuaixun_v2",
                },
            )
    return {"source": source, "ok": True, "hits": filter_by_hours(hits, hours)[:max_items]}


def fetch_eastmoney_fast(
    pattern: re.Pattern[str],
    max_items: int,
    hours: float | None = None,
    keyword: str = "",
) -> dict[str, Any]:
    source = "东方财富全球财经快讯"
    params = {
        "client": "web",
        "biz": "web_724",
        "fastColumn": "102",
        "sortEnd": "",
        "pageSize": "200",
        "req_trace": str(int(time.time() * 1000)),
    }
    data = request_json("https://np-weblist.eastmoney.com/comm/web/getFastNewsList", params)
    rows = data.get("data", {}).get("fastNewsList", [])
    hits: list[dict[str, Any]] = []
    for row in rows:
        title = clean_text(row.get("title"))
        summary = clean_text(row.get("summary"))
        stock_list = row.get("stockList")
        haystack = " ".join([title, summary, clean_text(stock_list)])
        keep, matched = should_keep_news(pattern, haystack, keyword)
        if not keep:
            continue
        code = row.get("code")
        url = f"https://finance.eastmoney.com/a/{code}.html" if code else ""
        add_hit(
            hits,
            source,
            title,
            summary,
            row.get("showTime", ""),
            url,
            {
                "news_id": code,
                "real_sort": row.get("realSort"),
                "stock_list": stock_list,
                "matched_keyword": matched,
                "feed": "fast_news_list",
            },
        )
    return {"source": source, "ok": True, "hits": filter_by_hours(hits, hours)[:max_items]}


def fetch_eastmoney_radar(
    keyword: str,
    pattern: re.Pattern[str],
    max_items: int,
    hours: float | None = None,
    pages: int = 3,
    page_size: int = 100,
) -> dict[str, Any]:
    source = "东方财富快讯雷达"
    fetch_limit = eastmoney_candidate_limit(keyword, max_items, pages, page_size)
    sub_results = [
        fetch_eastmoney_home_fast(pattern, fetch_limit, hours, keyword),
        fetch_eastmoney_kuaixun_v2(pattern, fetch_limit, hours, keyword, pages, page_size),
        fetch_eastmoney_fast(pattern, fetch_limit, hours, keyword),
    ]
    hits = merge_hits([hit for result in sub_results for hit in result.get("hits", [])])
    hits = filter_by_hours(hits, hours)
    hits, selection_mode = select_radar_hits(hits, keyword, max_items)
    return {
        "source": source,
        "ok": True,
        "hits": hits,
        "meta": {
            "feeds": [
                {
                    "source": result["source"],
                    "hits": len(result.get("hits", [])),
                }
                for result in sub_results
            ],
            "broad_keyword_mode": is_broad_market_keyword(keyword),
            "selection_mode": selection_mode,
            "eastmoney_pages": pages,
            "eastmoney_page_size": min(max(1, page_size), 100),
        },
    }


def fetch_eastmoney_search(keyword: str, max_items: int, hours: float | None = None) -> dict[str, Any]:
    source = "东方财富站内新闻搜索"
    callback = f"jQuery{int(time.time() * 1000)}"
    inner = {
        "uid": "",
        "keyword": keyword,
        "type": ["cmsArticleWebOld"],
        "client": "web",
        "clientType": "web",
        "clientVersion": "curr",
        "param": {
            "cmsArticleWebOld": {
                "searchScope": "default",
                "sort": "default",
                "pageIndex": 1,
                "pageSize": max(max_items, 10),
                "preTag": "<em>",
                "postTag": "</em>",
            }
        },
    }
    params = {
        "cb": callback,
        "param": json.dumps(inner, ensure_ascii=False),
        "_": str(int(time.time() * 1000)),
    }
    raw = request_text(
        "https://search-api-web.eastmoney.com/search/jsonp",
        params,
        referer=f"https://so.eastmoney.com/news/s?keyword={urllib.parse.quote(keyword)}",
    )
    match = re.search(r"^[^(]+\((.*)\)\s*$", raw, re.S)
    data = json.loads(match.group(1) if match else raw)
    rows = data.get("result", {}).get("cmsArticleWebOld", [])
    hits: list[dict[str, Any]] = []
    for row in rows:
        code = row.get("code")
        url = f"http://finance.eastmoney.com/a/{code}.html" if code else ""
        add_hit(
            hits,
            source,
            row.get("title", ""),
            f"{row.get('mediaName', '')} {row.get('content', '')}",
            row.get("date", ""),
            url,
        )
    hits = filter_by_hours(hits, hours)[:max_items]
    return {"source": source, "ok": True, "hits": hits}


def fetch_sina_fast(pattern: re.Pattern[str], max_items: int, hours: float | None = None) -> dict[str, Any]:
    source = "新浪财经7x24"
    params = {
        "page": "1",
        "page_size": "20",
        "zhibo_id": "152",
        "tag_id": "0",
        "dire": "f",
        "dpc": "1",
        "pagesize": "20",
        "type": "1",
    }
    data = request_json("https://zhibo.sina.com.cn/api/zhibo/feed", params, "https://finance.sina.com.cn/7x24/")
    rows = data.get("result", {}).get("data", {}).get("feed", {}).get("list", [])
    hits: list[dict[str, Any]] = []
    for row in rows:
        text = clean_text(row.get("rich_text"))
        if pattern.search(text):
            add_hit(hits, source, text[:80], text, row.get("create_time", ""), "")
    hits = filter_by_hours(hits, hours)[:max_items]
    return {"source": source, "ok": True, "hits": hits}


def fetch_cls(pattern: re.Pattern[str], max_items: int, hours: float | None = None) -> dict[str, Any]:
    source = "财联社电报"
    data = request_json("https://www.cls.cn/nodeapi/telegraphList", referer="https://www.cls.cn/telegraph")
    rows = data.get("data", {}).get("roll_data", [])
    hits: list[dict[str, Any]] = []
    for row in rows:
        title = clean_text(row.get("title"))
        summary = clean_text(row.get("content"))
        if pattern.search(f"{title} {summary}"):
            add_hit(hits, source, title, summary, str(row.get("ctime", "")), "")
    hits = filter_by_hours(hits, hours)[:max_items]
    return {"source": source, "ok": True, "hits": hits}


def related_stock_text(row: dict[str, Any]) -> str:
    values: list[str] = []
    items: list[Any] = []
    for field in ("stocks", "stock", "stock_data"):
        raw = row.get(field)
        if isinstance(raw, list):
            items.extend(raw)
        elif isinstance(raw, dict):
            items.append(raw)
        elif raw:
            values.append(clean_text(raw))

    for item in items:
        if not isinstance(item, dict):
            values.append(clean_text(item))
            continue
        name = clean_text(item.get("stockName") or item.get("name") or item.get("shortName"))
        code = clean_text(item.get("code") or item.get("stockCode") or item.get("symbol"))
        if name and code:
            values.append(f"{name}({code})")
        elif name or code:
            values.append(name or code)

    return "、".join(dict.fromkeys(value for value in values if value))


def stcn_tag_text(tags: Any) -> str:
    values: list[str] = []
    if not isinstance(tags, list):
        return ""
    for group in tags:
        if not isinstance(group, list):
            continue
        for item in group:
            if not isinstance(item, dict):
                continue
            name = clean_text(item.get("title") or item.get("name"))
            stock_code = clean_text(item.get("stock_code"))
            code = clean_text(item.get("code"))
            if name and stock_code:
                values.append(f"{name}({stock_code})")
            elif name and code:
                values.append(f"{name}({code})")
            elif name:
                values.append(name)
    return "、".join(dict.fromkeys(value for value in values if value))


def fetch_stcn_fast(pattern: re.Pattern[str], max_items: int, hours: float | None = None) -> dict[str, Any]:
    source = "证券时报/人民财讯快讯"
    data = request_json(
        "https://www.stcn.com/article/list.html",
        {"type": "kx"},
        referer="https://www.stcn.com/article/list/kx.html",
        extra_headers={"X-Requested-With": "XMLHttpRequest"},
    )
    rows = data.get("data", [])
    hits: list[dict[str, Any]] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        title = clean_text(row.get("title"))
        content = clean_text(row.get("content"))
        tags = stcn_tag_text(row.get("tags"))
        haystack = " ".join([title, content, tags, clean_text(row.get("source"))])
        if pattern.search(haystack):
            summary_parts = [content]
            if tags:
                summary_parts.append(f"标签/相关: {tags}")
            if row.get("source"):
                summary_parts.append(f"来源: {clean_text(row.get('source'))}")
            if row.get("isRed") or row.get("red"):
                summary_parts.append("标记: red")
            url = clean_text(row.get("share_url") or row.get("web_url") or row.get("url"))
            if url.startswith("/"):
                url = "https://www.stcn.com" + url
            when = row.get("time") or row.get("show_time") or ""
            add_hit(hits, source, title, " | ".join(part for part in summary_parts if part), when, url)
    hits = filter_by_hours(hits, hours)[:max_items]
    return {"source": source, "ok": True, "hits": hits}


def fetch_21jingji_fast(pattern: re.Pattern[str], max_items: int, hours: float | None = None) -> dict[str, Any]:
    source = "南财快讯/21经济网"
    data = request_json(
        "https://api.21jingji.com/timestream/getListweb",
        {"page": "1"},
        referer="https://www.21jingji.com/",
    )
    rows = data.get("data") or data.get("list") or []
    if isinstance(rows, dict):
        rows = rows.get("list") or rows.get("data") or []
    hits: list[dict[str, Any]] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        title = clean_text(row.get("title"))
        content = clean_text(row.get("content"))
        keywords = clean_text(row.get("keywords"))
        related = related_stock_text(row)
        flag_parts = [
            f"{field}={clean_text(row.get(field))}"
            for field in ("important", "warning", "redMark", "riskrating", "isCredible")
            if clean_text(row.get(field))
        ]
        haystack = " ".join([title, content, keywords, related])
        if pattern.search(haystack):
            summary_parts = [content]
            if keywords:
                summary_parts.append(f"关键词: {keywords}")
            if related:
                summary_parts.append(f"相关: {related}")
            if flag_parts:
                summary_parts.append(f"标记: {', '.join(flag_parts)}")
            when = row.get("updatetime") or row.get("inputtime") or ""
            if row.get("inputtime") and row.get("updatetime"):
                summary_parts.append(f"时间: input={row.get('inputtime')}, update={row.get('updatetime')}")
            add_hit(
                hits,
                source,
                title,
                " | ".join(part for part in summary_parts if part),
                when,
                row.get("url") or row.get("sourceLink") or "",
            )
    hits = filter_by_hours(hits, hours)[:max_items]
    return {"source": source, "ok": True, "hits": hits}


def fetch_ths_fast(pattern: re.Pattern[str], max_items: int, hours: float | None = None) -> dict[str, Any]:
    source = "同花顺财经直播"
    params = {"page": "1", "tag": "", "track": "website"}
    data = request_json(
        "https://news.10jqka.com.cn/tapp/news/push/stock",
        params,
        referer="https://news.10jqka.com.cn/realtimenews.html",
    )
    rows = data.get("data", {}).get("list", [])
    hits: list[dict[str, Any]] = []
    for row in rows:
        title = clean_text(row.get("title"))
        summary = clean_text(row.get("digest"))
        if pattern.search(f"{title} {summary}"):
            add_hit(hits, source, title, summary, str(row.get("rtime", "")), row.get("url", ""))
    hits = filter_by_hours(hits, hours)[:max_items]
    return {"source": source, "ok": True, "hits": hits}


def fetch_futu_fast(pattern: re.Pattern[str], max_items: int, hours: float | None = None) -> dict[str, Any]:
    source = "富途牛牛快讯"
    data = request_json(
        "https://news.futunn.com/news-site-api/main/get-flash-list",
        {"pageSize": "50"},
        referer="https://news.futunn.com/main/live",
    )
    rows = data.get("data", {}).get("data", {}).get("news", [])
    hits: list[dict[str, Any]] = []
    for row in rows:
        title = clean_text(row.get("title"))
        summary = clean_text(row.get("content"))
        if pattern.search(f"{title} {summary}"):
            add_hit(hits, source, title, summary, str(row.get("time", "")), row.get("detailUrl", ""))
    hits = filter_by_hours(hits, hours)[:max_items]
    return {"source": source, "ok": True, "hits": hits}


def safe_fetch(name: str, func) -> dict[str, Any]:
    try:
        return func()
    except Exception as exc:  # noqa: BLE001 - this is a diagnostic script
        return {"source": name, "ok": False, "error": f"{type(exc).__name__}: {exc}", "hits": []}


def local_status() -> dict[str, Any]:
    return {
        "akshare_root": str(DEFAULT_AKSHARE_ROOT),
        "akshare_present": DEFAULT_AKSHARE_ROOT.exists(),
        "daily_stock_analysis_root": str(DEFAULT_DAILY_ROOT),
        "daily_stock_analysis_present": DEFAULT_DAILY_ROOT.exists(),
        "configured_env": {name: bool(os.environ.get(name)) for name in KEY_ENV_NAMES},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe stock-market research sources.")
    parser.add_argument("--keyword", default="黄金", help="Keyword for news filtering/search.")
    parser.add_argument("--fetch", action="store_true", help="Fetch public finance-news endpoints.")
    parser.add_argument("--max-items", type=int, default=20, help="Max hits per source.")
    parser.add_argument("--hours", type=float, default=None, help="Only keep hits within this many hours.")
    parser.add_argument("--eastmoney-pages", type=int, default=3, help="Eastmoney kuaixun v2 pages to scan.")
    parser.add_argument("--eastmoney-page-size", type=int, default=100, help="Eastmoney kuaixun v2 page size, capped at 100.")
    args = parser.parse_args()

    result: dict[str, Any] = {
        "keyword": args.keyword,
        "local_status": local_status(),
        "sources": [],
    }

    if args.fetch:
        pattern = keyword_pattern(args.keyword)
        result["sources"] = [
            safe_fetch(
                "东方财富快讯雷达",
                lambda: fetch_eastmoney_radar(
                    args.keyword,
                    pattern,
                    args.max_items,
                    args.hours,
                    args.eastmoney_pages,
                    args.eastmoney_page_size,
                ),
            ),
            safe_fetch("东方财富站内新闻搜索", lambda: fetch_eastmoney_search(args.keyword, args.max_items, args.hours)),
            safe_fetch("新浪财经7x24", lambda: fetch_sina_fast(pattern, args.max_items, args.hours)),
            safe_fetch("财联社电报", lambda: fetch_cls(pattern, args.max_items, args.hours)),
            safe_fetch("证券时报/人民财讯快讯", lambda: fetch_stcn_fast(pattern, args.max_items, args.hours)),
            safe_fetch("南财快讯/21经济网", lambda: fetch_21jingji_fast(pattern, args.max_items, args.hours)),
            safe_fetch("同花顺财经直播", lambda: fetch_ths_fast(pattern, args.max_items, args.hours)),
            safe_fetch("富途牛牛快讯", lambda: fetch_futu_fast(pattern, args.max_items, args.hours)),
        ]

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
