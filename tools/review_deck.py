"""review_deck — the Review Deck the report tool writes with --deck (0.9.0).

Pure functions, no network and no page IO: the titles of the slide pages, the
Deck Manifest text Wiki Deck compiles, the Review Deck Theme's directives, the
attendance and mood lines read back from a Review Meeting page, the fish masks
for public output, and the call to tools/deck-slides.mjs, which draws the
slides with the very code the board draws them with in the page.

A deck for week 2026-W40 is:

  Review Deck 2026-W40                 the manifest: DECK, THEME, TITLE HIDE,
                                       WIDTH 1280, HEIGHT 720, LIVE, PRESENTERS,
                                       one SLIDE per slide page
  Review Slide W40 1 — Weekly Review   one svg item (the slide) and # Notes
  Review Slide W40 2 — Hours given per member
  …
  Review Deck Theme                    the theme, written once, then the site's
"""

from __future__ import annotations

import json
import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SLIDES_JS = os.path.join(HERE, "deck-slides.mjs")

THEME_TITLE = "Review Deck Theme"
RELAY = "https://live.pi5.private.fish"
WIDTH, HEIGHT = 1280, 720
MASKS_FILE = os.path.expanduser("~/.config/timebank/masks.json")

SLIDE_NAMES = {
    "title": "Weekly Review",
    "hours": "Hours given per member",
    "planned": "Planned against actual",
    "shares": "Shares of dynamic equity",
    "ledger": "Ledger check",
}

THEME_DIRECTIVES = """BASE white
COLOR-BG #ffffff
COLOR-FG #1f2933
COLOR-ACCENT #20364f
COLOR-LINK #2f6db3
COLOR-MUTED #5f6b7a
FONT-HEADING Helvetica, Arial, sans-serif
FONT-BODY Helvetica, Arial, sans-serif
FONT-SIZE 30px"""


def deck_title(week: str) -> str:
    return f"Review Deck {week}"


def meeting_title(week: str) -> str:
    return f"Review Meeting {week}"


def short_week(week: str) -> str:
    """'2026-W40' -> 'W40'."""
    return week.split("-", 1)[1] if "-" in week else week


def slide_title(week: str, n: int, key: str) -> str:
    return f"Review Slide {short_week(week)} {n} — {SLIDE_NAMES.get(key, key.title())}"


def manifest_text(week: str, slide_titles: list[str], presenters: list[str] | None = None,
                  relay: str | None = RELAY, theme: str = THEME_TITLE) -> str:
    """The Deck Manifest. PRESENTERS names relay logins (Keycloak usernames,
    split on spaces), not display names; the site owner presents anyway."""
    lines = [f"DECK Weekly Review {week}", f"THEME [[{theme}]]", "TITLE HIDE", f"WIDTH {WIDTH}", f"HEIGHT {HEIGHT}"]
    if relay:
        lines.append(f"LIVE {relay}")
    if presenters:
        lines.append("PRESENTERS " + " ".join(presenters))
    lines += [f"SLIDE [[{t}]]" for t in slide_titles]
    return "\n".join(lines)


def ledger_rows(summary: dict) -> list[dict]:
    """The week's ledger check per member, from timebank_report.summarise()."""
    return [{"member": r["member"], "given": round(r["given"], 2), "received": round(r["received"], 2),
             "net": round(r["net"], 2), "awaiting": r["awaiting"]} for r in summary["rows"]]


def ledger_table_rows(rows: list[dict]) -> list[list]:
    fmt = lambda h: f"{h:g}"
    return [[r["member"], fmt(r["given"]), fmt(r["received"]), fmt(r["net"]), r["awaiting"]] for r in rows]


def ledger_caption(week: str) -> str:
    return f"Ledger check, {week} — given, received, net and awaiting per member"


# --- the meeting page read back --------------------------------------------------

ATTEND = re.compile(r"^In the room\s*:\s*(.+?)\.?\s*$", re.I)
MOOD = re.compile(r"^\*{0,2}([A-Z][\w .'-]*?)'s mood\*{0,2}\s*:\s*(.+?)\s*$")


def placeholder(s: str) -> bool:
    s = s.strip()
    return not s or s in {"…", "..."} or (s.startswith("(") and s.endswith(")")) or (s.startswith("*") and s.endswith("*"))


def meeting_lines(page: dict | None) -> dict:
    """Attendance and mood lines from a Review Meeting page:
    'In the room: David, Max, Mitch.' and one "David's mood: …" item per member."""
    out = {"attendance": [], "mood": []}
    for it in (page or {}).get("story", []):
        if it.get("type") not in ("markdown", "paragraph"):
            continue
        for line in (it.get("text") or "").split("\n"):
            line = line.strip().lstrip("-").strip()
            m = ATTEND.match(line)
            if m and not placeholder(m.group(1)):
                out["attendance"] = [x.strip() for x in re.split(r",|\band\b", m.group(1)) if x.strip()]
                continue
            m = MOOD.match(line)
            if m and not placeholder(m.group(2)):
                out["mood"].append([m.group(1).strip(), m.group(2).rstrip(".")])
    return out


PLACEHOLDER_LINK = re.compile(r"\b(Weekly Plan|Timebank Weekly Report|Review Deck|Review Meeting) YYYY-Www(\+1)?")


def next_week(week: str) -> str:
    import datetime as _dt
    y, w = int(week[:4]), int(week.split("W")[1])
    d = _dt.date.fromisocalendar(y, w, 1) + _dt.timedelta(days=7)
    iy, iw, _ = d.isocalendar()
    return f"{iy}-W{iw:02d}"


def fill_template_text(text: str, week: str) -> str:
    """A Review Meeting Template's placeholders for one week: 'Weekly Plan
    YYYY-Www' becomes [[Weekly Plan 2026-W40]], 'YYYY-Www+1' the week after."""
    def link(m):
        return f"[[{m.group(1)} {next_week(week) if m.group(2) else week}]]"
    return PLACEHOLDER_LINK.sub(link, text).replace("YYYY-Www+1", next_week(week)).replace("YYYY-Www", week)


def board_text(week: str, attendance: list[str], mood: list[list[str]]) -> str:
    """The Review Board's BOARD item: the week and last meeting's lines, which
    the board draws on its title slide as the deck does."""
    lines = ["BOARD", f"WEEK {week}"]
    if attendance:
        lines.append("ATTENDANCE " + ", ".join(attendance))
    lines += [f"MOOD {who}: {line}" for who, line in mood]
    return "\n".join(lines)


def previous_meeting(slugs: list[str], week: str) -> str | None:
    """The latest review-meeting-YYYY-wNN slug before this week."""
    key = week.lower()
    found = sorted(s for s in slugs if re.fullmatch(r"review-meeting-\d{4}-w\d{2}", s) and s[len("review-meeting-"):] < key)
    return found[-1] if found else None


# --- masks ------------------------------------------------------------------------

def load_masks(spec: str | None) -> dict | None:
    """--masks: a JSON file {"David": "Koi", …} or inline "David=Koi,Max=…".
    The map lives outside the repository and outside every public site."""
    if spec is None:
        return None
    if spec in ("", "default"):
        spec = MASKS_FILE
    if "=" in spec and not os.path.exists(os.path.expanduser(spec)):
        return {k.strip(): v.strip() for k, v in (p.split("=", 1) for p in spec.split(",") if "=" in p)}
    path = os.path.expanduser(spec)
    if not os.path.exists(path):
        raise SystemExit(f"--masks: no mask map at {path} — write {{\"Name\": \"Fish\", …}} there, or pass Name=Fish,…")
    with open(path) as f:
        return json.load(f)


def mask(name: str, masks: dict | None) -> str:
    if not masks or name is None:
        return name
    if name in masks:
        return masks[name]
    first = str(name).split()[0] if str(name).split() else name
    return masks.get(first, name)


# --- drawing ------------------------------------------------------------------------

def render(models: list[str], ledger: dict | None, meta: dict, node: str = "node") -> list[dict]:
    """[{key, title, svg, notes}] from tools/deck-slides.mjs."""
    payload = json.dumps({"models": models, "ledger": ledger, "meta": meta})
    out = subprocess.run([node, SLIDES_JS], input=payload, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)
