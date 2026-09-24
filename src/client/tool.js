// Ledger Verification Tool — the report drawn by the timebank item in TOOL
// mode on the plugin's own "Ledger Verification Tool" page, which a badge
// click opens beside the ledger. Pure: renders HTML from a verifyItem()
// result and finds candidate ledgers in sitemaps. The browser layer
// (timebank.js) finds the ledger to the tool's left, runs the checks and
// wires the buttons; nothing here touches the DOM.

import { asSlug, normLabel, normSite, sameSite, ledgerUrl, formatHours, escape, escapeAttr, parseLedgerUrl } from './parse.js'
import { internalAnchor, externalAnchor, refAnchor, resolveLike } from './links.js'
import { SIGNOFF_TEXT, suggestTitle, TEMPLATE_TITLE } from './txn.js'

export const TOOL_TITLE = 'Ledger Verification Tool'

export const STATUS_TEXT = {
  ok: 'Verified (green)',
  partial: 'Partly verified (orange)',
  fail: 'Not verified (red)',
  none: 'No linked entries'
}

const normTitle = t => normLabel(String(t || '').replace(/[’‘]/g, "'"))

// For every counterparty ledger that was unreachable or left entries unmatched,
// look through sitemaps for pages whose slug or title matches its name — other
// than the ledger already checked and this ledger itself.
//   sitemaps = { site: [{ slug, title }] }
// -> [{ ledger, reason: 'unreachable'|'unmatched', entries, candidates: [{ site, slug, title, href }], searched }]
export const findCandidates = (result, sitemaps = {}) => {
  const sites = Object.keys(sitemaps || {}).filter(site => Array.isArray(sitemaps[site]))
  const out = []
  for (const cp of (result && result.counterparties) || []) {
    if (cp.reachable && cp.unmatched.length === 0) continue
    const wantSlug = cp.slug
    const wantTitle = normTitle(cp.name)
    const candidates = []
    for (const site of sites) {
      for (const p of sitemaps[site]) {
        if (!p || !p.slug) continue
        const hit = p.slug === wantSlug || normTitle(p.title) === wantTitle || asSlug(p.title || '') === wantSlug
        if (!hit) continue
        if (sameSite(site, cp.site) && p.slug === cp.slug) continue
        if (sameSite(site, result.site) && p.slug === result.slug) continue
        if (candidates.some(c => sameSite(c.site, site) && c.slug === p.slug)) continue
        const s = normSite(site)
        candidates.push({ site: s, slug: p.slug, title: p.title || p.slug, href: ledgerUrl({ site: s, slug: p.slug }) })
      }
    }
    out.push({
      ledger: cp,
      reason: cp.reachable ? 'unmatched' : 'unreachable',
      entries: cp.unmatched,
      candidates,
      searched: sites.length
    })
  }
  return out
}

// The known sites beyond the neighbourhood: every site an external link on the
// ledger's page names (in any item), except the page's own site.
export const sitesMentioned = (page, ownSite) => {
  const out = []
  for (const it of (page && page.story) || []) {
    const text = typeof it.text === 'string' ? it.text : ''
    for (const m of text.matchAll(/\[((?:https?:)?\/\/[^\s\]]+)\s[^\]]*\]/gi)) {
      const ref = parseLedgerUrl(m[1])
      const site = ref ? ref.site : null
      if (site && !sameSite(site, ownSite) && !out.some(s => sameSite(s, site))) out.push(site)
    }
  }
  return out
}

// --- Report ---

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// "23 Sep 2026, 14:05 UTC"
export const formatStamp = ms => {
  const d = new Date(ms)
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`
}

// A coloured pill in the badge's own classes: ok green, partial orange, fail red.
export const pill = (cls, text) => `<span class="timebank-badge ${cls}" style="margin-left:0">${escape(text)}</span>`

export const RESULT_PILL = {
  matched: ['ok', 'matched'],
  unmatched: ['fail', 'unmatched'],
  unreachable: ['fail', 'ledger unreachable']
}

export const SIGNOFF_PILL = { accepted: 'ok', dialogue: 'partial', awaiting: 'partial' }

const linkText = s => String(s || '').replace(/[[\]]/g, '')

const button = (action, extra, label) =>
  `<button data-timebank-action="${action}"${extra}>${escape(label)}</button>`

const outSpan = key => `<span data-timebank-out="${escapeAttr(key)}" style="margin-left:8px;color:#555"></span>`

const TH = 'style="text-align:left;padding:4px 6px;border-bottom:1px solid #ccc;font-weight:600"'
const TD = 'style="padding:4px 6px;border-bottom:1px solid #eee;vertical-align:top"'
const table = (head, rows) => `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:4px 0 8px">
<thead><tr>${head.map(h => `<th ${TH}>${escape(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map(c => `<td ${TD}>${c}</td>`).join('')}</tr>`).join('\n')}</tbody></table>`

const heading = (title, line) =>
  `<h3 style="margin:14px 0 2px">${escape(title)}</h3><p style="margin:0 0 6px;color:#666">${escape(line)}</p>`

const para = html => `<p style="margin:6px 0">${html}</p>`

// A transaction page link: internal, searched on the page's own site first,
// so it opens in the lineup from the site that holds it.
const txnAnchor = (txn, context) => internalAnchor(txn.title || txn.slug, context, txn.site)

const outcomeOf = (cp, ok) => ok ? 'matched' : (cp.reachable ? 'unmatched' : 'unreachable')

// Every linked entry, Result first.
//   -> rows of HTML cells
export const entryRows = (result, context = []) => {
  const rows = []
  for (const cp of result.counterparties) {
    const all = [...cp.matched.map(e => [e, true]), ...cp.unmatched.map(e => [e, false])]
    for (const [e, ok] of all) {
      const [cls, text] = RESULT_PILL[outcomeOf(cp, ok)]
      const by = ok && e.matchedBy === 'page' ? ' by page' : ''
      rows.push([
        pill(cls, text + by),
        escape(e.direction),
        escape(formatHours(e.time) || '0h'),
        escape(e.label) + (e.pulled ? ' ' + pill('pending', 'pulled') : ''),
        `${refAnchor({ ...cp, external: true }, result.site, context, ledgerUrl)} <span style="color:#888">${escape(cp.site)}</span>`,
        e.txn ? txnAnchor(e.txn.site ? e.txn : { ...e.txn, site: result.site }, context) : '<span style="color:#999">none</span>'
      ])
    }
  }
  return rows
}

// Entries with no transaction page: valid as they stand when matched, but a
// page records the work. Offered as a new page, as the wiki offers a red link.
export const missingPages = result => {
  const out = []
  for (const cp of result.counterparties) {
    for (const e of [...cp.matched, ...cp.unmatched]) {
      if (!e.txn && !e.pulled) out.push({ entry: e, title: suggestTitle(e), matched: cp.matched.includes(e) })
    }
  }
  return out
}

// model = {
//   result: verifyItem(), signoffs: signOffs(), groups: findCandidates(),
//   freeze: { pulled, stale } | null, context: [sites], verified: { at, by }, note
// } -> HTML for the TOOL item
export const renderReport = model => {
  const { result, signoffs = [], groups = [], freeze = null, context = [], note } = model
  const at = (model.verified && model.verified.at) || Date.now()
  const by = (model.verified && model.verified.by) || result.site
  const out = []
  const ledger = externalAnchor(ledgerUrl({ site: result.site, slug: result.slug }), linkText(result.title))
  const status = { ok: ['ok', 'Verified'], partial: ['partial', 'Partly verified'], fail: ['fail', 'Not verified'], none: ['pending', 'No linked entries'] }[result.status] || ['pending', result.status]
  const unreachable = result.unreachable.length
    ? `; ${plural(result.unreachable.length, 'counterparty ledger', 'counterparty ledgers')} could not be reached`
    : ''
  const pulled = result.pulled ? `, ${plural(result.pulled, 'entry', 'entries')} pulled from transaction pages` : ''
  out.push(para(`${pill(status[0], status[1])} The ledger ${ledger} on ${escape(result.site)}, checked ${escape(formatStamp(at))} from ${escape(by)}: ${result.matched.length} of ${plural(result.linked, 'linked entry', 'linked entries')} matched${escape(unreachable)}${escape(pulled)}.`))
  if (note) out.push(para(`<b>${escape(note)}</b>`))

  out.push(heading('Entries', 'Every linked entry and what its counterparty ledger says'))
  const rows = entryRows(result, context)
  out.push(rows.length
    ? table(['Result', 'Direction', 'Hours', 'Label', 'Counterparty ledger', 'Transaction page'], rows)
    : para('This ledger has no linked entries yet.'))

  out.push(heading('Transactions', 'Each transaction page and whether the receiver has signed off'))
  if (signoffs.length) {
    out.push(table(['Sign-off', 'Transaction page', 'Direction', 'Hours', 'With'], signoffs.map(s => {
      const forked = s.fork ? ` — forked on ${escape(s.forkSite)}${s.comments ? ` with ${plural(s.comments, 'comment', 'comments')}` : ''}` : ''
      return [
        pill(SIGNOFF_PILL[s.state], SIGNOFF_TEXT[s.state]) + forked,
        txnAnchor(s.txn, context) + (s.reachable ? '' : ' <span style="color:#9b1c1c">(page not found)</span>'),
        escape(s.entry.direction),
        escape(formatHours(s.entry.time) || '0h'),
        escape(linkText(s.entry.counterparty.name))
      ]
    })))
    out.push(para('<span style="color:#555">Accepted: the receiver\'s ledger holds the line. In dialogue: the receiver has forked the page to comment or query. Awaiting sign-off: neither yet — for an entry pulled onto this ledger, Freeze is the sign-off.</span>'))
  } else {
    out.push(para('No entry links a transaction page. A matched pair of lines with no page behind it is valid as it stands.'))
  }

  if (result.lineup || (freeze && (freeze.pulled.length || freeze.stale.length))) {
    out.push(heading('Freeze', 'Write the pulled entries into the ledger, so it stands alone'))
    const n = freeze ? freeze.pulled.length + freeze.stale.length : 0
    if (n) {
      const what = [
        freeze.pulled.length ? `${plural(freeze.pulled.length, 'entry is', 'entries are')} pulled from transaction pages but not written in the ledger` : '',
        freeze.stale.length ? `${plural(freeze.stale.length, 'written line differs', 'written lines differ')} from ${freeze.stale.length === 1 ? 'its' : 'their'} transaction page` : ''
      ].filter(Boolean).join('; ')
      out.push(para(`${escape(what)}. Freeze writes ${n === 1 ? 'it' : 'them'} into the ledger's own text and keeps LINEUP, so the ledger still thaws. It needs this browser to be logged in as the owner of ${escape(result.site)}.`))
      out.push(`<p>${button('freeze', '', `Freeze ${plural(n, 'entry', 'entries')} into the ledger`)}${outSpan('freeze')}</p>`)
      out.push(`<pre style="font-size:12px;background:#f6f6f6;padding:6px;white-space:pre-wrap">${escape([...freeze.stale.map(s => s.entry.raw), ...freeze.pulled.map(e => e.raw)].join('\n'))}</pre>`)
    } else {
      out.push(para('Nothing to freeze: every pulled entry is already written in the ledger.'))
    }
  }

  out.push(heading('Send verification message', 'One message per counterparty ledger to the NOTIFY topic'))
  if (result.notify) {
    out.push(para(`Posts ${plural(result.counterparties.length, 'message', 'messages')} to ${escape(result.notify)}: the title names this ledger, the tags carry the result, the click link opens the counterparty ledger, and the body lists each entry as Confirmed or Verify.`))
    out.push(`<p>${button('send', '', 'Send verification message')}${outSpan('send')}</p>`)
  } else {
    out.push(para('This ledger has no <code>NOTIFY:</code> line, so there is no topic to post to. Add one, such as <code>NOTIFY: ntfy.sh/your-topic</code>, to send verification messages.'))
  }

  out.push(heading('Find missing ledgers', 'Candidates for every counterparty ledger that was unreachable or did not match, and entries with no transaction page'))
  if (!groups.length) out.push(para('Every counterparty ledger was reached and matched every entry, so there is no ledger to find.'))
  groups.forEach((g, gi) => {
    const what = g.reason === 'unreachable'
      ? `could not be reached at ${escape(g.ledger.href)}`
      : `was reached at ${escape(g.ledger.href)} but does not record ${plural(g.entries.length, 'entry', 'entries')} back`
    out.push(para(`<b>${escape(linkText(g.ledger.name))}</b> ${what}.`))
    if (g.candidates.length) {
      out.push(para(`Candidates among the ${plural(g.searched, 'site', 'sites')} searched, the neighbourhood and the sites this page links to:`))
      out.push(`<ul style="margin:0 0 6px">${g.candidates.map((c, ci) =>
        `<li>${externalAnchor(c.href, linkText(c.title))} on ${escape(c.site)} ${button('fix', ` data-timebank-group="${gi}" data-timebank-candidate="${ci}"`, 'Fix')}${outSpan(`fix-${gi}-${ci}`)}</li>`).join('')}</ul>`)
      out.push(para(`<span style="color:#555">Fix rewrites ${plural(g.entries.length, 'entry line', 'entry lines')} to name the chosen ledger by external link, saves the ledger and checks again. It needs this browser to be logged in as the owner of ${escape(result.site)}.</span>`))
    } else {
      out.push(para(`No page with this title or slug among the ${plural(g.searched, 'site', 'sites')} searched, the neighbourhood and the sites this page links to.`))
    }
  })
  const missing = missingPages(result)
  if (missing.length) {
    out.push(para(`<b>${plural(missing.length, 'entry has', 'entries have')} no transaction page.</b> A matched pair of lines needs no page to count, but a page records the work. Click a title to open it as a new page, then choose <i>create from ${escape(TEMPLATE_TITLE)}</i> — the wiki offers every template on this site.`))
    out.push(`<ul style="margin:0 0 6px">${missing.map(m =>
      `<li>${internalAnchor(m.title, context)} — ${resolveLike(m.entry.raw, context)} ${m.matched ? pill('ok', 'matched') : pill('fail', 'unmatched')}</li>`).join('')}</ul>`)
  }

  out.push(para('<span style="color:#888">Drawn in the browser by the timebank plugin from the ledger beside this page. Click the badge again, or reload this page, to re-check.</span>'))
  return out.join('\n')
}
