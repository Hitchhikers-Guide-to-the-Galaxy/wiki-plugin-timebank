"""python3 -m unittest discover -s tools   (from the repo root)"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import timebank_report as tr  # noqa: E402

FIXTURES = json.load(open(os.path.join(HERE, "..", "test", "fixtures", "transactions.json")))

A = "http://alice.localhost:4242/view/alices-ledger"
B = "http://bob.localhost:4242/view/bobs-ledger"
D = "http://david.localhost:4242/view/davids-ledger"
MEMBERS = [
    {"member": "Alice", "site": "alice.localhost:4242", "slug": "alices-ledger"},
    {"member": "Bob", "site": "bob.localhost:4242", "slug": "bobs-ledger"},
    {"member": "David", "site": "david.localhost:4242", "slug": "davids-ledger"},
]


def txn(giver, receiver, hours, date, what="Work"):
    return "\n".join([f"GIVER: [{giver} G]", f"RECEIVER: [{receiver} R]", f"HOURS: {hours}", f"DATE: {date}", f"WHAT: {what}"])


def page(title, text, journal=None):
    return {"title": title, "story": [{"type": "transaction", "id": "t1", "text": text}],
            "journal": journal or [{"type": "create", "item": {"title": title}, "date": 1}]}


class TransactionParserPort(unittest.TestCase):
    """The shared fixtures: the JS wrote them, the port must agree."""

    def test_parse_transaction_matches_the_javascript(self):
        for case in FIXTURES["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(tr.parse_transaction(case["text"], case["page"]), case["expect"])

    def test_minutes_dates_urls_and_sites_match_the_javascript(self):
        for s, want in FIXTURES["minutes"]:
            self.assertEqual(tr.parse_minutes(s), want, s)
        for s, want in FIXTURES["dates"]:
            self.assertEqual(tr.parse_date(s), want, s)
        for s, want in FIXTURES["urls"]:
            self.assertEqual(tr.parse_ledger_url(s), want, s)
        for a, b, want in FIXTURES["sameSite"]:
            self.assertEqual(tr.same_site(a, b), want, (a, b))

    def test_ledger_lines(self):
        e = tr.parse_entries(f"LINEUP\n[[Gardening for Bob, 1 September]] for [{B} Bob's Ledger]: 2 hours\n"
                             f"[http://alice.localhost:4242/view/sewing-for-bob Sewing for Bob] from [{A} Alice's Ledger]: 90 minutes\n"
                             "Cooking for [[David's Ledger]]: 1 hour\nAdmin tasks")
        self.assertEqual([x["direction"] for x in e], ["gave", "received", "gave"])
        self.assertEqual(e[0]["txn"]["slug"], "gardening-for-bob-1-september")
        self.assertEqual(e[1]["time"], 1.5)
        self.assertEqual(e[1]["counterparty"]["site"], "alice.localhost:4242")
        self.assertIsNone(e[2]["txn"])
        self.assertEqual(tr.extract_commands("WATCH: bob.localhost:4242, //david.localhost:4242/x\nLINEUP")["watch"],
                         ["bob.localhost:4242", "david.localhost:4242"])


class ForkDedupe(unittest.TestCase):
    def test_a_fork_counts_once_by_its_home_site(self):
        text = txn(A, B, "2 hours", "1 September 2026")
        home = page("Gardening for Bob", text)
        fork = page("Gardening for Bob", text, [{"type": "create", "date": 1}, {"type": "fork", "site": "alice.localhost:4242", "date": 2},
                                                {"type": "add", "date": 3}])
        self.assertEqual(tr.home_site(home, "alice.localhost:4242"), "alice.localhost:4242")
        self.assertEqual(tr.home_site(fork, "bob.localhost:4242"), "alice.localhost:4242")
        copies = [{"facts": f, "site": s, "home": tr.home_site(p, s)}
                  for p, s in ((fork, "bob.localhost:4242"), (home, "alice.localhost"))
                  for f in tr.page_transactions(p, s)]
        out = tr.dedupe(copies)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["forks"], ["bob.localhost:4242"])
        self.assertTrue(out[0]["home_read"])
        self.assertEqual(out[0]["facts"]["page"]["site"], "alice.localhost")

    def test_a_chain_of_forks_leads_home_to_the_first(self):
        chain = page("X", txn(A, B, "1 hour", "2026-09-01"), [
            {"type": "create", "date": 1}, {"type": "fork", "site": "alice.localhost:4242", "date": 2},
            {"type": "fork", "site": "bob.localhost:4242", "date": 3}])
        self.assertEqual(tr.home_site(chain, "david.localhost:4242"), "alice.localhost:4242")

    def test_a_seeded_fork_before_the_create_is_not_a_home(self):
        seeded = page("X", txn(A, B, "1 hour", "2026-09-01"), [
            {"type": "fork", "site": "plugin.fedwiki.club", "date": 0}, {"type": "create", "date": 1}])
        self.assertEqual(tr.home_site(seeded, "alice.localhost:4242"), "alice.localhost:4242")

    def test_the_same_slug_on_two_home_sites_is_two_transactions(self):
        a = page("Soup", txn(A, B, "1 hour", "2026-09-01"))
        d = page("Soup", txn(D, B, "1 hour", "2026-09-01"))
        copies = [{"facts": f, "site": s, "home": s} for p, s in ((a, "alice.localhost:4242"), (d, "david.localhost:4242"))
                  for f in tr.page_transactions(p, s)]
        self.assertEqual(len(tr.dedupe(copies)), 2)


class IsoWeeks(unittest.TestCase):
    def test_weeks_run_monday_to_sunday(self):
        ms = lambda s: tr.parse_date(s)  # noqa: E731
        self.assertEqual(tr.iso_week(ms("2026-08-31")), "2026-W36")
        self.assertEqual(tr.iso_week(ms("2026-09-06")), "2026-W36")
        self.assertEqual(tr.iso_week(ms("2026-09-07")), "2026-W37")
        self.assertEqual(tr.iso_week(ms("27 September 2026")), "2026-W39")
        self.assertEqual(tr.iso_week(ms("2026-01-01")), "2026-W01")
        self.assertEqual(tr.iso_week(ms("2027-01-01")), "2026-W53")
        self.assertEqual(tr.week_bounds("2026-W36")[0].isoformat(), "2026-08-31")
        self.assertEqual(tr.week_bounds("2026-W36")[1].isoformat(), "2026-09-06")

    def test_bucketing_skips_undated(self):
        ts = [{"facts": {"date": tr.parse_date("2026-09-01")}}, {"facts": {"date": tr.parse_date("2026-09-08")}},
              {"facts": {"date": None}}, {"facts": {"date": tr.parse_date("2026-09-02")}}]
        weeks = tr.by_week(ts)
        self.assertEqual(list(weeks), ["2026-W36", "2026-W37"])
        self.assertEqual(len(weeks["2026-W36"]), 2)


class StatesAndShares(unittest.TestCase):
    def ledgers(self, a_text, b_text):
        return [{"site": "alice.localhost:4242", "slug": "alices-ledger", "entries": tr.ledger_entries({"story": [{"type": "timebank", "text": a_text}]}, "alice.localhost:4242")},
                {"site": "bob.localhost:4242", "slug": "bobs-ledger", "entries": tr.ledger_entries({"story": [{"type": "timebank", "text": b_text}]}, "bob.localhost:4242")}]

    def one(self, forks=()):
        f = tr.parse_transaction(txn(A, B, "2 hours", "2026-09-01", "Gardening"), {"site": "alice.localhost:4242", "slug": "gardening-for-bob", "title": "Gardening for Bob"})
        return {"home": "alice.localhost:4242", "facts": f, "forks": list(forks)}

    def test_the_home_page_is_the_givers_record_and_the_receivers_line_verifies(self):
        led = self.ledgers("LINEUP", f"[http://alice.localhost:4242/view/gardening-for-bob Gardening for Bob] from [{A} Alice's Ledger]: 2 hours")
        self.assertEqual(tr.state_of(self.one(), led), "verified")

    def test_without_the_receivers_line_it_awaits_or_is_in_dialogue(self):
        led = self.ledgers("LINEUP", "LINEUP")
        self.assertEqual(tr.state_of(self.one(), led), "awaiting")
        self.assertEqual(tr.state_of(self.one(["bob.localhost:4242"]), led), "in dialogue")

    def test_a_line_naming_the_wrong_ledger_does_not_carry(self):
        led = self.ledgers("", f"[http://alice.localhost:4242/view/gardening-for-bob Gardening for Bob] from [[Alice's Ledger]]: 2 hours")
        self.assertEqual(tr.state_of(self.one(), led), "awaiting")

    def test_label_and_minutes_carry_a_line_with_no_page_link(self):
        led = self.ledgers("", f"Gardening from [{A} Alice's Ledger]: 120 minutes")
        self.assertEqual(tr.state_of(self.one(), led), "verified")

    def test_shares_of_hours_given(self):
        def t(g, r, minutes, state):
            return {"facts": {"giver": {"site": g[0], "slug": g[1]}, "receiver": {"site": r[0], "slug": r[1]}, "minutes": minutes}, "state": state}
        a, b, d = [(m["site"], m["slug"]) for m in MEMBERS]
        s = tr.summarise([t(a, b, 120, "verified"), t(b, d, 60, "awaiting"), t(a, d, 60, "verified")], MEMBERS)
        rows = {r["member"]: r for r in s["rows"]}
        self.assertEqual(s["total"], 4)
        self.assertEqual(rows["Alice"]["given"], 3)
        self.assertAlmostEqual(rows["Alice"]["share"], 0.75)
        self.assertAlmostEqual(rows["Bob"]["share"], 0.25)
        self.assertEqual(rows["David"]["share"], 0)
        self.assertEqual(rows["David"]["received"], 2)
        self.assertEqual(rows["David"]["net"], -2)
        self.assertEqual((rows["Bob"]["verified"], rows["Bob"]["awaiting"]), (1, 1))
        self.assertAlmostEqual(sum(r["share"] for r in s["rows"]), 1)

    def test_hours_format(self):
        self.assertEqual([tr.fmt_hours(h) for h in (2, 1.5, 0.5, -1.5, 0)], ["2h", "1h 30m", "30m", "-1h 30m", "0h"])


class Drawing(unittest.TestCase):
    def test_svgs_are_self_contained(self):
        pie = tr.pie_svg([("Alice", 3), ("Bob", 1.5), ("David", 0)], "Hours given")
        bars = tr.bars_svg([("2026-W36", [("Alice", 2), ("Bob", 1.5)])], ["Alice", "Bob"], "Hours per week")
        for s in (pie, bars):
            self.assertTrue(s.startswith("<svg") and s.endswith("</svg>"))
            self.assertNotIn("http://", s.replace('xmlns="http://www.w3.org/2000/svg"', ""))
        self.assertIn("67%", pie)
        self.assertIn("W36", bars)


if __name__ == "__main__":
    unittest.main()
