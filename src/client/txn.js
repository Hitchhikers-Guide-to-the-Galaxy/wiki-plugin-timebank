// Time Transaction pages — pure functions, no DOM, no wiki globals.
//
// A Time Transaction page is the record of one piece of work; a ledger is a
// view of the transaction pages that name it. The page carries its facts in a
// `transaction` item:
//
//   GIVER: [http://demo.localhost:4242/view/alices-ledger Alice's Ledger]
//   RECEIVER: [http://david.localhost:4242/view/davids-ledger David's Ledger]
//   HOURS: 1 hour                  (2 | 2 hours | 90 minutes | 1.5h)
//   DATE: 3 September 2026
//   WHAT: Repairs                  (the entry label; the page title when absent)
//   SOURCE: audio note             (chat message | audio note | hand)
//   Any other line is the note: what was done, in prose.
//
// A ledger with a LINEUP line gathers these facts (from pages beside it in the
// lineup and from its own site) and shows them as pulled entries; Freeze
// writes the pulled entries into the ledger's own text.
//
// Every ledger also watches other sites — its WATCH lines and the sites of the
// counterparty ledgers it names — for transaction pages that name it and that
// it does not yet carry: a Thank You Invoice written on the receiver's site, or
// an Energy Invoice on the giver's. Those are awaiting reconcile; Reconcile
// forks them to the ledger's site and freezes their lines in.

import { asSlug, normSite, sameSite, parseDate, ledgerRefOf, ledgerUrl, parseEntries, isCommand, extractCommands, isoDay, sameDay } from './parse.js'

export const TEMPLATE_TITLE = 'Time Transaction Template'
export const TRANSACTION_TOPIC = 'time-transaction'

const FIELD = /^(GIVER|RECEIVER|HOURS|DATE|WHAT|SOURCE)\s*:\s*(.*)$/i

// "2" | "2 hours" | "1.5h" | "90 minutes" | "30 mins" -> minutes | null
export const parseMinutes = s => {
  const m = String(s || '').trim().match(/^([\d.]+)\s*(hours?|hrs?|h|minutes?|mins?|m)?$/i)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!isFinite(n) || n <= 0) return null
  const unit = (m[2] || 'h').toLowerCase()
  return Math.round(unit.startsWith('m') ? n : n * 60)
}

// "1 hour" | "2 hours" | "90 minutes" — the time as a ledger line writes it.
export const minutesText = minutes => {
  if (minutes % 60 === 0) {
    const h = minutes / 60
    return `${h} ${h === 1 ? 'hour' : 'hours'}`
  }
  return `${minutes} minutes`
}

// page = { site, slug, title, itemId } — where the transaction item lives.
// -> facts { giver, receiver, minutes, time, date, label, source, note, page, valid }
export const parseTransaction = (text, page = {}) => {
  const site = page.site ? normSite(page.site) : undefined
  const facts = {
    giver: null,
    receiver: null,
    minutes: null,
    time: null,
    date: null,
    label: null,
    source: null,
    note: '',
    page: { site, slug: page.slug || (page.title ? asSlug(page.title) : undefined), title: page.title || null, itemId: page.itemId || null }
  }
  const note = []
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(FIELD)
    if (!m) { note.push(line); continue }
    const key = m[1].toUpperCase()
    const value = m[2].trim()
    if (key === 'GIVER') facts.giver = ledgerRefOf(value, site)
    else if (key === 'RECEIVER') facts.receiver = ledgerRefOf(value, site)
    else if (key === 'HOURS') facts.minutes = parseMinutes(value)
    else if (key === 'DATE') facts.date = parseDate(value)
    else if (key === 'WHAT') facts.label = value || null
    else if (key === 'SOURCE') facts.source = value || null
  }
  if (!facts.label) facts.label = facts.page.title
  facts.time = facts.minutes === null ? null : facts.minutes / 60
  facts.note = note.join(' ')
  facts.valid = !!(facts.giver && facts.receiver && facts.minutes && facts.page.slug)
  return facts
}

// Every transaction item on a page served by `site`. A page that records
// recurring work holds one item per occasion: each fact carries
// occasion = { n, of } (1-based, in story order) — its identity is the page
// plus the item.
export const pageTransactions = (page, site, slug) => {
  const out = []
  for (const it of (page && page.story) || []) {
    if (it.type !== 'transaction') continue
    out.push(parseTransaction(it.text || '', { site, slug: slug || asSlug(page.title || ''), title: page.title, itemId: it.id }))
  }
  out.forEach((f, i) => { f.occasion = { n: i + 1, of: out.length } })
  return out
}

// One occasion: its page (site-free: a fork keeps the slug and item ids) plus its item.
export const occasionKey = f => `${f.page.slug}#${f.page.itemId || ''}`

// A transaction dated inside a ledger period (both at day precision). With no
// period every transaction is inside; with a period an undated one is not.
export const inPeriod = (facts, period) => {
  if (!period) return true
  if (facts.date === null || facts.date === undefined) return false
  const day = Math.floor(facts.date / 86400000)
  return day >= Math.floor(period.start / 86400000) && day <= Math.floor(period.end / 86400000)
}

export const sameLedger = (a, b) => !!(a && b && a.slug === b.slug && sameSite(a.site, b.site))

export const samePage = (a, b) => !!(a && b && a.slug === b.slug && sameSite(a.site, b.site))

// Link text for a page or ledger, written from a ledger on `site`: a
// [[wikilink]] when it lives on the same site, an external link otherwise.
const linkFrom = (site, { title, name, slug, site: where, href, scheme }) => {
  const text = String(title || name || slug).replace(/[[\]]/g, '')
  if (!where || sameSite(where, site)) return `[[${text}]]`
  return `[${href && /\/view\//.test(href) ? href : ledgerUrl({ site: where, slug, scheme })} ${text}]`
}

// The ledger line a transaction implies for ledger `me` = { site, slug }.
// null when the transaction does not name `me` (or names it on both sides).
export const entryLineFor = (facts, me) => {
  if (!facts || !facts.valid) return null
  const giving = sameLedger(facts.giver, me)
  const receiving = sameLedger(facts.receiver, me)
  if (giving === receiving) return null
  const other = giving ? facts.receiver : facts.giver
  const page = { title: facts.page.title || facts.label, slug: facts.page.slug, site: facts.page.site }
  const day = facts.date === null || facts.date === undefined ? '' : `${isoDay(facts.date)} `
  return `${day}${linkFrom(me.site, page)} ${giving ? 'for' : 'from'} ${linkFrom(me.site, other)}: ${minutesText(facts.minutes)}`
}

// Which written line holds a pulled entry's occasion. A line links the page
// (or a fork of it: the same slug); a dated line holds only the occasion of
// that day; an undated line holds any occasion of the page, preferring one of
// the same minutes. Each written line holds one occasion: `used` records the
// claimed lines. -> the written entry | null
export const claimWritten = (written, e, used = new Set(), site) => {
  const slug = e.txn && e.txn.slug
  const date = e.facts ? e.facts.date : e.date
  const minutes = e.facts ? e.facts.minutes : Math.round((e.time || 0) * 60)
  const same = (written || []).filter(x => x.linked && x.txn && !used.has(x) && txnOf(x, site).slug === slug)
  const pick = same.find(x => x.date !== null && x.date !== undefined && sameDay(x.date, date)) ||
    same.find(x => (x.date === null || x.date === undefined) && Math.round(x.time * 60) === minutes) ||
    same.find(x => x.date === null || x.date === undefined)
  if (pick) used.add(pick)
  return pick || null
}

// Resolve an entry's transaction ref against the site its ledger is on.
export const txnOf = (entry, site) => {
  const t = entry && entry.txn
  if (!t) return null
  return t.external ? t : { ...t, site: site ? normSite(site) : undefined }
}

// One transaction however many copies are gathered: a fork keeps the slug and
// the item ids, so the first seen (the lineup before the own site) wins.
const dedupe = facts => {
  const seen = new Set()
  return facts.filter(f => {
    const key = f.page.itemId ? `${f.page.slug}#${f.page.itemId}` : `${normSite(f.page.site)}/${f.page.slug}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Gathered facts -> the entries they add to ledger `me`.
//   written = the ledger's own parsed entries · period = the ledger's
//   START/END (only occasions dated inside it are pulled), or null
// -> { pulled: entries to show (and freeze), frozen: written lines that already
//      hold the same occasion and agree, stale: [{ entry, written }] that disagree }
export const pullEntries = (facts, me, written = [], period = null) => {
  const pulled = []
  const frozen = []
  const stale = []
  const used = new Set()
  for (const f of dedupe(facts || [])) {
    if (!inPeriod(f, period)) continue
    const line = entryLineFor(f, me)
    if (!line) continue
    const [entry] = parseEntries(line)
    if (!entry || !entry.linked) continue
    const e = { ...entry, pulled: true, facts: f, txn: { ...entry.txn, site: f.page.site } }
    // a written line linking this page (or a fork of it: same slug) holds it —
    // on a page of recurring work, the line of the same day
    const w = claimWritten(written, e, used, me.site)
    if (!w) { pulled.push(e); continue }
    const agrees = w.direction === e.direction && Math.round(w.time * 60) === f.minutes
    if (agrees) frozen.push(w)
    else stale.push({ entry: e, written: w })
  }
  return { pulled, frozen, stale }
}

// Write pulled entries into the ledger's own text: a stale line is replaced
// by its fresh pulled line; a new line goes after the last entry line (or the
// last command line, or at the end). LINEUP stays, so the ledger keeps
// thawing: frozen lines are never shown twice.
export const freezeText = (text, pulled = [], stale = []) => {
  const lines = String(text || '').split('\n')
  for (const { entry, written } of stale) {
    const i = lines.findIndex(l => l.trim() === written.raw)
    if (i >= 0) lines[i] = entry.raw
  }
  const add = pulled.map(e => e.raw).filter(raw => !lines.some(l => l.trim() === raw))
  if (!add.length) return lines.join('\n')
  let at = -1
  lines.forEach((l, i) => { if (parseEntries(l).some(e => e.time !== null)) at = i })
  if (at < 0) lines.forEach((l, i) => { if (isCommand(l.trim())) at = i })
  if (at < 0) at = lines.length - 1
  lines.splice(at + 1, 0, ...add)
  return lines.join('\n')
}

// --- Sign-off ---
//
// The giver writes the transaction page; the receiver signs off by adding the
// line to their own ledger. They may fork the page to comment or query first.
//   accepted — the receiver's ledger holds the line
//   dialogue — not yet accepted, and the receiver has forked the page
//   awaiting — neither yet
// A matched pair of lines with no page behind them is valid on its own.
export const SIGNOFF_TEXT = {
  accepted: 'accepted',
  dialogue: 'in dialogue',
  awaiting: 'awaiting sign-off'
}

//   entry: my entry (direction, pulled) · matched: the counterparty ledger holds
//   the other side · fork: the receiver's copy of the page exists
export const signOffState = ({ direction, pulled = false, matched = false, fork = false }) => {
  const accepted = direction === 'gave' ? matched : !pulled
  if (accepted) return 'accepted'
  return fork ? 'dialogue' : 'awaiting'
}

// The site a page was forked from, when its journal says it is a fork made
// on `site` (the latest fork action naming another site), else null.
// A fork that records a rename (renamed) or the page's move to a new site
// (moved) is lineage, not someone's copy of the page (0.8.0).
export const lineageFork = a => Boolean(a && a.type === 'fork' && (a.renamed || a.moved))

export const forkedFrom = (page, site) => {
  const forks = ((page && page.journal) || []).filter(a => a.type === 'fork' && a.site && !lineageFork(a) && !sameSite(a.site, site))
  return forks.length ? normSite(forks[forks.length - 1].site) : null
}

// Items on a fork that are not on the original: its comments and queries.
export const forkComments = (original, fork) => {
  if (!fork) return 0
  const ids = new Set(((original && original.story) || []).map(i => i.id))
  return ((fork.story) || []).filter(i => !ids.has(i.id)).length
}

// The receiver's site for an entry on a ledger at `site`.
export const receiverSite = (entry, site) => entry.direction === 'gave'
  ? (entry.counterparty.external ? entry.counterparty.site : normSite(site))
  : normSite(site)

// The person a ledger belongs to, from its name: "Alice's Ledger" -> "Alice",
// "David Ledger" -> "David"; any other name is returned as it is.
export const personOf = name => {
  const s = String(name || '').replace(/[[\]]/g, '').replace(/[’‘]/g, "'").trim()
  const m = s.match(/^(.+?)(?:'s?)?\s+Ledger$/i)
  return m ? m[1].trim() : s
}

// The title to offer for an entry with no transaction page: the work and the
// counterparty, never a date — "Childcare for David", "Soup from Alice". The
// date lives in the transaction item's DATE line and a date item on the page;
// when the same work recurs for the same person the page recurs, one
// transaction item per occasion.
export const suggestTitle = entry => {
  const who = personOf(entry.counterparty.name || entry.counterparty.slug)
  const what = String(entry.label || 'Time').replace(/[[\]]/g, '').trim()
  return `${what} ${entry.direction === 'gave' ? 'for' : 'from'} ${who}`.replace(/\s+/g, ' ')
}

// Sitemap entries that may be transaction pages: pages that link the Time
// Transaction topic page, as every page made from the template does.
export const transactionCandidates = (sitemap, limit = 400) => (Array.isArray(sitemap) ? sitemap : [])
  .filter(p => p && p.slug && p.slug !== asSlug(TEMPLATE_TITLE) && p.slug !== TRANSACTION_TOPIC &&
    p.links && Object.prototype.hasOwnProperty.call(p.links, TRANSACTION_TOPIC))
  .slice(0, limit)

// --- Watched sites and Reconcile ---

// The sites a ledger watches for incoming transaction pages: its WATCH lines,
// then the sites of the counterparty ledgers it already names by external
// link — never its own site. The Wiki Message rule: a ledger only receives
// from a site it chose to watch, or from someone it already trades with.
export const watchedSites = (text, ownSite) => {
  const out = []
  const add = site => {
    if (!site || sameSite(site, ownSite) || out.some(s => sameSite(s, site))) return
    out.push(normSite(site))
  }
  extractCommands(text).watch.forEach(add)
  for (const e of parseEntries(text)) {
    if (e.linked && e.counterparty.external) add(e.counterparty.site)
  }
  return out
}

// Entries that transaction pages on watched sites imply for ledger `me` and
// that the ledger does not yet carry: not written (by page slug), not already
// pulled from the lineup or its own site, and not on its own site at all.
//   facts: gathered from the watched sites · written: the ledger's parsed
//   entries · pulled: entries already pulled by LINEUP
// -> [entry with awaiting: true, facts]
export const awaitingEntries = (facts, me, written = [], pulled = [], period = null) => {
  const { pulled: implied } = pullEntries(facts, me, written, period)
  return implied
    .filter(e => !sameSite(e.facts.page.site, me.site))
    .filter(e => !pulled.some(p => p.facts && occasionKey(p.facts) === occasionKey(e.facts)))
    .map(e => ({ ...e, awaiting: true }))
}

// Total minutes awaiting, for the badge.
export const awaitingMinutes = awaiting => (awaiting || []).reduce((sum, e) => sum + (e.facts ? e.facts.minutes : Math.round(e.time * 60)), 0)

// One-click Reconcile, the pure part: which pages to fork to the ledger's own
// site, and the ledger text with their lines frozen in. Each line keeps its
// external link to the page where it was written, so the pair matches by page;
// the fork is the ledger's own copy and the receipt the writer can see.
// A page whose slug the ledger's site already holds is never forked over it:
// it is kept (the site already has its copy, or a different page by that name)
// and only its line is frozen.  ownSlugs: slugs in the ledger site's sitemap.
// -> { forks: [{ site, slug, title }], kept: [{ site, slug, title }], text }
export const reconcilePlan = (text, awaiting = [], ownSlugs = []) => {
  const forks = []
  const kept = []
  for (const e of awaiting) {
    const p = e.facts && e.facts.page
    if (!p || !p.slug || [...forks, ...kept].some(f => f.slug === p.slug)) continue
    const page = { site: normSite(p.site), slug: p.slug, title: p.title || p.slug }
    if (ownSlugs.includes(p.slug)) kept.push(page)
    else forks.push(page)
  }
  return { forks, kept, text: freezeText(text, awaiting, []) }
}
