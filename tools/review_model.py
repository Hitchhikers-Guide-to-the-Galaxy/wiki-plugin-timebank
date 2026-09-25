"""review_model — the Review Model workbook (Phase 12 of the Timebank Verification Plan).

One workbook the review meeting argues in, written by the broker's report tool
and frozen onto wiki pages by the Model Plugin. Tabs:

  Members   Member, Site, Ledger — from Known Ledgers
  Plan      Week, Member, Estimated hours, Tasks — the planning meeting's; the
            tool keeps what is there and only seeds weeks that have no rows
  Actual    A:J every transaction (Date, Week, Transaction, Giver, Receiver,
            Hours, Category, State, Link, Weighted hours) and L:P the weekly
            totals per member (Week, Member, Given, Received, Weighted given) —
            imported from the wiki, never edited here
  Review    Week, Member, Planned, Actual, Variance, Approved hours,
            Approved on, Approver — planned against actual, and what was approved
  Equity    multipliers by category, vesting, and the shares
  Approved  one dated row per member per approved week — appended once, never
            rewritten: the week's hours burned to dynamic equity

Formulas are written WITH their cached values, because the Model Plugin never
evaluates a formula: it shows the <v> a spreadsheet last saved. This module
computes every cached value the formula would give. Stdlib only; the bytes are
deterministic, so the same figures give the same file.

The kind of work (Category) comes from a transaction's CATEGORY field when it
has one, else from its label through KINDS below — until the transaction item
carries CATEGORY (Phase 10).
"""

from __future__ import annotations

import datetime as dt
import os
import re
import zipfile
from xml.sax.saxutils import escape as xesc

# --- categories ----------------------------------------------------------------

CATEGORIES = [
    ("Care", 1.2, "childcare, dog walking, plant sitting"),
    ("Garden", 1.0, "gardening, pruning, hedges, lawns, seeds"),
    ("Food", 1.0, "bread, soup, jam, cakes, cooking"),
    ("Repair", 1.1, "bikes, furniture, shelves, tyres, sewing"),
    ("Teaching", 1.25, "lessons and tutoring"),
    ("Tech", 1.25, "computers, printers, websites, spreadsheets, scanning"),
    ("Admin", 1.1, "CV, proofreading, tax forms, translation"),
    ("Errands", 0.9, "lifts, shopping, moving, car wash"),
    ("Other", 1.0, "anything the list does not name"),
]

KINDS = [  # (word in the label, category) — first match wins
    ("lesson", "Teaching"), ("tutoring", "Teaching"),
    ("childcare", "Care"), ("dog walking", "Care"), ("plant sitting", "Care"),
    ("garden", "Garden"), ("pruning", "Garden"), ("hedge", "Garden"), ("lawn", "Garden"), ("seed", "Garden"),
    ("bread", "Food"), ("soup", "Food"), ("jam", "Food"), ("cake", "Food"), ("cooking", "Food"),
    ("repair", "Repair"), ("furniture", "Repair"), ("shelf", "Repair"), ("tyre", "Repair"), ("sewing", "Repair"),
    ("computer", "Tech"), ("printer", "Tech"), ("website", "Tech"), ("spreadsheet", "Tech"), ("photo scanning", "Tech"),
    ("cv", "Admin"), ("proofreading", "Admin"), ("tax", "Admin"), ("translation", "Admin"),
    ("lift", "Errands"), ("shopping", "Errands"), ("moving", "Errands"), ("car wash", "Errands"),
]

VEST_WEEKS = 4


def category_of(label: str | None, explicit: str | None = None) -> str:
    names = {c[0].lower(): c[0] for c in CATEGORIES}
    if explicit and explicit.strip().lower() in names:
        return names[explicit.strip().lower()]
    low = (label or "").lower()
    for word, cat in KINDS:
        if re.search(rf"\b{re.escape(word)}", low):
            return cat
    return "Other"


def multiplier(cat: str) -> float:
    return next((m for c, m, _ in CATEGORIES if c == cat), 1.0)


# --- the plan the tool seeds (deterministic; the planning meeting edits it) ----

DEFAULT_PLAN = {
    "2026-W36": {"Alice": (3, "Gardening for Bob; cover childcare if asked"),
                 "Bob": (2, "Website fix for David"),
                 "David": (2, "Soup for Alice; lawn")},
    "2026-W37": {"Alice": (3, "Childcare for David"),
                 "Bob": (2, "Printer setup; spreadsheet help"),
                 "David": (3, "Tax form help for Alice; hedge")},
    "2026-W38": {"Alice": (2, "Sewing for Bob"),
                 "Bob": (4, "Maths tutoring; website fix"),
                 "David": (2, "Guitar lesson; errands")},
    "2026-W39": {"Alice": (5, "Garden design; bread; pruning"),
                 "Bob": (4, "Lift to the station; translation"),
                 "David": (2, "Proofreading for Alice")},
    "2026-W40": {"Alice": (3, "Seed swap stall; soup"),
                 "Bob": (3, "Bike repair; printer setup for Carol"),
                 "David": (3, "Maths help; shelf fitting")},
}


def week_start(week: str) -> dt.date:
    y, w = week.split("-W")
    return dt.date.fromisocalendar(int(y), int(w), 1)


def fmt_hours(h: float) -> str:
    h = round(float(h), 2)
    return f"{h:g} hour" if h == 1 else f"{h:g} hours"


# --- approval text (the REVIEW item on a weekly report; same grammar as review.js) --

def approval_text(week: str, on: str, by: str, hours: list[tuple[str, float]]) -> str:
    lines = [f"REVIEW: {week}", f"APPROVED: {on} by {by}"]
    lines += [f"{m}: {fmt_hours(h)}" for m, h in hours]
    lines.append("The meeting approved these hours; the report tool burns them into the Review Model's Approved sheet once.")
    return "\n".join(lines)


def parse_review(text: str) -> dict:
    out = {"week": None, "approved": None, "hours": []}
    for raw in (text or "").split("\n"):
        line = raw.strip()
        m = re.match(r"^REVIEW\s*:\s*(\d{4}-W\d{2})\s*$", line, re.I)
        if m:
            out["week"] = m.group(1).upper()
            continue
        m = re.match(r"^APPROVED\s*:\s*(\d{4}-\d{2}-\d{2})(?:\s+by\s+(.+))?$", line, re.I)
        if m:
            out["approved"] = {"on": m.group(1), "by": (m.group(2) or "").strip() or "the site owner"}
            continue
        m = re.match(r"^([^:]+?)\s*:\s*([\d.]+)\s*(?:hours?|h)\s*$", line, re.I)
        if m and out["week"]:
            out["hours"].append((m.group(1).strip(), float(m.group(2))))
    return out


# --- xlsx writing ------------------------------------------------------------------
# A cell is a value, or (value, style), or (value, style, formula). Styles:
# 0 General, 1 bold, 2 '0.0', 3 '0.0%', 4 '0.00'.

STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
          '<numFmts count="3"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="0.00"/></numFmts>'
          '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
          '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
          '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
          '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
          '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
          '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
          '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
          '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>')


def col(n: int) -> str:
    s = ""
    n += 1
    while n:
        n, rem = divmod(n - 1, 26)
        s = chr(65 + rem) + s
    return s


def _num(v) -> str:
    v = round(float(v), 10)
    return repr(int(v)) if v == int(v) else repr(v)


def _cell(ref: str, value, style: int = 0, formula: str | None = None) -> str:
    s = f' s="{style}"' if style else ""
    f = f"<f>{xesc(formula)}</f>" if formula else ""
    if value is None or value == "":
        return f'<c r="{ref}"{s}>{f}</c>' if (formula or style) else ""
    if isinstance(value, str) and not formula:
        return f'<c r="{ref}" t="inlineStr"{s}><is><t>{xesc(value)}</t></is></c>'
    if isinstance(value, str):
        return f'<c r="{ref}" t="str"{s}>{f}<v>{xesc(value)}</v></c>'
    return f'<c r="{ref}"{s}>{f}<v>{_num(value)}</v></c>'


def _sheet_xml(rows: list[list]) -> str:
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    for i, cells in enumerate(rows, start=1):
        xml = "".join(_cell(f"{col(j)}{i}", *(c if isinstance(c, tuple) else (c,))) for j, c in enumerate(cells) if c is not None)
        out.append(f'<row r="{i}">{xml}</row>')
    out.append("</sheetData></worksheet>")
    return "".join(out)


def write_xlsx(path: str, sheets: list[tuple[str, list[list]]], names: dict[str, str] | None = None) -> None:
    names = names or {}
    ct = "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                 for i in range(1, len(sheets) + 1))
    wb_sheets = "".join(f'<sheet name="{xesc(n)}" sheetId="{i}" r:id="rId{i}"/>' for i, (n, _) in enumerate(sheets, start=1))
    defined = "".join(f'<definedName name="{xesc(k)}">{xesc(v)}</definedName>' for k, v in sorted(names.items()))
    rels = "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
                   for i in range(1, len(sheets) + 1))
    n = len(sheets) + 1
    parts = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ct + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + wb_sheets + '</sheets>' + (f"<definedNames>{defined}</definedNames>" if defined else "") + '</workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + f'<Relationship Id="rId{n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        "xl/styles.xml": STYLES,
    }
    for i, (_, rows) in enumerate(sheets, start=1):
        parts[f"xl/worksheets/sheet{i}.xml"] = _sheet_xml(rows)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    os.replace(tmp, path)


# --- xlsx reading (cached values; what a spreadsheet last saved) ------------------

def _unxml(s: str) -> str:
    return (s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&"))


def _addr(ref: str) -> tuple[int, int]:
    m = re.match(r"^([A-Z]+)(\d+)$", ref)
    c = 0
    for ch in m.group(1):
        c = c * 26 + ord(ch) - 64
    return int(m.group(2)), c - 1


def read_xlsx(path: str) -> dict[str, dict[tuple[int, int], object]]:
    """{sheet: {(row, col0): value}} — cached values, whoever saved the file
    (this module, Excel, LibreOffice or Google Sheets' export)."""
    with zipfile.ZipFile(path) as z:
        strip = lambda x: re.sub(r"<(/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])", r"<\1", x)  # noqa: E731
        read = lambda n: strip(z.read(n).decode("utf-8")) if n in z.namelist() else ""  # noqa: E731
        wb, rels = read("xl/workbook.xml"), read("xl/_rels/workbook.xml.rels")
        targets = {}
        for m in re.finditer(r"<Relationship\b[^>]*>", rels):
            rid = re.search(r'Id="([^"]*)"', m.group(0)).group(1)
            t = re.search(r'Target="([^"]*)"', m.group(0)).group(1)
            targets[rid] = t.lstrip("/") if t.startswith("/") else f"xl/{t}"
        shared = [_unxml("".join(re.findall(r"<t\b[^>]*>([\s\S]*?)</t>", si)))
                  for si in re.findall(r"<si>([\s\S]*?)</si>", read("xl/sharedStrings.xml"))]
        out = {}
        for m in re.finditer(r"<sheet\b[^>]*>", wb):
            name = _unxml(re.search(r'name="([^"]*)"', m.group(0)).group(1))
            rid = re.search(r'r:id="([^"]*)"', m.group(0)).group(1)
            cells = {}
            for c in re.finditer(r"<c\b([^>]*?)(?:/>|>([\s\S]*?)</c>)", read(targets[rid])):
                attrs, inner = c.group(1), c.group(2) or ""
                ref = re.search(r'r="([^"]*)"', attrs).group(1)
                t = (re.search(r't="([^"]*)"', attrs) or [None, "n"])[1]
                v = re.search(r"<v>([\s\S]*?)</v>", inner)
                if t == "s" and v:
                    val = shared[int(v.group(1))]
                elif t == "inlineStr":
                    val = _unxml("".join(re.findall(r"<t\b[^>]*>([\s\S]*?)</t>", inner)))
                elif t in ("str", "e"):
                    val = _unxml(v.group(1)) if v else None
                elif t == "b":
                    val = bool(v and v.group(1) == "1")
                else:
                    val = float(v.group(1)) if v else None
                if val is not None and val != "":
                    cells[_addr(ref)] = val
            out[name] = cells
        return out


def _rows(cells: dict, width: int) -> list[list]:
    if not cells:
        return []
    last = max(r for r, _ in cells)
    return [[cells.get((r, c)) for c in range(width)] for r in range(1, last + 1)]


def load_state(path: str) -> dict:
    """What the workbook holds that the wiki does not: the plan and the approvals."""
    state = {"plan": {}, "approved": []}
    if not os.path.exists(path):
        return state
    book = read_xlsx(path)
    for row in _rows(book.get("Plan", {}), 4)[1:]:
        week, member, hours, tasks = row
        if week and member:
            state["plan"].setdefault(str(week), {})[str(member)] = (float(hours or 0), str(tasks or ""))
    for row in _rows(book.get("Approved", {}), 8)[1:]:
        on, week, member, hours, weighted, approver = row[:6]
        if week and member:
            state["approved"].append({"on": str(on), "week": str(week), "member": str(member), "hours": float(hours or 0),
                                      "weighted": float(weighted or 0), "approver": str(approver or "")})
    return state


# --- the model -------------------------------------------------------------------

def weekly_totals(txs: list[dict], members: list[str]) -> dict[tuple[str, str], dict]:
    out = {}
    for t in txs:
        for who, key in ((t["giver"], "given"), (t["receiver"], "received")):
            if who in members:
                row = out.setdefault((t["week"], who), {"given": 0.0, "received": 0.0, "weighted": 0.0})
                row[key] += t["hours"]
                if key == "given":
                    row["weighted"] += t["hours"] * multiplier(t["category"])
    return out


def approve_rows(week: str, on: str, by: str, hours: list[tuple[str, float]], totals: dict) -> list[dict]:
    """The Approved sheet's rows for one week: the approved hours weighted by the
    member's mix of work that week (weighted given / given), frozen as values."""
    rows = []
    for member, h in hours:
        t = totals.get((week, member)) or {}
        ratio = (t["weighted"] / t["given"]) if t.get("given") else 1.0
        rows.append({"on": on, "week": week, "member": member, "hours": round(h, 4), "weighted": round(h * ratio, 4), "approver": by})
    return rows


def build(members: list[dict], txs: list[dict], state: dict, vest_weeks: int = VEST_WEEKS):
    """-> (sheets, names, layout, figures). members: [{member, site, url}];
    txs: [{date, week, title, giver, receiver, hours, category, state, url}]."""
    names_ = [m["member"] for m in members]
    nm = len(names_)
    plan = {w: dict(v) for w, v in state["plan"].items()}
    weeks = sorted(plan)
    approved = sorted(state["approved"], key=lambda a: (a["week"], names_.index(a["member"]) if a["member"] in names_ else 99, a["member"]))
    ncat = len(CATEGORIES)

    # Equity layout first: other sheets refer to it
    e_vest, e_asof = ncat + 3, ncat + 4
    e_head = ncat + 6
    e_first, e_last = e_head + 1, e_head + nm
    e_total = e_last + 1

    # Members
    members_rows = [[("Member", 1), ("Site", 1), ("Ledger", 1)]] + [[m["member"], m["site"], m["url"]] for m in members]

    # Plan
    plan_rows = [[("Week", 1), ("Member", 1), ("Estimated hours", 1), ("Tasks", 1)]]
    plan_ranges = {}
    for w in weeks:
        start = len(plan_rows) + 1
        for member in names_:
            h, tasks = plan[w].get(member, (0.0, ""))
            plan_rows.append([w, member, (float(h), 2), tasks])
        plan_ranges[w] = f"B{start}:D{start + nm - 1}"
    # members named in the plan but not known are kept, below the known ones
    for w in weeks:
        for member in plan[w]:
            if member not in names_:
                h, tasks = plan[w][member]
                plan_rows.append([w, member, (float(h), 2), tasks])

    # Actual
    txs = sorted(txs, key=lambda t: (t["date"], t["title"]))
    n = len(txs)
    last = n + 1
    actual = [[("Date", 1), ("Week", 1), ("Transaction", 1), ("Giver", 1), ("Receiver", 1), ("Hours", 1), ("Category", 1),
               ("State", 1), ("Link", 1), ("Weighted hours", 1), None,
               ("Week", 1), ("Member", 1), ("Given", 1), ("Received", 1), ("Weighted given", 1)]]
    for i, t in enumerate(txs, start=2):
        actual.append([t["date"], t["week"], t["title"], t["giver"], t["receiver"], (t["hours"], 2), t["category"], t["state"], t["url"],
                       (t["hours"] * multiplier(t["category"]), 4, f"F{i}*IFERROR(VLOOKUP(G{i},Equity!$A$2:$B${ncat + 1},2,FALSE),1)")])
    totals = weekly_totals(txs, names_)
    total_weeks = sorted({t["week"] for t in txs} | set(weeks))
    j = 2
    for w in total_weeks:
        for member in names_:
            t = totals.get((w, member), {"given": 0.0, "received": 0.0, "weighted": 0.0})
            cells = [w, member,
                     (t["given"], 2, f"SUMIFS($F$2:$F${last},$B$2:$B${last},L{j},$D$2:$D${last},M{j})"),
                     (t["received"], 2, f"SUMIFS($F$2:$F${last},$B$2:$B${last},L{j},$E$2:$E${last},M{j})"),
                     (t["weighted"], 4, f"SUMIFS($J$2:$J${last},$B$2:$B${last},L{j},$D$2:$D${last},M{j})")]
            if j <= len(actual):
                actual[j - 1] += [None] * (11 - len(actual[j - 1])) + cells
            else:
                actual.append([None] * 11 + cells)
            j += 1
    tot_last = j - 1

    # Review
    by_wm = {(a["week"], a["member"]): a for a in approved}
    review = [[("Week", 1), ("Member", 1), ("Planned", 1), ("Actual", 1), ("Variance", 1), ("Approved hours", 1), ("Approved on", 1), ("Approver", 1)]]
    review_ranges, figures = {}, {"review": {}}
    for w in weeks:
        start = len(review) + 1
        for member in names_:
            r = len(review) + 1
            planned = float(plan[w].get(member, (0.0, ""))[0])
            given = totals.get((w, member), {}).get("given", 0.0)
            a = by_wm.get((w, member))
            review.append([w, member,
                           (planned, 2, f"SUMIFS(Plan!$C:$C,Plan!$A:$A,$A{r},Plan!$B:$B,$B{r})"),
                           (given, 2, f"SUMIFS(Actual!$N$2:$N${tot_last},Actual!$L$2:$L${tot_last},$A{r},Actual!$M$2:$M${tot_last},$B{r})"),
                           (given - planned, 2, f"D{r}-C{r}"),
                           (a["hours"], 2) if a else None, a["on"] if a else None, a["approver"] if a else None])
            figures["review"].setdefault(w, []).append({"member": member, "planned": planned, "actual": given, "approved": a["hours"] if a else None})
        review_ranges[w] = f"B{start}:H{start + nm - 1}"

    # Approved (+ vesting)
    asof = max((a["week"] for a in approved), default=None)
    asof_text = week_start(asof).isoformat() if asof else ""
    appr = [[("Approved on", 1), ("Week", 1), ("Member", 1), ("Approved hours", 1), ("Weighted hours", 1), ("Approver", 1), ("Week starts", 1), ("Vested hours", 1)]]
    vested_by = {m: 0.0 for m in names_}
    for i, a in enumerate(approved, start=2):
        ws = week_start(a["week"])
        frac = min(1.0, (((week_start(asof) - ws).days / 7) + 1) / vest_weeks) if asof else 0.0
        v = a["weighted"] * frac
        vested_by[a["member"]] = vested_by.get(a["member"], 0.0) + v
        appr.append([a["on"], a["week"], a["member"], (a["hours"], 2), (a["weighted"], 4), a["approver"], ws.isoformat(),
                     (v, 4, f"E{i}*MIN(1,((DATEVALUE(Equity!$B${e_asof})-DATEVALUE(G{i}))/7+1)/Equity!$B${e_vest})")])

    # Equity
    equity = [[("Category", 1), ("Multiplier", 1), ("Kinds of work", 1)]]
    equity += [[c, (m, 4), kinds] for c, m, kinds in CATEGORIES]
    equity.append([])
    equity.append([("Vesting weeks", 1), vest_weeks, "an approved week vests a quarter a week, starting with the week itself"])
    equity.append([("As of week starting", 1), asof_text, "the latest approved week (written by the report tool)"])
    equity.append([])
    equity.append([("Member", 1), ("Approved hours", 1), ("Weighted hours", 1), ("Vested hours", 1), ("Share", 1)])
    vsum = sum(vested_by.get(m, 0.0) for m in names_)
    shares = []
    for k, member in enumerate(names_):
        r = e_first + k
        ah = sum(a["hours"] for a in approved if a["member"] == member)
        wh = sum(a["weighted"] for a in approved if a["member"] == member)
        vh = vested_by.get(member, 0.0)
        sh = (vh / vsum) if vsum else 0.0
        shares.append({"member": member, "approved": ah, "weighted": wh, "vested": vh, "share": sh})
        equity.append([member,
                       (ah, 2, f"SUMIF(Approved!$C:$C,$A{r},Approved!$D:$D)"),
                       (wh, 4, f"SUMIF(Approved!$C:$C,$A{r},Approved!$E:$E)"),
                       (vh, 4, f"SUMIF(Approved!$C:$C,$A{r},Approved!$H:$H)"),
                       (sh, 3, f"IF(SUM(D${e_first}:D${e_last})=0,0,D{r}/SUM(D${e_first}:D${e_last}))")])
    equity.append([("Total", 1),
                   (sum(s["approved"] for s in shares), 2, f"SUM(B{e_first}:B{e_last})"),
                   (sum(s["weighted"] for s in shares), 4, f"SUM(C{e_first}:C{e_last})"),
                   (vsum, 4, f"SUM(D{e_first}:D{e_last})"),
                   (1.0 if vsum else 0.0, 3, f"SUM(E{e_first}:E{e_last})")])
    figures["shares"] = shares

    sheets = [("Members", members_rows), ("Plan", plan_rows), ("Actual", actual), ("Review", review), ("Equity", equity), ("Approved", appr)]
    names = {"ReviewShares": f"Equity!$A${e_head}:$E${e_total}"}
    for w in weeks:
        a, b = plan_ranges[w].split(":")
        names[f"Plan_{w.replace('-', '_')}"] = f"Plan!${a[0]}${a[1:]}:${b[0]}${b[1:]}"
        a, b = review_ranges[w].split(":")
        names[f"Review_{w.replace('-', '_')}"] = f"Review!${a[0]}${a[1:]}:${b[0]}${b[1:]}"
    layout = {"plan": plan_ranges, "review": review_ranges, "review_all": f"A1:E{len(review)}",
              "shares": f"A{e_head}:E{e_total}", "weeks": weeks, "tot_last": tot_last}
    return sheets, names, layout, figures
