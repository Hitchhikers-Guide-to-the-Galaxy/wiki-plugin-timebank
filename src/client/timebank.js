// TimeBank Plugin — browser layer.
// Displays time entries as a ledger with a prose caption, and — when entries
// name a counterparty ledger ("Gardening for [[Alice Ledger]]: 2 hours", or on
// another site "Gardening for [https://alice.wiki/view/alices-ledger Alice's Ledger]: 2 hours")
// — a Verified badge that checks the matching double entry on that ledger.
//
// A ledger with a LINEUP line is a view of Time Transaction pages: it pulls
// entries from transaction items on pages to its left in the lineup and on its
// own site, marked as pulled; Freeze writes them into its text.
//
// Every ledger also watches other sites (its WATCH lines and the sites of the
// ledgers it names) for transaction pages that name it and that it does not
// carry yet — a Thank You Invoice written on the receiver's site. The badge
// shows their hours as awaiting reconcile; the tool page's Reconcile button
// opens them, forks them here and freezes their lines in.
//
// Clicking the badge opens the plugin's own "Ledger Verification Tool" page
// beside the ledger. That page carries a timebank item in TOOL mode, which
// finds the ledger to its left and draws the report: entries with their
// results and transaction pages, sign-off per transaction, Send, Freeze, Find
// and Fix.
//
// Grammar: ./parse.js · matching and messages: ./verify.js · report: ./tool.js
// Transaction pages: ./txn.js · the transaction item: ./transaction.js

import * as parse from './parse.js'
import * as verify from './verify.js'
import * as tool from './tool.js'
import * as txn from './txn.js'
import * as links from './links.js'
import * as periods from './periods.js'
import * as views from './views.js'
import * as review from './review.js'
import { transactionPlugin } from './transaction.js'

const {
  extractDates, extractCommands, parseEntries, extractCaption, totalHours, formatHours, formatShortDate, escapeAttr,
  sameSite, normSite, rewriteEntries, escape
} = parse
const { verifyItem, formatVerifyMessages, signOffs } = verify
const { findCandidates, renderReport, sitesMentioned, awaitingText, TOOL_TITLE } = tool
const { pullEntries, pageTransactions, transactionCandidates, freezeText, watchedSites, awaitingEntries, reconcilePlan } = txn
const { resolveLike } = links
const {
  identitySlug, periodPagesOf, periodLedger, summariseLedger, resolveOwnerName, ownedBy, ledgersInSitemap, ledgerItemOf,
  indexCandidates, classifyOccasions, orphanPlan
} = periods
const { renderSummary, renderBalance, renderIndex } = views
const { periodOf } = verify
const { parseReview, approvalText, modelOf, reviewRows, hoursToApprove, boardData, barsSvg, plannedActualSvg, PALETTE } = review

// --- Markup ---

// Must run synchronously inside emit: wiki.resolveLinks reads the
// resolutionContext, which refresh.js only sets while the item is emitted.
// Anything drawn later goes through links.resolveLike with the page's context.
const markup = text => {
  const w = typeof window !== 'undefined' ? window.wiki : undefined
  return parse.markup(text, w && w.resolveLinks ? w.resolveLinks : null)
}

// --- Style ---

const STYLE_ID = 'timebank-plugin-style'
const CSS = `
.timebank-badge { font-size: 11px; font-weight: normal; padding: 0 6px; border-radius: 8px; margin-left: 8px; cursor: pointer; white-space: nowrap; user-select: none; }
.timebank-badge.ok { background: #e3f5e3; color: #1e6b1e; }
.timebank-badge.partial { background: #fff3cd; color: #8a5a00; }
.timebank-badge.fail { background: #fde8e8; color: #9b1c1c; }
.timebank-badge.pending { background: #eee; color: #666; }
.timebank-pulled-row td { background: #f3f7fc; }
.timebank-awaiting-row td { background: #fffaf0; }
.timebank-tool .timebank-badge { cursor: default; }
`

const ensureStyle = () => {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

// --- Badge ---

const BADGE_TEXT = { ok: 'Verified', partial: 'Partly verified', fail: 'Not verified', pending: 'Verifying…' }

const tooltip = (result, extra) => {
  const out = []
  out.push(`${result.matched.length} of ${result.linked} linked entries matched`)
  if (result.pulled) out.push(`${result.pulled} pulled from Time Transaction pages`)
  for (const u of result.unmatched) {
    out.push(u.reachable ? `Unmatched: ${u.raw} (in ${u.href})` : `Unmatched: ${u.raw}`)
  }
  for (const id of result.unreachable) out.push(`Unreachable: ${id}`)
  out.push('Click to open the Ledger Verification Tool beside this ledger')
  if (extra) out.push(extra)
  return out.join('\n')
}

const setBadge = ($item, status, title, awaiting = []) => {
  const $badge = $item.find('.timebank-badge').first()
  const waiting = awaiting.length ? awaitingText(awaiting) : ''
  if (status === 'none' && !waiting) { $badge.hide(); return }
  const cls = status === 'none' ? 'partial' : status
  const text = status === 'none' ? waiting : [BADGE_TEXT[status] || status, waiting].filter(Boolean).join(' · ')
  $badge.show().removeClass('ok partial fail pending').addClass(cls).text(text)
  if (title !== undefined) $badge.attr('title', title)
}

const awaitingTooltip = awaiting => awaiting.map(e =>
  `Awaiting reconcile: ${e.raw} (written on ${e.facts.page.site})`).join('\n')

// --- Adapters (wiki globals) ---

const pageObjectOf = $page => {
  try { return wiki.lineup.atKey($page.data('key')) || null } catch { return null }
}

// The site a page is served from: its lineup site, or this origin.
const siteOfPage = $page => {
  const site = $page.data('site')
  return !site || site === 'origin' || site === 'view' || site === 'local' ? location.host : site
}
const siteOf = $item => siteOfPage($item.parents('.page'))

const slugOf = $item => String($item.parents('.page').attr('id') || '').split('_rev')[0]

const titleOf = $item => {
  const $page = $item.parents('.page')
  const po = pageObjectOf($page)
  if (po && po.getTitle) return po.getTitle()
  return $page.find('h1').first().text().trim()
}

// The search path the wiki would use for links on this page.
const contextOf = $page => {
  const po = pageObjectOf($page)
  try { if (po && po.getContext) return po.getContext() } catch { /* fall through */ }
  return ['view']
}

const fetchRemote = async (site, slug) => {
  const res = await fetch(`/remote/${site}/${slug}.json`, { signal: AbortSignal.timeout(4000) })
  if (!res.ok) return null
  return await res.json()
}

const fetchPage = (site, slug) => new Promise(resolve => {
  const fallback = () => fetchRemote(site, slug).then(resolve, () => resolve(null))
  try {
    wiki.site(site).get(`${slug}.json`, (err, page) => {
      if (!err && page && page.story) return resolve(page)
      const status = err && err.xhr ? err.xhr.status : 0
      if (status === 404 || sameSite(site, location.host)) return resolve(null)
      fallback()
    })
  } catch {
    fallback()
  }
})

// A site's sitemap, or null when it cannot be read within four seconds.
const fetchSitemap = site => new Promise(resolve => {
  const near = typeof wiki !== 'undefined' && wiki.neighborhood ? wiki.neighborhood : {}
  const known = Object.keys(near).find(s => sameSite(s, site))
  if (known && Array.isArray(near[known].sitemap)) return resolve(near[known].sitemap)
  const timer = setTimeout(() => resolve(null), 4000)
  // the site adapter hands sitemaps back wrapped as { data, lastModified }
  const done = map => {
    clearTimeout(timer)
    resolve(Array.isArray(map) ? map : map && Array.isArray(map.data) ? map.data : null)
  }
  try {
    wiki.site(site).get('system/sitemap.json', (err, map) => done(err ? null : map))
  } catch {
    done(null)
  }
})

// Sitemaps of every neighbourhood site (this origin, lineup sites, and the
// counterparty sites registered on render) for the candidate finder.
const neighbourhoodSitemaps = () => {
  const near = (typeof wiki !== 'undefined' && wiki.neighborhood) || {}
  const out = {}
  for (const site of Object.keys(near)) {
    const map = near[site] && near[site].sitemap
    if (Array.isArray(map)) out[site] = map
  }
  return out
}

// Counterparty sites become neighbours, so their flags show and their pages
// resolve in the lineup. Guarded: absent under node and in older clients.
const registerSites = entries => {
  const hood = typeof wiki !== 'undefined' && wiki.neighborhoodObject
  if (!hood || typeof hood.registerNeighbor !== 'function') return
  for (const e of entries) {
    const site = e.linked && e.counterparty.external ? e.counterparty.site : null
    if (!site || sameSite(site, location.host)) continue
    try { hood.registerNeighbor(site) } catch { /* a neighbour that will not register is simply not shown */ }
  }
}

// A period page ("Alice's Ledger 2026-09") is the ledger it belongs to: its
// identity is the summary's slug, while its own slug is where it is saved.
const contextFor = $item => ({
  title: titleOf($item),
  slug: identitySlug(titleOf($item), slugOf($item)),
  pageSlug: slugOf($item),
  site: siteOf($item),
  fetchPage,
  fetchSitemap
})

// --- Thaw: gathering transaction pages ---

// Transaction facts on the pages to the left of this item's page: read from
// each page object's story, plus any rendered transaction-source item (the
// map/calendar pattern), so neither render order nor script loading matters.
const lineupFacts = $item => {
  const out = []
  $item.parents('.page').prevAll('.page').each((_i, el) => {
    const $p = $(el)
    const po = pageObjectOf($p)
    if (po && po.getRawPage) {
      const raw = po.getRawPage()
      const slug = po.getSlug ? po.getSlug() : String($p.attr('id') || '').split('_rev')[0]
      out.push(...pageTransactions(raw, siteOfPage($p), slug))
    }
    $p.find('.transaction-source').each((_j, it) => {
      if (typeof it.transactionData === 'function') {
        try { out.push(...it.transactionData()) } catch { /* skip a broken item */ }
      }
    })
  })
  return out
}

// Transaction pages on a site — the ledger's own, or one it watches: every
// page linking the Time Transaction topic (as pages made from the template
// do), read in full.
const ownSiteCache = new Map()
const siteFacts = site => {
  const key = normSite(site)
  const hit = ownSiteCache.get(key)
  if (hit && Date.now() - hit.at < 30000) return hit.promise
  const promise = (async () => {
    const map = await fetchSitemap(site)
    const pages = await Promise.all(transactionCandidates(map).map(async p => {
      const page = await fetchPage(site, p.slug)
      return page ? pageTransactions(page, site, p.slug) : []
    }))
    return pages.flat()
  })().catch(() => [])
  ownSiteCache.set(key, { at: Date.now(), promise })
  return promise
}

const meOf = $item => ({ site: normSite(siteOf($item)), slug: identitySlug(titleOf($item), slugOf($item)) })
const periodOfText = text => periodOf(extractDates(text || ''))

// -> { pulled, frozen, stale } for a LINEUP ledger; null otherwise.
const gather = async ($item, item) => {
  const text = item.text || ''
  if (!extractCommands(text).lineup) return null
  const me = meOf($item)
  const facts = [...lineupFacts($item), ...(await siteFacts(me.site))]
  return pullEntries(facts, me, parseEntries(text), periodOfText(text))
}

// -> { awaiting, watched } — incoming pages on watched sites not yet carried.
const gatherAwaiting = async ($item, item, pull) => {
  const text = item.text || ''
  const me = meOf($item)
  const watched = watchedSites(text, me.site)
  if (!watched.length) return { awaiting: [], watched }
  const facts = (await Promise.all(watched.map(siteFacts))).flat()
  return { awaiting: awaitingEntries(facts, me, parseEntries(text), pull ? pull.pulled : [], periodOfText(text)), watched }
}

// Awaiting rows: shown under the ledger, never counted in its total.
const drawAwaiting = ($item, awaiting) => {
  const rows = awaiting.map(e => `
    <tr class="timebank-awaiting-row" title="${escapeAttr(`Written on ${e.facts.page.site}: not in this ledger until it is reconciled on the Ledger Verification Tool`)}">
      <td style="padding:4px 8px;border-bottom:1px solid #ddd">${resolveLike(e.raw, [])} <span class="timebank-badge partial" style="cursor:default">awaiting reconcile</span></td>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;color:#999;white-space:nowrap">${formatHours(e.time)}</td>
    </tr>`).join('')
  $item.find('tbody.timebank-awaiting').html(rows)
  if (awaiting.length) $item.find('.timebank-empty').remove()
}

// Pulled rows are drawn after emit, so their links go through resolveLike
// with the ledger page's own context.
const drawPulled = ($item, item, pull) => {
  const context = contextOf($item.parents('.page'))
  const rows = (pull ? pull.pulled : []).map(e => `
    <tr class="timebank-pulled-row" title="${escapeAttr(`Pulled from the Time Transaction page ${e.facts.page.title || e.facts.page.slug} on ${e.facts.page.site}: not written in this ledger until it is frozen`)}">
      <td style="padding:4px 8px;border-bottom:1px solid #ddd">${resolveLike(e.raw, context)} <span class="timebank-badge pending" style="cursor:default">pulled</span></td>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;color:#666;white-space:nowrap">${formatHours(e.time)}</td>
    </tr>`).join('')
  $item.find('tbody.timebank-pulled').html(rows)
  const written = parseEntries(item.text || '')
  const total = totalHours(written) + totalHours(pull ? pull.pulled : [])
  $item.find('tfoot.timebank-total').html(total > 0 ? totalRow(total) : '')
  if (pull && pull.pulled.length) $item.find('.timebank-empty').remove()
}

const totalRow = total => `
    <tr style="font-weight:bold;background:#f0f0f0">
      <td style="padding:6px 8px">Total</td>
      <td style="padding:6px 8px;text-align:right">${formatHours(total)}</td>
    </tr>`

// --- Verification ---

const runVerification = async ($item, item, { retry = true } = {}) => {
  const run = ($item.data('timebankRun') || 0) + 1
  $item.data('timebankRun', run)
  setBadge($item, 'pending', 'Checking counterparty ledgers…')
  const ctx = contextFor($item)
  let result
  let pull
  let incoming
  try {
    pull = await gather($item, item)
    if ($item.data('timebankRun') !== run) return null
    $item.data('timebankPull', pull)
    if (pull) drawPulled($item, item, pull)
    result = await verifyItem(item, { ...ctx, pulled: pull ? pull.pulled : [] })
    incoming = await gatherAwaiting($item, item, pull)
    if ($item.data('timebankRun') !== run) return null
    $item.data('timebankAwaiting', incoming)
    drawAwaiting($item, incoming.awaiting)
  } catch (err) {
    if ($item.data('timebankRun') === run) setBadge($item, 'fail', `Verification error: ${err.message || err}`)
    return null
  }
  if ($item.data('timebankRun') !== run) return null // a newer run owns the badge
  item.verified = {
    at: Date.now(),
    by: location.host,
    site: result.site,
    status: result.status,
    matched: result.matched,
    unmatched: result.unmatched.map(u => ({ key: u.key, site: u.site, slug: u.slug })),
    unreachable: result.unreachable
  }
  setBadge($item, result.status, tooltip(result, awaitingTooltip(incoming.awaiting)), incoming.awaiting)
  // The neighbourhood may still be loading: retry once when a neighbour lands.
  const onlyUnreachable = result.status === 'fail' && result.unreachable.length > 0 &&
    result.unmatched.every(u => !u.reachable)
  if (retry && onlyUnreachable && typeof $ !== 'undefined') {
    $('body').one('new-neighbor-done', () => runVerification($item, item, { retry: false }))
  }
  return { result, ctx, pull, incoming }
}

const postNotifications = async messages => {
  const sent = []
  for (const m of messages) {
    const res = await fetch(m.url, {
      method: 'POST',
      body: m.body,
      headers: { Title: m.title, Tags: m.tags, Click: m.click }
    })
    if (!res.ok) throw new Error(`${res.status} from ${m.url}`)
    sent.push(m)
  }
  return sent
}

// A transaction item rendered to the left of LINEUP ledgers: re-gather them.
let listening = false
const listenForTransactions = () => {
  if (listening || typeof document === 'undefined') return
  listening = true
  const pending = new WeakSet()
  document.addEventListener('timebank:transaction', ev => {
    const el = ev.detail && ev.detail.el
    const $from = el ? $(el).parents('.page') : $()
    $('.item.timebank').each((_i, it) => {
      const $it = $(it)
      const item = $it.data('item')
      if (!item || !extractCommands(item.text || '').lineup || extractCommands(item.text || '').tool) return
      if ($from.length && !$from.nextAll('.page').is($it.parents('.page'))) return
      if (pending.has(it)) return
      pending.add(it)
      setTimeout(() => { pending.delete(it); runVerification($it, item, { retry: false }) }, 50)
    })
  })
}

// --- The badge opens the Ledger Verification Tool page ---

// Which ledger item the tool should report on, when a page holds several.
let lastClicked = null

const onBadgeClick = ($item, item) => {
  const $page = $item.parents('.page')
  lastClicked = { key: $page.data('key'), id: item.id }
  wiki.pageHandler.context = ['view']
  wiki.doInternalLink(TOOL_TITLE, $page)
}

// --- Ledger Verification Tool (TOOL mode) ---

const isTool = item => extractCommands((item && item.text) || '').tool
const modeOf = item => {
  const c = extractCommands((item && item.text) || '')
  return c.tool ? 'tool' : c.index ? 'index' : c.balance ? 'balance' : c.review ? 'review' : c.board ? 'board' : c.periods ? 'periods' : 'ledger'
}

// The ledger on the page immediately to the tool's left.
const ledgerLeftOf = $tool => {
  const $page = $tool.parents('.page').prev('.page')
  if (!$page.length) return null
  const cands = $page.find('.item.timebank').toArray()
    .map(el => ({ $item: $(el), item: $(el).data('item') }))
    .filter(c => c.item && ['ledger', 'periods'].includes(modeOf(c.item)))
  if (!cands.length) return { $page, none: true }
  const clicked = lastClicked && lastClicked.key === $page.data('key') && cands.find(c => c.item.id === lastClicked.id)
  const withLinks = cands.find(c => parseEntries(c.item.text || '').some(e => e.linked) || extractCommands(c.item.text || '').lineup || extractCommands(c.item.text || '').watch.length)
  const pick = clicked || withLinks || cands[0]
  return { $page, ...pick, count: cands.length }
}

const toolMessage = ($tool, html) => $tool.find('.timebank-tool').html(`<p style="margin:6px 0">${html}</p>`)

const runTool = async ($tool, note) => {
  const led = ledgerLeftOf($tool)
  if (!led) {
    return toolMessage($tool, 'Open this page beside a ledger: click the <b>Verified</b> badge on any timebank ledger and this tool opens to its right, checking that ledger.')
  }
  if (led.none) {
    return toolMessage($tool, `The page to the left, <b>${escape(led.$page.find('h1').first().text().trim())}</b>, holds no timebank ledger. Click the badge on a ledger to check it here.`)
  }
  toolMessage($tool, `Checking <b>${escape(titleOf(led.$item))}</b>…`)
  if (modeOf(led.item) === 'periods') {
    const model = await runSummary(led.$item, led.item)
    const context = contextOf(led.$page)
    return $tool.find('.timebank-tool').html([
      `<p style="margin:6px 0">${tool.pill(views.STATUS_PILL[model.status][0], views.STATUS_PILL[model.status][1])} <b>${escape(model.title)}</b> on ${escape(model.site)} is a summary ledger: its entries are written in its period pages, and its badge is the worst of theirs. Open a period page and click its badge to check its entries here.</p>`,
      renderSummary(model, context)
    ].join('\n'))
  }
  const out = await runVerification(led.$item, led.item, { retry: false })
  if (!out) return toolMessage($tool, 'The check did not finish; click the badge again.')
  const { result, ctx, pull, incoming } = out
  const [signoffs, maps] = await Promise.all([signOffs(result, ctx), searchSitemaps(led.$page, ctx.site)])
  const groups = findCandidates(result, maps)
  const context = contextOf(led.$page)
  const extra = led.count > 1 ? `The page to the left holds ${led.count} ledgers; this is the one whose badge was clicked (or the first with linked entries).` : null
  const html = renderReport({
    result, signoffs, groups, context,
    freeze: pull ? { pulled: pull.pulled, stale: pull.stale } : null,
    verified: led.item.verified,
    note: [note, extra].filter(Boolean).join(' ') || null,
    awaiting: incoming.awaiting,
    watched: incoming.watched
  })
  $tool.find('.timebank-tool').html(html)
  $tool.data('timebankTool', { led, result, ctx, groups, pull, incoming })
}

// Neighbourhood sitemaps plus those of the sites the ledger's page links to.
const searchSitemaps = async ($page, ownSite) => {
  const maps = neighbourhoodSitemaps()
  const po = pageObjectOf($page)
  const page = po && po.getRawPage ? po.getRawPage() : null
  const extra = sitesMentioned(page, ownSite).filter(site => !Object.keys(maps).some(s => sameSite(s, site)))
  const fetched = await Promise.all(extra.map(fetchSitemap))
  extra.forEach((site, i) => { if (fetched[i]) maps[site] = fetched[i] })
  return maps
}

const outFor = ($tool, key) => $tool.find(`[data-timebank-out="${key}"]`)

const onSend = async ($tool, t, $out) => {
  const { result, ctx, led } = t
  const messages = formatVerifyMessages(result, ctx)
  $out.text(`Sending ${messages.length} to ${result.notify}…`)
  let note
  try {
    await postNotifications(messages)
    note = `Sent ${messages.length} message${messages.length === 1 ? '' : 's'} to ${result.notify}`
  } catch (err) {
    note = `Send failed: ${err.message || err}`
  }
  $out.text(note)
  const awaiting = (t.incoming && t.incoming.awaiting) || []
  setBadge(led.$item, result.status, tooltip(result, [note, awaitingTooltip(awaiting)].filter(Boolean).join('\n')), awaiting)
}

// The browser may save this ledger only when it is logged in as the owner of
// the site the ledger page is served from (the origin), not a remote copy.
const whyNotWritable = (led, site, action) => {
  const remote = led.$page.data('site')
  const isRemote = remote && remote !== 'origin' && remote !== 'view' && remote !== 'local' && !sameSite(remote, location.host)
  if (isRemote) return `Not saved: this copy of the ledger comes from ${remote}. Open it on ${remote} and log in there as its owner to ${action} it.`
  if (typeof window.isOwner === 'undefined' || !window.isOwner) {
    return `Not saved: this browser is not logged in as the owner of ${site}. Log in as the site owner, then ${action} again.`
  }
  return null
}

// pageHandler.put has no callback, and a refused save falls back silently to
// the browser's local storage; so read the page back from the server.
const confirmSaved = async (slug, item) => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 750))
    try {
      const res = await fetch(`/${slug}.json`, { cache: 'no-store' })
      if (res.ok) {
        const page = await res.json()
        const saved = (page.story || []).find(it => it.id === item.id)
        if (saved && saved.text === item.text) return true
      }
    } catch { /* try again */ }
  }
  return false
}

// Save new ledger text through the wiki's page handler, redraw the ledger,
// confirm with the server, then redraw the tool with a note.
const saveLedger = async ($tool, led, text, what) => {
  const { $item, item } = led
  item.text = text
  wiki.pageHandler.put(led.$page, { type: 'edit', id: item.id, item })
  $item.off()
  emit($item.empty(), item, { check: false })
  bind($item, item)
  const saved = await confirmSaved(slugOf($item), item)
  await runTool($tool, saved
    ? `${what}; the ledger was saved on ${siteOf($item)} and checked again.`
    : `Changed in this browser only: ${what}, but the server did not confirm the save, so the ledger may now be a local copy. Log in as the owner of ${siteOf($item)} and try again.`)
}

const onFix = async ($tool, t, group, cand, $out) => {
  const { led, result } = t
  const g = t.groups[group]
  const c = g && g.candidates[cand]
  if (!c) return $out.text('This candidate is no longer listed; click the badge to re-check.')
  const why = whyNotWritable(led, result.site, 'fix')
  if (why) return $out.text(why)
  const text = rewriteEntries(led.item.text || '', g.entries.filter(e => !e.pulled).map(e => e.raw), { href: c.href, name: c.title })
  if (text === led.item.text) return $out.text('Nothing to change: the entry lines were not found in the ledger.')
  $out.text('Saving…')
  const n = g.entries.length
  await saveLedger($tool, led, text, `Fixed: ${n} entry ${n === 1 ? 'line now names' : 'lines now name'} ${c.title.replace(/[[\]]/g, '')} on ${c.site}`)
}

const onFreeze = async ($tool, t, $out) => {
  const { led, result, pull } = t
  if (!pull || !(pull.pulled.length + pull.stale.length)) return $out.text('Nothing to freeze.')
  const why = whyNotWritable(led, result.site, 'freeze')
  if (why) return $out.text(why)
  const text = freezeText(led.item.text || '', pull.pulled, pull.stale)
  if (text === led.item.text) return $out.text('Nothing to change.')
  $out.text('Saving…')
  const n = pull.pulled.length + pull.stale.length
  await saveLedger($tool, led, text, `Froze ${n} pulled ${n === 1 ? 'entry' : 'entries'} into the ledger`)
}

// --- Reconcile ---

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Open a page from `site` at the end of the lineup and wait until it has
// rendered as that site's copy. -> $page | null
const openRemote = async (title, slug, site) => {
  wiki.doInternalLink(title, $('.page').last(), site)
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    const $p = $('.page').last()
    if (String($p.attr('id') || '').split('_rev')[0] !== slug) continue
    const po = pageObjectOf($p)
    if (po && po.isRemote && po.isRemote() && $p.find('.item').length) return $p
  }
  return null
}

// After the wiki's fork, read the page back from this origin.
const confirmForked = async slug => {
  for (let i = 0; i < 6; i++) {
    await sleep(750)
    try {
      const res = await fetch(`/${slug}.json`, { cache: 'no-store' })
      if (res.ok) {
        const page = await res.json()
        if ((page.journal || []).some(a => a.type === 'fork')) return true
      }
    } catch { /* try again */ }
  }
  return false
}

// Open each incoming page beside the tool, fork it here with the wiki's own
// fork action (pageHandler.put, as the fork flag does), then freeze their
// lines into the ledger and check again.
const onReconcile = async ($tool, t, $out) => {
  const { led, result, incoming } = t
  const awaiting = (incoming && incoming.awaiting) || []
  if (!awaiting.length) return $out.text('Nothing awaiting reconcile.')
  const why = whyNotWritable(led, result.site, 'reconcile')
  if (why) return $out.text(why)
  const own = await fetchSitemap(location.host)
  const plan = reconcilePlan(led.item.text || '', awaiting, (own || []).map(p => p.slug))
  const done = []
  for (const f of plan.forks) {
    $out.text(`Opening ${f.title} from ${f.site}…`)
    const $p = await openRemote(f.title, f.slug, f.site)
    if (!$p) return $out.text(`Stopped: ${f.title} did not open from ${f.site}, so nothing was forked or frozen after it.${done.length ? ` Forked so far: ${done.join(', ')}.` : ''}`)
    $out.text(`Forking ${f.title} to ${location.host}…`)
    wiki.pageHandler.put($p, { type: 'fork', site: f.site })
    if (!(await confirmForked(f.slug))) {
      return $out.text(`Stopped: the fork of ${f.title} was not confirmed by ${location.host}, so the ledger was not changed. Log in as the site owner and reconcile again.`)
    }
    done.push(f.title)
  }
  $out.text('Freezing the lines into the ledger…')
  const kept = plan.kept.length ? `; ${plan.kept.map(k => k.title).join(', ')} already on ${location.host}, not forked over` : ''
  await saveLedger($tool, led, plan.text, `Reconciled ${awaiting.length} incoming ${awaiting.length === 1 ? 'page' : 'pages'}: forked ${done.length}${kept}, lines frozen into the ledger`)
}

const onToolClick = ($tool, e) => {
  const $btn = $(e.currentTarget)
  const action = $btn.attr('data-timebank-action')
  e.preventDefault()
  e.stopPropagation()
  const t = $tool.data('timebankTool')
  const stale = $out => $out.text('This report is stale; click the badge to re-check.')
  if (action === 'send') {
    const $out = outFor($tool, 'send')
    if (!t) return stale($out)
    if ($btn.prop('disabled')) return
    $btn.prop('disabled', true)
    onSend($tool, t, $out).finally(() => $btn.prop('disabled', false))
  } else if (action === 'fix') {
    const gi = +$btn.attr('data-timebank-group')
    const ci = +$btn.attr('data-timebank-candidate')
    const $out = outFor($tool, `fix-${gi}-${ci}`)
    if (!t) return stale($out)
    onFix($tool, t, gi, ci, $out).catch(err => $out.text(`Fix failed: ${err.message || err}`))
  } else if (action === 'reconcile') {
    const $out = outFor($tool, 'reconcile')
    if (!t) return stale($out)
    if ($btn.prop('disabled')) return
    $btn.prop('disabled', true)
    onReconcile($tool, t, $out).catch(err => $out.text(`Reconcile failed: ${err.message || err}`)).finally(() => $btn.prop('disabled', false))
  } else if (action === 'freeze') {
    const $out = outFor($tool, 'freeze')
    if (!t) return stale($out)
    onFreeze($tool, t, $out).catch(err => $out.text(`Freeze failed: ${err.message || err}`))
  }
}

const emitTool = ($item) => {
  $item.append('<div class="timebank-tool" style="margin:8px 0;font-family:sans-serif;font-size:14px"><p style="margin:6px 0;color:#666">Looking for the ledger to the left…</p></div>')
  // Deferred a tick so the item is attached to its page and the lineup.
  setTimeout(() => runTool($item).catch(err => toolMessage($item, `The tool failed: ${escape(err.message || err)}`)), 0)
}

// --- Summary ledger (PERIODS), balance (BALANCE), Transactions Index (INDEX) ---

// Fetches memoised for one drawing, each capped at five seconds so an
// unreachable party (a site that does not resolve) cannot hold the page.
const withTimeout = (promise, ms = 5000) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))])
const memoFetch = () => {
  const pages = new Map()
  const maps = new Map()
  return {
    page: (site, slug) => {
      const key = `${normSite(site)}/${slug}`
      if (!pages.has(key)) pages.set(key, withTimeout(fetchPage(site, slug)).catch(() => null))
      return pages.get(key)
    },
    sitemap: site => {
      const key = normSite(site)
      if (!maps.has(key)) maps.set(key, withTimeout(fetchSitemap(site)).catch(() => null))
      return maps.get(key)
    }
  }
}

// A period's badge, as its own ledger item would draw it: written entries,
// plus the entries it pulls when it has LINEUP.
const periodStatus = async (site, identity, p, memo) => {
  const me = { site: normSite(site), slug: identity }
  const pulled = p.lineup ? pullEntries(await siteFacts(site), me, p.written, p.period).pulled : []
  const r = await verifyItem({ text: p.text }, {
    title: p.title, slug: identity, pageSlug: p.slug, site, fetchPage: memo.page, fetchSitemap: memo.sitemap, pulled
  })
  return r.status
}

// The summary ledger titled `title` on `site`: its period pages, found by
// title prefix in the site's sitemap. -> summariseLedger() + who and where
const summaryFor = async (site, title, text, { statuses = true, memo = memoFetch() } = {}) => {
  const cmd = extractCommands(text || '')
  const identity = parse.asSlug(title)
  const map = await memo.sitemap(site)
  const pages = periodPagesOf(map, title)
  const got = await Promise.all(pages.map(p => memo.page(site, p.slug)))
  const list = got.map((pg, i) => pg ? periodLedger(pg, pages[i]) : null).filter(Boolean)
  if (statuses) {
    await Promise.all(list.map(async p => {
      try { p.status = await periodStatus(site, identity, p, memo) } catch { p.status = 'fail' }
    }))
  }
  const recent = cmd.periods ? cmd.periods.recent : 10
  const who = await resolveOwnerName(cmd.owner, site, memo.page)
  return {
    ...summariseLedger(list, { recent }),
    title, slug: identity, site: normSite(site),
    owner: cmd.owner, ownerName: who
  }
}

const runSummary = async ($item, item) => {
  const model = await summaryFor(siteOf($item), titleOf($item), item.text || '')
  const context = contextOf($item.parents('.page'))
  $item.find('.timebank-summary').html(renderSummary(model, context))
  const lines = model.periods.map(p => `${p.title}: ${(views.STATUS_PILL[p.status] || ['', p.status])[1]}`)
  setBadge($item, model.status, [...lines, 'Click to open the Ledger Verification Tool beside this ledger'].join('\n'))
  $item.find('.timebank-net').text(periods.signedHours(model.net, formatHours))
  item.verified = { at: Date.now(), by: location.host, site: model.site, status: model.status, periods: model.periods.map(p => ({ slug: p.slug, status: p.status })) }
  return model
}

const emitSummary = ($item, item, { check = true } = {}) => {
  const { owner, periods: p } = extractCommands(item.text || '')
  $item.append(`
    <div style="margin:8px 0;font-family:sans-serif;font-size:14px">
      <table style="width:100%;border-collapse:collapse;background:#fafafa;border:1px solid #ddd">
        <thead><tr style="background:#e8e8e8">
          <th style="padding:6px 8px;text-align:left;font-weight:600">Summary ledger<span class="timebank-badge pending" title="Checking the period ledgers…">${BADGE_TEXT.pending}</span></th>
          <th style="padding:6px 8px;text-align:right;font-weight:600">Net <span class="timebank-net"></span></th>
        </tr></thead>
      </table>
      <div class="timebank-summary" style="padding:4px 2px"><p style="margin:6px 0;color:#666">Finding the period pages titled <i>${escape(titleOf($item))} YYYY-MM</i>${owner ? ` of ${markup(`[[${owner.name}]]`)}` : ''}; the ${p.recent} most recent transactions…</p></div>
    </div>`)
  if (check) setTimeout(() => runSummary($item, item).catch(err => setBadge($item, 'fail', `Summary error: ${err.message || err}`)), 0)
}

// BALANCE on the owner's About page: the ledger named on the line, or the
// summary ledger on this site whose OWNER line links this page.
const findOwnedLedger = async (site, aboutSlug, memo) => {
  const map = await memo.sitemap(site)
  const ledgers = ledgersInSitemap(map)
  for (const l of ledgers) {
    const entry = (map || []).find(p => p.slug === l.slug)
    // a summary with no OWNER line owns [[About]] without linking it
    const links = entry && entry.links && Object.prototype.hasOwnProperty.call(entry.links, aboutSlug)
    if (!entry || (!links && aboutSlug !== 'about')) continue
    const page = await memo.page(site, l.slug)
    const it = ledgerItemOf(page)
    const c = it ? extractCommands(it.text || '') : {}
    if (ownedBy(c, aboutSlug)) return { title: page.title, text: it.text }
  }
  return null
}

const emitBalance = ($item, item) => {
  $item.append('<div class="timebank-balance" style="margin:8px 0;font-family:sans-serif;font-size:14px;padding:6px 10px;border:1px solid #ddd;border-left:4px solid #3a9a5b;border-radius:4px;background:#fafafa"><p style="margin:6px 0;color:#666">Reading the ledger…</p></div>')
  setTimeout(async () => {
    const $out = $item.find('.timebank-balance')
    try {
      const site = siteOf($item)
      const memo = memoFetch()
      const ref = extractCommands(item.text || '').balance
      let ledger = null
      if (ref && ref !== true) {
        const page = await memo.page(ref.external ? ref.site : site, ref.slug)
        const it = ledgerItemOf(page)
        if (page && it) ledger = { title: page.title, text: it.text, site: ref.external ? ref.site : site }
      } else {
        const found = await findOwnedLedger(site, slugOf($item), memo)
        if (found) ledger = { ...found, site }
      }
      if (!ledger) return $out.html('<p style="margin:6px 0">No summary ledger found. Write <code>BALANCE: [[Your Ledger]]</code>, or give your summary ledger an <code>OWNER:</code> line linking this page.</p>')
      const model = await summaryFor(ledger.site, ledger.title, ledger.text, { statuses: false, memo })
      $out.html(renderBalance(model, contextOf($item.parents('.page'))))
    } catch (err) {
      $out.html(`<p style="margin:6px 0">The balance could not be read: ${escape(err.message || err)}</p>`)
    }
  }, 0)
}

// The index reports on the site of the page to its left (this page's own
// site when nothing is to its left).
const indexSubject = $item => {
  const $left = $item.parents('.page').prev('.page')
  const $page = $left.length ? $left : $item.parents('.page')
  return { $page, site: siteOfPage($page), title: $left.length ? $left.find('h1').first().text().trim() : null }
}

const runIndex = async ($item, note) => {
  const $out = $item.find('.timebank-index')
  const { site, title } = indexSubject($item)
  $out.html(`<p style="margin:6px 0;color:#666">Reading the sitemap of ${escape(site)}…</p>`)
  const memo = memoFetch()
  const map = await memo.sitemap(site)
  if (!map) return $out.html(`<p style="margin:6px 0">The sitemap of ${escape(site)} could not be read.</p>`)
  const bases = ledgersInSitemap(map)
  const ledgers = await Promise.all(bases.map(async l => ({
    title: l.title, slug: l.slug, site,
    periods: (await Promise.all(l.periods.map(async p => {
      const pg = await memo.page(site, p.slug)
      return pg ? periodLedger(pg, p) : null
    }))).filter(Boolean)
  })))
  const cands = indexCandidates(map, ledgers.map(l => l.slug))
  const pages = await Promise.all(cands.map(p => memo.page(site, p.slug)))
  const occasions = []
  const skipped = []
  pages.forEach((pg, i) => {
    if (!pg) return
    const facts = pageTransactions(pg, site, cands[i].slug)
    if (facts.length) { occasions.push(...facts); return }
    const it = ledgerItemOf(pg)
    if (it && !extractCommands(it.text || '').periods) {
      // a plain ledger: one page, one period (or none)
      ledgers.push({ title: pg.title, slug: cands[i].slug, site, periods: [periodLedger(pg, { slug: cands[i].slug })] })
    } else if (!(pg.story || []).some(x => x.type === 'timebank')) {
      skipped.push(cands[i]) // an About page (BALANCE) or a ledger is not a stray
    }
  })
  const rows = classifyOccasions(occasions, ledgers, site)
  // parties whose ledger cannot be read: unknown
  const refs = new Map()
  for (const f of occasions) for (const r of [f.giver, f.receiver]) if (r && r.site && r.slug) refs.set(`${r.site}/${r.slug}`, r)
  const unknown = []
  await Promise.all([...refs.entries()].map(async ([id, r]) => {
    if (sameSite(r.site, site) && ledgers.some(l => l.slug === r.slug)) return
    const pg = await memo.page(r.site, r.slug)
    if (!pg) unknown.push(id)
  }))
  const remote = !sameSite(site, location.host)
  const context = contextOf($item.parents('.page'))
  $out.html((note ? `<p style="margin:6px 0"><b>${escape(note)}</b></p>` : '') +
    renderIndex({ site, rows, unknown: unknown.sort(), pages: new Set(occasions.map(f => f.page.slug)).size, skipped, of: title, remote }, context))
  $item.data('timebankIndex', { site, rows, ledgers, remote })
}

const emitIndex = $item => {
  $item.append('<div class="timebank-index" style="margin:8px 0;font-family:sans-serif;font-size:14px"><p style="margin:6px 0;color:#666">Looking for the site to the left…</p></div>')
  setTimeout(() => runIndex($item).catch(err => $item.find('.timebank-index').html(`<p>The index failed: ${escape(err.message || err)}</p>`)), 0)
}

// Open the listed pages to the right of the index, in order, keeping them all.
const openLineup = ($item, t, state, $out) => {
  const seen = new Set()
  const list = t.rows.filter(r => !state || r.state === state).map(r => r.facts.page).filter(p => {
    if (seen.has(p.slug)) return false
    seen.add(p.slug)
    return true
  })
  if (!list.length) return $out.text('Nothing to open.')
  const where = t.remote ? t.site : null
  list.forEach((p, i) => wiki.doInternalLink(p.title || p.slug, i === 0 ? $item.parents('.page') : null, where))
  $out.text(`Opened ${list.length} ${list.length === 1 ? 'page' : 'pages'} to the right.`)
}

const putAction = async (slug, action) => {
  const res = await fetch(`/page/${slug}/action`, { method: 'PUT', body: new URLSearchParams({ action: JSON.stringify(action) }) })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`)
}

const onLogOrphans = async ($item, t, $out) => {
  if (t.remote) return $out.text(`Not saved: this index shows ${t.site} from ${location.host}. Open the Transactions Index on ${t.site} and log in there as its owner.`)
  if (typeof window.isOwner === 'undefined' || !window.isOwner) {
    return $out.text(`Not saved: this browser is not logged in as the owner of ${t.site}. Log in as the site owner, then log the orphans again.`)
  }
  const plan = orphanPlan(t.rows, t.site)
  if (!plan.edits.length && !plan.creates.length) return $out.text('Nothing to log: the orphans here name no ledger on this site.')
  let n = 0
  for (const e of plan.edits) {
    $out.text(`Writing ${e.lines.length} into ${e.title}…`)
    const page = await (await fetch(`/${e.slug}.json`, { cache: 'no-store' })).json()
    const it = (page.story || []).find(x => x.id === e.itemId)
    if (!it) return $out.text(`Stopped: ${e.title} changed since the index was drawn; reload and try again.`)
    await putAction(e.slug, { type: 'edit', id: it.id, item: { ...it, text: e.text }, date: Date.now() })
    n += e.lines.length
  }
  for (const c of plan.creates) {
    $out.text(`Creating ${c.title}…`)
    const story = [
      { type: 'timebank', id: Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10), text: c.text },
      { type: 'markdown', id: Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10), text: 'A period ledger created by Log the orphans on the [[Transactions Index]]. See [[Time Transaction]].' }
    ]
    await putAction(c.slug, { type: 'create', item: { title: c.title, story }, date: Date.now() })
    n += c.lines.length
  }
  ownSiteCache.clear()
  await runIndex($item, `Logged ${n} ${n === 1 ? 'orphan' : 'orphans'}: ${plan.edits.length} period ${plan.edits.length === 1 ? 'ledger' : 'ledgers'} edited, ${plan.creates.length} created${plan.skipped.length ? `; ${plan.skipped.length} left (they name no ledger here)` : ''}.`)
}

const onIndexClick = ($item, e) => {
  const $btn = $(e.currentTarget)
  const action = $btn.attr('data-timebank-action')
  e.preventDefault()
  e.stopPropagation()
  const t = $item.data('timebankIndex')
  if (action === 'lineup') {
    const $out = $item.find('[data-timebank-out="lineup"]')
    if (!t) return $out.text('Still reading; try again in a moment.')
    openLineup($item, t, $btn.attr('data-timebank-state') || null, $out)
  } else if (action === 'log-orphans') {
    const $out = $item.find('[data-timebank-out="log-orphans"]')
    if (!t) return $out.text('Still reading; try again in a moment.')
    if ($btn.prop('disabled')) return
    $btn.prop('disabled', true)
    onLogOrphans($item, t, $out).catch(err => $out.text(`Log the orphans failed: ${err.message || err}`)).finally(() => $btn.prop('disabled', false))
  }
}

// --- Weekly review (REVIEW) and the Review Board (BOARD) — 0.7.0 ---

// The model items on the same page, as frozen tables.
const modelsOnPage = $item => $item.parents('.page').find('.item.model').toArray()
  .map(el => { const it = $(el).data('item'); return it ? { ...modelOf(it.text), id: it.id } : null })
  .filter(Boolean)

const reviewModelFor = ($item, week) => {
  const ms = modelsOnPage($item).filter(m => m.sheet === 'Review')
  return ms.find(m => m.caption && m.caption.includes(week)) || ms[0] || null
}

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const drawReview = ($item, item, note = '') => {
  const r = parseReview(item.text || '')
  const model = reviewModelFor($item, r.week)
  const rows = model ? reviewRows(model) : []
  const $out = $item.find('.timebank-review')
  const head = `<p style="margin:4px 0;font-weight:600">Review of ${escape(r.week || 'this week')}</p>`
  let body
  if (r.approved) {
    const list = r.hours.map(([m, h]) => `${escape(m)} ${formatHours(h)}`).join(', ')
    body = `<p style="margin:4px 0">Approved on ${escape(r.approved.on)} by ${escape(r.approved.by)}: ${list || 'no hours'}. The week is burned; the report tool writes these hours into the Review Model's Approved sheet once and refreezes the figures above.</p>`
  } else if (!rows.length) {
    body = '<p style="margin:4px 0">No Review figures are frozen on this page yet: the report tool places a model item reading the Review tab for this week above this one.</p>'
  } else {
    const list = hoursToApprove(rows).map(([m, h]) => `${escape(m)} ${formatHours(h)}`).join(', ')
    body = `<p style="margin:4px 0">Approving burns these hours to dynamic equity, once only: ${list}.</p>` +
      '<p style="margin:4px 0"><button data-timebank-action="approve">Approve the week</button> <span data-timebank-out="approve" style="color:#555"></span></p>'
  }
  $out.html(head + body + (note ? `<p style="margin:4px 0;color:#555">${escape(note)}</p>` : ''))
}

const emitReview = ($item, item) => {
  $item.append('<div class="timebank-review" style="margin:8px 0;font-family:sans-serif;font-size:14px;padding:6px 10px;border:1px solid #ddd;border-left:4px solid #d9822b;border-radius:4px;background:#fafafa"><p style="margin:6px 0;color:#666">Reading the review…</p></div>')
  // the model item above may not be drawn yet: wait a tick for the page
  setTimeout(() => drawReview($item, item), 0)
}

const onApprove = async ($item, item, $out) => {
  const r = parseReview(item.text || '')
  if (r.approved) return $out.text(`Already approved on ${r.approved.on} by ${r.approved.by}: a week is burned once only.`)
  const site = siteOf($item)
  const remote = $item.parents('.page').data('site')
  if (remote && remote !== 'origin' && remote !== 'view' && remote !== 'local' && !sameSite(remote, location.host)) {
    return $out.text(`Not saved: this copy of the report comes from ${remote}. Open it on ${remote} and log in there as its owner to approve.`)
  }
  if (typeof window.isOwner === 'undefined' || !window.isOwner) {
    return $out.text(`Not saved: this browser is not logged in as the owner of ${site}. Log in as the site owner, then approve again. Nothing was written.`)
  }
  const model = reviewModelFor($item, r.week)
  const rows = model ? reviewRows(model) : []
  if (!rows.length) return $out.text('Not saved: no Review figures are frozen on this page to approve.')
  const by = (typeof window.ownerName === 'string' && window.ownerName) || 'the site owner'
  item.text = approvalText(r.week, todayIso(), by, hoursToApprove(rows))
  const $page = $item.parents('.page:first')
  wiki.pageHandler.put($page, { type: 'edit', id: item.id, item })
  const saved = await confirmSaved(slugOf($item), item)
  drawReview($item, item, saved
    ? 'Approved and saved to the page journal. Run the report tool (--review-model) to burn the hours into the workbook and refreeze.'
    : 'Changed in this browser only: the server did not confirm the save. Log in as the site owner and approve again.')
}

const drawBoard = $item => {
  const data = boardData(modelsOnPage($item))
  const $out = $item.find('.timebank-board-charts')
  if (!data.weeks.length && !data.share.length) {
    return $out.html('<p style="margin:6px 0">No frozen figures on this page yet: the board draws the model items that freeze the Review and Equity tabs of the Review Model.</p>')
  }
  const members = data.perMember.map(p => p.member)
  const colour = m => PALETTE[Math.max(0, members.indexOf(m)) % PALETTE.length]
  const weeks = data.weeks.map(w => w.week)
  const span = weeks.length ? `${weeks[0]} to ${weeks[weeks.length - 1]}` : ''
  const parts = [
    barsSvg(`Hours given per member, ${span}`, data.perMember.map(p => ({ label: p.member, value: p.actual, color: colour(p.member) }))),
    plannedActualSvg('Planned against actual, per week', data.weeks, members),
    data.share.length ? barsSvg('Shares of dynamic equity', data.share.map(s => ({ label: s.member, value: s.share, color: colour(s.member) })), { unit: '%' }) : ''
  ]
  $out.html(parts.filter(Boolean).map(p => `<div style="margin:10px 0">${p}</div>`).join(''))
}

const emitBoard = $item => {
  $item.append('<div class="timebank-board" style="margin:8px 0;font-family:sans-serif;font-size:14px;background:#fff">' +
    '<p style="margin:4px 0"><button data-timebank-action="fullscreen">Full screen</button> <span style="color:#666">drawn from the frozen figures on this page — no workbook, no network</span></p>' +
    '<div class="timebank-board-charts"><p style="margin:6px 0;color:#666">Drawing…</p></div></div>')
  setTimeout(() => drawBoard($item), 0)
}

const onBoardClick = ($item, e) => {
  e.preventDefault()
  e.stopPropagation()
  const el = $item.find('.timebank-board')[0]
  if (!el) return
  if (document.fullscreenElement) return document.exitFullscreen()
  el.style.padding = '24px'
  const done = () => { if (!document.fullscreenElement) el.style.padding = '' }
  document.addEventListener('fullscreenchange', done, { once: true })
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {})
}

// --- Plugin ---

const emit = ($item, item, { check = true } = {}) => {
  ensureStyle()
  listenForTransactions()
  if (isTool(item)) return emitTool($item)
  const mode = modeOf(item)
  if (mode === 'periods') return emitSummary($item, item, { check })
  if (mode === 'index') return emitIndex($item, item)
  if (mode === 'balance') return emitBalance($item, item)
  if (mode === 'review') return emitReview($item, item)
  if (mode === 'board') return emitBoard($item, item)
  // Parse START/END commands — clear stale values if absent
  const dates = extractDates(item.text || '')
  if (dates.start) item.start = dates.start; else delete item.start
  if (dates.end) item.end = dates.end; else delete item.end
  if (!item.end) item.end = Date.now()

  const entries = parseEntries(item.text || '')
  const total = totalHours(entries)
  const caption = extractCaption(item.text || '')
  const { lineup, watch } = extractCommands(item.text || '')
  const linked = entries.some(e => e.linked)
  const watching = watch.length > 0
  registerSites(entries)

  const columnHeader = dates.end ? formatShortDate(item.end) : 'Entry'
  const badge = linked || lineup || watching
    ? `<span class="timebank-badge pending" title="${escapeAttr('Checking counterparty ledgers…')}">${BADGE_TEXT.pending}</span>`
    : ''

  const rows = entries.map(e => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd">${markup(e.raw)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;color:#666;white-space:nowrap">${e.time !== null ? formatHours(e.time) : ''}</td>
    </tr>`).join('')

  const empty = lineup
    ? 'No entries yet. Open a Time Transaction page to the left of this ledger to pull its entry.'
    : 'No entries yet. Double-click to add.'

  $item.append(`
    <div style="margin:8px 0;font-family:sans-serif;font-size:14px">
      <table style="width:100%;border-collapse:collapse;background:#fafafa;border:1px solid #ddd">
        <thead>
          <tr style="background:#e8e8e8">
            <th style="padding:6px 8px;text-align:left;font-weight:600">${columnHeader}${badge}</th>
            <th style="padding:6px 8px;text-align:right;font-weight:600">Time</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr class="timebank-empty"><td colspan="2" style="padding:8px;color:#999;font-style:italic">${empty}</td></tr>`}
        </tbody>
        <tbody class="timebank-pulled"></tbody>
        <tbody class="timebank-awaiting"></tbody>
        <tfoot class="timebank-total">${total > 0 ? totalRow(total) : ''}</tfoot>
      </table>
      ${caption ? `<div style="padding:8px;color:#555;font-style:italic;border-top:1px solid #ddd;background:#fafafa">${markup(caption)}</div>` : ''}
    </div>`)

  // Everything above is synchronous; the async check draws only the badge and
  // the pulled rows. Deferred a tick so the item is attached to its .page.
  if ((linked || lineup || watching) && check) setTimeout(() => runVerification($item, item), 0)
}

const bind = ($item, item) => {
  if (isTool(item)) {
    $item.on('click', 'button[data-timebank-action]', e => onToolClick($item, e))
    return $item
  }
  const mode = modeOf(item)
  if (mode === 'index') {
    $item.on('click', 'button[data-timebank-action]', e => onIndexClick($item, e))
    return $item.dblclick(() => wiki.textEditor($item, item))
  }
  if (mode === 'balance') return $item.dblclick(() => wiki.textEditor($item, item))
  if (mode === 'review') {
    $item.on('click', 'button[data-timebank-action="approve"]', e => {
      e.preventDefault()
      e.stopPropagation()
      const $btn = $(e.currentTarget)
      const $out = $item.find('[data-timebank-out="approve"]')
      if ($btn.prop('disabled')) return
      $btn.prop('disabled', true)
      onApprove($item, item, $out).catch(err => $out.text(`Approve failed: ${err.message || err}`)).finally(() => $btn.prop('disabled', false))
    })
    return $item.dblclick(() => wiki.textEditor($item, item))
  }
  if (mode === 'board') {
    $item.on('click', 'button[data-timebank-action="fullscreen"]', e => onBoardClick($item, e))
    return $item.dblclick(() => wiki.textEditor($item, item))
  }
  if (mode === 'periods') {
    $item.on('click', '.timebank-badge', e => { e.stopPropagation(); e.preventDefault(); onBadgeClick($item, item) })
    $item.on('dblclick', '.timebank-badge', e => e.stopPropagation())
    $item.on('dblclick', 'a', e => e.stopPropagation())
    return $item.dblclick(() => wiki.textEditor($item, item))
  }
  $item.on('click', '.timebank-badge', e => {
    e.stopPropagation()
    e.preventDefault()
    if ($(e.currentTarget).closest('.timebank-pulled-row, .timebank-awaiting-row').length) return
    onBadgeClick($item, item)
  })
  $item.on('dblclick', '.timebank-badge', e => e.stopPropagation())
  return $item.dblclick(() => {
    if (!/^END\s*:/im.test(item.text || '')) item.end = Date.now()
    // With pulled entries beside it, the editor opens on the frozen text:
    // saving it is a freeze (the timeline plugin's LINEUP pattern).
    const pull = $item.data('timebankPull')
    if (pull && (pull.pulled.length || pull.stale.length)) {
      return wiki.textEditor($item, { ...item, text: freezeText(item.text || '', pull.pulled, pull.stale) })
    }
    return wiki.textEditor($item, item)
  })
}

if (typeof window !== 'undefined') {
  window.plugins.timebank = { emit, bind }
  // The transaction item type is served by the tiny wiki-plugin-transaction
  // package, whose client file imports this bundle and registers this.
  window.wikiPluginTransaction = transactionPlugin
}

export const timebank = typeof window == 'undefined'
  ? { ...parse, ...verify, ...tool, ...txn, ...links, ...periods, ...views, ...review }
  : undefined
