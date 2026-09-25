"""python3 -m unittest discover -s tools   (from the repo root)"""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import review_model as rm  # noqa: E402

MEMBERS = [{"member": m, "site": f"{m.lower()}.localhost:4242", "url": f"http://{m.lower()}.localhost:4242/view/x"} for m in ("Alice", "Bob")]


def tx(date, week, title, giver, receiver, hours):
    return {"date": date, "week": week, "title": title, "giver": giver, "receiver": receiver, "hours": hours,
            "category": rm.category_of(title), "state": "verified", "url": "http://x/view/y"}


TXS = [tx("2026-09-28", "2026-W40", "Childcare for Bob", "Alice", "Bob", 2.0),
       tx("2026-09-29", "2026-W40", "Website fix for Alice", "Bob", "Alice", 1.0),
       tx("2026-09-30", "2026-W40", "Bread for Bob", "Alice", "Bob", 1.0)]


class ReviewModel(unittest.TestCase):
    def test_categories_from_labels(self):
        self.assertEqual(rm.category_of("Maths tutoring"), "Teaching")
        self.assertEqual(rm.category_of("Dog walking"), "Care")
        self.assertEqual(rm.category_of("Something new"), "Other")
        self.assertEqual(rm.category_of("Something new", "tech"), "Tech")

    def test_approval_text_round_trips(self):
        text = rm.approval_text("2026-W40", "2026-10-05", "David Bovill", [("Alice", 3.0), ("Bob", 1.0)])
        self.assertTrue(text.startswith("REVIEW: 2026-W40\nAPPROVED: 2026-10-05 by David Bovill\nAlice: 3 hours\nBob: 1 hour\n"))
        r = rm.parse_review(text)
        self.assertEqual(r["approved"], {"on": "2026-10-05", "by": "David Bovill"})
        self.assertEqual(r["hours"], [("Alice", 3.0), ("Bob", 1.0)])

    def test_build_computes_what_the_formulas_would(self):
        state = {"plan": {"2026-W40": {"Alice": (4.0, "care"), "Bob": (2.0, "web")}}, "approved": []}
        totals = rm.weekly_totals(TXS, ["Alice", "Bob"])
        self.assertAlmostEqual(totals[("2026-W40", "Alice")]["weighted"], 2 * 1.2 + 1 * 1.0)
        state["approved"] = rm.approve_rows("2026-W40", "2026-10-05", "D", [("Alice", 3.0), ("Bob", 1.0)], totals)
        self.assertAlmostEqual(state["approved"][0]["weighted"], 3.0 * (3.4 / 3.0))
        sheets, names, layout, fig = rm.build(MEMBERS, TXS, state)
        self.assertEqual([n for n, _ in sheets], ["Members", "Plan", "Actual", "Review", "Equity", "Approved"])
        self.assertEqual(layout["plan"]["2026-W40"], "B2:D3")
        self.assertEqual(layout["review"]["2026-W40"], "B2:H3")
        review = dict(sheets)["Review"]
        self.assertEqual(review[1][2][0], 4.0)   # planned
        self.assertEqual(review[1][3][0], 3.0)   # actual given
        self.assertEqual(review[1][4][0], -1.0)  # variance
        self.assertIn("SUMIFS(Plan!", review[1][2][2])
        # one approved week, as of itself: a quarter vested
        shares = {s["member"]: s for s in fig["shares"]}
        self.assertAlmostEqual(shares["Alice"]["vested"], 3.4 / 4)
        self.assertAlmostEqual(shares["Alice"]["share"] + shares["Bob"]["share"], 1.0)

    def test_workbook_round_trip_keeps_plan_and_approvals(self):
        state = {"plan": {"2026-W40": {"Alice": (4.0, "care"), "Bob": (2.0, "web")}},
                 "approved": rm.approve_rows("2026-W40", "2026-10-05", "D", [("Alice", 3.0), ("Bob", 1.0)], rm.weekly_totals(TXS, ["Alice", "Bob"]))}
        sheets, names, layout, _ = rm.build(MEMBERS, TXS, state)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "m.xlsx")
            rm.write_xlsx(path, sheets, names)
            first = open(path, "rb").read()
            back = rm.load_state(path)
            self.assertEqual(back["plan"], state["plan"])
            self.assertEqual([(a["week"], a["member"], a["hours"]) for a in back["approved"]], [("2026-W40", "Alice", 3.0), ("2026-W40", "Bob", 1.0)])
            rm.write_xlsx(path, *rm.build(MEMBERS, TXS, back)[:2])
            self.assertEqual(open(path, "rb").read(), first, "the same figures give the same bytes")
            cells = rm.read_xlsx(path)["Equity"]
            self.assertEqual(cells[(15, 0)], "Member")


if __name__ == "__main__":
    unittest.main()
