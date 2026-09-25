#!/usr/bin/env python3
"""timebank-sample — months of sample data on the laptop's three-site test bed.

Alice, Bob and David each own a site on the private farm (alice.localhost,
bob.localhost, david.localhost, port 4242). This script organises those sites
the 0.6.0 way and fills them with June to September 2026:

  migrate   (once; a no-op when already done)
    - renames every transaction page titled "<Work> for <Person>, <day> <Month>"
      to "<Work> for <Person>": the page is re-created under the new slug with
      its old journal carried over and a fork action naming the old title — as
      wiki-client does when a ghost page's title is edited — and gains a date
      item beside its transaction item; the old slug keeps a one-line
      "Moved to [[New Title]]" page; every ledger line, fork and page on the
      three sites (and the localhost demo page) is repointed
    - splits each ledger: its lines move, dated, into "<Name>'s Ledger 2026-09";
      the ledger itself becomes the summary (OWNER + PERIODS)
    - adds "About <Name>" with a BALANCE item, and teaches the template and the
      topic page the new naming
  generate  (every run; deterministic, seed 2026)
    - recurring work: occasions added to three September pages, and new pages
      of two to four occasions
    - one-off pages, three naming Carol (no site), three late-September pages
      not logged yet
    - "<Name>'s Ledger 2026-06" .. "2026-08", rewritten from the data

Rerunning rewrites the generated pages to the same bytes and leaves
hand-written pages alone. Reindex afterwards: wiki-reindex <domain>.

  python3 tools/timebank-sample.py [--dry-run]
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import os
import random
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.expanduser("~/.claude/skills/fedwiki-lib"))
import timebank_report as tr  # noqa: E402
import fedwiki  # noqa: E402

SEED = 2026
PORT = 4242
NOTIFY = "ntfy.sh/timebank-demo-david"
PROV = ("Generated sample data — tools/timebank-sample.py (seed 2026) in wiki-plugin-timebank 0.6.0, run by "
        "Claude Code (claude-opus-5-5) for Phase 11 of the Timebank Verification Plan.")
MIGRATE_PROV = ("Phase 11 migration — tools/timebank-sample.py in wiki-plugin-timebank 0.6.0, run by Claude Code "
                "(claude-opus-5-5) for the Timebank Verification Plan.")

PEOPLE = {
    "alice": {"name": "Alice", "domain": "alice.localhost", "ledger": "Alice's Ledger"},
    "bob": {"name": "Bob", "domain": "bob.localhost", "ledger": "Bob's Ledger"},
    "david": {"name": "David", "domain": "david.localhost", "ledger": "David's Ledger"},
}
for _k, _p in PEOPLE.items():
    _p["site"] = f"{_p['domain']}:{PORT}"
    _p["slug"] = fedwiki.as_slug(_p["ledger"])
    _p["url"] = f"http://{_p['site']}/view/{_p['slug']}"
    _p["about"] = f"About {_p['name']}"
CAROL = {"name": "Carol", "ledger": "Carol's Ledger", "url": "https://carol.timebank.example/view/carols-ledger", "site": "carol.timebank.example"}
OTHERS = {"alice": ["bob", "david"], "bob": ["alice", "david"], "david": ["alice", "bob"]}
MONTHS = ["2026-06", "2026-07", "2026-08"]
MONTH_WORD = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
DATED_TITLE = re.compile(r"^(.+), (\d{1,2}) (" + "|".join(MONTH_WORD) + r")$")

# Recurring work: (title, giver, receiver, work, [(iso day, hours)]). The first
# three extend September pages written by hand; the rest are new pages.
EXTEND = [
    ("Childcare for David", "alice", "david", "Childcare", [("2026-06-18", 3), ("2026-07-16", 3), ("2026-08-20", 4)]),
    ("Gardening for Bob", "alice", "bob", "Gardening", [("2026-06-06", 2), ("2026-07-11", 2.5), ("2026-08-08", 2)]),
    ("Website fix for Bob", "david", "bob", "Website fix", [("2026-07-22", 2), ("2026-08-26", 1.5)]),
]
RECURRING = [
    ("Dog walking for Alice", "bob", "alice", "Dog walking", [("2026-06-03", 1), ("2026-06-17", 1), ("2026-07-01", 1), ("2026-07-15", 1.5)]),
    ("Maths tutoring for Bob", "david", "bob", "Maths tutoring", [("2026-06-09", 1.5), ("2026-07-07", 1.5), ("2026-08-04", 1.5)]),
    ("Shopping for David", "alice", "david", "Shopping", [("2026-07-09", 1), ("2026-08-13", 1)]),
    ("Computer help for Alice", "david", "alice", "Computer help", [("2026-06-27", 2), ("2026-08-29", 1)]),
    ("Lawn mowing for David", "bob", "david", "Lawn mowing", [("2026-06-14", 1), ("2026-07-12", 1), ("2026-08-09", 1)]),
]
WORKS = {
    "alice": ["Jam making", "Plant sitting", "Cake baking", "Hemming", "Seed sorting", "Hedge trimming"],
    "bob": ["Car wash", "Shelf fitting", "Ladder help", "Furniture assembly", "Tyre change", "Bread"],
    "david": ["Photo scanning", "Proofreading", "CV review", "Printer setup", "Spreadsheet help", "Soup"],
}
NOTES = {
    "Childcare": "Collected the children from school, then tea and homework until David got home.",
    "Gardening": "Weeded the vegetable beds, tied in the beans and cut back the lavender.",
    "Website fix": "Fixed the broken booking form on Bob's site and renewed its certificate.",
    "Dog walking": "Took Alice's dog along the river for an hour while she was at work.",
    "Maths tutoring": "An hour and a half of algebra with Bob's daughter before her exam.",
    "Shopping": "Did David's weekly shop while he was laid up with a bad back.",
    "Computer help": "Cleared the laptop of old software and set up backups.",
    "Lawn mowing": "Mowed David's lawn and edged the borders.",
    "Jam making": "Made a batch of plum jam from the tree and brought over six jars.",
    "Plant sitting": "Watered the house plants and the greenhouse while they were away.",
    "Cake baking": "Baked a birthday cake, two layers, lemon.",
    "Hemming": "Took up the hems on a pair of curtains.",
    "Seed sorting": "Sorted and labelled the seed swap tin.",
    "Hedge trimming": "Trimmed the front hedge and cleared the clippings.",
    "Car wash": "Washed and hoovered the car inside and out.",
    "Shelf fitting": "Put up two shelves in the kitchen alcove.",
    "Ladder help": "Held the ladder and passed tools while the gutters were cleared.",
    "Furniture assembly": "Assembled a flat-pack wardrobe.",
    "Tyre change": "Changed a flat tyre and checked the spare.",
    "Bread": "Baked two sourdough loaves.",
    "Photo scanning": "Scanned an album of old family photos and put them on a stick.",
    "Proofreading": "Proofread a grant application, ten pages.",
    "CV review": "Went through a CV line by line and rewrote the summary.",
    "Printer setup": "Set up the new printer on the home network.",
    "Spreadsheet help": "Built a household budget spreadsheet.",
    "Soup": "Made a pot of soup and dropped it round.",
    "Sewing lesson": "An afternoon learning to use the sewing machine: threading, tension and a straight seam.",
}
# Carol has no site: pages naming her are orphans, flagged unknown party.
CAROL_PAGES = [
    ("Printer setup for Carol", "david", "carol", "Printer setup", "2026-06-21", 1, "david"),
    ("Bread for Carol", "bob", "carol", "Bread", "2026-07-25", 1, "bob"),
    ("Sewing lesson from Carol", "carol", "alice", "Sewing lesson", "2026-08-16", 2, "alice"),  # a thank-you: the receiver writes
]
# Late September: written, not yet logged by anyone — the September ledgers pull them.
LATE = [
    ("Plant sitting for Bob", "alice", "bob", "Plant sitting", "2026-09-24", 1),
    ("Shelf fitting for David", "bob", "david", "Shelf fitting", "2026-09-25", 2),
    ("Proofreading for Alice", "david", "alice", "Proofreading", "2026-09-24", 1.5),
]


# --- small helpers ------------------------------------------------------------

def hid(*parts) -> str:
    """A deterministic 16-hex id, so a rerun writes the same items."""
    return hashlib.sha1("|".join(str(p) for p in (SEED, *parts)).encode()).hexdigest()[:16]


def ms(iso: str, hour: int = 12) -> int:
    d = dt.datetime.fromisoformat(iso).replace(hour=hour, tzinfo=dt.timezone.utc)
    return int(d.timestamp() * 1000)


def long_day(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return f"{d.day} {MONTH_WORD[d.month - 1]} {d.year}"


def hours_text(h: float) -> str:
    m = round(h * 60)
    if m % 60 == 0:
        return f"{m // 60} hour" if m == 60 else f"{m // 60} hours"
    return f"{m} minutes"


def amount_words(h: float) -> str:
    return {0.5: "half an hour", 1: "an hour", 1.5: "an hour and a half", 2: "two hours", 2.5: "two and a half hours",
            3: "three hours", 4: "four hours"}.get(h, hours_text(h))


def party(key: str) -> dict:
    return CAROL if key == "carol" else PEOPLE[key]


def load(domain: str, slug: str):
    path = fedwiki.page_path(domain, slug)
    return fedwiki.load_page(path) if os.path.exists(path) else None


def save(domain: str, slug: str, page: dict, write: bool, log: list, what: str) -> None:
    log.append(f"{what}: http://{domain}:{PORT}/view/{slug}")
    if write:
        fedwiki.save_page(fedwiki.page_path(domain, slug), page)


def generated(page) -> bool:
    j = (page or {}).get("journal") or []
    return bool(j) and "timebank-sample.py (seed" in (j[0].get("provenance") or "")


def ledger_item(page):
    return next((i for i in page["story"] if i.get("type") == "timebank"
                 and not re.search(r"^\s*(TOOL|INDEX|BALANCE)", i.get("text") or "", re.M)), None)


def txn_text(giver: str, receiver: str, hours: float, iso: str, work: str, source: str = "hand") -> str:
    g, r = party(giver), party(receiver)
    return "\n".join([f"GIVER: [{g['url']} {g['ledger']}]", f"RECEIVER: [{r['url']} {r['ledger']}]",
                      f"HOURS: {hours_text(hours)}", f"DATE: {long_day(iso)}", f"WHAT: {work}", f"SOURCE: {source}"])


# --- migrate: rename the dated pages -----------------------------------------------

def rename_pages(write: bool, log: list) -> dict:
    """-> {old_slug: (old_title, new_title, new_slug)} across the three sites."""
    renames = {}
    for key, p in PEOPLE.items():
        root, _ = fedwiki.resolve_root(p["domain"])
        for slug, path in sorted(fedwiki.iter_pages(root)):
            page = fedwiki.load_page(path)
            m = DATED_TITLE.match(page.get("title") or "")
            if not m or page.get("moved") or not any(i.get("type") == "transaction" for i in page["story"]):
                continue
            old, new = page["title"], m.group(1)
            new_slug = fedwiki.as_slug(new)
            renames[slug] = (old, new, new_slug)
            if load(p["domain"], new_slug):
                continue
            now = fedwiki.now_ms()
            page = copy.deepcopy(page)
            page["title"] = new
            if page["journal"] and page["journal"][0].get("type") == "create":
                page["journal"][0]["item"]["title"] = new
            fork = fedwiki.add_journal(page, "fork", {"site": p["site"]}, date=now)
            fork["renamed"] = {"from": old, "slug": slug}
            fork["provenance"] = f"Renamed from [[{old}]] ({slug}): re-created under the new slug with the old journal carried over, as wiki-client does when a page's title is edited. {MIGRATE_PROV}"
            for i, it in enumerate(list(page["story"])):
                if it.get("type") != "transaction":
                    continue
                f = tr.parse_transaction(it.get("text") or "")
                if f["date"] is None:
                    continue
                iso = dt.datetime.fromtimestamp(f["date"] / 1000, dt.timezone.utc).date().isoformat()
                item = fedwiki.make_item(f"{iso} {new}", type="date", id=hid("date", p["domain"], new_slug, it["id"]))
                at = page["story"].index(it) + 1
                page["story"].insert(at, item)
                fedwiki.add_journal(page, "add", item, after=it["id"], date=now + 1,
                                    provenance="The recorded date as a date item; the title no longer carries it.")
            save(p["domain"], new_slug, page, write, log, "renamed")
            stub = fedwiki.make_item(f"➜ Moved to [[{new}]] — this page was renamed.", id=hid("moved", p["domain"], slug))
            moved = {"title": old, "moved": new, "story": [stub],
                     "journal": [fedwiki.create_entry(old, [stub], provenance=f"Moved to [[{new}]]. {MIGRATE_PROV}", date=now)]}
            save(p["domain"], slug, moved, write, log, "moved stub")
            root_assets = os.path.join(str(root), "assets")
            if os.path.isdir(os.path.join(root_assets, slug)) and not os.path.exists(os.path.join(root_assets, new_slug)):
                log.append(f"assets moved: {p['domain']}/assets/{slug} -> {new_slug}")
                if write:
                    shutil.move(os.path.join(root_assets, slug), os.path.join(root_assets, new_slug))
    return renames


def repoint(renames: dict, write: bool, log: list) -> None:
    """Every item text on the three sites and the localhost demo page: old
    titles and slugs become the new ones (ledger lines, forks, prose)."""
    pairs = sorted({(o, n) for o, n, _ in renames.values()}, key=lambda x: -len(x[0]))
    slugs = sorted(((s, v[2]) for s, v in renames.items()), key=lambda x: -len(x[0]))
    targets = [(p["domain"], None) for p in PEOPLE.values()] + [("localhost", "timebank-verification-demo")]
    for domain, only in targets:
        root, _ = fedwiki.resolve_root(domain)
        for slug, path in sorted(fedwiki.iter_pages(root)):
            if only and slug != only:
                continue
            page = fedwiki.load_page(path)
            if page.get("moved") or slug.startswith("timebank-weekly-report") or slug == "timebank-report":
                continue
            changed = False
            for it in page["story"]:
                t = it.get("text")
                if not isinstance(t, str):
                    continue
                u = t
                for o, n in pairs:
                    u = u.replace(o, n)
                for o, n in slugs:
                    u = re.sub(rf"(?<![a-z0-9-]){re.escape(o)}(?![a-z0-9-])", n, u)
                if u != t:
                    it["text"] = u
                    fedwiki.add_journal(page, "edit", it, provenance="Repointed to the renamed transaction pages.")
                    changed = True
            if changed:
                save(domain, slug, page, write, log, "repointed")


# --- migrate: split the ledgers into periods ---------------------------------------

def date_lines(text: str, site: str) -> str:
    """Prefix each linked line with its transaction page's date (read from disk)."""
    out = []
    for line in text.split("\n"):
        es = tr.parse_entries(line)
        e = es[0] if es else None
        if e and e["linked"] and e.get("txn") and e.get("date") is None:
            t = e["txn"]
            where = t.get("site") or site
            dom = re.sub(r":\d+$", "", where)
            page = load(dom, t["slug"]) if dom.endswith(".localhost") else None
            fs = tr.page_transactions(page, where, t["slug"]) if page else []
            f = next((x for x in fs if x["date"] is not None and tr.js_round(e["time"] * 60) == x["minutes"]), fs[0] if fs else None)
            if f and f["date"] is not None:
                line = f"{dt.datetime.fromtimestamp(f['date'] / 1000, dt.timezone.utc).date().isoformat()} {line.strip()}"
        out.append(line)
    return "\n".join(out)


def split_ledgers(write: bool, log: list) -> None:
    for key, p in PEOPLE.items():
        page = load(p["domain"], p["slug"])
        item = ledger_item(page) if page else None
        if not item or tr.extract_commands(item["text"])["periods"]:
            continue
        title = f"{p['ledger']} 2026-09"
        slug = fedwiki.as_slug(title)
        body = []
        for line in item["text"].split("\n"):
            s = line.strip()
            if re.match(r"^(START|END)\s*:", s, re.I):
                continue
            if s.endswith("four weeks of swaps with " + " and ".join(PEOPLE[o]["name"] for o in OTHERS[key]) + "."):
                continue
            body.append(line)
        text = "\n".join(["START: 1 September 2026", "END: 30 September 2026"] + [date_lines(l, p["site"]) for l in body] +
                         [f"{p['name']}'s September, from the ledger she kept before it had periods." if key == "alice" else
                          f"{p['name']}'s September, from the ledger he kept before it had periods."])
        if not load(p["domain"], slug):
            others = " and ".join(f"[{PEOPLE[o]['url']} {PEOPLE[o]['ledger']}]" for o in OTHERS[key])
            new = fedwiki.make_page(title, [
                f"{p['name']}'s ledger for September 2026: one period of [[{p['ledger']}]], whose summary adds the months up. Each line links its [[Time Transaction]] page and carries its date; the badge checks it against the September lines of {others}.",
                {"type": "timebank", "text": text, "id": hid("period", slug)},
                "LINEUP pulls the transaction pages on this site dated in September that name this ledger; WATCH lists the sites whose September pages naming it show as awaiting reconcile. Click the badge to open the [[Ledger Verification Tool]].",
                f"# See\n\n- [[{p['ledger']}]] — the summary, and the net balance\n- [[{p['about']}]] — whose ledger it is\n- [[Transactions Index]] — every transaction page on this site\n- [[Time Transaction]] — what a transaction page is",
            ], provenance=f"Split from [[{p['ledger']}]]: its September lines, dated. {MIGRATE_PROV}")
            save(p["domain"], slug, new, write, log, "period ledger")
        # the ledger becomes the summary
        item["text"] = f"OWNER: [[{p['about']}]]\nPERIODS: 10\nNOTIFY: {NOTIFY}"
        fedwiki.add_journal(page, "edit", item, provenance=f"Now the summary ledger: its lines moved to [[{title}]]. {MIGRATE_PROV}")
        lead = page["story"][0]
        others = " and ".join(f"[{PEOPLE[o]['url']} {PEOPLE[o]['ledger']}]" for o in OTHERS[key])
        lead["text"] = (f"{p['name']} keeps a timebank ledger on {p['domain']}, month by month: one period page per month — "
                        f"[[{title}]] and the months before it — and this summary, which finds them by title in the site's sitemap, "
                        f"shows the ten most recent transactions and the net balance. The OWNER line links [[{p['about']}]], where the "
                        f"balance also shows. {p['name']} trades hours with {others}; transaction pages and their ledgers name this page, "
                        f"never a period page.")
        fedwiki.add_journal(page, "edit", lead, provenance="Describes the summary ledger.")
        help_ = page["story"][2]
        help_["text"] = ("PERIODS: 10 finds the period pages titled with this page's title and a month, shows the ten most recent "
                         "transactions and the net balance — hours given less hours received, over the lines written in the period "
                         "ledgers. The badge is the worst of the periods' badges; click it to open the [[Ledger Verification Tool]].")
        fedwiki.add_journal(page, "edit", help_, provenance="Describes PERIODS.")
        see = page["story"][-1]
        see["text"] = (f"# See\n\n- [[{p['about']}]] — the owner, and the balance beside them\n- [[Transactions Index]] — every "
                       f"transaction page on this site and whether a period ledger logs it\n- [[Time Transaction]] — what a transaction "
                       f"page is\n- [[Time Transaction Template]] — the shape each one shares\n- [http://localhost:4242/view/timebank-verification-demo "
                       f"Timebank Verification Demo] — the demo pages on localhost")
        fedwiki.add_journal(page, "edit", see, provenance="See the owner and the index.")
        save(p["domain"], p["slug"], page, write, log, "summary ledger")


def about_pages(write: bool, log: list) -> None:
    for key, p in PEOPLE.items():
        slug = fedwiki.as_slug(p["about"])
        if load(p["domain"], slug):
            continue
        page = fedwiki.make_page(p["about"], [
            f"{p['name']} owns {p['domain']}, one of the three sites of the timebank test bed on the laptop. {p['name']}'s ledger is [[{p['ledger']}]] — a summary over one period page per month — and its OWNER line links this page, so the balance lives beside its owner.",
            {"type": "timebank", "text": f"BALANCE: [[{p['ledger']}]]", "id": hid("balance", p["domain"])},
            f"The balance is read live from the period ledgers: hours given and received on lines written there, and the net. Transaction pages that no period ledger logs yet are not in it; the [[Transactions Index]] lists every transaction page on {p['domain']} and says which.",
            f"# See\n\n- [[{p['ledger']}]] — the summary ledger\n- [[Transactions Index]] — every transaction page on this site\n- [[Time Transaction]] — what a transaction page is",
        ], provenance=MIGRATE_PROV)
        save(p["domain"], slug, page, write, log, "about page")


def teach_template(write: bool, log: list) -> None:
    for key, p in PEOPLE.items():
        page = load(p["domain"], "time-transaction-template")
        if page and not any(i.get("type") == "date" for i in page["story"]):
            t = next(i for i in page["story"] if i.get("type") == "transaction")
            item = fedwiki.make_item("2026-01-01", type="date", id=hid("template-date", p["domain"]))
            page["story"].insert(page["story"].index(t) + 1, item)
            fedwiki.add_journal(page, "add", item, after=t["id"], provenance="The recorded date as a date item.")
            note = fedwiki.make_item(
                "*Name the page for the work and the person — Childcare for David, Soup from Alice — never the date: the date goes in "
                "the transaction item's DATE line and in the date item beside it. When the same work recurs for the same person, add "
                "the new occasion to this page — a date item and a transaction item of its own — instead of a new page.*",
                id=hid("template-naming", p["domain"]))
            page["story"].insert(page["story"].index(item) + 1, note)
            fedwiki.add_journal(page, "add", note, after=item["id"], provenance="Naming and recurring work.")
            save(p["domain"], "time-transaction-template", page, write, log, "template")
        topic = load(p["domain"], "time-transaction")
        if topic and not any("never the date" in (i.get("text") or "") for i in topic["story"]):
            item = fedwiki.make_item(
                "A transaction page is named for the work and the person — [[Childcare for David]] — never the date. The recorded "
                "date is in the transaction item's DATE line and in a date item on the page; the journal keeps when the page was "
                "written. When the same work recurs for the same person the page recurs: one transaction item per occasion, each "
                "with its own date, and a ledger line names an occasion by linking the page with the date first — "
                "`2026-09-10 [[Childcare for David]] for …: 4 hours`. Every transaction page on this site: the [[Transactions Index]].",
                id=hid("topic-naming", p["domain"]))
            at = next((k for k, i in enumerate(topic["story"]) if (i.get("text") or "").startswith("# ")), len(topic["story"]))
            topic["story"].insert(at, item)
            fedwiki.add_journal(topic, "add", item, after=topic["story"][at - 1]["id"] if at else None, provenance="Naming and recurring work.")
            save(p["domain"], "time-transaction", topic, write, log, "topic page")


# --- generate: the transactions ----------------------------------------------------

def plan_transactions() -> tuple[dict, dict]:
    """-> (pages, logging). pages: title -> {giver, receiver, work, home, occasions: [(iso, hours)], extend};
    logging: (title, iso) -> {giver: bool, receiver: bool}."""
    rnd = random.Random(SEED)
    taken = {"Childcare for David", "Garden design for David", "Gardening for Bob", "Pruning for David", "Sewing for Bob",
             "Translation for Bob", "Bread for Alice", "Soup for Alice", "Bicycle lesson for Alice", "Bike repair for David",
             "Guitar lesson for David", "Lift to the station for Alice", "Moving boxes for David", "Tax form help for Alice",
             "Website fix for Bob"}
    pages = {}
    for title, g, r, work, occ in EXTEND:
        pages[title] = {"giver": g, "receiver": r, "work": work, "home": g, "occasions": list(occ), "extend": True, "kind": "recurring"}
    for title, g, r, work, occ in RECURRING:
        pages[title] = {"giver": g, "receiver": r, "work": work, "home": g, "occasions": list(occ), "extend": False, "kind": "recurring"}
    oneoffs = []
    for month in MONTHS:
        y, m = (int(x) for x in month.split("-"))
        n = 0
        while n < 9:
            g = rnd.choice(sorted(PEOPLE))
            r = rnd.choice(OTHERS[g])
            work = rnd.choice(WORKS[g])
            day = rnd.randint(1, 28)
            hours = rnd.choice([0.5, 1, 1, 1.5, 2, 2, 3])
            title = f"{work} for {PEOPLE[r]['name']}"
            if title in taken or (title in pages and pages[title]["kind"] == "recurring"):
                continue
            iso = f"{y}-{m:02d}-{day:02d}"
            if title in pages:
                if any(o[0] == iso for o in pages[title]["occasions"]):
                    continue
                pages[title]["occasions"].append((iso, hours))
            else:
                pages[title] = {"giver": g, "receiver": r, "work": work, "home": g, "occasions": [(iso, hours)], "extend": False, "kind": "one-off"}
            oneoffs.append((title, iso))
            n += 1
    for title, g, r, work, iso, hours, home in CAROL_PAGES:
        pages[title] = {"giver": g, "receiver": r, "work": work, "home": home, "occasions": [(iso, hours)], "extend": False, "kind": "carol"}
    for title, g, r, work, iso, hours in LATE:
        if title in pages:
            pages[title]["occasions"].append((iso, hours))
        else:
            pages[title] = {"giver": g, "receiver": r, "work": work, "home": g, "occasions": [(iso, hours)], "extend": False, "kind": "late"}
    for p in pages.values():
        p["occasions"].sort()
    logging = {}
    late = {(t, iso) for t, _, _, _, iso, _ in LATE}
    for title, p in pages.items():
        for iso, _ in p["occasions"]:
            carol = "carol" in (p["giver"], p["receiver"])
            logging[(title, iso)] = {"giver": not carol and (title, iso) not in late, "receiver": not carol and (title, iso) not in late}
    # a few gaps, one per site: the giver has not logged it (an orphan on their site's index)
    for giver, month in (("alice", "2026-07"), ("bob", "2026-08"), ("david", "2026-06")):
        t, iso = next((t, iso) for t, iso in sorted(oneoffs, key=lambda x: x[1]) if pages[t]["giver"] == giver and iso.startswith(month))
        logging[(t, iso)]["giver"] = False
    # and one receiver who has not logged it yet (the giver's month is partly verified)
    t, iso = next((t, iso) for t, iso in sorted(oneoffs, key=lambda x: x[1]) if pages[t]["receiver"] == "david" and iso.startswith("2026-08")
                  and logging[(t, iso)]["giver"])
    logging[(t, iso)]["receiver"] = False
    return pages, logging


def occasion_items(title: str, p: dict, iso: str, hours: float, slug: str, home: str, heading: bool) -> list[dict]:
    items = []
    if heading:
        items.append(fedwiki.make_item(f"# {long_day(iso)}\n> Another occasion of the same work.", unwrap=False, id=hid("occ-h", home, slug, iso)))
    items.append(fedwiki.make_item(f"{iso} {title}", type="date", id=hid("date", home, slug, iso)))
    source = "thank-you" if p["home"] == p["receiver"] else "hand"
    items.append(fedwiki.make_item(txn_text(p["giver"], p["receiver"], hours, iso, p["work"], source), type="transaction", unwrap=False,
                                   id=hid("txn", home, slug, iso)))
    items.append(fedwiki.make_item(NOTES.get(p["work"], f"{p['work']}, as agreed."), id=hid("note", home, slug, iso)))
    return items


def write_transaction_pages(pages: dict, write: bool, log: list) -> None:
    for title, p in sorted(pages.items()):
        home = PEOPLE[p["home"]]
        slug = fedwiki.as_slug(title)
        existing = load(home["domain"], slug)
        g, r = party(p["giver"]), party(p["receiver"])
        if p["extend"]:
            if not existing:
                if write:
                    sys.exit(f"{title} should exist on {home['domain']} (the migration renames it)")
                log.append(f"would add {len(p['occasions'])} occasions to {title} once it is renamed")
                continue
            ids = {i["id"] for i in existing["story"]}
            new = []
            first = True
            for iso, hours in p["occasions"]:
                items = occasion_items(title, p, iso, hours, slug, home["domain"], heading=False)
                if first:
                    items.insert(0, fedwiki.make_item("# Earlier occasions\n> The same work for the same person, June to August 2026.",
                                                      unwrap=False, id=hid("earlier", home["domain"], slug)))
                    first = False
                new += [i for i in items if i["id"] not in ids]
            if not new:
                continue
            see = next((k for k, i in enumerate(existing["story"]) if (i.get("text") or "").startswith("# See")), len(existing["story"]))
            after = existing["story"][see - 1]["id"]
            for k, item in enumerate(new):
                existing["story"].insert(see + k, item)
                fedwiki.add_journal(existing, "add", item, after=after, provenance=PROV)
                after = item["id"]
            save(home["domain"], slug, existing, write, log, f"occasions added ({len(p['occasions'])})")
            continue
        if existing and not generated(existing):
            log.append(f"SKIPPED (hand-written page in the way): http://{home['domain']}:{PORT}/view/{slug}")
            continue
        occ = p["occasions"]
        n = len(occ)
        when = (f"on {long_day(occ[0][0])}" if n == 1 else
                f"{n} times, from {long_day(occ[0][0])} to {long_day(occ[-1][0])} — one transaction item per occasion, each with its own date")
        total = sum(h for _, h in occ)
        if p["home"] == p["receiver"]:
            lead = (f"This page is a [[Time Transaction]]: {g['name']} gave {r['name']} {amount_words(total)} of {p['work'].lower()} {when}. "
                    f"{r['name']} recorded it as a thank-you, on the receiver's site. Sample data for the test bed.")
        else:
            lead = (f"This page is a [[Time Transaction]]: {g['name']} gave {r['name']} {amount_words(total) if n == 1 else f'{amount_words(total)} in all'} "
                    f"of {p['work'].lower()} {when}. {g['name']} wrote it here, on the giver's site; [[{home['ledger']}]] logs it. Sample data for the test bed.")
        story = [fedwiki.make_item(lead, id=hid("lead", home["domain"], slug))]
        story += occasion_items(title, p, occ[0][0], occ[0][1], slug, home["domain"], heading=False)
        carol = "carol" in (p["giver"], p["receiver"])
        sign = ("# Sign-off\n> The receiver adds the line to their ledger.")
        sign_text = (f"{'Carol has no site and no ledger here, so this page cannot be signed off by her: the Transactions Index flags her as an unknown party.' if carol else ''} "
                     f"The receiver signs off by adding each occasion's line, dated, to their own period ledger for the month, "
                     f"[{r['url']} {r['ledger']}]; the giver logs it in theirs, [{g['url']} {g['ledger']}].").strip()
        tail = [fedwiki.make_item(sign, unwrap=False, id=hid("sign-h", home["domain"], slug)),
                fedwiki.make_item(sign_text, id=hid("sign", home["domain"], slug)),
                fedwiki.make_item(f"# See\n\n- [[Time Transaction]] — what this page is\n- [{g['url']} {g['ledger']}] — the giver's ledger\n"
                                  f"- [{r['url']} {r['ledger']}] — the receiver's ledger\n- [[Transactions Index]] — every transaction page on this site",
                                  unwrap=False, id=hid("see", home["domain"], slug))]
        page = fedwiki.make_page(title, story + tail, provenance=PROV, date=ms(occ[0][0], 19))
        for iso, hours in occ[1:]:
            items = occasion_items(title, p, iso, hours, slug, home["domain"], heading=True)
            at = len(page["story"]) - len(tail)
            after = page["story"][at - 1]["id"]
            for k, item in enumerate(items):
                page["story"].insert(at + k, item)
                fedwiki.add_journal(page, "add", item, after=after, date=ms(iso, 19) + k)
                after = item["id"]
        save(home["domain"], slug, page, write, log, f"{p['kind']} page ({n})")


# --- generate: the period ledgers June to August -----------------------------------------

def period_line(owner: str, title: str, p: dict, iso: str, hours: float) -> str | None:
    me = PEOPLE[owner]
    if owner == p["giver"]:
        other, word = party(p["receiver"]), "for"
    elif owner == p["receiver"]:
        other, word = party(p["giver"]), "from"
    else:
        return None
    home = PEOPLE[p["home"]]
    slug = fedwiki.as_slug(title)
    link = f"[[{title}]]" if home is me else f"[http://{home['site']}/view/{slug} {title}]"
    return f"{iso} {link} {word} [{other['url']} {other['ledger']}]: {hours_text(hours)}"


def write_period_ledgers(pages: dict, logging: dict, write: bool, log: list) -> None:
    for key, me in PEOPLE.items():
        for month in MONTHS:
            lines = []
            for title, p in pages.items():
                for iso, hours in p["occasions"]:
                    if not iso.startswith(month):
                        continue
                    side = "giver" if key == p["giver"] else "receiver" if key == p["receiver"] else None
                    if not side or not logging[(title, iso)][side]:
                        continue
                    lines.append(period_line(key, title, p, iso, hours))
            lines.sort()
            y, m = (int(x) for x in month.split("-"))
            last = (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)).day
            word = MONTH_WORD[m - 1]
            text = "\n".join([f"START: 1 {word} {y}", f"END: {last} {word} {y}", f"NOTIFY: {NOTIFY}"] + lines +
                             [f"{me['name']}'s {word}: {len(lines)} lines with " + " and ".join(PEOPLE[o]["name"] for o in OTHERS[key]) + "."])
            title = f"{me['ledger']} {month}"
            slug = fedwiki.as_slug(title)
            existing = load(me["domain"], slug)
            if existing and not generated(existing):
                log.append(f"SKIPPED (hand-written period ledger): http://{me['site']}/view/{slug}")
                continue
            others = " and ".join(f"[{PEOPLE[o]['url']} {PEOPLE[o]['ledger']}]" for o in OTHERS[key])
            page = fedwiki.make_page(title, [
                fedwiki.make_item(f"{me['name']}'s ledger for {word} {y}: one period of [[{me['ledger']}]], whose summary adds the months up. Each line is dated and links its [[Time Transaction]] page; the badge checks it against the {word} lines of {others}. A closed month: no LINEUP, so a transaction page it does not log is an orphan on the [[Transactions Index]].", id=hid("plead", slug)),
                fedwiki.make_item(text, type="timebank", unwrap=False, id=hid("period", slug)),
                fedwiki.make_item(f"# See\n\n- [[{me['ledger']}]] — the summary, and the net balance\n- [[{me['about']}]] — whose ledger it is\n- [[Transactions Index]] — every transaction page on this site\n- [[Time Transaction]] — what a transaction page is", unwrap=False, id=hid("psee", slug)),
            ], provenance=PROV, date=ms(f"{y}-{m:02d}-{last:02d}", 20))
            save(me["domain"], slug, page, write, log, f"period ledger ({len(lines)} lines)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    write = not a.dry_run
    log: list[str] = []
    renames = rename_pages(write, log)
    if write:
        repoint(renames, write, log)
    split_ledgers(write, log)
    about_pages(write, log)
    teach_template(write, log)
    pages, logging = plan_transactions()
    write_transaction_pages(pages, write, log)
    write_period_ledgers(pages, logging, write, log)
    occ = [(t, iso) for t, p in pages.items() for iso, _ in p["occasions"]]
    print("\n".join(log))
    print(f"\n{len(renames)} renamed; {len(pages)} generated pages, {len(occ)} generated occasions "
          f"({sum(1 for t, p in pages.items() if len(p['occasions']) > 1)} pages with two or more); "
          f"unlogged: {sorted(k for k, v in logging.items() if not all(v.values()))}")
    for month in MONTHS + ["2026-09"]:
        print(f"  {month}: {sum(1 for _, iso in occ if iso.startswith(month))} generated occasions")


if __name__ == "__main__":
    main()
