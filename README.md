# wiki-plugin-timebank

A [Federated Wiki](https://fed.wiki) plugin that displays time entries as a dated ledger with totals.

Each `timebank` item holds newline-separated text. Lines are classified and rendered as a table with a running total and optional date range header.

## Usage

Double-click a timebank item to edit. Each line is one entry:

```
START: 1 June 2026
END: 7 June 2026
Meeting with David: 2 hours
Code review: 1 hour
Admin tasks
Call with team: 30 mins
A short description of this period's work.
```

- Lines with `START:` / `END:` set the date range shown in the header
- Lines ending in a time amount (`2 hours`, `30 mins`, `1.5h`, `90m`) are summed into a **Total** row
- Lines without a time are shown as notes
- Prose sentences (containing punctuation) appear as an italic caption below the table
- Entry rows and the caption go through the wiki's link resolver, so `[[Links]]` work and HTML is escaped

## Linked ledgers and the Verified badge

```
START: 1 September 2026
END: 7 September 2026
NOTIFY: ntfy.sh/timebank-david
Gardening for [[Alice Ledger]]: 2 hours
Repairs from [[Alice Ledger]]: 1 hour
Soup for [https://alice.wiki/view/alices-ledger Alice's Ledger]: 1 hour
Meeting with [[David]]: 2 hours
```

- `for` / `to` — hours I **gave**; `from` / `by` — hours I **received**
- `[[Page]]` names a ledger on **this page's own site**
- `[https://site/view/slug Name]` names a ledger on **another site** by external link — the only cross-site form (0.3.0). `http://`, `//site/slug`, ports, a trailing slash and a `.html` or `.json` suffix are all accepted. Write `/view/slug`: a wiki server answers `/view/slug` and `/slug.html`, not a bare `/slug`
- A link without a direction word is an ordinary entry
- `NOTIFY: topic` — ntfy topic (https unless `http://` is written)
- `WATCH: site [site …]` — sites this ledger watches for incoming Time Transaction pages that name it (0.5.0)
- `LEDGER:` is gone (0.3.0): name the ledger by external link instead

A ledger's identity is its **site plus its slug**. An entry is matched when the counterparty ledger has a timebank entry that points back at this exact ledger — a wikilink on their page names their own site, so it only points back when both ledgers share a site — runs the opposite way, has the same minutes and the same label (case, spacing and trailing punctuation ignored), in an overlapping START/END period when both declare one. Two pages titled "David's Ledger" on two sites never match each other. On a `*.localhost` dev farm a portless name and its `:port` name count as one site.

The badge beside the column header is **Verified** (green, all matched), **Partly verified** (orange) or **Not verified** (red, none matched or a counterparty unreachable); hover for details. Each external counterparty's site is registered as a neighbour, so its flag shows and its pages resolve.

## Time Transaction pages and LINEUP (0.4.0)

A ledger line is a summary; a **Time Transaction** page records the work, with a `transaction` item holding the facts:

```
GIVER: [https://alice.wiki/view/alices-ledger Alice's Ledger]
RECEIVER: [https://david.wiki/view/davids-ledger David's Ledger]
HOURS: 1 hour
DATE: 3 September 2026
WHAT: Repairs
SOURCE: audio note
Planed the shed door and re-hung the gate.
```

- An entry's label may link its transaction page: `[[Repairs for David, 3 September]] for [https://david.wiki/view/davids-ledger David's Ledger]: 1 hour`, or `[https://alice.wiki/view/repairs-for-david-3-september Repairs for David, 3 September] from [...]` from another site
- When both ledgers link the same page (site plus slug) they match **by page**, before label and hours are compared; label-and-hours stays the fallback. A matched pair with no page is valid
- `LINEUP` makes the ledger a view: it pulls the entries implied by transaction items on pages to its left in the lineup and on its own site (pages linking `[[Time Transaction]]`), marked *pulled*. A page already linked by a written line (or a fork of it) is not shown twice
- **Freeze** writes pulled entries into the ledger's text (tool page button, or the editor, which opens on the frozen text while entries are pulled); `LINEUP` stays
- Sign-off per transaction page: **accepted** (the receiver's ledger holds the line), **in dialogue** (the receiver forked the page), **awaiting sign-off**

The `transaction` item type is served by a tiny second package, **wiki-plugin-transaction** (`transaction/` in this repo): wiki-server serves one item type per package, so its client file imports `/plugins/timebank/timebank.js` and registers `window.plugins.transaction` from this bundle. Install both.

## Thank You Invoice: watched sites, awaiting, Reconcile (0.5.0)

A thank-you is recorded by the **receiver**: a Time Transaction page on the receiver's own site (Marvin, the Pi5's Telegram bot, writes it from a `/thanks` message or voice note, after reading it back in the chat) plus the line in the receiver's ledger. Nothing is pushed to the giver's site. The giver's ledger **watches**:

- the sites on its `WATCH:` lines, and the sites of the counterparty ledgers it already names by external link — never its own site
- every transaction page there that names this ledger and that the ledger does not carry yet (no written line linking the same page, not already pulled by `LINEUP`) is **awaiting reconcile**: the badge reads `Verified · 6h awaiting reconcile`, the rows show under the ledger (not counted in its total), and the tooltip lists them
- the tool page's **Awaiting reconcile** section lists the pages and offers **Reconcile**: it opens each page beside the tool, forks it to the ledger's site with the wiki's own fork (`pageHandler.put(…, {type: 'fork'})`, as the fork flag does), writes the lines into the ledger (keeping the external link to the page where it was written, so the pair matches **by page**) and checks again. It never forks over a page the site already holds by that slug, stops at the first fork the server does not confirm, and refuses — saying why — when the browser is not logged in as the owner

An **Energy Invoice** is the same page from the giver's side: it is written on the giver's site and awaits reconcile on the receiver's ledger.

The `transaction` item registers the giver's and receiver's sites as neighbours, so a Twin `WATCH` item on the page shows who has forked it — the receipt of the [Wiki Message](http://plan.ide.earth/view/wiki-message).

## Names, occasions and periods (0.6.0)

**A transaction page is named for the work and the person** — `Childcare for David`, `Soup from Alice` — never the date. The recorded date is the transaction item's `DATE:` line and a `date` item beside it (wiki-plugin-date); the journal keeps when the page was written. The Ledger Verification Tool offers new pages by this rule.

**Recurring work recurs on one page.** When the same work is done again for the same person, the page gains another occasion: a `date` item and a `transaction` item of its own. An occasion's identity is **page plus item**. A ledger line names an occasion by linking the page with the day first:

```
2026-09-10 [[Childcare for David]] for [http://david.localhost:4242/view/davids-ledger David's Ledger]: 4 hours
```

- The matcher pairs two lines by page, then by occasion: the same day when both lines are dated, else the same minutes; then the same page on any day neither line contradicts. Lines dated on different days never pair.
- A written line holds one occasion: a dated line the occasion of its day, an undated line one of the same minutes. Pulled lines (`LINEUP`) are always written dated.

**Period ledgers and the summary.** A ledger page per month — `Alice's Ledger 2026-09`, with its own `START`, `END`, entries and badge — and a summary ledger, `Alice's Ledger`:

```
OWNER: [[About Alice]]
PERIODS: 10
NOTIFY: ntfy.sh/timebank-demo-david
```

- `PERIODS` (or `PERIODS: n`) finds the period pages by title prefix — `<summary title> YYYY-MM` — in the site's sitemap, and shows each period's badge and hours, the `n` most recent transactions (default 10) and the **net balance** across all periods: hours given less hours received on the lines written in the period ledgers.
- Its badge aggregates the periods' badges, worst wins: any fail → fail, any partial → partial; periods with no linked entries do not count.
- The summary's title is the ledger's identity. Transaction pages and other ledgers name `Alice's Ledger`, never a period page; a period page matches as the ledger it belongs to, and a counterparty that is a summary is read through its period pages overlapping this period.
- A period ledger with `LINEUP` pulls only transaction pages dated inside its `START`..`END`; so does `WATCH`.
- `OWNER: [[About Alice]]` names whose ledger it is.

**Balance beside the owner.** A timebank item `BALANCE: [[Alice's Ledger]]` on the owner's About page (or bare `BALANCE`, which finds the summary whose `OWNER` links this page) shows hours given, received and the net, with links to the ledger and the Transactions Index.

**Transactions Index** (a plugin page, `pages/transactions-index`, listed in `factory.json` `pages`; its timebank item holds `INDEX`). For the site of the page to its left it lists every sitemap page linking `time-transaction` — less the template, the topic page and ledgers — one row per occasion with its date, parties, hours and state:

- **logged** — the period ledger whose `START`..`END` holds its date has its line
- **awaiting** — that ledger has no line but pulls it (`LINEUP`): Freeze logs it
- **orphan** — no period ledger holds its date, or the one that does is closed and has no line, or it names no ledger on this site

A party whose ledger cannot be read is flagged **unknown party**. **Open as lineup** opens the listed pages (all, the orphans, or the awaiting) to the right of the index, keeping them all. **Log the orphans** writes each orphan's line into the period ledger that holds its date, or creates the period page, through the site's action route; it refuses, saying why, when the browser is not the owner or the site shown is another origin's.

The report tool reads summary ledgers through their periods, takes the member's name from `OWNER`, writes a **Timebank Monthly Report YYYY-MM** per month beside the weekly ones, draws the total report's bars per month, and prints each summary ledger's logged net beside the report's net per person (the difference is what is not logged yet). `tools/timebank-sample.py` builds the laptop test bed: it renames the dated pages (see below), splits the ledgers into periods, adds the About pages, and generates June to September 2026 (seed 2026, rerunnable to the same bytes).

**Renaming a page** follows wiki-client's own rename (editing a ghost page's title, then forking it): the page is re-created under the new slug with its journal carried over — the create's title rewritten — and a `fork` action naming the old title (`renamed: {from, slug}`); the old slug keeps a one-line `➜ Moved to [[New Title]]` page marked `"moved"`, and every ledger line and fork naming it is repointed.

## Ledger Verification Tool (0.4.0: a plugin page)

A single click on the badge opens the **Ledger Verification Tool** beside the ledger. It is a plugin page (`pages/ledger-verification-tool`, listed in `factory.json` `pages`), served on every site of the farm, green. Its timebank item holds `TOOL`: on emit it finds the ledger on the page to its left, checks it and draws the report:

- which ledger, which site, when it was checked and from which site, and the badge status
- **Entries** — Result first, coloured like the badge (matched green, *by page* when both link one transaction page; unmatched or ledger unreachable red), then direction, hours, label, counterparty ledger and transaction page
- **Transactions** — each transaction page and its sign-off
- **Freeze** — on a `LINEUP` ledger, writes the pulled entries in
- **Send verification message** — one message per counterparty to the `NOTIFY:` topic
- **Find missing ledgers** — candidates for each unreachable or unmatched counterparty with a **Fix** button, and entries with no transaction page offered as new pages (the wiki then offers *create from Time Transaction Template*)
- Freeze and Fix save through the wiki's page handler and confirm with the server; they refuse, and say why, when the browser is not logged in as the owner or the ledger is a remote copy

The last check is kept on the item as `item.verified = { at, by, site, status, matched, unmatched, unreachable }`. Double-click still opens the editor.

## The broker's reports (tools/)

`tools/timebank-report.py` is the [Broker Role](https://time.peoplepowered.money/view/broker-role)'s tool. It reads the **Known Ledgers** page (a table item with Member, Site, Slug and Ledger columns), every known ledger, and the Time Transaction pages on the ledgers' sites, their `WATCH:` sites and the sites of the ledgers they name. Each transaction page counts once, by its home site and slug (the earliest fork in its journal). A transaction is **verified** when both ledgers carry it — a written line linking the page (or, with no page link, the same label and minutes) naming the other ledger, or the page's home being that ledger's own site — **in dialogue** when the missing side has forked it, **awaiting** otherwise.

```bash
python3 tools/timebank-report.py --known http://david.localhost:4242/view/known-ledgers [--dry-run] [--json]
python3 -m unittest discover -s tools
```

It writes, on the broker's site, a **Timebank Weekly Report YYYY-Www** per ISO week (people table, the week's total, an SVG pie of hours given, a Transactions table, a tickable review row per transaction) and a **Timebank Report** over all weeks (people table, an SVG bar per week, a Shares table, the Transactions table), reconciled in place with fedwiki-lib's `Report`: a human's arrangement, ticks and notes survive a rerun. Beside the total report it writes `assets/timebank-report/equity-model.xlsx` (Shares: member, hours given, multiplier, weighted hours, share, with formulas and cached values) and, once, a Model Plugin item freezing `Shares!A1:E(n+2)`. The transaction parser is a port of `src/client/txn.js`; `test/fixtures/transactions.json` is shared by `node --test` and the Python tests so the two cannot drift.

## Supported Time Formats

`2 hours` · `1 hour` · `30 mins` · `45 minutes` · `1.5h` · `90m` · `2 hrs`

## Build

```bash
npm install
npm run build
```

The build step runs tests then bundles `src/client/timebank.js` (with `parse.js`, `verify.js`, `tool.js`, `txn.js`, `links.js`, `periods.js`, `views.js` and `transaction.js`) → `client/timebank.js` via esbuild. `transaction/` is the wiki-plugin-transaction package; pack it with `npm pack ./transaction`.

## Install into Federated Wiki

```bash
cd ~/.nvm/versions/node/$(node -v | tr -d v)/lib/node_modules/wiki
npm install wiki-plugin-timebank
npm install ./path/to/wiki-plugin-transaction-0.4.0.tgz
```

Then restart your wiki server.

## Development

Source lives in `src/client/`: `parse.js` (grammar and ledger addresses), `verify.js` (matching, sign-off and messages, pure), `txn.js` (transaction facts, pulled entries, freeze, pure), `tool.js` (the tool report and candidate finder, pure), `periods.js` (period ledgers, the summary, index classification and Log the orphans, pure), `views.js` (the summary, index and balance HTML, pure), `links.js` (anchors identical to wiki.resolveLinks, for markup drawn after emit), `transaction.js` (the transaction item) and `timebank.js` (browser layer). After editing, run `npm run build` to recompile. The `npm run about` script starts a local wiki server on port 3010 pointing at the plugin directory, which is useful for previewing the about page.

## License

MIT © David Bovill
