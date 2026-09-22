#!/usr/bin/env python3
"""Import an EPUB into the Co-Reading MCP chunk format.

This is deliberately dependency-light. It reads the EPUB zip, extracts XHTML/HTML
documents in spine order when possible, falls back to all HTML files otherwise,
strips tags, and writes chunks while preserving spine item boundaries.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from import_text import slugify, write_book_sections


CONTAINER = "META-INF/container.xml"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def ns_name(name: str) -> str:
    return name.split("}", 1)[-1]


def strip_tags(raw: str) -> str:
    raw = re.sub(r"(?is)<[^>]+>", " ", raw)
    raw = html.unescape(raw)
    raw = re.sub(r"\s+", " ", raw)
    return raw.strip()


def title_from_html(raw: str) -> str | None:
    for match in re.finditer(r"(?is)<h[1-3][^>]*>(.*?)</h[1-3]>", raw):
        title = strip_tags(match.group(1))
        if title:
            return title
    title_match = re.search(r"(?is)<title[^>]*>(.*?)</title>", raw)
    if title_match:
        title = strip_tags(title_match.group(1))
        if title:
            return title
    return None


def text_from_html(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
    raw = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?i)</(p|div|section|article|h[1-6]|li|tr)>", "\n\n", raw)
    raw = re.sub(r"(?is)<[^>]+>", " ", raw)
    raw = html.unescape(raw)
    raw = re.sub(r"[ \t\r\f\v]+", " ", raw)
    raw = re.sub(r"\n\s*\n\s*\n+", "\n\n", raw)
    return raw.strip()


def sections_from_html_headings(raw: str) -> list[dict[str, str]]:
    matches = list(re.finditer(r"(?is)<h[1-3][^>]*>.*?</h[1-3]>", raw))
    if len(matches) < 2:
        return []

    sections = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(raw)
        title = strip_tags(match.group(0)) or f"Section {index + 1}"
        text = text_from_html(raw[start:end])
        if text:
            sections.append({"title": title, "text": text})
    return sections


def should_split_html_by_headings(raw: str, text: str, ordered_count: int) -> bool:
    sections = sections_from_html_headings(raw)
    return len(sections) >= 2 and (ordered_count == 1 or len(text) > 12000)


def clean_metadata_title(value: str | None, fallback: str) -> str:
    title = (value or "").strip()
    if not title or title.lower() in {"unknown", "untitled", "administrator"} or len(title) <= 1:
        return fallback
    return title


def clean_metadata_author(value: str | None, title: str) -> str | None:
    author = (value or "").strip()
    if not author or author.lower() in {"unknown", "administrator"} or author == title:
        return None
    return author


def find_opf_path(zf: zipfile.ZipFile) -> str | None:
    try:
        root = ET.fromstring(zf.read(CONTAINER))
    except Exception:
        return None

    for element in root.iter():
        if ns_name(element.tag) == "rootfile":
            full_path = element.attrib.get("full-path")
            if full_path:
                return full_path
    return None


def parse_opf(
    zf: zipfile.ZipFile, opf_path: str
) -> tuple[str | None, str | None, list[str], dict[str, str]]:
    root = ET.fromstring(zf.read(opf_path))
    opf_dir = str(Path(opf_path).parent)
    if opf_dir == ".":
        opf_dir = ""

    title = None
    author = None
    manifest: dict[str, str] = {}
    spine_ids: list[str] = []
    toc_path = None

    for element in root.iter():
        local = ns_name(element.tag)
        if local == "title" and element.text and title is None:
            title = element.text.strip()
        elif local == "creator" and element.text and author is None:
            author = element.text.strip()
        elif local == "item":
            item_id = element.attrib.get("id")
            href = element.attrib.get("href")
            media_type = element.attrib.get("media-type", "")
            properties = element.attrib.get("properties", "")
            if item_id and href and ("html" in media_type or href.lower().endswith((".html", ".xhtml", ".htm"))):
                manifest[item_id] = str(Path(opf_dir) / href) if opf_dir else href
            if href and ("nav" in properties.split() or media_type == "application/x-dtbncx+xml"):
                toc_path = str(Path(opf_dir) / href) if opf_dir else href
        elif local == "itemref":
            ref = element.attrib.get("idref")
            if ref:
                spine_ids.append(ref)

    ordered = [manifest[item_id] for item_id in spine_ids if item_id in manifest]
    toc_titles = parse_toc_titles(zf, toc_path, opf_dir) if toc_path else {}
    return title, author, ordered, toc_titles


def find_cover_image(zf: zipfile.ZipFile, opf_path: str | None) -> tuple[str, bytes] | None:
    """Return the best EPUB cover image path and bytes, if one exists."""
    candidates: list[tuple[int, str]] = []
    if opf_path:
        try:
            root = ET.fromstring(zf.read(opf_path))
            opf_dir = str(Path(opf_path).parent)
            if opf_dir == ".":
                opf_dir = ""
            cover_id = None
            for element in root.iter():
                if ns_name(element.tag) == "meta" and element.attrib.get("name", "").lower() == "cover":
                    cover_id = element.attrib.get("content")
            for element in root.iter():
                if ns_name(element.tag) != "item":
                    continue
                item_id = element.attrib.get("id", "")
                href = element.attrib.get("href", "")
                media_type = element.attrib.get("media-type", "")
                properties = element.attrib.get("properties", "")
                if not href or not (media_type.startswith("image/") or Path(href).suffix.lower() in IMAGE_EXTENSIONS):
                    continue
                resolved = str(Path(opf_dir) / href) if opf_dir else href
                score = 0
                if "cover-image" in properties.split():
                    score += 100
                if cover_id and item_id == cover_id:
                    score += 90
                if "cover" in item_id.lower():
                    score += 50
                if "cover" in Path(href).stem.lower():
                    score += 40
                candidates.append((score, resolved))
        except Exception:
            pass

    if not candidates:
        for name in zf.namelist():
            if Path(name).suffix.lower() in IMAGE_EXTENSIONS and "cover" in Path(name).stem.lower():
                candidates.append((10, name))

    for _, name in sorted(candidates, key=lambda item: item[0], reverse=True):
        try:
            data = zf.read(name)
            if len(data) >= 128:
                return name, data
        except KeyError:
            continue
    return None


def parse_toc_titles(zf: zipfile.ZipFile, toc_path: str, opf_dir: str) -> dict[str, str]:
    try:
        raw = zf.read(toc_path)
    except KeyError:
        return {}

    titles: dict[str, str] = {}
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return titles

    def normalize_href(href: str) -> str:
        href = href.split("#", 1)[0]
        if not href:
            return href
        return str(Path(opf_dir) / href) if opf_dir and not href.startswith(opf_dir) else href

    parent_map = {child: parent for parent in root.iter() for child in parent}
    for element in root.iter():
        if ns_name(element.tag) == "content":
            src = element.attrib.get("src", "")
            parent = parent_map.get(element)
            parent_text = "".join(parent.itertext()).strip() if parent is not None else None
            # NCX puts text in a nearby navLabel; ElementTree has no parent links,
            # so NCX titles are handled in the navPoint loop below.
            if src and parent_text:
                titles[normalize_href(src)] = parent_text

    for nav_point in root.iter():
        if ns_name(nav_point.tag) != "navPoint":
            continue
        label = None
        src = None
        for child in nav_point.iter():
            local = ns_name(child.tag)
            if local == "text" and child.text and label is None:
                label = child.text.strip()
            elif local == "content" and src is None:
                src = child.attrib.get("src")
        if label and src:
            titles[normalize_href(src)] = label

    for anchor in root.iter():
        if ns_name(anchor.tag) != "a":
            continue
        href = anchor.attrib.get("href")
        text = "".join(anchor.itertext()).strip()
        if href and text:
            titles[normalize_href(href)] = text

    return titles


def html_files(zf: zipfile.ZipFile) -> list[str]:
    return sorted(
        name
        for name in zf.namelist()
        if name.lower().endswith((".html", ".xhtml", ".htm")) and not name.endswith("/")
    )


def read_epub(path: Path) -> tuple[str | None, str | None, list[dict[str, str]], tuple[str, bytes] | None]:
    with zipfile.ZipFile(path) as zf:
        opf_path = find_opf_path(zf)
        title = None
        author = None
        ordered: list[str] = []
        toc_titles: dict[str, str] = {}
        if opf_path:
            try:
                title, author, ordered, toc_titles = parse_opf(zf, opf_path)
            except Exception:
                ordered = []
        if not ordered:
            ordered = html_files(zf)

        cover = find_cover_image(zf, opf_path)
        sections = []
        for index, name in enumerate(ordered):
            try:
                raw = zf.read(name).decode("utf-8")
            except UnicodeDecodeError:
                raw = zf.read(name).decode("utf-8", errors="ignore")
            except KeyError:
                continue
            text = text_from_html(raw)
            if should_split_html_by_headings(raw, text, len(ordered)):
                for section_index, section in enumerate(sections_from_html_headings(raw)):
                    sections.append(
                        {
                            "title": section["title"],
                            "text": section["text"],
                            "sourcePath": f"{name}#heading-{section_index + 1}",
                        }
                    )
                continue
            if text:
                section_title = toc_titles.get(name) or title_from_html(raw) or f"Section {index + 1}"
                sections.append({"title": section_title, "text": text, "sourcePath": name})

    return title, author, sections, cover


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--title")
    parser.add_argument("--author")
    parser.add_argument("--book-id")
    parser.add_argument("--out", type=Path, default=Path("data/books"))
    parser.add_argument("--max-chars", type=int, default=6000)
    args = parser.parse_args()

    title, author, sections, cover = read_epub(args.input)
    final_title = args.title or clean_metadata_title(title, args.input.stem)
    final_author = args.author or clean_metadata_author(author, final_title)
    if not final_author and args.title and title and title != final_title:
        maybe_author = clean_metadata_title(title, "")
        if maybe_author and maybe_author != final_title:
            final_author = maybe_author
    book_id = args.book_id or slugify(final_title)

    if not sections:
        print("No readable text found in EPUB", file=sys.stderr)
        raise SystemExit(1)

    book_dir = write_book_sections(
        sections,
        final_title,
        final_author,
        args.out,
        book_id,
        args.max_chars,
        {"type": "epub", "fileName": args.input.name},
    )
    if cover:
        cover_path, cover_bytes = cover
        extension = Path(cover_path).suffix.lower()
        if extension not in IMAGE_EXTENSIONS:
            extension = ".jpg"
        cover_name = f"cover{extension}"
        (book_dir / cover_name).write_bytes(cover_bytes)
        manifest_path = book_dir / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["coverFile"] = cover_name
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(book_dir)


if __name__ == "__main__":
    main()
