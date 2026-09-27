"""Tests for review_deck — the Review Deck the report tool writes with --deck (0.9.0)."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import review_deck as rd  # noqa: E402

REVIEW = """MODEL /assets/review-model/review-model.xlsx
SHEET Review
CAPTION Planned against actual, every planned week

| Week | Member | Planned | Actual | Variance |
|---|---|---|---|---|
| 2026-W40 | Alice | 4.0 | 3.0 | -1.0 |
| 2026-W40 | David Bovill | 3.0 | 2.0 | -1.0 |"""


class Titles(unittest.TestCase):
    def test_titles(self):
        self.assertEqual(rd.deck_title("2026-W40"), "Review Deck 2026-W40")
        self.assertEqual(rd.slide_title("2026-W40", 2, "hours"), "Review Slide W40 2 — Hours given per member")
        self.assertEqual(rd.meeting_title("2026-W40"), "Review Meeting 2026-W40")

    def test_manifest(self):
        t = rd.manifest_text("2026-W40", ["Review Slide W40 1 — Weekly Review", "Review Slide W40 2 — Hours given per member"], presenters=["david"])
        lines = t.split("\n")
        self.assertEqual(lines[:8], ["DECK Weekly Review 2026-W40", "THEME [[Review Deck Theme]]", "TITLE HIDE", "WIDTH 1280", "HEIGHT 720",
                                     "LIVE https://live.pi5.private.fish", "PRESENTERS david", "SLIDE [[Review Slide W40 1 — Weekly Review]]"])
        self.assertEqual(len([x for x in lines if x.startswith("SLIDE ")]), 2)

    def test_manifest_public(self):
        t = rd.manifest_text("2026-W40", ["A"], presenters=None, relay=None)
        self.assertNotIn("LIVE", t)
        self.assertNotIn("PRESENTERS", t)

    def test_theme_directives(self):
        names = [l.split()[0] for l in rd.THEME_DIRECTIVES.split("\n")]
        self.assertEqual(names[0], "BASE")
        for n in names:
            self.assertIn(n, {"BASE", "COLOR-BG", "COLOR-FG", "COLOR-ACCENT", "COLOR-LINK", "COLOR-MUTED", "FONT-HEADING", "FONT-BODY", "FONT-CODE", "FONT-SIZE", "LOGO", "FOOTER", "CSS"})


class Meeting(unittest.TestCase):
    def page(self, *texts):
        return {"story": [{"type": "markdown", "text": t} for t in texts]}

    def test_attendance_and_mood(self):
        p = self.page("In the room: David, Max and Mitch.", "David's mood: steady, a good week.", "Max's mood: tired", "Mitch's mood: …")
        self.assertEqual(rd.meeting_lines(p), {"attendance": ["David", "Max", "Mitch"], "mood": [["David", "steady, a good week"], ["Max", "tired"]]})

    def test_placeholders_are_skipped(self):
        p = self.page("In the room: (from the room roster)", "David's mood: *one line, said at the review*")
        self.assertEqual(rd.meeting_lines(p), {"attendance": [], "mood": []})

    def test_previous_meeting(self):
        slugs = ["review-meeting-2026-w38", "review-meeting-2026-w39", "review-meeting-2026-w40", "review-meeting-template", "weekly-plan-2026-w39"]
        self.assertEqual(rd.previous_meeting(slugs, "2026-W40"), "review-meeting-2026-w39")
        self.assertIsNone(rd.previous_meeting(slugs, "2026-W38"))


class Masks(unittest.TestCase):
    def test_inline_and_file(self):
        self.assertEqual(rd.load_masks("David=Koi,Max=Pufferfish"), {"David": "Koi", "Max": "Pufferfish"})
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"Mitch": "Pike"}, f)
        try:
            self.assertEqual(rd.load_masks(f.name), {"Mitch": "Pike"})
        finally:
            os.unlink(f.name)
        self.assertIsNone(rd.load_masks(None))
        with self.assertRaises(SystemExit):
            rd.load_masks("/nonexistent/masks.json")

    def test_mask(self):
        m = {"David": "Koi"}
        self.assertEqual(rd.mask("David Bovill", m), "Koi")
        self.assertEqual(rd.mask("Alice", m), "Alice")
        self.assertEqual(rd.mask("David Bovill", None), "David Bovill")


class Render(unittest.TestCase):
    def test_render_through_node(self):
        rows = [{"member": "Alice", "given": 3, "received": 2, "net": 1, "awaiting": 1}]
        slides = rd.render([REVIEW], {"week": "2026-W40", "rows": rows}, {"week": "2026-W40", "masks": {"Alice": "Pike"}})
        self.assertEqual([s["key"] for s in slides], ["title", "hours", "planned", "ledger"])
        for s in slides:
            self.assertIn('viewBox="0 0 1280 720"', s["svg"])
            self.assertNotIn("Alice", s["svg"])
            self.assertNotIn("Alice", s["notes"])
        self.assertIn("Pike gave 3 hours", slides[-1]["notes"])

    def test_ledger_rows(self):
        summary = {"rows": [{"member": "A", "given": 1.504, "received": 0.0, "net": 1.504, "verified": 1, "awaiting": 2}]}
        self.assertEqual(rd.ledger_rows(summary), [{"member": "A", "given": 1.5, "received": 0.0, "net": 1.5, "awaiting": 2}])
        self.assertEqual(rd.ledger_table_rows(rd.ledger_rows(summary)), [["A", "1.5", "0", "1.5", 2]])


if __name__ == "__main__":
    unittest.main()
