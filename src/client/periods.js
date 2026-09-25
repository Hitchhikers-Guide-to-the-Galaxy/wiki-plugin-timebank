// Period ledgers, the summary ledger, the Transactions Index and the balance
// beside the owner — pure functions, no DOM, no wiki globals (0.6.0).
//
// Years of transactions do not belong in one item. A person keeps one ledger
// page per period — "Alice's Ledger 2026-09", with its own START, END, entries
// and badge — and a summary ledger, "Alice's Ledger", whose timebank item holds
//
//   OWNER: [[About Alice]]     whose ledger it is: the owner's About page
//   PERIODS: 10                find the period pages by title prefix in the
//                              site's sitemap; show the 10 most recent
//                              transactions and the net balance
//
// The summary's title is the ledger's identity: transaction pages and other
// ledgers name "Alice's Ledger" (site plus slug alices-ledger), never a
// period page, so a period page matches as the ledger it belongs to.

import { asSlug, normSite, sameSite, parseEntries, extractCommands, extractDates, isoDay } from './parse.js'
import { inPeriod, claimWritten, entryLineFor, personOf, freezeText, TEMPLATE_TITLE, TRANSACTION_TOPIC } from './txn.js'

// "Alice's Ledger 2026-09" -> { base: "Alice's Ledger", month: '2026-09' } | null
export const periodOfTitle = title => {
  const m = String(title || '').trim().match(/^(.*\S)\s+(\d{4})-(\d{2})$/)
  if (!m) return null
  const mon = parseInt(m[3], 10)
  if (mon < 1 || mon > 12) return null
  return { base: m[1], month: `${m[2]}-${m[3]}` }
}

// '2026-09' -> { start, end } at noon UTC, as parseDate writes dates.
export const monthBounds = month => {
  const [y, m] = String(month).split('-').map(n => parseInt(n, 10))
  return { start: Date.UTC(y, m - 1, 1, 12), end: Date.UTC(y, m, 0, 12) }
}

export const monthOf = ms => isoDay(ms).slice(0, 7)

// A ledger's identity slug: a period page is the ledger it belongs to.
export const identitySlug = (title, slug) => {
  const p = periodOfTitle(title)
  return p ? asSlug(p.base) : (slug || asSlug(title || ''))
}

// The period pages of a summary ledger titled `base`, found in a sitemap by
// title prefix, oldest first. -> [{ slug, title, month }]
export const periodPagesOf = (sitemap, base) => {
  const want = asSlug(base || '')
  const out = []
  for (const p of Array.isArray(sitemap) ? sitemap : []) {
    const t = p && periodOfTitle(p.title)
    if (!t || asSlug(t.base) !== want || !p.slug) continue
    if (out.some(o => o.slug === p.slug)) continue
    out.push({ slug: p.slug, title: p.title, month: t.month })
  }
  return out.sort((a, b) => a.month < b.month ? -1 : a.month > b.month ? 1 : 0)
}

// Every summary ledger a sitemap implies: the bases of its period titles.
// -> [{ title, slug, periods: [{ slug, title, month }] }]
export const ledgersInSitemap = sitemap => {
  const bases = new Map()
  for (const p of Array.isArray(sitemap) ? sitemap : []) {
    const t = p && periodOfTitle(p.title)
    if (!t) continue
    const key = asSlug(t.base)
    if (!bases.has(key)) bases.set(key, t.base)
  }
  return [...bases.entries()].map(([slug, title]) => ({ title, slug, periods: periodPagesOf(sitemap, title) }))
}

// The first ledger item of a page (a timebank item that is not the tool,
// index or balance). -> item | null
export const ledgerItemOf = page => ((page && page.story) || []).find(it => {
  if (it.type !== 'timebank') return false
  const c = extractCommands(it.text || '')
  return !c.tool && !c.index && !c.balance
}) || null

// A period page read from its site -> { title, slug, month, period, text, lineup, written }
export const periodLedger = (page, { slug, month } = {}) => {
  const item = ledgerItemOf(page)
  const text = item ? item.text || '' : ''
  const dates = extractDates(text)
  const bounds = month ? monthBounds(month) : null
  const period = dates.start || dates.end
    ? { start: Math.min(dates.start ?? dates.end, dates.end ?? dates.start), end: Math.max(dates.start ?? dates.end, dates.end ?? dates.start) }
    : bounds
  return {
    title: page ? page.title : null,
    slug: slug || asSlug((page && page.title) || ''),
    month: month || (period ? monthOf(period.end) : null),
    period,
    text,
    itemId: item ? item.id : null,
    lineup: extractCommands(text).lineup,
    written: parseEntries(text)
  }
}

// ok, partial, fail — the worst wins: any fail -> fail, any partial -> partial,
// all ok -> ok. Periods with no linked entries do not count; none at all -> none.
export const aggregateStatus = statuses => {
  const s = (statuses || []).filter(x => x === 'ok' || x === 'partial' || x === 'fail')
  if (!s.length) return 'none'
  if (s.includes('fail')) return 'fail'
  if (s.includes('partial')) return 'partial'
  return 'ok'
}

const minutesOf = e => Math.round((e.time || 0) * 60)

// The summary: per period the written linked entries, hours given and
// received, and net; across periods the totals and the most recent entries.
//   periods: [periodLedger + { status? }] · recent: how many to show
// Hours are logged hours: lines written in the period ledgers. Pulled and
// awaiting entries are not counted until they are frozen or reconciled.
// -> { periods: [{ ...period, given, received, net, count }], given, received, net, count, recent: [entry + { period }], status }
export const summariseLedger = (periods, { recent = 10 } = {}) => {
  const rows = []
  const all = []
  for (const p of periods || []) {
    let given = 0
    let received = 0
    let count = 0
    p.written.forEach((e, i) => {
      if (!e.linked) return
      count++
      if (e.direction === 'gave') given += minutesOf(e)
      else received += minutesOf(e)
      all.push({ ...e, period: { title: p.title, slug: p.slug, month: p.month }, at: e.date ?? (p.period ? p.period.end : 0), order: i })
    })
    rows.push({ ...p, given: given / 60, received: received / 60, net: (given - received) / 60, count })
  }
  const given = rows.reduce((s, r) => s + r.given, 0)
  const received = rows.reduce((s, r) => s + r.received, 0)
  all.sort((a, b) => (b.at - a.at) || (b.period.month > a.period.month ? 1 : b.period.month < a.period.month ? -1 : b.order - a.order))
  return {
    periods: rows,
    given,
    received,
    net: given - received,
    count: rows.reduce((s, r) => s + r.count, 0),
    recent: all.slice(0, recent),
    status: aggregateStatus(rows.map(r => r.status))
  }
}

// "+4h 30m" / "-2h" / "0h" — a signed balance.
export const signedHours = (h, fmt) => {
  const r = Math.round(h * 60) / 60
  if (Math.abs(r) < 1e-9) return '0h'
  return `${r > 0 ? '+' : '-'}${fmt(Math.abs(r))}`
}

// --- The Transactions Index ---

export const INDEX_TITLE = 'Transactions Index'

// Pages a sitemap offers as Time Transaction pages: those linking the topic,
// less the template, the topic page itself and ledger pages (a period title,
// or a page whose slug is a known ledger's).
export const indexCandidates = (sitemap, ledgerSlugs = []) => (Array.isArray(sitemap) ? sitemap : [])
  .filter(p => p && p.slug && p.links && Object.prototype.hasOwnProperty.call(p.links, TRANSACTION_TOPIC))
  .filter(p => p.slug !== asSlug(TEMPLATE_TITLE) && p.slug !== TRANSACTION_TOPIC && p.slug !== asSlug(INDEX_TITLE))
  .filter(p => !periodOfTitle(p.title) && !ledgerSlugs.includes(p.slug))

// Classify every occasion found on `site` against the site's ledgers.
//   occasions: facts from pageTransactions (each with page and occasion)
//   ledgers: [{ title, slug, site, periods: [periodLedger] }] — the site's
//            ledgers; a plain ledger is one "period" with period null
// Each occasion names at most one ledger on this site (the giver's or the
// receiver's). The period ledger whose START..END holds its date:
//   logged   — has a written line for it (the page, and the day when dated)
//   awaiting — has none, but pulls it (LINEUP): Freeze will log it
//   orphan   — no period ledger holds the date, or the one that does is
//              closed (no LINEUP) and has no line, or it names no ledger here
// -> [{ facts, state, reason, ledger, period, side, direction }]
export const classifyOccasions = (occasions, ledgers, site) => {
  const used = new Map()
  const usedOf = slug => { if (!used.has(slug)) used.set(slug, new Set()); return used.get(slug) }
  const rows = []
  const sorted = [...(occasions || [])].sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
  for (const f of sorted) {
    const side = ['giver', 'receiver'].find(k => f[k] && sameSite(f[k].site, site) && ledgers.some(l => l.slug === f[k].slug))
    if (!side) {
      rows.push({ facts: f, state: 'orphan', reason: 'names no ledger on this site', ledger: null, period: null, side: null, direction: null })
      continue
    }
    const ledger = ledgers.find(l => l.slug === f[side].slug)
    const me = { site: normSite(site), slug: ledger.slug }
    const direction = side === 'giver' ? 'gave' : 'received'
    const covering = ledger.periods.filter(p => inPeriod(f, p.period))
    const row = { facts: f, ledger, side, direction, period: null }
    if (!f.valid) { rows.push({ ...row, state: 'orphan', reason: 'the transaction item is missing GIVER, RECEIVER or HOURS' }); continue }
    if (!covering.length) {
      const month = f.date === null || f.date === undefined ? null : monthOf(f.date)
      rows.push({ ...row, state: 'orphan', reason: month ? `no period ledger holds ${month}` : 'undated: no period ledger can hold it' })
      continue
    }
    const line = entryLineFor(f, me)
    const [entry] = line ? parseEntries(line) : []
    const probe = entry ? { ...entry, facts: f, txn: { ...entry.txn, site: f.page.site } } : null
    let hit = null
    for (const p of covering) {
      const w = probe && claimWritten(p.written, probe, usedOf(p.slug), site)
      if (w) { hit = { p, w }; break }
    }
    if (hit) { rows.push({ ...row, state: 'logged', reason: `written in ${hit.p.title}`, period: hit.p, line: hit.w }); continue }
    const pulling = covering.find(p => p.lineup)
    if (pulling) { rows.push({ ...row, state: 'awaiting', reason: `pulled by ${pulling.title} (LINEUP) — Freeze logs it`, period: pulling, line: probe }); continue }
    rows.push({ ...row, state: 'orphan', reason: `${covering[0].title} holds its date but has no line for it`, period: covering[0], line: probe })
  }
  return rows
}

export const stateCounts = rows => {
  const out = { logged: 0, awaiting: 0, orphan: 0 }
  for (const r of rows || []) out[r.state] = (out[r.state] || 0) + 1
  return out
}

// Log the orphans, the pure part: each orphan that names a ledger here goes
// into the period ledger that holds its date (frozen into its text), or into
// a new period page when none does. Orphans naming no ledger here are left.
// -> { edits: [{ slug, title, itemId, text, lines }], creates: [{ title, slug, text, lines }], skipped: [row] }
export const orphanPlan = (rows, site) => {
  const edits = new Map()
  const creates = new Map()
  const skipped = []
  for (const r of rows || []) {
    if (r.state !== 'orphan') continue
    if (!r.ledger || !r.facts.valid) { skipped.push(r); continue }
    const me = { site: normSite(site), slug: r.ledger.slug }
    const line = entryLineFor(r.facts, me)
    if (!line) { skipped.push(r); continue }
    const [entry] = parseEntries(line)
    if (r.period && r.period.itemId) {
      const key = r.period.slug
      if (!edits.has(key)) edits.set(key, { slug: r.period.slug, title: r.period.title, itemId: r.period.itemId, base: r.period.text, lines: [] })
      edits.get(key).lines.push({ ...entry, raw: line })
    } else if (r.facts.date !== null && r.facts.date !== undefined) {
      const month = monthOf(r.facts.date)
      const title = `${r.ledger.title} ${month}`
      if (!creates.has(title)) creates.set(title, { title, slug: asSlug(title), month, lines: [] })
      creates.get(title).lines.push({ ...entry, raw: line })
    } else {
      skipped.push(r)
    }
  }
  const monthText = month => {
    const b = monthBounds(month)
    const day = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    return `START: ${day(b.start)}\nEND: ${day(b.end)}`
  }
  return {
    edits: [...edits.values()].map(e => ({ ...e, text: freezeText(e.base, e.lines, []) })),
    creates: [...creates.values()].map(c => ({ ...c, text: [monthText(c.month), ...c.lines.sort((a, b) => a.raw < b.raw ? -1 : 1).map(l => l.raw)].join('\n') })),
    skipped
  }
}

// --- Balance beside the owner ---

// The owner's name from their About page title: "About Alice" -> "Alice".
export const ownerName = ref => {
  const t = String((ref && (ref.name || ref.title)) || '').trim()
  return t.replace(/^About\s+/i, '') || null
}

// A party as a person: "Alice's Ledger" -> "Alice".
export const partyName = ref => ref ? personOf(ref.name || ref.slug) : '?'

