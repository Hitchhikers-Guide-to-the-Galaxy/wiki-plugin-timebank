"""The broker's report — pure functions, no network, no page writes.

A port of the parts of src/client/{parse,txn}.js the broker needs, kept
faithful to the JavaScript (test/fixtures/transactions.json is shared by
`node --test` and `python3 -m unittest`), plus what only the broker does:
count each transaction page once by its home site and slug, bucket by ISO
week, sum per person, and draw the pie and the bars.

The rule for a transaction's state follows Phase 7's decision — the
transaction page is the record, a ledger a view of it:

  a ledger CARRIES a transaction when its own text has an entry for it (the
  entry links the page by slug, or, with no page link, has the same label and
  minutes), with the right direction and naming the other party's ledger —
  or when the page's home is that ledger's own site, since the page there is
  that party's own record (the giver's page, or the receiver's Thank You
  Invoice).

  verified     both ledgers carry it
  in dialogue  one side does not, but has forked the page onto its site
  awaiting     one side does not, and has not forked it
"""

from __future__ import annotations

import datetime as _dt
import math
import re
from urllib.parse import unquote

# --- parse.js -----------------------------------------------------------------

MONTHS = {
    "jan": 0, "feb": 1, "mar": 2, "apr": 3, "may": 4, "jun": 5, "jul": 6, "aug": 7, "sep": 8, "oct": 9, "nov": 10, "dec": 11,
    "january": 0, "february": 1, "march": 2, "april": 3, "june": 5, "july": 6, "august": 7,
    "september": 8, "october": 9, "november": 10, "december": 11,
}

_EPOCH = _dt.datetime(1970, 1, 1, tzinfo=_dt.timezone.utc)


def _utc_ms(year: int, month0: int, day: int) -> int | None:
    """Date.UTC(year, month0, day, 12): days and months overflow as in JS."""
    if 0 <= year <= 99:
        year += 1900
    year += month0 // 12
    month0 %= 12
    try:
        d = _dt.datetime(year, month0 + 1, 1, 12, tzinfo=_dt.timezone.utc) + _dt.timedelta(days=day - 1)
    except (ValueError, OverflowError):
        return None
    return int((d - _EPOCH).total_seconds() * 1000)


def _parse_int(s: str):
    """JavaScript parseInt(s): leading digits, else NaN (None)."""
    m = re.match(r"^\s*([+-]?\d+)", s)
    return int(m.group(1)) if m else None


def _parse_float(s: str):
    """JavaScript parseFloat(s) on [\\d.]+ text: the longest leading number."""
    m = re.match(r"^\s*([+-]?(?:\d+\.?\d*|\.\d+))", s)
    return float(m.group(1)) if m else None


def js_round(x: float) -> int:
    """Math.round: half rounds up."""
    return math.floor(x + 0.5)


def parse_date(s: str) -> int | None:
    s = str(s).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        y, m, d = (int(p) for p in s.split("-"))
        if not (1 <= m <= 12 and 1 <= d <= 31):
            return None
        return _utc_ms(y, m - 1, d)
    parts = s.replace(",", "", 1).split()
    day = month = year = None
    if len(parts) >= 2:
        for p in parts:
            n = _parse_int(p)
            if n is not None and n > 31:
                year = n
            elif n is not None and n <= 31:
                day = n
            elif p.lower() in MONTHS:
                month = MONTHS[p.lower()]
        if day and month is not None and year:
            return _utc_ms(year, month, day)
    return None


def as_slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9-]", "", re.sub(r"\s", "-", name)).lower()


def norm_label(label) -> str:
    s = re.sub(r"\s+", " ", str(label or "").lower()).strip()
    return re.sub(r"[\s.,;:!?]+$", "", s)


def norm_site(host) -> str:
    return re.sub(r":(80|443)$", "", str(host or "").strip().lower())


def _host_only(site: str) -> str:
    return re.sub(r":\d+$", "", norm_site(site))


def same_site(a, b) -> bool:
    x, y = norm_site(a), norm_site(b)
    if not x or not y:
        return False
    if x == y:
        return True
    if not re.search(r"(^|\.)localhost$", _host_only(x), re.I) or _host_only(x) != _host_only(y):
        return False
    return not re.search(r":\d+$", x) or not re.search(r":\d+$", y)


def parse_ledger_url(href):
    m = re.match(r"^(https?:)?//([^/\s?#]+)([^?#\s]*)", str(href or "").strip(), re.I)
    if not m:
        return None
    parts = [p for p in m.group(3).split("/") if p]
    slug = parts[-1] if parts else ""
    try:
        slug = unquote(slug, errors="strict")
    except UnicodeDecodeError:
        pass
    slug = re.sub(r"\.(json|html)$", "", slug, flags=re.I).lower()
    if not slug or slug == "view" or not re.match(r"^[a-z0-9-]+$", slug):
        return None
    return {"site": norm_site(m.group(2)), "slug": slug, "scheme": m.group(1).lower() if m.group(1) else None}


def ledger_ref_of(token, site=None):
    s = str(token or "").strip()
    m = re.match(r"^\[\[([^\]]+)\]\]$", s)
    if m:
        name = m.group(1).strip()
        ref = {"name": name, "slug": as_slug(name), "external": False}
        if site:
            ref["site"] = norm_site(site)
        return ref
    m = re.match(r"^\[((?:https?:)?//[^\s\]]+)\s+([^\]]+)\]$", s, re.I)
    if not m:
        return None
    ref = parse_ledger_url(m.group(1))
    if not ref:
        return None
    return {"name": m.group(2).strip(), "slug": ref["slug"], "site": ref["site"], "scheme": ref["scheme"],
            "href": m.group(1), "external": True}


TIME_SUFFIX = re.compile(r":\s*([\d.]+)\s*(hours?|hrs?|h|minutes?|mins?|m)\s*$", re.I)
LINKED = re.compile(r"^(.+?)\s+(for|to|from|by)\s+(?:\[\[([^\]]+)\]\]|\[((?:https?:)?//[^\s\]]+)\s+([^\]]+)\])$", re.I)
COMMANDS = re.compile(r"^(?:(?:START|END|NOTIFY|WATCH)\s*:|(?:LINEUP|TOOL)\s*$)", re.I)


def parse_watch(value) -> list[str]:
    out = []
    for token in re.split(r"[\s,]+", str(value or "")):
        t = token.strip()
        if not t:
            continue
        m = re.match(r"^(?:https?:)?//([^/\s?#]+)", t, re.I)
        host = norm_site(m.group(1) if m else t.split("/")[0])
        if re.match(r"^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d+)?$", host):
            out.append(host)
    return out


def extract_commands(text) -> dict:
    notify, lineup, watch = None, False, []
    for line in (l.strip() for l in str(text or "").split("\n")):
        if not line:
            continue
        m = re.match(r"^NOTIFY\s*:\s*(.+)$", line, re.I)
        if m:
            notify = m.group(1).strip()
        w = re.match(r"^WATCH\s*:\s*(.*)$", line, re.I)
        if w:
            for site in parse_watch(w.group(1)):
                if not any(same_site(s, site) for s in watch):
                    watch.append(site)
        if re.match(r"^LINEUP$", line, re.I):
            lineup = True
    return {"notify": notify, "lineup": lineup, "watch": watch}


def parse_entries(text) -> list[dict]:
    """Time entries of a timebank item (lines ending in a time), linked or not."""
    out = []
    for line in (l.strip() for l in str(text or "").split("\n")):
        if not line or COMMANDS.match(line):
            continue
        m = TIME_SUFFIX.search(line)
        if not m:
            continue
        amount = _parse_float(m.group(1)) or 0.0
        hours = amount / 60 if m.group(2).lower().startswith("m") else amount
        label = TIME_SUFFIX.sub("", line).strip()
        linked = LINKED.match(label)
        cp = None
        if linked:
            if linked.group(3) is not None:
                cp = {"name": linked.group(3).strip(), "slug": as_slug(linked.group(3).strip()), "external": False}
            else:
                ref = parse_ledger_url(linked.group(4))
                if ref:
                    cp = {"name": linked.group(5).strip(), "slug": ref["slug"], "site": ref["site"], "external": True}
        if cp:
            label_text = linked.group(1).strip()
            txn = ledger_ref_of(label_text)
            d = linked.group(2).lower()
            out.append({"label": txn["name"] if txn else label_text, "time": hours, "raw": line, "linked": True,
                        "direction": "gave" if d in ("for", "to") else "received", "counterparty": cp, "txn": txn})
        else:
            out.append({"label": label, "time": hours, "raw": line, "linked": False})
    return out


# --- txn.js -------------------------------------------------------------------

FIELD = re.compile(r"^(GIVER|RECEIVER|HOURS|DATE|WHAT|SOURCE)\s*:\s*(.*)$", re.I)
TEMPLATE_SLUG = "time-transaction-template"
TOPIC_SLUG = "time-transaction"


def parse_minutes(s):
    m = re.match(r"^([\d.]+)\s*(hours?|hrs?|h|minutes?|mins?|m)?$", str(s or "").strip(), re.I)
    if not m:
        return None
    n = _parse_float(m.group(1))
    if n is None or not math.isfinite(n) or n <= 0:
        return None
    unit = (m.group(2) or "h").lower()
    return js_round(n if unit.startswith("m") else n * 60)


def parse_transaction(text, page=None) -> dict:
    """Port of txn.js parseTransaction. Keys JSON.stringify would drop (undefined)
    are left out, so the result compares equal to the shared fixtures."""
    page = page or {}
    site = norm_site(page["site"]) if page.get("site") else None
    pg = {}
    if site:
        pg["site"] = site
    slug = page.get("slug") or (as_slug(page["title"]) if page.get("title") else None)
    if slug:
        pg["slug"] = slug
    pg["title"] = page.get("title") or None
    pg["itemId"] = page.get("itemId") or None
    facts = {"giver": None, "receiver": None, "minutes": None, "time": None, "date": None,
             "label": None, "source": None, "note": "", "page": pg}
    note = []
    for raw in str(text or "").split("\n"):
        line = raw.strip()
        if not line:
            continue
        m = FIELD.match(line)
        if not m:
            note.append(line)
            continue
        key, value = m.group(1).upper(), m.group(2).strip()
        if key == "GIVER":
            facts["giver"] = ledger_ref_of(value, site)
        elif key == "RECEIVER":
            facts["receiver"] = ledger_ref_of(value, site)
        elif key == "HOURS":
            facts["minutes"] = parse_minutes(value)
        elif key == "DATE":
            facts["date"] = parse_date(value)
        elif key == "WHAT":
            facts["label"] = value or None
        elif key == "SOURCE":
            facts["source"] = value or None
    if not facts["label"]:
        facts["label"] = pg["title"]
    facts["time"] = None if facts["minutes"] is None else facts["minutes"] / 60
    facts["note"] = " ".join(note)
    facts["valid"] = bool(facts["giver"] and facts["receiver"] and facts["minutes"] and pg.get("slug"))
    return facts


def page_transactions(page: dict, site: str, slug: str | None = None) -> list[dict]:
    out = []
    for it in (page or {}).get("story") or []:
        if it.get("type") == "transaction":
            out.append(parse_transaction(it.get("text") or "", {"site": site, "slug": slug or as_slug(page.get("title") or ""),
                                                                "title": page.get("title"), "itemId": it.get("id")}))
    return out


def transaction_candidates(sitemap) -> list[str]:
    """Slugs of sitemap pages that link the Time Transaction topic, as txn.js does."""
    out = []
    for p in sitemap if isinstance(sitemap, list) else []:
        if p and p.get("slug") and p["slug"] not in (TEMPLATE_SLUG, TOPIC_SLUG) and TOPIC_SLUG in (p.get("links") or {}):
            out.append(p["slug"])
    return out


def same_ledger(a, b) -> bool:
    return bool(a and b and a.get("slug") == b.get("slug") and same_site(a.get("site"), b.get("site")))


# --- the broker ---------------------------------------------------------------

def home_site(page: dict, site: str) -> str:
    """Where a page was first written: the earliest real fork in its journal
    (a fork seated before the create only seeds the neighbourhood), else the
    site it was read from."""
    seen_create = False
    for action in (page or {}).get("journal") or []:
        if action.get("type") == "create":
            seen_create = True
        elif action.get("type") == "fork" and seen_create and action.get("site"):
            return norm_site(action["site"])
    return norm_site(site)


def dedupe(copies: list[dict]) -> list[dict]:
    """copies: [{facts, site, home}] — one per transaction item found on a site.
    One transaction per home site plus slug (and item id). The copy on its home
    site supplies the facts when it was read; every other site holding it is a fork."""
    groups: dict[str, dict] = {}
    order = []
    for c in copies:
        f = c["facts"]
        key = f"{_host_only(c['home'])}/{f['page'].get('slug')}#{f['page'].get('itemId') or ''}"
        if key not in groups:
            groups[key] = {"home": c["home"], "copies": [], "facts": None}
            order.append(key)
        g = groups[key]
        g["copies"].append(c)
        if same_site(c["site"], c["home"]):
            g["facts"] = f
    out = []
    for key in order:
        g = groups[key]
        facts = g["facts"] or g["copies"][0]["facts"]
        forks = sorted({norm_site(c["site"]) for c in g["copies"] if not same_site(c["site"], g["home"])})
        out.append({"key": key, "home": g["home"], "facts": facts, "forks": forks, "home_read": g["facts"] is not None})
    return out


def iso_week(ms: int) -> str:
    d = (_EPOCH + _dt.timedelta(milliseconds=ms)).date()
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def week_bounds(week: str) -> tuple[_dt.date, _dt.date]:
    y, w = week.split("-W")
    monday = _dt.date.fromisocalendar(int(y), int(w), 1)
    return monday, monday + _dt.timedelta(days=6)


def ledger_entries(page: dict, site: str) -> list[dict]:
    out = []
    for it in (page or {}).get("story") or []:
        if it.get("type") != "timebank":
            continue
        for e in parse_entries(it.get("text") or ""):
            if not e["linked"]:
                continue
            cp = dict(e["counterparty"])
            if not cp.get("external"):
                cp["site"] = norm_site(site)
            e = dict(e, counterparty=cp)
            out.append(e)
    return out


def carries(ledger: dict, t: dict, side: str) -> bool:
    """Does `ledger` = {site, slug, entries} carry transaction t on `side`
    ('giver' | 'receiver')?"""
    f = t["facts"]
    me, other = (f["giver"], f["receiver"]) if side == "giver" else (f["receiver"], f["giver"])
    if not same_ledger(me, ledger):
        return False
    if same_site(t["home"], ledger["site"]):
        return True
    want = "gave" if side == "giver" else "received"
    slug = f["page"].get("slug")
    for e in ledger["entries"]:
        if e["direction"] != want or not same_ledger(e["counterparty"], other):
            continue
        if e.get("txn"):
            if e["txn"]["slug"] == slug:
                return True
        elif js_round(e["time"] * 60) == f["minutes"] and norm_label(e["label"]) == norm_label(f["label"]):
            return True
    return False


def state_of(t: dict, ledgers: list[dict]) -> str:
    f = t["facts"]
    sides = {}
    for side, ref in (("giver", f["giver"]), ("receiver", f["receiver"])):
        led = next((l for l in ledgers if same_ledger(l, ref)), None)
        sides[side] = (led, bool(led and carries(led, t, side)))
    if all(c for _, c in sides.values()):
        return "verified"
    for side, (led, c) in sides.items():
        ref = f[side]
        if not c and any(same_site(s, ref.get("site")) for s in t["forks"]):
            return "in dialogue"
    return "awaiting"


def member_of(ref, members: list[dict]):
    return next((m for m in members if same_ledger(m, ref)), None)


def summarise(transactions: list[dict], members: list[dict]) -> dict:
    """Per member: given, received, net hours; verified and awaiting counts
    (awaiting counts 'in dialogue' too); share of all hours given by members."""
    rows = {m["member"]: {"member": m["member"], "given": 0.0, "received": 0.0, "verified": 0, "awaiting": 0} for m in members}
    for t in transactions:
        f = t["facts"]
        g, r = member_of(f["giver"], members), member_of(f["receiver"], members)
        for who, key in ((g, "given"), (r, "received")):
            if who:
                rows[who["member"]][key] += f["minutes"] / 60
                rows[who["member"]]["verified" if t["state"] == "verified" else "awaiting"] += 1
    total_given = sum(r["given"] for r in rows.values())
    for r in rows.values():
        r["net"] = r["given"] - r["received"]
        r["share"] = (r["given"] / total_given) if total_given else 0.0
    return {"rows": [rows[m["member"]] for m in members], "total": total_given,
            "count": len(transactions), "verified": sum(1 for t in transactions if t["state"] == "verified")}


def by_week(transactions: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for t in transactions:
        if t["facts"].get("date") is not None:
            out.setdefault(iso_week(t["facts"]["date"]), []).append(t)
    return dict(sorted(out.items()))


def fmt_hours(h: float) -> str:
    if abs(h - round(h)) < 1e-9:
        return f"{int(round(h))}h"
    hrs = int(h) if h > 0 else -int(-h)
    mins = js_round(abs(h - hrs) * 60)
    if hrs == 0:
        return f"{'-' if h < 0 else ''}{mins}m"
    return f"{hrs}h {mins}m"


# --- drawing ------------------------------------------------------------------

PALETTE = ["#2f6db3", "#d9822b", "#3a9a5b", "#b8466a", "#7a5cc2", "#8a7a2e"]


def _esc(s) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def pie_svg(slices: list[tuple[str, float]], title: str) -> str:
    """A pie of hours by person, 400 x 260, labels in a legend with hours and %."""
    total = sum(v for _, v in slices)
    w, h, cx, cy, r = 400, 260, 130, 135, 105
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="sans-serif">',
             f'<text x="{w / 2}" y="18" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">{_esc(title)}</text>']
    live = [(n, v) for n, v in slices if v > 0]
    if not total:
        parts.append(f'<text x="{w / 2}" y="{cy}" text-anchor="middle" font-size="13" fill="#666">No hours given</text>')
    elif len(live) == 1:
        i = [n for n, _ in slices].index(live[0][0])
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{PALETTE[i % len(PALETTE)]}" stroke="#fff" stroke-width="2"/>')
    else:
        a = -math.pi / 2
        for i, (n, v) in enumerate(slices):
            if v <= 0:
                continue
            b = a + 2 * math.pi * v / total
            x1, y1 = cx + r * math.cos(a), cy + r * math.sin(a)
            x2, y2 = cx + r * math.cos(b), cy + r * math.sin(b)
            large = 1 if b - a > math.pi else 0
            parts.append(f'<path d="M{cx},{cy} L{x1:.1f},{y1:.1f} A{r},{r} 0 {large} 1 {x2:.1f},{y2:.1f} Z" '
                         f'fill="{PALETTE[i % len(PALETTE)]}" stroke="#fff" stroke-width="2"/>')
            mid = (a + b) / 2
            if v / total >= 0.08:
                parts.append(f'<text x="{cx + r * 0.62 * math.cos(mid):.1f}" y="{cy + r * 0.62 * math.sin(mid) + 5:.1f}" '
                             f'text-anchor="middle" font-size="13" font-weight="bold" fill="#fff">{js_round(100 * v / total)}%</text>')
            a = b
    for i, (n, v) in enumerate(slices):
        y = 70 + i * 34
        pct = f" · {js_round(100 * v / total)}%" if total else ""
        parts.append(f'<rect x="258" y="{y - 13}" width="16" height="16" rx="3" fill="{PALETTE[i % len(PALETTE)]}"/>')
        parts.append(f'<text x="282" y="{y}" font-size="14" fill="#333">{_esc(n)}</text>')
        parts.append(f'<text x="282" y="{y + 16}" font-size="12" fill="#666">{fmt_hours(v)} given{pct}</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def bars_svg(weeks: list[tuple[str, list[tuple[str, float]]]], names: list[str], title: str) -> str:
    """Stacked bars of hours given per ISO week, one colour per person."""
    w, h = 400, 280
    left, right, top, bottom = 44, 12, 30, 62
    plot_h = h - top - bottom
    peak = max([sum(v for _, v in parts) for _, parts in weeks] + [1])
    step = 2 if peak <= 12 else 5
    top_val = step * math.ceil(peak / step)
    n = max(len(weeks), 1)
    slot = (w - left - right) / n
    bw = min(56, slot * 0.6)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="sans-serif">',
           f'<text x="{w / 2}" y="18" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">{_esc(title)}</text>']
    for v in range(0, top_val + 1, step):
        y = top + plot_h - plot_h * v / top_val
        out.append(f'<line x1="{left}" y1="{y:.1f}" x2="{w - right}" y2="{y:.1f}" stroke="#ddd"/>')
        out.append(f'<text x="{left - 6}" y="{y + 4:.1f}" text-anchor="end" font-size="11" fill="#666">{v}h</text>')
    for i, (week, parts) in enumerate(weeks):
        x = left + slot * i + (slot - bw) / 2
        base = top + plot_h
        for j, (name, v) in enumerate(parts):
            if v <= 0:
                continue
            bh = plot_h * v / top_val
            base -= bh
            out.append(f'<rect x="{x:.1f}" y="{base:.1f}" width="{bw:.1f}" height="{bh:.1f}" fill="{PALETTE[names.index(name) % len(PALETTE)]}" stroke="#fff"/>')
        total = sum(v for _, v in parts)
        out.append(f'<text x="{x + bw / 2:.1f}" y="{base - 5:.1f}" text-anchor="middle" font-size="12" font-weight="bold" fill="#333">{fmt_hours(total)}</text>')
        out.append(f'<text x="{x + bw / 2:.1f}" y="{top + plot_h + 16}" text-anchor="middle" font-size="12" fill="#333">{_esc(week.split("-")[1])}</text>')
    lx = left
    for j, name in enumerate(names):
        out.append(f'<rect x="{lx}" y="{h - 26}" width="14" height="14" rx="3" fill="{PALETTE[j % len(PALETTE)]}"/>')
        out.append(f'<text x="{lx + 19}" y="{h - 14}" font-size="13" fill="#333">{_esc(name)}</text>')
        lx += 19 + 9 * len(name) + 22
    out.append("</svg>")
    return "\n".join(out)
