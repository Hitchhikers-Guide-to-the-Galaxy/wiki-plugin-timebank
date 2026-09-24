// Transaction item — browser layer. Renders the facts of a Time Transaction
// page as a card and exposes them to the lineup the way map and calendar
// items do: the item gets the class `transaction-source` and a
// `transactionData()` function on its element, and `$item.data('transaction')`.
// Ledgers with a LINEUP line to its right read them and show pulled entries.
//
// The code ships in the timebank bundle. wiki-server serves one item type per
// plugin package, so the tiny wiki-plugin-transaction package's client file
// imports /plugins/timebank/timebank.js and registers this object as
// window.plugins.transaction.

import { escape, escapeAttr, formatShortDate, formatHours, sameSite } from './parse.js'
import { parseTransaction } from './txn.js'

const STYLE_ID = 'transaction-plugin-style'
const CSS = `
.transaction-card { margin: 8px 0; padding: 8px 10px; border: 1px solid #cfd8e3; border-left: 4px solid #4a78b0; border-radius: 4px; background: #f7f9fc; font-family: sans-serif; font-size: 14px; }
.transaction-card .tx-head { display: flex; justify-content: space-between; font-weight: 600; }
.transaction-card .tx-parties { margin: 4px 0; }
.transaction-card .tx-meta { color: #666; font-size: 12px; }
.transaction-card .tx-note { margin-top: 4px; color: #444; font-style: italic; }
.transaction-card .tx-warn { color: #9b1c1c; font-size: 12px; }
`

const ensureStyle = () => {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

const markup = text => {
  const w = typeof window !== 'undefined' ? window.wiki : undefined
  return w && w.resolveLinks ? w.resolveLinks(String(text || ''), escape) : escape(text)
}

const pageInfo = $item => {
  const $page = $item.parents('.page')
  const key = $page.data('key')
  let po
  try { po = wiki.lineup.atKey(key) } catch { po = null }
  const remote = po && po.isRemote && po.isRemote()
  const site = remote ? po.getRemoteSite(location.host) : location.host
  const title = po && po.getTitle ? po.getTitle() : $page.find('h1').first().text().trim()
  const slug = po && po.getSlug ? po.getSlug() : String($page.attr('id') || '').split('_rev')[0]
  return { site, slug, title }
}

// A ledger named in the card: the same [[link]] / [href link] text the item
// holds, resolved synchronously here inside emit.
const ledgerMarkup = (ref, site) => {
  if (!ref) return '<span class="tx-warn">missing</span>'
  if (ref.external && !sameSite(ref.site, site)) return markup(`[${ref.href} ${ref.name}]`)
  return markup(`[[${ref.name}]]`)
}

const emit = ($item, item) => {
  ensureStyle()
  const info = pageInfo($item)
  const facts = parseTransaction(item.text || '', { ...info, itemId: item.id })
  const hours = facts.time ? formatHours(facts.time) : '?'
  const date = facts.date ? formatShortDate(facts.date) : 'no date'
  const source = facts.source ? ` · from ${escape(facts.source)}` : ''
  const warn = facts.valid ? '' : '<div class="tx-warn">Needs GIVER, RECEIVER and HOURS lines to count on a ledger.</div>'
  $item.addClass('transaction-source')
  $item.get(0).transactionData = () => [facts]
  $item.data('transaction', facts)
  $item.append(`
    <div class="transaction-card" title="${escapeAttr('Time Transaction — double-click to edit')}">
      <div class="tx-head"><span>${escape(facts.label || 'Time transaction')}</span><span>${escape(hours)}</span></div>
      <div class="tx-parties">${ledgerMarkup(facts.giver, info.site)} gave to ${ledgerMarkup(facts.receiver, info.site)}</div>
      <div class="tx-meta">${escape(date)}${source}</div>
      ${facts.note ? `<div class="tx-note">${markup(facts.note)}</div>` : ''}
      ${warn}
    </div>`)
  // Ledgers to the right with LINEUP may have drawn before this item: tell them.
  if (typeof document !== 'undefined') {
    setTimeout(() => document.dispatchEvent(new CustomEvent('timebank:transaction', { detail: { el: $item.get(0) } })), 0)
  }
}

const bind = ($item, item) => {
  $item.dblclick(() => wiki.textEditor($item, item))
}

export const transactionPlugin = { emit, bind }
