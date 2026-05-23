#!/usr/bin/env python3
"""Probe browser-only market APIs through chrome-devtools CLI.

Some finance sites serve useful data only in a browser session, via JSONP,
same-site credentials, or anti-bot cookies. This script keeps those probes
explicit instead of pretending every endpoint is a plain curl target.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from typing import Any


def run_devtools(args: list[str], timeout: int = 30) -> dict[str, Any]:
    proc = subprocess.run(
        ["chrome-devtools", *args, "--output-format=json"],
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Unexpected chrome-devtools output: {proc.stdout[:500]}") from exc


def navigate(url: str, wait: float = 4.0) -> None:
    run_devtools(["navigate_page", "--url", url, "--timeout", "30000"], timeout=40)
    if wait:
        time.sleep(wait)


def parse_eval_payload(payload: dict[str, Any]) -> Any:
    message = payload.get("message", "")
    match = re.search(r"```json\n(.*?)\n```", message, re.S)
    if not match:
        return payload
    return json.loads(match.group(1))


def evaluate(script: str, timeout: int = 30) -> Any:
    return parse_eval_payload(run_devtools(["evaluate_script", script], timeout=timeout))


def eastmoney_concepts(keyword: str, page_size: int) -> dict[str, Any]:
    navigate("https://quote.eastmoney.com/center/gridlist.html#concept_board")
    script = f"""
async () => {{
  function jsonp(url) {{
    return new Promise((resolve, reject) => {{
      const cb = "cb_" + Math.random().toString(36).slice(2);
      window[cb] = data => {{ delete window[cb]; script.remove(); resolve(data); }};
      const script = document.createElement("script");
      script.onerror = () => reject(new Error("script load failed"));
      script.src = url + (url.includes("?") ? "&" : "?") + "cb=" + cb;
      document.body.appendChild(script);
      setTimeout(() => reject(new Error("timeout")), 10000);
    }});
  }}
  const url = "https://push2.eastmoney.com/api/qt/clist/get?np=1&fltt=1&invt=2"
    + "&fs=m:90%2Bt:3%2Bf:!50"
    + "&fields=f12,f13,f14,f2,f3,f4,f20,f8,f104,f105,f128,f140,f136,f207,f208,f222"
    + "&fid=f3&pn=1&pz={int(page_size)}&po=1&dect=1"
    + "&ut=fa5fd1943c7b386f172d6893dbfba10b&wbp2u=%7C0%7C0%7C0%7Cweb";
  const data = await jsonp(url);
  const re = new RegExp({json.dumps(keyword)}, "i");
  const rows = (data.data?.diff || []).filter(r => !{json.dumps(keyword)} || re.test(r.f14 || ""));
  return {{
    source: "Eastmoney concept board via browser JSONP",
    total: data.data?.total,
    hits: rows.map(r => ({{
      board_code: r.f12,
      market: r.f13,
      name: r.f14,
      latest: r.f2 == null ? null : r.f2 / 1000,
      change_pct: r.f3 == null ? null : r.f3 / 100,
      change: r.f4 == null ? null : r.f4 / 100,
      turnover_rate: r.f8 == null ? null : r.f8 / 100,
      total_market_cap: r.f20,
      up_count: r.f104,
      down_count: r.f105,
      lead_stock: r.f128,
      lead_stock_code: r.f140,
      lag_stock: r.f207,
      lag_stock_code: r.f208
    }}))
  }};
}}
"""
    return evaluate(script)


def eastmoney_constituents(board_code: str, page_size: int) -> dict[str, Any]:
    navigate(f"https://quote.eastmoney.com/bk/90.{board_code}.html")
    script = f"""
async () => {{
  function jsonp(url) {{
    return new Promise((resolve, reject) => {{
      const cb = "cb_" + Math.random().toString(36).slice(2);
      window[cb] = data => {{ delete window[cb]; script.remove(); resolve(data); }};
      const script = document.createElement("script");
      script.onerror = () => reject(new Error("script load failed"));
      script.src = url + (url.includes("?") ? "&" : "?") + "cb=" + cb;
      document.body.appendChild(script);
      setTimeout(() => reject(new Error("timeout")), 10000);
    }});
  }}
  const fields = "f14,f12,f13,f2,f4,f3,f152,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f109";
  const url = "https://push2.eastmoney.com/api/qt/clist/get?np=1&fltt=1&invt=2"
    + "&fs=b:{board_code}&fields=" + encodeURIComponent(fields)
    + "&fid=f62&pn=1&pz={int(page_size)}&po=1&dect=1"
    + "&ut=fa5fd1943c7b386f172d6893dbfba10b&wbp2u=%7C0%7C0%7C0%7Cweb";
  const data = await jsonp(url);
  return {{
    source: "Eastmoney concept constituents via browser JSONP",
    board_code: {json.dumps(board_code)},
    total: data.data?.total,
    hits: (data.data?.diff || []).map(r => ({{
      code: r.f12,
      market: r.f13,
      name: r.f14,
      price: r.f2 == null ? null : r.f2 / 100,
      change_pct: r.f3 == null ? null : r.f3 / 100,
      change: r.f4 == null ? null : r.f4 / 100,
      main_net_inflow: r.f62,
      main_net_inflow_pct: r.f184 == null ? null : r.f184 / 100,
      super_large_net_inflow: r.f66,
      super_large_net_inflow_pct: r.f69 == null ? null : r.f69 / 100,
      large_net_inflow: r.f72,
      large_net_inflow_pct: r.f75 == null ? null : r.f75 / 100,
      medium_net_inflow: r.f78,
      medium_net_inflow_pct: r.f81 == null ? null : r.f81 / 100,
      small_net_inflow: r.f84,
      small_net_inflow_pct: r.f87 == null ? null : r.f87 / 100,
      pe_dynamic: r.f109 == null ? null : r.f109 / 100
    }}))
  }};
}}
"""
    return evaluate(script)


def yahoo_quote(symbols: str) -> dict[str, Any]:
    first = symbols.split(",")[0].strip()
    navigate(f"https://finance.yahoo.com/quote/{first}/", wait=6)
    script = f"""
async () => {{
  const crumb = await (await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {{ credentials: "include" }})).text();
  const url = "https://query1.finance.yahoo.com/v7/finance/quote?symbols={symbols}&crumb=" + encodeURIComponent(crumb);
  const response = await fetch(url, {{ credentials: "include" }});
  return {{
    source: "Yahoo v7 quote via browser crumb/session",
    status: response.status,
    data: await response.json()
  }};
}}
"""
    return evaluate(script, timeout=40)


def cme_gold() -> dict[str, Any]:
    navigate("https://www.cmegroup.com/markets/metals/precious/gold.quotes.html", wait=8)
    script = """
async () => {
  const t = Date.now();
  const q = await fetch(`/CmeWS/mvc/quotes/v2/437?isProtected&_t=${t}`, { credentials: "include" });
  const cvol = await fetch(`/services/cvol?symbol=GCVL&isProtected&_t=${t}`, { credentials: "include" });
  return {
    source: "CME Gold product page via browser session",
    quotes_status: q.status,
    cvol_status: cvol.status,
    quotes: await q.json(),
    cvol: await cvol.json()
  };
}
"""
    return evaluate(script, timeout=45)


def hkex_stock(code: str) -> dict[str, Any]:
    normalized = code.zfill(5)
    navigate("https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh", wait=4)
    script = f"""
async () => {{
  const url = "https://www1.hkexnews.hk/search/prefix.do?callback=callback&lang=ZH&type=A&name={normalized}&market=SEHK";
  const data = await new Promise((resolve, reject) => {{
    window.callback = payload => resolve(payload);
    const script = document.createElement("script");
    script.onerror = () => reject(new Error("script load failed"));
    script.src = url;
    document.body.appendChild(script);
    setTimeout(() => reject(new Error("timeout")), 10000);
  }});
  const first = data.stockInfo?.[0] || null;
  const today = new Date();
  const from = new Date(today);
  from.setMonth(from.getMonth() - 1);
  const fmt = d => d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, "0")
    + String(d.getDate()).padStart(2, "0");
  const search_url = first ? "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh&category=0&market=SEHK&searchType=0&documentType=-1&t1code=-2&t2Gcode=-2&t2code=-2&stockId="
    + encodeURIComponent(first.stockId) + "&from=" + fmt(from) + "&to=" + fmt(today) + "&title=" : null;
  return {{
    source: "HKEX stock resolver and title search URL",
    requested_code: {json.dumps(normalized)},
    stock_info: data.stockInfo || [],
    search_url
  }};
}}
"""
    return evaluate(script)


def ths_concepts(keyword: str) -> dict[str, Any]:
    navigate("https://q.10jqka.com.cn/gn/", wait=5)
    script = f"""
() => {{
  const re = new RegExp({json.dumps(keyword)}, "i");
  const hits = Array.from(document.querySelectorAll("a"))
    .map(a => ({{ name: a.innerText.trim(), url: a.href }}))
    .filter(x => x.name && re.test(x.name) && /\\/gn\\/detail\\/code\\//.test(x.url));
  return {{
    source: "10jqka concept map from browser DOM",
    keyword: {json.dumps(keyword)},
    hits
  }};
}}
"""
    return evaluate(script)


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe browser-only market APIs through chrome-devtools.")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("eastmoney-concepts")
    p.add_argument("--keyword", default="")
    p.add_argument("--page-size", type=int, default=80)

    p = sub.add_parser("eastmoney-constituents")
    p.add_argument("--board-code", required=True)
    p.add_argument("--page-size", type=int, default=20)

    p = sub.add_parser("yahoo-quote")
    p.add_argument("--symbols", required=True)

    sub.add_parser("cme-gold")

    p = sub.add_parser("hkex-stock")
    p.add_argument("--code", required=True)

    p = sub.add_parser("ths-concepts")
    p.add_argument("--keyword", required=True)

    args = parser.parse_args()
    if args.command == "eastmoney-concepts":
        result = eastmoney_concepts(args.keyword, args.page_size)
    elif args.command == "eastmoney-constituents":
        result = eastmoney_constituents(args.board_code, args.page_size)
    elif args.command == "yahoo-quote":
        result = yahoo_quote(args.symbols)
    elif args.command == "cme-gold":
        result = cme_gold()
    elif args.command == "hkex-stock":
        result = hkex_stock(args.code)
    elif args.command == "ths-concepts":
        result = ths_concepts(args.keyword)
    else:
        raise AssertionError(args.command)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
