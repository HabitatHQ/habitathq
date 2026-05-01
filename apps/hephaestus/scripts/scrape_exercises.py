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
Aggregate exercise metadata from three sources and merge into seed.

Sources
-------
1. ExerciseDB v2   https://v2.exercisedb.dev      (1 300+ exercises, REST API)
2. wger.de         https://wger.de/api/v2/        (877 exercises, REST API)
3. VirtuaGym       https://exercises.virtuagym.com (2 500+ exercises, scraped HTML)

Output
------
app/assets/seed/exercises.json  — merged, deduplicated exercise list.
Existing entries are preserved unchanged; only new slugs are appended.

Resume support
--------------
Intermediate JSON files are written to scripts/cache/ so the script can
be re-run after interruption without re-fetching already-downloaded data.
"""

from __future__ import annotations

import json
import math
import re
import time
import random
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

# ── Paths ─────────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.parent
SEED_FILE = REPO_ROOT / "app" / "assets" / "seed" / "exercises.json"
CACHE_DIR = Path(__file__).parent / "cache"

# ── HTTP / retry config ───────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "application/json, text/html, */*",
}

# Polite inter-request delay (jitter applied on top)
DELAY_BASE = 0.8
DELAY_JITTER = 1.2  # uniform jitter [0, DELAY_JITTER]

# Exponential backoff: base_delay * (2 ** attempt) + jitter
BACKOFF_BASE = 2.0
BACKOFF_CAP = 60.0   # seconds
BACKOFF_JITTER = 1.0  # uniform jitter per backoff step
MAX_RETRIES = 5


def polite_sleep() -> None:
    time.sleep(DELAY_BASE + random.uniform(0, DELAY_JITTER))


def _backoff_delay(attempt: int) -> float:
    """Full-jitter exponential backoff (capped)."""
    cap = min(BACKOFF_CAP, BACKOFF_BASE * (2 ** attempt))
    return random.uniform(0, cap) + random.uniform(0, BACKOFF_JITTER)


def http_get_json(
    client: httpx.Client,
    url: str,
    *,
    retries: int = MAX_RETRIES,
) -> dict | list | None:
    for attempt in range(retries):
        try:
            r = client.get(url, timeout=20, follow_redirects=True)
            if r.status_code == 429:
                delay = _backoff_delay(attempt + 2)  # start steeper for rate-limits
                print(f"    [429] rate-limited — backing off {delay:.1f}s (attempt {attempt+1})")
                time.sleep(delay)
                continue
            if r.status_code >= 500:
                delay = _backoff_delay(attempt)
                print(f"    [{r.status_code}] server error — backing off {delay:.1f}s")
                time.sleep(delay)
                continue
            r.raise_for_status()
            return r.json()
        except httpx.TimeoutException:
            delay = _backoff_delay(attempt)
            print(f"    [TIMEOUT] {url} — retrying in {delay:.1f}s (attempt {attempt+1})")
            time.sleep(delay)
        except httpx.HTTPStatusError as e:
            print(f"    [HTTP {e.response.status_code}] {url}")
            return None
        except Exception as e:
            delay = _backoff_delay(attempt)
            print(f"    [ERR] {e} — retrying in {delay:.1f}s (attempt {attempt+1})")
            time.sleep(delay)
    print(f"    [FAIL] gave up after {retries} attempts: {url}")
    return None


def http_get_html(
    client: httpx.Client,
    url: str,
    *,
    retries: int = MAX_RETRIES,
) -> BeautifulSoup | None:
    for attempt in range(retries):
        try:
            r = client.get(url, timeout=20, follow_redirects=True)
            if r.status_code == 429:
                delay = _backoff_delay(attempt + 2)
                print(f"    [429] rate-limited — backing off {delay:.1f}s")
                time.sleep(delay)
                continue
            if r.status_code >= 500:
                delay = _backoff_delay(attempt)
                print(f"    [{r.status_code}] server error — backing off {delay:.1f}s")
                time.sleep(delay)
                continue
            r.raise_for_status()
            return BeautifulSoup(r.text, "lxml")
        except httpx.TimeoutException:
            delay = _backoff_delay(attempt)
            print(f"    [TIMEOUT] {url} — retrying in {delay:.1f}s")
            time.sleep(delay)
        except httpx.HTTPStatusError as e:
            print(f"    [HTTP {e.response.status_code}] {url}")
            return None
        except Exception as e:
            delay = _backoff_delay(attempt)
            print(f"    [ERR] {e} — retrying in {delay:.1f}s")
            time.sleep(delay)
    print(f"    [FAIL] gave up after {retries} attempts: {url}")
    return None


# ── Normalisation helpers ─────────────────────────────────────────────────────

def slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


# ── Canonical muscle names ────────────────────────────────────────────────────

_MUSCLE_MAP: list[tuple[re.Pattern[str], str]] = [
    # lower body
    (re.compile(r"quad|rectus femoris|vastus", re.I), "quads"),
    (re.compile(r"glute|gluteus", re.I), "glutes"),
    (re.compile(r"hamstring|biceps femoris", re.I), "hamstrings"),
    (re.compile(r"\badduct", re.I), "adductors"),
    (re.compile(r"\babduct|hip abduct", re.I), "abductors"),
    (re.compile(r"hip flexor|iliopsoas|psoas", re.I), "hip flexors"),
    (re.compile(r"calf|calves|gastrocnem|soleus", re.I), "calves"),
    (re.compile(r"tibialis", re.I), "shins"),
    # core
    (re.compile(r"\babs\b|abdomin|rectus abd", re.I), "abs"),
    (re.compile(r"obliq", re.I), "obliques"),
    (re.compile(r"\bcore\b|transversus", re.I), "core"),
    (re.compile(r"lower back|erector spinae|spinal erec|lumbar", re.I), "lower back"),
    # upper back
    (re.compile(r"lat\b|latissimus", re.I), "lats"),
    (re.compile(r"trap|trapezius", re.I), "traps"),
    (re.compile(r"rhomboid", re.I), "rhomboids"),
    (re.compile(r"rear delt|posterior delt", re.I), "rear delts"),
    (re.compile(r"upper back|mid back|middle back|teres", re.I), "upper back"),
    # chest
    (re.compile(r"chest|pector", re.I), "chest"),
    (re.compile(r"serratus", re.I), "serratus"),
    # shoulders
    (re.compile(r"shoulder|delt|rotator cuff", re.I), "shoulders"),
    # arms
    (re.compile(r"bicep|brachialis", re.I), "biceps"),
    (re.compile(r"tricep", re.I), "triceps"),
    (re.compile(r"forearm|wrist|brachioradialis", re.I), "forearms"),
    # other
    (re.compile(r"\bneck\b", re.I), "neck"),
]


def normalise_muscle(raw: str) -> str:
    raw = raw.strip()
    for pattern, canonical in _MUSCLE_MAP:
        if pattern.search(raw):
            return canonical
    return raw.lower().strip()


# ── Equipment subcategory (specific type) ────────────────────────────────────
# Maps raw equipment strings → EquipmentSub values (app/types/database.ts).
# Order matters: more-specific patterns come first.

_EQUIP_SUB_MAP: list[tuple[re.Pattern[str], str]] = [
    # Barbell family
    (re.compile(r"ez.?bar|ez.?curl|cambered", re.I), "ez-bar"),
    (re.compile(r"trap.?bar|hex.?bar", re.I), "trap-bar"),
    (re.compile(r"smith.?machine|guided.?bar", re.I), "smith-machine"),
    (re.compile(r"barbell|olympic.?bar|standard.?bar", re.I), "barbell"),
    # Dumbbell
    (re.compile(r"dumbbell", re.I), "dumbbell"),
    # Cable
    (re.compile(r"cable|pulley|string.?weight", re.I), "cable"),
    # Machine subtypes
    (re.compile(r"plate.?loaded|lever|hammer.?strength", re.I), "plate-loaded"),
    (re.compile(r"machine|selectoris|pec.?deck|leg.?press.?machine|hack.?squat.?machine", re.I), "selectorized"),
    # Bodyweight subtypes (check before generic 'bodyweight')
    (re.compile(r"pull.?up.?bar|chin.?up.?bar|dip.?bar", re.I), "pull-up-bar"),
    (re.compile(r"suspension|trx|gymnastic.?ring|ring\b", re.I), "suspension"),
    (re.compile(r"body.?weight|body.?only|no.?equip|none|own.?weight|gym.?mat\b|mat\b", re.I), "bodyweight"),
    # Accessories
    (re.compile(r"kettlebell|kettle.?bell", re.I), "kettlebell"),
    (re.compile(r"resistance.?band|band\b|tube\b|loop.?band", re.I), "bands"),
    (re.compile(r"swiss.?ball|stability.?ball|exercise.?ball|bosu", re.I), "swiss-ball"),
    (re.compile(r"medicine.?ball|med.?ball|wall.?ball", re.I), "medicine-ball"),
    (re.compile(r"foam.?roll|foam.?roller", re.I), "foam-roller"),
    (re.compile(r"sled|prowler", re.I), "sled"),
]

# Category derived from subcategory (mirrors equipmentCategory() in database.ts)
_SUB_TO_CATEGORY: dict[str, str] = {
    "barbell":       "barbell",
    "ez-bar":        "barbell",
    "trap-bar":      "barbell",
    "smith-machine": "barbell",
    "dumbbell":      "dumbbell",
    "cable":         "cable",
    "selectorized":  "machine",
    "plate-loaded":  "machine",
    "bodyweight":    "bodyweight",
    "pull-up-bar":   "bodyweight",
    "suspension":    "bodyweight",
    # everything else → 'other'
}


def normalise_equipment(raw: str) -> tuple[str, str]:
    """Return (equipment_category, equipment_sub) for a raw equipment string."""
    raw = raw.strip()
    for pattern, sub in _EQUIP_SUB_MAP:
        if pattern.search(raw):
            cat = _SUB_TO_CATEGORY.get(sub, "other")
            return cat, sub
    return "other", "other"


# ── Movement pattern inference ────────────────────────────────────────────────

def infer_movement(
    *,
    body_part: str = "",
    category: str = "",
    target: str = "",
    muscles: list[str] = [],
) -> str:
    bp = f"{body_part} {category} {target}".lower()
    ms = " ".join(muscles).lower()

    if re.search(r"cardio|running|cycling|treadmill|rowing.machine|skipping|swim", bp):
        return "cardio"

    if re.search(r"carry|farmer|suitcase|yoke", bp):
        return "carry"

    if re.search(r"hinge|deadlift|hip.hinge|swing|good.morning|\brdl\b|stiff.leg", bp):
        return "hinge"

    if re.search(r"squat|lunge|leg.press|split.squat|goblet|step.up|pistol", bp):
        return "squat"

    if re.search(r"\brow\b|pull.?down|pull.?up|chin.?up|lat.pull|\bback\b|rear.delt|rhomboid", bp):
        return "row"

    if re.search(r"press|push|fly|flye|\bchest\b|bench|overhead|\bshoulder\b|\bdip\b", bp):
        return "press"

    if re.search(r"upper.arm|lower.arm|\barm\b|bicep|tricep|forearm|curl\b", bp):
        return "isolation"
    if re.search(r"calves|calf|shin|tibial", bp):
        return "isolation"
    if re.search(r"\babs\b|waist|core\b|abdomin|obliq", bp):
        return "isolation"
    if re.search(r"\bneck\b", bp):
        return "isolation"

    # Muscle-based fallback
    if re.search(r"glute|hamstring", ms) and not re.search(r"quad|squat", ms):
        return "hinge"
    if re.search(r"quad|glute", ms):
        return "squat"
    if re.search(r"lat\b|rhomboid|trap|upper.back", ms):
        return "row"
    if re.search(r"chest|pector|delt|shoulder", ms):
        return "press"

    return "isolation"


_MOVEMENT_ICON: dict[str, str] = {
    "squat":     "i-ph-barbell",
    "hinge":     "i-ph-barbell",
    "press":     "i-ph-arrow-fat-up",
    "row":       "i-ph-arrow-fat-down",
    "carry":     "i-ph-person-simple-walk",
    "isolation": "i-ph-activity",
    "cardio":    "i-ph-person-simple-run",
}


# ── Source 1: ExerciseDB v2 ───────────────────────────────────────────────────

EXERCISEDB_BASE = "https://v2.exercisedb.dev"
EXERCISEDB_CACHE = CACHE_DIR / "exercisedb.json"


def fetch_exercisedb(client: httpx.Client) -> list[dict]:
    if EXERCISEDB_CACHE.exists():
        print("[CACHE] ExerciseDB — loading from cache")
        return json.loads(EXERCISEDB_CACHE.read_text())

    print("\n=== Source 1: ExerciseDB v2 ===")
    results: list[dict] = []
    limit = 100
    offset = 0

    while True:
        url = f"{EXERCISEDB_BASE}/exercises?limit={limit}&offset={offset}"
        print(f"  GET {url}")
        data = http_get_json(client, url)
        if data is None:
            print("  [WARN] ExerciseDB fetch failed — skipping remaining pages")
            break

        # API may return list directly or wrapped object
        if isinstance(data, list):
            page = data
        elif isinstance(data, dict):
            page = (
                data.get("exercises")
                or data.get("data")
                or data.get("results")
                or []
            )
            if not page and "name" in data:
                page = [data]
        else:
            break

        if not page:
            break

        results.extend(page)
        print(f"    fetched {len(results)} total")

        if len(page) < limit:
            break
        offset += limit
        polite_sleep()

    EXERCISEDB_CACHE.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"  Total: {len(results)} exercises from ExerciseDB")
    return results


def normalise_exercisedb(raw: list[dict]) -> list[dict]:
    out: list[dict] = []
    for ex in raw:
        name: str = ex.get("name") or ex.get("exerciseName") or ""
        if not name:
            continue

        body_part: str = ex.get("bodyPart") or ex.get("body_part") or ""
        equip_raw: str = ex.get("equipment") or ""
        target: str = ex.get("target") or ""
        secondary: list = ex.get("secondaryMuscles") or ex.get("secondary_muscles") or []
        instructions: list = ex.get("instructions") or []

        muscles_pri = [normalise_muscle(target)] if target else []
        muscles_sec = [normalise_muscle(m) for m in secondary if m]

        equipment_cat, equipment_sub = normalise_equipment(equip_raw)
        movement = infer_movement(
            body_part=body_part,
            target=target,
            muscles=muscles_pri + muscles_sec,
        )

        cue = ""
        if instructions:
            first = instructions[0].strip()
            m = re.search(r"[.!?]", first[50:]) if len(first) > 50 else None
            cue = (first[: 50 + m.start() + 1].strip() if m else first[:120]).strip()

        out.append({
            "name": name.strip(),
            "slug": slugify(name),
            "equipment": equipment_cat,
            "equipment_sub": equipment_sub,
            "movement": movement,
            "muscles": list(dict.fromkeys(m for m in muscles_pri if m)),
            "muscles_sec": list(dict.fromkeys(m for m in muscles_sec if m)),
            "cues": cue,
            "icon": _MOVEMENT_ICON[movement],
        })
    return out


# ── Source 2: wger.de ─────────────────────────────────────────────────────────

WGER_BASE = "https://wger.de/api/v2"
WGER_CACHE = CACHE_DIR / "wger.json"


def fetch_wger(client: httpx.Client) -> list[dict]:
    if WGER_CACHE.exists():
        print("[CACHE] wger — loading from cache")
        return json.loads(WGER_CACHE.read_text())

    print("\n=== Source 2: wger.de ===")
    results: list[dict] = []
    url: str | None = (
        f"{WGER_BASE}/exerciseinfo/?format=json&language=2&limit=100&offset=0"
    )

    while url:
        print(f"  GET {url}")
        data = http_get_json(client, url)
        if not data or not isinstance(data, dict):
            break
        page: list = data.get("results") or []
        results.extend(page)
        print(f"    {len(results)} / {data.get('count', '?')}")
        url = data.get("next")
        if url:
            polite_sleep()

    WGER_CACHE.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"  Total: {len(results)} exercises from wger")
    return results


def normalise_wger(raw: list[dict]) -> list[dict]:
    out: list[dict] = []
    for ex in raw:
        translations: list = ex.get("translations") or []
        name = description_html = ""
        for t in translations:
            if t.get("language") == 2:
                name = t.get("name") or ""
                description_html = t.get("description") or ""
                break
        if not name:
            continue

        category_obj: dict = ex.get("category") or {}
        category: str = category_obj.get("name") or ""

        muscles_pri = list(dict.fromkeys(
            normalise_muscle(m.get("name_en") or m.get("name") or "")
            for m in (ex.get("muscles") or [])
            if m.get("name_en") or m.get("name")
        ))
        muscles_sec = list(dict.fromkeys(
            normalise_muscle(m.get("name_en") or m.get("name") or "")
            for m in (ex.get("muscles_secondary") or [])
            if m.get("name_en") or m.get("name")
        ))
        equip_list: list = ex.get("equipment") or []
        equip_raw = equip_list[0].get("name", "") if equip_list else "bodyweight"
        equipment_cat, equipment_sub = normalise_equipment(equip_raw)

        movement = infer_movement(
            category=category,
            muscles=muscles_pri + muscles_sec,
        )

        cue = ""
        if description_html:
            soup = BeautifulSoup(description_html, "lxml")
            text = soup.get_text(" ", strip=True)
            m_sent = re.search(r"[.!?]", text[30:]) if len(text) > 30 else None
            if m_sent:
                cue = text[: 30 + m_sent.start() + 1].strip()
            else:
                cue = text[:120].strip()

        out.append({
            "name": name.strip(),
            "slug": slugify(name),
            "equipment": equipment_cat,
            "equipment_sub": equipment_sub,
            "movement": movement,
            "muscles": [m for m in muscles_pri if m],
            "muscles_sec": [m for m in muscles_sec if m],
            "cues": cue,
            "icon": _MOVEMENT_ICON[movement],
        })
    return out


# ── Source 3: VirtuaGym ───────────────────────────────────────────────────────

VIRTUAGYM_BASE = "https://exercises.virtuagym.com"
VIRTUAGYM_CACHE = CACHE_DIR / "virtuagym.json"

VIRTUAGYM_MUSCLE_PATHS = [
    "/muscle/abductors/",
    "/muscle/adductors/",
    "/muscle/abs/",
    "/muscle/biceps/",
    "/muscle/calves/",
    "/muscle/chest/",
    "/muscle/forearms/",
    "/muscle/glutes/",
    "/muscle/hamstrings/",
    "/muscle/lats/",
    "/muscle/lower-back/",
    "/muscle/middle-back/",
    "/muscle/neck/",
    "/muscle/quadriceps/",
    "/muscle/shoulders/",
    "/muscle/traps/",
    "/muscle/triceps/",
    "/muscle/upper-back/",
]


def _vg_collect_slugs(client: httpx.Client, path: str) -> list[str]:
    slugs: list[str] = []
    page = 1
    while True:
        url = VIRTUAGYM_BASE + path + (f"page/{page}/" if page > 1 else "")
        soup = http_get_html(client, url)
        if soup is None:
            break
        found = 0
        for a in soup.select("a[href*='/exercise/']"):
            href = str(a.get("href", ""))
            slug = urlparse(href).path.rstrip("/").split("/")[-1]
            if slug and slug not in slugs:
                slugs.append(slug)
                found += 1
        if not found:
            break
        has_next = bool(soup.select_one("a.next, a[rel='next'], .pagination .next"))
        if not has_next:
            break
        page += 1
        polite_sleep()
    return slugs


def _vg_scrape_exercise(client: httpx.Client, slug: str) -> dict | None:
    url = f"{VIRTUAGYM_BASE}/exercise/{slug}/"
    soup = http_get_html(client, url)
    if soup is None:
        return None

    h1 = soup.find("h1")
    name = h1.get_text(strip=True) if h1 else slug.replace("-", " ").title()

    muscles_pri: list[str] = []
    muscles_sec: list[str] = []
    equipment_raw = ""

    # JSON-LD schema.org
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            if not isinstance(data, dict):
                continue
            for supply in data.get("supply", []):
                if isinstance(supply, dict):
                    m = normalise_muscle(supply.get("name", ""))
                    if m and m not in muscles_pri:
                        muscles_pri.append(m)
            for tool in data.get("tool", []):
                if isinstance(tool, dict) and not equipment_raw:
                    equipment_raw = tool.get("name", "")
        except (json.JSONDecodeError, AttributeError):
            continue

    # Muscle from page taxonomy links
    for a in soup.select("a[href*='/muscle/']"):
        href = str(a.get("href", ""))
        muscle_slug = href.rstrip("/").split("/")[-1]
        if muscle_slug not in ("muscle",):
            m = normalise_muscle(muscle_slug.replace("-", " "))
            if m and m not in muscles_pri:
                muscles_pri.append(m)

    # Equipment from equipment taxonomy link
    if not equipment_raw:
        for a in soup.select("a[href*='/equipment/']"):
            href = str(a.get("href", ""))
            eq_slug = href.rstrip("/").split("/")[-1]
            equipment_raw = eq_slug.replace("-", " ")
            break

    # Cue from first description paragraph
    cue = ""
    for el in soup.select(".entry-content p, .exercise-description p, article p"):
        text = el.get_text(" ", strip=True)
        if len(text) > 20:
            cue = text[:120].strip()
            break

    equipment_cat, equipment_sub = (
        normalise_equipment(equipment_raw) if equipment_raw else ("bodyweight", "bodyweight")
    )
    movement = infer_movement(muscles=muscles_pri + muscles_sec)

    return {
        "name": name,
        "slug": slugify(name),
        "equipment": equipment_cat,
        "equipment_sub": equipment_sub,
        "movement": movement,
        "muscles": list(dict.fromkeys(muscles_pri)),
        "muscles_sec": list(dict.fromkeys(muscles_sec)),
        "cues": cue,
        "icon": _MOVEMENT_ICON[movement],
    }


def fetch_virtuagym(client: httpx.Client) -> list[dict]:
    if VIRTUAGYM_CACHE.exists():
        print("[CACHE] VirtuaGym — loading from cache")
        return json.loads(VIRTUAGYM_CACHE.read_text())

    print("\n=== Source 3: VirtuaGym ===")

    all_slugs: list[str] = []
    for path in VIRTUAGYM_MUSCLE_PATHS:
        print(f"  [LIST] {path}")
        slugs = _vg_collect_slugs(client, path)
        new = [s for s in slugs if s not in all_slugs]
        all_slugs.extend(new)
        print(f"    +{len(new)} → {len(all_slugs)} total")
        polite_sleep()

    print(f"  Scraping {len(all_slugs)} exercise pages …")
    results: list[dict] = []
    for i, slug in enumerate(all_slugs, 1):
        print(f"  [{i}/{len(all_slugs)}] {slug}")
        entry = _vg_scrape_exercise(client, slug)
        if entry:
            results.append(entry)
        if i % 20 == 0:
            VIRTUAGYM_CACHE.write_text(json.dumps(results, indent=2, ensure_ascii=False))
        polite_sleep()

    VIRTUAGYM_CACHE.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"  Total scraped: {len(results)}")
    return results


# ── Merge ─────────────────────────────────────────────────────────────────────

def merge_into_seed(new_exercises: list[dict]) -> None:
    existing: list[dict] = []
    if SEED_FILE.exists():
        existing = json.loads(SEED_FILE.read_text())

    existing_slugs = {ex["slug"] for ex in existing}
    added = 0

    for ex in new_exercises:
        slug = ex.get("slug", "")
        if not slug or slug in existing_slugs:
            continue
        if not ex.get("name") or not ex.get("movement"):
            continue
        existing.append(ex)
        existing_slugs.add(slug)
        added += 1

    existing.sort(key=lambda x: x["name"].lower())
    SEED_FILE.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n")
    print(f"\n[SEED] +{added} new exercises — total: {len(existing)}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    all_new: list[dict] = []

    with httpx.Client(headers=HEADERS) as client:
        for label, fetch_fn, normalise_fn in [
            ("ExerciseDB", fetch_exercisedb, normalise_exercisedb),
            ("wger",       fetch_wger,       normalise_wger),
            ("VirtuaGym",  fetch_virtuagym,  lambda x: x),  # already normalised
        ]:
            try:
                raw = fetch_fn(client)
                normalised = normalise_fn(raw)
                all_new.extend(normalised)
                print(f"  → {len(all_new)} cumulative after {label}")
            except Exception as e:
                print(f"[ERROR] {label} failed: {e}")

    # Deduplicate within incoming (first-seen wins)
    seen: set[str] = set()
    deduped = [
        ex for ex in all_new
        if (slug := ex.get("slug", "")) and slug not in seen and not seen.add(slug)  # type: ignore[func-returns-value]
    ]
    print(f"\n[DEDUP] {len(all_new)} → {len(deduped)} unique incoming exercises")

    merge_into_seed(deduped)


if __name__ == "__main__":
    main()
