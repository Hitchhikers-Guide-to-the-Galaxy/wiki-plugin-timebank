// TimeBank verification — pure double-entry matching between linked ledgers.
// No DOM, no wiki globals: fetching is injected through ctx so the whole check
// runs under node --test with fakes.
//
// A ledger's identity is its site plus its slug. A [[wikilink]] counterparty
// names a ledger on the site of the page it is written on; an external link
// [http://site/view/slug Name] names a ledger on any site. So two pages titled
// "David's Ledger" on two sites are two ledgers and never match each other.
//
// ctx = {
//   title,                         my page title
//   slug,                          my page slug (defaults to asSlug(title))
//   site,                          the site my page is on
//   fetchPage(site, slug)          -> Promise<page json | null>   (null = 404 / unreachable)
//   fetchSitemap(site)             -> Promise<sitemap | null>     (optional: finds the period
//                                     pages of a counterparty's summary ledger, 0.6.0)
//   pageSlug                       the slug of the page the item is on, when `slug` is the
//                                  ledger's identity (a period page's summary slug)
// }

import {
  parseEntries, extractDates, extractCommands, asSlug, normLabel, formatHours, formatDay,
  normSite, sameSite, schemeFor, ledgerUrl, ledgerId, sameDay
} from './parse.js'
import { signOffState, forkComments, receiverSite, forkedFrom } from './txn.js'
import { periodPagesOf, monthBounds } from './periods.js'

export { schemeFor }

const minutes = e => Math.round((e.time || 0) * 60)

// Keys are written from the text: an external counterparty carries its site.
export const entryKey = e => {
  const cp = e.counterparty
  const who = cp ? (cp.site ? `${cp.site}/${cp.slug}` : cp.slug) : ''
  return `${e.direction}|${who}|${minutes(e)}|${normLabel(e.label)}`
}

// Period from START/END: a lone date is a one-day period; none -> null.
export const periodOf = dates => {
  const start = dates.start ?? dates.end
  const end = dates.end ?? dates.start
  if (start === undefined || end === undefined) return null
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

const overlaps = (a, b) => !a || !b || (a.start <= b.end && b.start <= a.end)

const dated = e => e.date !== null && e.date !== undefined

// Two lines for one occasion of a page: the same day when both are dated,
// else the same minutes.
const sameOccasion = (e, f) => dated(e) && dated(f) ? sameDay(e.date, f.date) : minutes(e) === minutes(f)

// Two lines that cannot be one occasion: both dated, on different days.
const otherDay = (e, f) => dated(e) && dated(f) && !sameDay(e.date, f.date)

const opposite = d => (d === 'gave' ? 'received' : 'gave')

// The ledger a counterparty names, given the site the entry is written on.
export const counterpartyLedger = (cp, site) => cp.external
  ? { site: cp.site, slug: cp.slug, name: cp.name, scheme: cp.scheme, external: true }
  : { site: normSite(site), slug: cp.slug, name: cp.name, scheme: null, external: false }

// Multiset match. `mine` are my linked entries; `theirs` are the counterparty's
// linked entries, each carrying `period` from its item and `counterparty.site`
// and `txn.site` resolved. Each counter-entry is consumed at most once. The
// back-pointer must name my slug and, when both sides know it, my site.
//   1. the strongest match: both entries link the same transaction page, by
//      site and slug, and the same occasion of it — the same day when both
//      lines are dated, else the same minutes (a page of recurring work holds
//      one transaction item per occasion: page plus item is the identity);
//      then the same page on any day neither line contradicts, whatever the
//      hours — label and period are not compared;
//   2. the fallback: same label, same minutes, overlapping periods — unless
//      both entries link transaction pages and the pages differ by slug, or
//      both lines are dated on different days.
// Every matched pair says how: matchedBy 'page' | 'label'.
//   opts = { title | slug: my page, site: my site, period: my period | null }
export const matchLedgers = (mine, theirs, opts = {}) => {
  const mySlug = opts.slug || asSlug(opts.title || '')
  const mySite = opts.site || null
  const myPeriod = opts.period || null
  const pool = theirs.map(f => ({ f, used: false }))
  const pointsAtMe = f => f.counterparty && f.counterparty.slug === mySlug &&
    (!mySite || !f.counterparty.site || sameSite(f.counterparty.site, mySite))
  const txnOfMine = e => e.txn ? (e.txn.site || !mySite ? e.txn : { ...e.txn, site: mySite }) : null
  const candidate = (e, f) => f.linked && pointsAtMe(f) && f.direction === opposite(e.direction)
  const hits = new Map()
  for (const strict of [true, false]) {
    for (const e of mine) {
      if (hits.has(e)) continue
      const t = txnOfMine(e)
      if (!t) continue
      const hit = pool.find(({ f, used }) => !used && candidate(e, f) && samePage(t, f.txn) &&
        (strict ? sameOccasion(e, f) : !otherDay(e, f)))
      if (hit) { hit.used = true; hits.set(e, { f: hit.f, by: 'page' }) }
    }
  }
  for (const e of mine) {
    if (hits.has(e)) continue
    const t = txnOfMine(e)
    const hit = pool.find(({ f, used }) =>
      !used &&
      candidate(e, f) &&
      !(t && f.txn && t.slug !== f.txn.slug) &&
      !otherDay(e, f) &&
      minutes(f) === minutes(e) &&
      normLabel(f.label) === normLabel(e.label) &&
      overlaps(myPeriod, f.period || null))
    if (hit) { hit.used = true; hits.set(e, { f: hit.f, by: 'label' }) }
  }
  const matched = []
  const unmatched = []
  for (const e of mine) {
    const h = hits.get(e)
    if (h) matched.push({ mine: e, theirs: h.f, by: h.by })
    else unmatched.push(e)
  }
  return { matched, unmatched }
}

const samePage = (a, b) => !!(a && b && a.slug === b.slug && a.site && b.site && sameSite(a.site, b.site))

// ok: every linked entry matched · fail: a counterparty unreachable, or nothing
// matched · partial: otherwise · none: no linked entries at all.
export const deriveStatus = ({ linked, matched, unreachable = [] }) => {
  if (!linked) return 'none'
  if (unreachable.length > 0 || matched === 0) return 'fail'
  if (matched === linked) return 'ok'
  return 'partial'
}

// Linked entries from every timebank item on a page served by `site`, each
// with its period and its counterparty's site resolved (wikilink = `site`).
export const ledgerEntries = (page, site) => {
  const out = []
  for (const it of (page && page.story) || []) {
    if (it.type !== 'timebank') continue
    const period = periodOf(extractDates(it.text || ''))
    for (const f of parseEntries(it.text || '')) {
      if (!f.linked) continue
      const cp = f.counterparty.external ? f.counterparty : { ...f.counterparty, site: site ? normSite(site) : undefined }
      const txn = f.txn && !f.txn.external ? { ...f.txn, site: site ? normSite(site) : undefined } : f.txn
      out.push({ ...f, counterparty: cp, txn, period })
    }
  }
  return out
}

// The entries a counterparty ledger page holds. A summary ledger (PERIODS)
// holds none itself: its period pages overlapping `period` (all of them when
// `period` is null) are read through ctx.fetchSitemap and ctx.fetchPage.
// -> { entries, periods: [slug] }
export const counterpartyEntries = async (page, site, period, ctx) => {
  const summary = ((page && page.story) || []).some(it => it.type === 'timebank' && extractCommands(it.text || '').periods)
  if (!summary || typeof ctx.fetchSitemap !== 'function') return { entries: ledgerEntries(page, site), periods: [] }
  const map = await Promise.resolve().then(() => ctx.fetchSitemap(site)).catch(() => null)
  const pages = periodPagesOf(map, page.title).filter(p => overlaps(period, monthBounds(p.month)))
  const got = await Promise.all(pages.map(p => Promise.resolve().then(() => ctx.fetchPage(site, p.slug)).catch(() => null)))
  const entries = []
  got.forEach(pg => { if (pg) entries.push(...ledgerEntries(pg, site)) })
  return { entries: [...ledgerEntries(page, site), ...entries], periods: pages.filter((p, i) => got[i]).map(p => p.slug) }
}

// ctx.pulled: entries pulled from Time Transaction pages (thawed, not written).
export const verifyItem = async (item, ctx) => {
  const text = (item && item.text) || ''
  const { notify, lineup } = extractCommands(text)
  const period = periodOf(extractDates(text))
  const site = normSite(ctx.site)
  const written = parseEntries(text).filter(e => e.linked)
    .map(e => e.txn && !e.txn.external ? { ...e, txn: { ...e.txn, site } } : e)
  const linked = [...written, ...(ctx.pulled || [])]
  const slug = ctx.slug || asSlug(ctx.title || '')
  const result = {
    title: ctx.title,
    site,
    slug,
    pageSlug: ctx.pageSlug || slug,
    period,
    notify,
    lineup,
    pulled: (ctx.pulled || []).length,
    status: 'none',
    linked: linked.length,
    matched: [],
    unmatched: [],
    unreachable: [],
    counterparties: []
  }
  if (!linked.length) return result

  const byLedger = new Map()
  for (const e of linked) {
    const ledger = counterpartyLedger(e.counterparty, site)
    const id = ledgerId(ledger)
    if (!byLedger.has(id)) byLedger.set(id, { ...ledger, id, entries: [] })
    byLedger.get(id).entries.push(e)
  }

  for (const cp of byLedger.values()) {
    let page
    try {
      page = await ctx.fetchPage(cp.site, cp.slug)
    } catch {
      page = null
    }
    const record = {
      id: cp.id,
      slug: cp.slug,
      name: cp.name,
      site: cp.site,
      href: ledgerUrl(cp),
      external: cp.external,
      reachable: !!page,
      title: page && page.title ? page.title : null,
      matched: [],
      unmatched: [],
      periods: []
    }
    if (!page) {
      result.unreachable.push(cp.id)
      record.unmatched = cp.entries
    } else {
      const theirs = await counterpartyEntries(page, cp.site, period, ctx)
      record.periods = theirs.periods
      const m = matchLedgers(cp.entries, theirs.entries, { slug, site, period })
      record.matched = m.matched.map(x => ({ ...x.mine, matchedBy: x.by }))
      record.unmatched = m.unmatched
    }
    result.matched.push(...record.matched.map(entryKey))
    result.unmatched.push(...record.unmatched.map(e => ({
      key: entryKey(e), raw: e.raw, site: record.site, slug: cp.slug, href: record.href, reachable: record.reachable
    })))
    result.counterparties.push(record)
  }

  result.status = deriveStatus({
    linked: linked.length, matched: result.matched.length, unreachable: result.unreachable
  })
  return result
}

// --- Messages ---

// ntfy headers are Latin-1; keep the Title printable ASCII.
export const asciiOnly = s => String(s || '')
  .replace(/[–—]/g, '-')
  .replace(/[^\x20-\x7E]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const periodText = p => {
  if (!p) return ''
  if (p.start === p.end) return ` (${formatDay(p.start)})`
  return ` (${formatDay(p.start)} – ${formatDay(p.end)})`
}

const describe = (title, e, period) => {
  const cp = e.counterparty.name
  const hours = formatHours(e.time) || '0h'
  return e.direction === 'gave'
    ? `${title} gave ${cp} ${hours} ${e.label}${periodText(period)}`
    : `${title} received from ${cp} ${hours} ${e.label}${periodText(period)}`
}

const tagFor = cp => {
  if (!cp.reachable || cp.matched.length === 0) return 'x'
  if (cp.unmatched.length === 0) return 'white_check_mark'
  return 'warning'
}

// One message per counterparty -> [{ url, title, tags, click, body }]
export const formatVerifyMessages = (result, ctx = {}) => {
  if (!result || !result.notify) return []
  const title = result.title || ctx.title || ''
  return result.counterparties.map(cp => {
    const lines = [
      ...cp.matched.map(e => `Confirmed: ${describe(title, e, result.period)} — matched`),
      ...cp.unmatched.map(e => cp.reachable
        ? `Verify: ${describe(title, e, result.period)} — unmatched in ${cp.href}`
        : `Verify: ${describe(title, e, result.period)} — ${cp.href} unreachable`)
    ]
    return {
      url: result.notify,
      title: asciiOnly(`Timebank verification: ${title}`),
      tags: `hourglass,${tagFor(cp)}`,
      click: cp.href,
      body: lines.join('\n')
    }
  })
}

// --- Sign-off per transaction page ---

// For every entry that links a transaction page, whether the receiver has
// signed off. Fetches the page and, when the receiver lives on another site
// than the page, the receiver's fork of it.
// -> [{ entry, txn, state, matched, fork: bool, comments, reachable }]
export const signOffs = async (result, ctx) => {
  const out = []
  const cache = new Map()
  const get = async (site, slug) => {
    const key = `${normSite(site)}/${slug}`
    if (!cache.has(key)) {
      cache.set(key, Promise.resolve().then(() => ctx.fetchPage(site, slug)).catch(() => null))
    }
    return cache.get(key)
  }
  for (const cp of result.counterparties || []) {
    const all = [...cp.matched.map(e => [e, true]), ...cp.unmatched.map(e => [e, false])]
    for (const [e, matched] of all) {
      const txn = e.txn && e.txn.site ? e.txn : e.txn ? { ...e.txn, site: result.site } : null
      if (!txn) continue
      let page = await get(txn.site, txn.slug)
      const reachable = !!page
      const rSite = receiverSite(e, result.site)
      let fork = null
      const accepted = signOffState({ direction: e.direction, pulled: !!e.pulled, matched }) === 'accepted'
      if (accepted) {
        // signed off: no need to look for the receiver's fork
      } else if (!sameSite(rSite, txn.site)) {
        fork = await get(rSite, txn.slug)
      } else if (e.direction === 'received' && forkedFrom(page, rSite)) {
        // the page linked is the receiver's own fork of the giver's page
        fork = page
        page = await get(forkedFrom(page, rSite), txn.slug)
      }
      out.push({
        entry: e,
        txn,
        matched,
        reachable,
        fork: !!fork,
        forkSite: fork ? rSite : null,
        comments: page ? forkComments(page, fork) : 0,
        state: signOffState({ direction: e.direction, pulled: !!e.pulled, matched, fork: !!fork })
      })
    }
  }
  return out
}
