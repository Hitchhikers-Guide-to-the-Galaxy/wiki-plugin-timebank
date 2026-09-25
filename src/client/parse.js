// TimeBank parser — pure functions, no DOM, no wiki globals.
//
// item.text — newline-separated content, may include:
//   START: 1 September 2026               — start of period (optional)
//   END: 7 September 2026                 — end of period (optional)
//   NOTIFY: ntfy.sh/timebank-david        — ntfy topic for verification messages (optional)
//   WATCH: ledger.timebank.private.fish   — sites this ledger watches for incoming Time
//                                           Transaction pages that name it (awaiting reconcile)
//   Gardening for [[Alice Ledger]]: 2 hours — linked entry, hours I GAVE   (for | to)
//   Repairs from [[Alice Ledger]]: 1 hour   — linked entry, hours I RECEIVED (from | by)
//   Soup for [https://alice.wiki/view/alices-ledger Alice's Ledger]: 1 hour
//                                         — linked entry naming a ledger on ANOTHER site
//                                           by external link; a [[wikilink]] is same-site only
//   Meeting with [[David]]: 2 hours       — time entry (a link, but no direction word: unlinked)
//   [[Repairs for David, 3 September]] for [[Alice Ledger]]: 1 hour
//                                         — the label may itself be a link to the entry's
//                                           Time Transaction page ([[wikilink]] or [href Title])
//   2026-09-10 [[Childcare for David]] for [http://… David's Ledger]: 4 hours
//                                         — an ISO date first names the occasion: a page that
//                                           records recurring work holds one transaction item
//                                           per occasion, and the date picks the item (0.6.0)
//   LINEUP                                — pull entries from Time Transaction pages beside
//                                           the ledger and on its own site (thaw)
//   TOOL                                  — this item is the Ledger Verification Tool's report
//   OWNER: [[About Alice]]                — whose ledger this is: the owner's About page (0.6.0)
//   PERIODS | PERIODS: 10                 — a summary ledger: its period pages are the pages
//                                           titled "<this title> YYYY-MM"; shows the 10 most
//                                           recent transactions and the net balance (0.6.0)
//   INDEX                                 — this item is the Transactions Index (0.6.0)
//   BALANCE | BALANCE: [[Alice's Ledger]] — the owner's balance, on their About page (0.6.0)
//   Admin tasks                           — note entry (no time, shown in table)
//   Any prose sentence.                   — caption text (shown below table)

// --- Dates ---

export const MONTHS = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,
  september:8,october:9,november:10,december:11
}

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export const parseDate = str => {
  str = str.trim()
  let d
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    d = new Date(str + 'T12:00:00Z')
  } else {
    const parts = str.replace(',','').split(/\s+/)
    let day, month, year
    if (parts.length >= 2) {
      parts.forEach(p => {
        const n = parseInt(p)
        if (!isNaN(n) && n > 31) year = n
        else if (!isNaN(n) && n <= 31) day = n
        else if (MONTHS[p.toLowerCase()] !== undefined) month = MONTHS[p.toLowerCase()]
      })
      if (day && month !== undefined && year) {
        d = new Date(Date.UTC(year, month, day, 12, 0, 0))
      }
    }
  }
  return d && !isNaN(d) ? d.getTime() : null
}

export const formatDate = ms => new Date(ms).toLocaleDateString('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
})

export const formatShortDate = ms => new Date(ms).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric'
})

// "1 Sep 2026" — fixed English abbreviations, UTC, independent of the ICU build
// (en-GB in recent ICU writes "Sept"), so messages read the same everywhere.
export const formatDay = ms => {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// --- Slugs and labels ---

// The wiki's own rule (wiki-client lib/page.js asSlug).
export const asSlug = name => name
  .replace(/\s/g, '-')
  .replace(/[^A-Za-z0-9-]/g, '')
  .toLowerCase()

// Lowercase, whitespace collapsed, trailing punctuation stripped.
export const normLabel = label => String(label || '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/[\s.,;:!?]+$/, '')

// --- Line classification ---

export const COMMANDS = /^(?:(?:START|END|NOTIFY|WATCH|OWNER)\s*:|PERIODS(?:\s*:\s*\d+)?\s*$|BALANCE(?:\s*:\s*\[.*\])?\s*$|(?:LINEUP|TOOL|INDEX)\s*$)/i
// An ISO date at the start of an entry line: the day of the occasion.
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})\s+(.*)$/
const TIME_SUFFIX = /:\s*([\d.]+)\s*(hours?|hrs?|h|minutes?|mins?|m)\s*$/i
// A counterparty is a [[wikilink]] (a ledger on this page's own site) or an
// external link [http://site/view/slug Name] (a ledger on any site).
const LINKED = /^(.+?)\s+(for|to|from|by)\s+(?:\[\[([^\]]+)\]\]|\[((?:https?:)?\/\/[^\s\]]+)\s+([^\]]+)\])$/i

export const isCommand  = line => COMMANDS.test(line)
export const isEntry    = line => TIME_SUFFIX.test(line)
export const isNote     = line => !isCommand(line) && !isEntry(line) && /^[^.!?]*$/.test(line) && line.split(' ').length <= 6
export const isProse    = line => !isCommand(line) && !isEntry(line) && !isNote(line)

const lines = text => (text || '').split('\n').map(line => line.trim()).filter(line => line.length > 0)

// --- Parsing ---

export const extractDates = text => {
  const result = {}
  ;(text || '').split('\n').forEach(line => {
    const m = line.trim().match(/^(START|END)\s*:\s*(.+)$/i)
    if (m) {
      const ms = parseDate(m[2])
      if (ms) result[m[1].toLowerCase()] = ms
    }
  })
  return result
}

// --- Sites and ledger addresses ---

// A site is a host with an optional port, lowercased; default ports dropped.
export const normSite = host => String(host || '')
  .trim()
  .toLowerCase()
  .replace(/:(80|443)$/, '')

const isLocalHost = host => /(^|\.)localhost$/i.test(host)
const hostOnly = site => normSite(site).replace(/:\d+$/, '')

// Two site names for one ledger site. Exact after normalisation — except on a
// *.localhost dev farm, where the proxied portless name and the :port name
// reach the same wiki, so the port is ignored when one side leaves it out.
export const sameSite = (a, b) => {
  const x = normSite(a)
  const y = normSite(b)
  if (!x || !y) return false
  if (x === y) return true
  if (!isLocalHost(hostOnly(x)) || hostOnly(x) !== hostOnly(y)) return false
  return !/:\d+$/.test(x) || !/:\d+$/.test(y)
}

// http for localhost, *.localhost, *.local and any host:port; https otherwise.
export const schemeFor = site => {
  const host = String(site || '')
  if (/:\d+$/.test(host) || /(^|\.)localhost$/i.test(host) || /\.local$/i.test(host)) return 'http:'
  return 'https:'
}

// An external ledger address -> { site, slug, scheme } or null. Accepts
// https://site/slug, http://site:port/view/slug, //site/slug, a trailing
// slash, a .html or .json suffix, and the last page of a /view/a/view/b lineup.
export const parseLedgerUrl = href => {
  const m = String(href || '').trim().match(/^(https?:)?\/\/([^/\s?#]+)([^?#\s]*)/i)
  if (!m) return null
  const parts = m[3].split('/').filter(Boolean)
  let slug = parts.length ? parts[parts.length - 1] : ''
  try { slug = decodeURIComponent(slug) } catch { /* keep the raw segment */ }
  slug = slug.replace(/\.(json|html)$/i, '').toLowerCase()
  if (!slug || slug === 'view' || !/^[a-z0-9-]+$/.test(slug)) return null
  return { site: normSite(m[2]), slug, scheme: m[1] ? m[1].toLowerCase() : null }
}

// The address that opens a ledger in a wiki: scheme//site/view/slug.
export const ledgerUrl = ({ site, slug, scheme }) =>
  `${scheme || schemeFor(site)}//${site}/view/${slug}`

// A ledger's identity: site plus slug.
export const ledgerId = ({ site, slug }) => `${normSite(site)}/${slug}`

// NOTIFY: ntfy.sh/topic — https by default, an explicit http:// is honoured.
export const normaliseNotify = ref => {
  const s = String(ref || '').trim().replace(/\/+$/, '')
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s}`
}

// WATCH: a.site, https://b.site/view/x c.site:4242 -> ['a.site', 'b.site', 'c.site:4242']
export const parseWatch = value => String(value || '')
  .split(/[\s,]+/)
  .map(token => {
    const t = token.trim()
    if (!t) return null
    const m = t.match(/^(?:https?:)?\/\/([^/\s?#]+)/i)
    const host = normSite(m ? m[1] : t.split('/')[0])
    return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d+)?$/.test(host) ? host : null
  })
  .filter(Boolean)

// -> { notify: url|null, lineup: bool, tool: bool, watch: [site], owner: ref|null,
//      periods: { recent }|null, index: bool, balance: ref|true|null }
export const extractCommands = text => {
  let notify = null
  let lineup = false
  let tool = false
  let owner = null
  let periods = null
  let index = false
  let balance = null
  const watch = []
  lines(text).forEach(line => {
    const o = line.match(/^OWNER\s*:\s*(.+)$/i)
    if (o) owner = ledgerRefOf(o[1]) || owner
    const p = line.match(/^PERIODS(?:\s*:\s*(\d+))?\s*$/i)
    if (p) periods = { recent: p[1] ? Math.max(1, parseInt(p[1], 10)) : 10 }
    const b = line.match(/^BALANCE(?:\s*:\s*(\[.*\]))?\s*$/i)
    if (b) balance = (b[1] && ledgerRefOf(b[1])) || true
    if (/^INDEX$/i.test(line)) index = true
    const m = line.match(/^NOTIFY\s*:\s*(.+)$/i)
    if (m) notify = normaliseNotify(m[1])
    const w = line.match(/^WATCH\s*:\s*(.*)$/i)
    if (w) parseWatch(w[1]).forEach(site => { if (!watch.some(s => sameSite(s, site))) watch.push(site) })
    if (/^LINEUP$/i.test(line)) lineup = true
    if (/^TOOL$/i.test(line)) tool = true
  })
  return { notify, lineup, tool, watch, owner, periods, index, balance }
}

// A ledger named by a link token: [[Name]] is a ledger on `site` (the site the
// text is written on); [href Name] is a ledger anywhere. -> ref | null
export const ledgerRefOf = (token, site) => {
  const s = String(token || '').trim()
  let m = s.match(/^\[\[([^\]]+)\]\]$/)
  if (m) {
    const name = m[1].trim()
    return { name, slug: asSlug(name), site: site ? normSite(site) : undefined, external: false }
  }
  m = s.match(/^\[((?:https?:)?\/\/[^\s\]]+)\s+([^\]]+)\]$/i)
  if (!m) return null
  const ref = parseLedgerUrl(m[1])
  if (!ref) return null
  return { name: m[2].trim(), slug: ref.slug, site: ref.site, scheme: ref.scheme, href: m[1], external: true }
}

// An entry label that is exactly one link names the entry's transaction page:
// [[Title]] on the ledger's own site, [href Title] anywhere. -> { title, slug, site?, href?, external } | null
export const txnRefOf = label => {
  const ref = ledgerRefOf(label)
  if (!ref) return null
  const { name, ...rest } = ref
  if (!rest.external) delete rest.site
  return { title: name, ...rest }
}

// [[Name]] -> { name, slug }            (same site as the page it is written on)
// [href Name] -> { name, slug, site, scheme, href, external: true }
const counterpartyOf = m => {
  if (m[3] !== undefined) return { name: m[3].trim(), slug: asSlug(m[3].trim()) }
  const ref = parseLedgerUrl(m[4])
  if (!ref) return null
  return { name: m[5].trim(), slug: ref.slug, site: ref.site, scheme: ref.scheme, href: m[4], external: true }
}

// The counterparty token of an entry line, between the direction word and the time.
const COUNTERPARTY_TOKEN = /(\s(?:for|to|from|by)\s+)(\[\[[^\]]+\]\]|\[(?:https?:)?\/\/[^\s\]]+\s+[^\]]+\])(\s*:\s*[\d.]+\s*[a-z]+\s*)$/i

// Rewrite the given entry lines (each raw line once) so their counterparty is
// named by external link: link = { href, name }. Other lines are untouched.
export const rewriteEntries = (text, raws, link) => {
  const todo = [...raws]
  const name = String(link.name).replace(/[[\]]/g, '')
  return String(text || '').split('\n').map(line => {
    const i = todo.indexOf(line.trim())
    if (i < 0) return line
    const out = line.replace(COUNTERPARTY_TOKEN, (all, dir, token, time) => `${dir}[${link.href} ${name}]${time}`)
    if (out !== line) todo.splice(i, 1)
    return out
  }).join('\n')
}

// A day as an ISO date, "2026-09-10" (UTC).
export const isoDay = ms => new Date(ms).toISOString().slice(0, 10)

// Two instants on the same UTC day.
export const sameDay = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined &&
  Math.floor(a / 86400000) === Math.floor(b / 86400000)

export const parseEntries = text => lines(text)
  .filter(line => !isCommand(line) && !isProse(line))
  .map(line => {
    const dated = line.match(DATE_PREFIX)
    const date = dated ? parseDate(dated[1]) : null
    const body = dated && date !== null ? dated[2].trim() : line
    const match = body.match(TIME_SUFFIX)
    if (match) {
      const amount = parseFloat(match[1])
      const hours = match[2].toLowerCase().startsWith('m') ? amount / 60 : amount
      const label = body.replace(TIME_SUFFIX, '').trim()
      const linked = label.match(LINKED)
      const counterparty = linked ? counterpartyOf(linked) : null
      if (counterparty) {
        const dir = linked[2].toLowerCase()
        const txn = txnRefOf(linked[1].trim())
        return {
          label: txn ? txn.title : linked[1].trim(),
          time: hours,
          raw: line,
          linked: true,
          direction: dir === 'for' || dir === 'to' ? 'gave' : 'received',
          counterparty,
          txn,
          date
        }
      }
      return { label, time: hours, raw: line, linked: false, date }
    }
    return { label: body, time: null, raw: line, linked: false, date }
  })

export const extractCaption = text => lines(text)
  .filter(line => isProse(line))
  .join(' ')

// --- Formatting ---

export const formatCaption = (start, end) => {
  if (!end) return ''
  if (!start || start === end) return formatDate(end)
  return `${formatDate(start)} – ${formatDate(end)}`
}

export const totalHours = entries => entries.reduce((sum, e) => sum + (e.time || 0), 0)

export const formatHours = h => {
  if (h === 0) return ''
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  if (hrs === 0) return `${mins}m`
  if (mins === 0) return `${hrs}h`
  return `${hrs}h ${mins}m`
}

// --- Markup ---

export const escape = s => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const escapeAttr = s => escape(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Text through the wiki's link resolver with an escaping sanitiser, so
// [[links]] become internal links and everything else is inert text.
// `resolve` is wiki.resolveLinks in the browser; absent, we only escape.
// The sanitiser must pass the resolver's 〖n〗 markers — escape() does.
export const markup = (text, resolve) => {
  const s = text === null || text === undefined ? '' : String(text)
  if (typeof resolve === 'function') return resolve(s, escape)
  return escape(s)
}
