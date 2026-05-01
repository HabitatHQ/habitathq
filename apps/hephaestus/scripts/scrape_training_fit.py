#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "httpx>=0.27",
#   "beautifulsoup4>=4.12",
#   "lxml>=5.0",
# ]
# ///
"""
Scrape exercise images + metadata from training.fit.

Output layout:
  out/
    images/          ← downloaded exercise images (PNG/GIF/WebP/JPG)
    exercises.json   ← index with name, muscles, equipment, movement, image path
"""

import json
import random
import re
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL = "https://training.fit"
OUT_DIR = Path("out")
IMAGES_DIR = OUT_DIR / "images"

# Muscle-group listing pages (all exercises for that group)
MUSCLE_GROUP_PATHS = [
    "/abs-training/",
    "/back-training/",
    "/biceps-training/",
    "/butt-training/",
    "/calves-training/",
    "/chest-training/",
    "/forearms-training/",
    "/neck-training/",
    "/shoulders-training/",
    "/triceps-training/",
    "/thighs-training/",
]

# Polite delay range between requests (seconds)
DELAY_MIN = 1.0
DELAY_MAX = 3.0

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


# ── Helpers ───────────────────────────────────────────────────────────────────


def sleep_politely() -> None:
    delay = random.uniform(DELAY_MIN, DELAY_MAX)
    time.sleep(delay)


def fetch(client: httpx.Client, url: str) -> BeautifulSoup | None:
    """GET url, return parsed soup or None on error."""
    try:
        r = client.get(url, follow_redirects=True, timeout=15)
        r.raise_for_status()
        return BeautifulSoup(r.text, "lxml")
    except httpx.HTTPError as e:
        print(f"  [WARN] fetch failed: {url} — {e}")
        return None


def slug_from_url(url: str) -> str:
    """'/exercise/bench-press/' → 'bench-press'"""
    parts = [p for p in urlparse(url).path.strip("/").split("/") if p]
    return parts[-1] if parts else "unknown"


def ext_from_content_type(ct: str, fallback_url: str) -> str:
    """Return file extension (.png, .gif, .jpg, .webp) from Content-Type header."""
    ct = ct.split(";")[0].strip().lower()
    mapping = {
        "image/gif": ".gif",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/avif": ".avif",
    }
    if ct in mapping:
        return mapping[ct]
    # Fall back to URL extension
    path = urlparse(fallback_url).path
    suffix = Path(path).suffix
    return suffix if suffix else ".img"


def download_image(client: httpx.Client, url: str, slug: str) -> str | None:
    """Download image to IMAGES_DIR/<slug><ext>. Returns relative path or None."""
    try:
        r = client.get(url, follow_redirects=True, timeout=30)
        r.raise_for_status()
        ct = r.headers.get("content-type", "")
        ext = ext_from_content_type(ct, url)
        dest = IMAGES_DIR / f"{slug}{ext}"
        dest.write_bytes(r.content)
        return str(dest.relative_to(OUT_DIR))
    except httpx.HTTPError as e:
        print(f"  [WARN] image download failed: {url} — {e}")
        return None


# ── Scrapers ──────────────────────────────────────────────────────────────────


def scrape_exercise_urls(client: httpx.Client, group_path: str) -> list[str]:
    """Return list of absolute exercise URLs from a muscle-group listing page."""
    url = BASE_URL + group_path
    print(f"[LIST] {url}")
    soup = fetch(client, url)
    if soup is None:
        return []

    urls: list[str] = []
    for a in soup.select("a[href*='/exercise/']"):
        href = a.get("href", "")
        if href and "/exercise/" in href:
            abs_url = urljoin(BASE_URL, href)
            # Normalise to bare exercise URL (no query params / anchors)
            parsed = urlparse(abs_url)
            clean = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            if clean not in urls:
                urls.append(clean)

    sleep_politely()
    return urls


def extract_muscles_from_jsonld(soup: BeautifulSoup) -> list[str]:
    """Parse schema.org HowTo JSON-LD to extract muscle names."""
    muscles: list[str] = []
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.string or "")
            if not isinstance(data, dict):
                continue
            # HowTo supply → description field or name
            items = data.get("supply", [])
            if not isinstance(items, list):
                items = [items]
            for item in items:
                if isinstance(item, dict):
                    name = item.get("name", "")
                    if name:
                        muscles.append(name)
        except (json.JSONDecodeError, AttributeError):
            continue
    return muscles


def scrape_exercise(client: httpx.Client, url: str) -> dict | None:
    """Fetch a single exercise page and return its metadata dict."""
    slug = slug_from_url(url)
    print(f"  [EX] {slug}")
    soup = fetch(client, url)
    if soup is None:
        return None

    # ── Name ──────────────────────────────────────────────────────────────────
    name = ""
    h1 = soup.find("h1")
    if h1:
        name = h1.get_text(strip=True)

    # ── Image ─────────────────────────────────────────────────────────────────
    image_url = ""
    # Primary signal: img with alt containing "Movement sequence"
    img = soup.find("img", alt=re.compile(r"movement sequence", re.I))
    if img:
        image_url = img.get("src") or img.get("data-src") or ""
    # Fallback: look for wp-content image near main article
    if not image_url:
        for img_tag in soup.select("article img, .entry-content img, main img"):
            src = img_tag.get("src") or img_tag.get("data-src") or ""
            if "wp-content/uploads" in src and not src.endswith(".svg"):
                image_url = src
                break
    if image_url and not image_url.startswith("http"):
        image_url = urljoin(BASE_URL, image_url)

    # ── Muscles ───────────────────────────────────────────────────────────────
    muscles = extract_muscles_from_jsonld(soup)
    # Fallback: look for a muscles table/list in page body
    if not muscles:
        for el in soup.select("table td, .muscles li, [class*='muscle'] li"):
            text = el.get_text(strip=True)
            if text and len(text) < 80:
                muscles.append(text)
    muscles = list(dict.fromkeys(muscles))  # deduplicate preserving order

    # ── Equipment ─────────────────────────────────────────────────────────────
    equipment: list[str] = []
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.string or "")
            if not isinstance(data, dict):
                continue
            tools = data.get("tool", [])
            if not isinstance(tools, list):
                tools = [tools]
            for t in tools:
                if isinstance(t, dict):
                    n = t.get("name", "")
                    if n:
                        equipment.append(n)
                elif isinstance(t, str) and t:
                    equipment.append(t)
        except (json.JSONDecodeError, AttributeError):
            continue

    # ── Category / movement type ──────────────────────────────────────────────
    category = ""
    # training.fit often lists "Compound exercise" or "Isolation exercise" in a
    # definition list or metadata block near the top
    for el in soup.select("dl dt, .exercise-meta dt, [class*='category']"):
        text = el.get_text(strip=True).lower()
        if "categor" in text or "type" in text or "exercise" in text:
            dd = el.find_next_sibling("dd")
            if dd:
                category = dd.get_text(strip=True)
                break
    # Second pass: look for text patterns in the page
    if not category:
        page_text = soup.get_text(" ", strip=True)
        for pat in [
            r"(compound exercise)",
            r"(isolation exercise)",
            r"(bodyweight exercise)",
            r"(machine exercise)",
        ]:
            m = re.search(pat, page_text, re.I)
            if m:
                category = m.group(1).title()
                break

    # ── Download image ────────────────────────────────────────────────────────
    image_path = None
    if image_url:
        # Re-use slug but check if file already downloaded (resume support)
        existing = list(IMAGES_DIR.glob(f"{slug}.*"))
        if existing:
            image_path = str(existing[0].relative_to(OUT_DIR))
            print(f"    [SKIP] image already exists: {image_path}")
        else:
            sleep_politely()
            image_path = download_image(client, image_url, slug)

    sleep_politely()

    return {
        "slug": slug,
        "name": name,
        "url": url,
        "image_url": image_url,
        "image_path": image_path,
        "muscles": muscles,
        "equipment": equipment,
        "category": category,
    }


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    IMAGES_DIR.mkdir(exist_ok=True)

    index_path = OUT_DIR / "exercises.json"

    # Load existing index to support resuming interrupted runs
    existing: dict[str, dict] = {}
    if index_path.exists():
        try:
            for entry in json.loads(index_path.read_text()):
                existing[entry["slug"]] = entry
            print(f"[RESUME] loaded {len(existing)} existing entries")
        except (json.JSONDecodeError, KeyError):
            pass

    all_exercise_urls: list[str] = []

    with httpx.Client(headers=HEADERS) as client:
        # Phase 1: collect exercise URLs from all muscle-group pages
        print("\n=== Phase 1: collecting exercise URLs ===")
        for group_path in MUSCLE_GROUP_PATHS:
            urls = scrape_exercise_urls(client, group_path)
            print(f"  found {len(urls)} exercises in {group_path}")
            for u in urls:
                if u not in all_exercise_urls:
                    all_exercise_urls.append(u)

        print(f"\nTotal unique exercises found: {len(all_exercise_urls)}")

        # Phase 2: scrape each exercise page
        print("\n=== Phase 2: scraping exercise pages ===")
        results: list[dict] = []
        for i, url in enumerate(all_exercise_urls, 1):
            slug = slug_from_url(url)
            if slug in existing:
                print(f"  [{i}/{len(all_exercise_urls)}] SKIP (cached): {slug}")
                results.append(existing[slug])
                continue

            print(f"  [{i}/{len(all_exercise_urls)}]", end=" ")
            entry = scrape_exercise(client, url)
            if entry:
                results.append(entry)
                # Write index after every exercise (crash-safe)
                index_path.write_text(json.dumps(results, indent=2, ensure_ascii=False))

    # Final write
    index_path.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    succeeded = sum(1 for r in results if r.get("image_path"))
    print(f"\n=== Done ===")
    print(f"  {len(results)} exercises scraped")
    print(f"  {succeeded} images downloaded")
    print(f"  Index: {index_path}")
    print(f"  Images: {IMAGES_DIR}/")


if __name__ == "__main__":
    main()
