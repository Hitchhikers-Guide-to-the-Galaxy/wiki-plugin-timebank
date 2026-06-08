// TimeBank Plugin
// Displays a list of time entries as a ledger with a prose description caption.
//
// item.text — newline-separated content, may include:
//   START: 7 June 2026          — start of period (optional)
//   END: 14 June 2026           — end of period (optional)
//   Meeting with David: 2 hours — time entry (label: amount unit)
//   Code review: 3 hours        — time entry
//   Admin tasks                 — note entry (no time, shown in table)
//   Any prose sentence.         — caption text (shown below table)
//
// Prose lines (no ': N hours/mins' pattern, not START/END) are collected
// and displayed as a description caption below the table.
// AI could parse caption prose to extract additional entries in future.

// --- Date parsing ---

const MONTHS = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,
  september:8,october:9,november:10,december:11
}

const parseDate = str => {
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

const formatDate = ms => new Date(ms).toLocaleDateString('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
})

const formatShortDate = ms => new Date(ms).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric'
})

// --- Line classification ---

const isCommand  = line => /^(START|END)\s*:/i.test(line)
const isEntry    = line => /:\s*[\d.]+\s*(hours?|hrs?|h|minutes?|mins?|m)\s*$/i.test(line)
const isNote     = line => !isCommand(line) && !isEntry(line) && /^[^.!?]*$/.test(line) && line.split(' ').length <= 6
const isProse    = line => !isCommand(line) && !isEntry(line) && !isNote(line)

// --- Parsing ---

const extractDates = text => {
  const result = {}
  text.split('\n').forEach(line => {
    const m = line.trim().match(/^(START|END)\s*:\s*(.+)$/i)
    if (m) {
      const ms = parseDate(m[2])
      if (ms) result[m[1].toLowerCase()] = ms
    }
  })
  return result
}

const parseEntries = text => text
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.length > 0)
  .filter(line => !isCommand(line) && !isProse(line))
  .map(line => {
    const match = line.match(/:\s*([\d.]+)\s*(hours?|hrs?|h|minutes?|mins?|m)\s*$/i)
    if (match) {
      const amount = parseFloat(match[1])
      const hours = match[2].toLowerCase().startsWith('m') ? amount / 60 : amount
      return { label: line.replace(/:\s*[\d.]+\s*(hours?|hrs?|h|minutes?|mins?|m)\s*$/i, '').trim(), time: hours, raw: line }
    }
    return { label: line, time: null, raw: line }
  })

const extractCaption = text => text
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.length > 0 && isProse(line))
  .join(' ')

// --- Formatting ---

const totalHours = entries => entries.reduce((sum, e) => sum + (e.time || 0), 0)

const formatHours = h => {
  if (h === 0) return ''
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  if (hrs === 0) return `${mins}m`
  if (mins === 0) return `${hrs}h`
  return `${hrs}h ${mins}m`
}

// --- Plugin ---

const emit = ($item, item) => {
  // Parse START/END commands — clear stale values if absent
  const dates = extractDates(item.text || '')
  if (dates.start) item.start = dates.start; else delete item.start
  if (dates.end) item.end = dates.end; else delete item.end
  if (!item.end) item.end = Date.now()

  const entries = parseEntries(item.text || '')
  const total = totalHours(entries)
  const caption = extractCaption(item.text || '')

  const columnHeader = dates.end ? formatShortDate(item.end) : 'Entry'

  const rows = entries.map(e => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd">${e.raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;color:#666;white-space:nowrap">${e.time !== null ? formatHours(e.time) : ''}</td>
    </tr>`).join('')

  const totalRow = total > 0 ? `
    <tr style="font-weight:bold;background:#f0f0f0">
      <td style="padding:6px 8px">Total</td>
      <td style="padding:6px 8px;text-align:right">${formatHours(total)}</td>
    </tr>` : ''

  $item.append(`
    <div style="margin:8px 0;font-family:sans-serif;font-size:14px">
      <table style="width:100%;border-collapse:collapse;background:#fafafa;border:1px solid #ddd">
        <thead>
          <tr style="background:#e8e8e8">
            <th style="padding:6px 8px;text-align:left;font-weight:600">${columnHeader}</th>
            <th style="padding:6px 8px;text-align:right;font-weight:600">Time</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="2" style="padding:8px;color:#999;font-style:italic">No entries yet. Double-click to add.</td></tr>'}
        </tbody>
        ${total > 0 ? `<tfoot>${totalRow}</tfoot>` : ''}
      </table>
      ${caption ? `<div style="padding:8px;color:#555;font-style:italic;border-top:1px solid #ddd;background:#fafafa">${caption}</div>` : ''}
    </div>`)
}

const bind = ($item, item) => {
  return $item.dblclick(() => {
    if (!/^END\s*:/im.test(item.text || '')) item.end = Date.now()
    return wiki.textEditor($item, item)
  })
}

if (typeof window !== 'undefined') {
  window.plugins.timebank = { emit, bind }
}

export const timebank = typeof window == 'undefined'
  ? { parseEntries, extractDates, extractCaption, parseDate, totalHours, formatHours, formatDate, formatShortDate }
  : undefined
