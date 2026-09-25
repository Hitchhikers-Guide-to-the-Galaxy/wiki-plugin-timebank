// HTML for the 0.6.0 modes — the summary ledger (PERIODS), the Transactions
// Index (INDEX) and the balance beside the owner (BALANCE). Pure: drawn after
// emit returns, so links go through links.js with the page's own context.

import { escape, formatHours, formatDay } from './parse.js'
import { internalAnchor } from './links.js'
import { signedHours, partyName, INDEX_TITLE, stateCounts } from './periods.js'
import { pill } from './tool.js'

const TH = 'style="text-align:left;padding:4px 6px;border-bottom:1px solid #ccc;font-weight:600"'
const THR = 'style="text-align:right;padding:4px 6px;border-bottom:1px solid #ccc;font-weight:600"'
const TD = 'style="padding:4px 6px;border-bottom:1px solid #eee;vertical-align:top"'
const TDR = 'style="padding:4px 6px;border-bottom:1px solid #eee;vertical-align:top;text-align:right;white-space:nowrap"'
const table = (head, rows, right = []) => `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:4px 0 8px">
<thead><tr>${head.map((h, i) => `<th ${right.includes(i) ? THR : TH}>${escape(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td ${right.includes(i) ? TDR : TD}>${c}</td>`).join('')}</tr>`).join('\n')}</tbody></table>`

const hours = h => escape(formatHours(h) || '0h')
const net = h => escape(signedHours(h, formatHours))
const para = html => `<p style="margin:6px 0">${html}</p>`
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export const STATUS_PILL = {
  ok: ['ok', 'Verified'],
  partial: ['partial', 'Partly verified'],
  fail: ['fail', 'Not verified'],
  none: ['pending', 'No linked entries'],
  pending: ['pending', 'Verifying…']
}

const statusPill = s => { const [c, t] = STATUS_PILL[s] || ['pending', s || '…']; return pill(c, t) }

// A page on `site`, opened from a page whose search path is `context`.
const pageLink = (title, site, context) => internalAnchor(title, context, site)

// The counterparty and page of an entry, as links.
const entryPage = (e, site, context) => e.txn
  ? pageLink(e.txn.title || e.txn.slug, e.txn.external ? e.txn.site : site, context)
  : escape(e.label)
const entryWho = e => escape(partyName(e.counterparty))

// The summary ledger: periods, totals, the most recent transactions.
//   model = summariseLedger(...) + { title, site, owner: ref|null, recentCount }
export const renderSummary = (model, context = []) => {
  const { site } = model
  const out = []
  const owner = model.owner
    ? `${escape(model.ownerName || model.owner.name)} — ${pageLink(model.owner.name, site, context)}`
    : '<span style="color:#9b1c1c">no OWNER: line — add <code>OWNER: [[About Name]]</code></span>'
  out.push(para(`<b>Owner:</b> ${owner}. <b>Balance:</b> ${hours(model.given)} given, ${hours(model.received)} received, <b>net ${net(model.net)}</b> over ${plural(model.periods.length, 'period', 'periods')} (${plural(model.count, 'logged entry', 'logged entries')}).`))
  if (!model.periods.length) {
    out.push(para(`No period pages yet. A period page is titled <i>${escape(model.title)} YYYY-MM</i> — for example ${pageLink(`${model.title} ${new Date().toISOString().slice(0, 7)}`, site, context)} — and holds a ledger with its own START and END.`))
    return out.join('\n')
  }
  out.push(table(['Period', 'Badge', 'Entries', 'Given', 'Received', 'Net'], [
    ...model.periods.slice().reverse().map(p => [
      pageLink(p.title, site, context),
      statusPill(p.status),
      String(p.count), hours(p.given), hours(p.received), net(p.net)
    ]),
    ['<b>All periods</b>', statusPill(model.status), `<b>${model.count}</b>`, `<b>${hours(model.given)}</b>`, `<b>${hours(model.received)}</b>`, `<b>${net(model.net)}</b>`]
  ], [2, 3, 4, 5]))
  out.push(`<p style="margin:10px 0 2px;font-weight:600">Most recent ${plural(model.recent.length, 'transaction', 'transactions')}</p>`)
  out.push(table(['Date', 'Transaction', 'With', 'Gave', 'Received', 'Period'], model.recent.map(e => [
    escape(e.date !== null && e.date !== undefined ? formatDay(e.date) : '—'),
    entryPage(e, site, context),
    entryWho(e),
    e.direction === 'gave' ? hours(e.time) : '',
    e.direction === 'received' ? hours(e.time) : '',
    pageLink(e.period.title, site, context)
  ]), [3, 4]))
  out.push(para(`<span style="color:#888">Logged hours: lines written in the period ledgers. Hours pulled or awaiting reconcile count once they are frozen or reconciled. Every transaction page on this site: the ${pageLink(INDEX_TITLE, site, context)}.</span>`))
  return out.join('\n')
}

// The balance beside the owner, on their About page.
//   model = summariseLedger(...) + { title, slug, site, ownerName }
export const renderBalance = (model, context = []) => {
  const who = model.ownerName ? escape(model.ownerName) : 'This owner'
  const ledger = pageLink(model.title, model.site, context)
  return [
    `<div style="display:flex;gap:18px;flex-wrap:wrap;margin:8px 0">
      <div><div style="font-size:12px;color:#666">Given</div><div style="font-size:22px;font-weight:600">${hours(model.given)}</div></div>
      <div><div style="font-size:12px;color:#666">Received</div><div style="font-size:22px;font-weight:600">${hours(model.received)}</div></div>
      <div><div style="font-size:12px;color:#666">Net balance</div><div style="font-size:22px;font-weight:600;color:${model.net < 0 ? '#9b1c1c' : '#1e6b1e'}">${net(model.net)}</div></div>
    </div>`,
    para(`${who}'s timebank balance, read from ${ledger}: ${plural(model.count, 'logged entry', 'logged entries')} in ${plural(model.periods.length, 'period ledger', 'period ledgers')}${model.periods.length ? `, ${escape(model.periods[0].month)} to ${escape(model.periods[model.periods.length - 1].month)}` : ''}. Every transaction page on this site, and whether a period ledger logs it: the ${pageLink(INDEX_TITLE, model.site, context)}.`)
  ].join('\n')
}

export const INDEX_PILL = { logged: 'ok', awaiting: 'partial', orphan: 'fail' }

// The Transactions Index for `site`.
//   rows: classifyOccasions() · unknown: [ledger id] of parties whose ledger
//   could not be read · pages: how many transaction pages · skipped: pages
//   linking Time Transaction with no transaction item
export const renderIndex = ({ site, rows, unknown = [], pages = 0, skipped = [], of = null, remote = false }, context = []) => {
  const out = []
  const counts = stateCounts(rows)
  const where = of ? `${escape(of)} on ${escape(site)}` : escape(site)
  out.push(para(`${pill('ok', `${counts.logged} logged`)} ${pill('partial', `${counts.awaiting} awaiting`)} ${pill('fail', `${counts.orphan} orphan`)} — ${plural(rows.length, 'occasion', 'occasions')} on ${plural(pages, 'Time Transaction page', 'Time Transaction pages')} of ${where}, from its sitemap (pages linking ${pageLink('Time Transaction', site, context)}, less the template, the topic page and ledgers).`))
  const isUnknown = ref => ref && unknown.some(id => id === `${ref.site}/${ref.slug}`)
  const party = ref => {
    if (!ref) return '<span style="color:#9b1c1c">missing</span>'
    const name = escape(partyName(ref))
    return isUnknown(ref) ? `${name} ${pill('fail', 'unknown party')}` : name
  }
  if (rows.length) {
    out.push(table(['Date', 'Transaction page', 'Parties', 'Hours', 'State'], rows.map((r, i) => {
      const f = r.facts
      const occ = f.occasion && f.occasion.of > 1 ? ` <span style="color:#888">(${f.occasion.n} of ${f.occasion.of})</span>` : ''
      return [
        escape(f.date !== null && f.date !== undefined ? formatDay(f.date) : '—'),
        pageLink(f.page.title || f.page.slug, site, context) + occ,
        `${party(f.giver)} → ${party(f.receiver)}`,
        hours(f.time || 0),
        `${pill(INDEX_PILL[r.state], r.state)}<span data-timebank-row="${i}"></span><div style="font-size:11px;color:#666">${escape(r.reason)}</div>`
      ]
    }), [3]))
  } else {
    out.push(para('No Time Transaction pages on this site yet.'))
  }
  if (unknown.length) out.push(para(`<b>Unknown party:</b> ${plural(unknown.length, 'ledger', 'ledgers')} named on these pages could not be read — ${unknown.map(escape).join(', ')}. A transaction with a party who has no ledger cannot be verified by them.`))
  if (skipped.length) out.push(para(`<span style="color:#888">Also linking Time Transaction, with no transaction item: ${skipped.map(p => pageLink(p.title || p.slug, site, context)).join(', ')}.</span>`))
  const orphans = rows.filter(r => r.state === 'orphan')
  const pagesOf = list => [...new Set(list.map(r => r.facts.page.slug))].length
  out.push(`<p style="margin:8px 0">
    <button data-timebank-action="lineup" data-timebank-state="">Open all ${plural(pagesOf(rows), 'page', 'pages')} as lineup</button>
    ${orphans.length ? `<button data-timebank-action="lineup" data-timebank-state="orphan">Open the ${plural(pagesOf(orphans), 'orphan page', 'orphan pages')}</button>` : ''}
    ${counts.awaiting ? `<button data-timebank-action="lineup" data-timebank-state="awaiting">Open the ${plural(pagesOf(rows.filter(r => r.state === 'awaiting')), 'awaiting page', 'awaiting pages')}</button>` : ''}
    <span data-timebank-out="lineup" style="margin-left:8px;color:#555"></span></p>`)
  if (orphans.length) {
    out.push(para(`<b>Log the orphans</b> writes each orphan's line into the period ledger that holds its date, or into a new period page when none does, and checks again. ${remote ? `This index shows ${escape(site)} from another site: open it on ${escape(site)} to log.` : `It needs this browser to be logged in as the owner of ${escape(site)}.`}`))
    out.push(`<p><button data-timebank-action="log-orphans">Log the ${plural(orphans.length, 'orphan', 'orphans')}</button><span data-timebank-out="log-orphans" style="margin-left:8px;color:#555"></span></p>`)
  }
  out.push(para('<span style="color:#888">Logged: a period ledger has its line. Awaiting: the period ledger holding its date pulls it (LINEUP) — Freeze on the Ledger Verification Tool logs it. Orphan: no period ledger logs it or pulls it. Drawn in the browser by the timebank plugin from the sitemap of the site of the page to the left.</span>'))
  return out.join('\n')
}

