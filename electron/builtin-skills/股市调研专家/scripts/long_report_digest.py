#!/usr/bin/env python3
"""Extract a compact evidence pack from long financial reports."""

from __future__ import annotations

import argparse
import html
import io
import json
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any


HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "text/html,application/pdf,text/plain,*/*"}
FINANCIAL_PATTERNS = re.compile(
    r"\b(revenue|net sales|sales|net income|earnings|eps|cash flow|operating cash|capital expenditure|capex|gross margin|operating margin|free cash flow|dividend|buyback)\b",
    re.IGNORECASE,
)
RISK_PATTERNS = re.compile(
    r"\b(risk|uncertain|regulation|competition|foreign exchange|supply chain|tariff|litigation|concentration|macro|geopolitical)\b",
    re.IGNORECASE,
)
NOISE_PATTERNS = re.compile(
    r"\b(unregistered sales of equity securities|regulation s-t|table of contents|shares used in computing earnings per share)\b",
    re.IGNORECASE,
)


def read_source(file_path: str = "", url: str = "") -> tuple[str, str]:
    if file_path:
        path = Path(file_path)
        data = path.read_bytes()
        return extract_text(data, source=str(path), content_type="", suffix=path.suffix.lower()), str(path)
    if url:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=30) as response:
            data = response.read()
            content_type = response.headers.get("Content-Type", "")
        return extract_text(data, source=url, content_type=content_type, suffix=Path(url).suffix.lower()), url
    raise ValueError("Either file_path or url is required")


def extract_text(data: bytes, source: str, content_type: str = "", suffix: str = "") -> str:
    kind = f"{content_type} {suffix}".lower()
    if "pdf" in kind:
        return extract_pdf_text(data, source)
    text = data.decode("utf-8", errors="replace")
    if "<html" in text.lower() or re.search(r"<(body|table|p|div|span|html)\b", text, re.IGNORECASE):
        text = strip_html(text)
    return normalize_text(text)


def extract_pdf_text(data: bytes, source: str) -> str:
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception as exc:  # noqa: BLE001 - optional dependency diagnostic
        raise RuntimeError("PDF extraction requires pypdf; use a text/HTML file or run with a Python environment that has pypdf.") from exc
    reader = PdfReader(io.BytesIO(data))
    parts: list[str] = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    text = "\n".join(parts)
    if not text.strip():
        raise ValueError(f"No extractable text found in PDF: {source}")
    return normalize_text(text)


def strip_html(text: str) -> str:
    text = re.sub(r"(?is)<script.*?</script>|<style.*?</style>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</tr>|</li>|</h[1-6]>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    return normalize_text(html.unescape(text))


def normalize_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_sentences(text: str) -> list[str]:
    chunks = re.split(r"(?<=[.!?。！？])\s+|\n+", text)
    return [re.sub(r"\s+", " ", chunk).strip() for chunk in chunks if len(chunk.strip()) >= 30]


def build_digest(text: str, source: str = "", max_highlights: int = 12) -> dict[str, Any]:
    clean = normalize_text(text)
    sentences = split_sentences(clean)
    financial = select_highlights(sentences, FINANCIAL_PATTERNS, max_highlights)
    risks = select_highlights(sentences, RISK_PATTERNS, max_highlights)
    return {
        "source": source,
        "character_count": len(clean),
        "word_count": len(re.findall(r"\w+", clean)),
        "sentence_count": len(sentences),
        "financial_highlights": financial,
        "risk_highlights": risks,
        "summary_skeleton": {
            "business_context": first_nonempty(sentences),
            "key_metrics": financial[:6],
            "risks": risks[:6],
            "missing": missing_sections(financial, risks),
        },
        "note": "Extractive evidence pack only. The final summary should still verify periods, units, and source reliability.",
    }


def select_highlights(sentences: list[str], pattern: re.Pattern[str], limit: int) -> list[str]:
    selected: list[str] = []
    seen: set[str] = set()
    for sentence in sentences:
        if NOISE_PATTERNS.search(sentence):
            continue
        if not pattern.search(sentence):
            continue
        compact = sentence[:600]
        key = compact.lower()
        if key in seen:
            continue
        selected.append(compact)
        seen.add(key)
        if len(selected) >= limit:
            break
    return selected


def first_nonempty(sentences: list[str]) -> str:
    return sentences[0] if sentences else ""


def missing_sections(financial: list[str], risks: list[str]) -> list[str]:
    missing: list[str] = []
    if not financial:
        missing.append("financial_highlights")
    if not risks:
        missing.append("risk_highlights")
    return missing


def render_markdown(payload: dict[str, Any]) -> str:
    lines = [
        f"# Long Report Digest: {payload['source']}",
        "",
        f"- Characters: {payload['character_count']}",
        f"- Words: {payload['word_count']}",
        f"- Sentences: {payload['sentence_count']}",
        "",
        "## Financial Highlights",
    ]
    for item in payload["financial_highlights"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## Risk Highlights")
    for item in payload["risk_highlights"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append(payload["note"])
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract a digest from a long financial report.")
    parser.add_argument("--file", default="", help="Local text, HTML, or PDF path.")
    parser.add_argument("--url", default="", help="Remote text, HTML, or PDF URL.")
    parser.add_argument("--max-highlights", type=int, default=12, help="Maximum highlights per category.")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of Markdown.")
    args = parser.parse_args()

    if bool(args.file) == bool(args.url):
        parser.error("Provide exactly one of --file or --url")
    text, source = read_source(file_path=args.file, url=args.url)
    payload = build_digest(text, source=source, max_highlights=args.max_highlights)

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(payload))
    return 0


if __name__ == "__main__":
    sys.exit(main())
