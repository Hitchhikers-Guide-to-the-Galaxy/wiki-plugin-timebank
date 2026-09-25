// Review and board — the weekly review's approval and the room's board (0.7.0).
// Pure functions, no DOM, no wiki globals.
//
// REVIEW mode — on a weekly report, beside the model item that freezes the
// Review tab of the Review Model for that week:
//
//   REVIEW: 2026-W40
//   APPROVED: 2026-10-05 by David Bovill     (written once, by Approve)
//   Alice: 3 hours
//   Bob: 2.5 hours
//
// BOARD mode — on the Review Board: draws hours per member, planned against
// actual per week and the shares from the model items on its own page, so the
// room needs no network and no workbook.
//
// The grammar matches tools/review_model.py (approval_text, parse_review).

const WEEK = /^REVIEW\s*:\s*(\d{4}-W\d{2})\s*$/i
const APPROVED = /^APPROVED\s*:\s*(\d{4}-\d{2}-\d{2})(?:\s+by\s+(.+))?$/i
const HOURS = /^([^:]+?)\s*:\s*([\d.]+)\s*(?:hours?|h)\s*$/i

export const parseReview = text => {
  const out = { week: null, approved: null, hours: [] }
  String(text || '').split('\n').forEach(raw => {
    const line = raw.trim()
    let m = WEEK.exec(line)
    if (m) { out.week = m[1].toUpperCase(); return }
    m = APPROVED.exec(line)
    if (m) { out.approved = { on: m[1], by: (m[2] || '').trim() || 'the site owner' }; return }
    m = HOURS.exec(line)
    if (m && out.week) out.hours.push([m[1].trim(), parseFloat(m[2])])
  })
  return out
}

const round = h => Math.round(h * 100) / 100
export const fmtHours = h => (round(h) === 1 ? '1 hour' : `${round(h)} hours`)

export const approvalText = (week, on, by, hours) => [
  `REVIEW: ${week}`,
  `APPROVED: ${on} by ${by}`,
  ...hours.map(([m, h]) => `${m}: ${fmtHours(h)}`),
  "The meeting approved these hours; the report tool burns them into the Review Model's Approved sheet once."
].join('\n')

// --- a model item's frozen table, read from its text ---------------------------

const cells = line => line.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))

export const modelOf = text => {
  const lines = String(text || '').split('\n')
  const out = { sheet: null, range: null, caption: null, columns: [], rows: [] }
  const table = []
  for (const raw of lines) {
    const line = raw.trim()
    let m
    if ((m = /^SHEET\s+(.+)$/.exec(line))) out.sheet = m[1].trim()
    else if ((m = /^RANGE\s+(.+)$/.exec(line))) out.range = m[1].trim()
    else if ((m = /^CAPTION\s+(.+)$/.exec(line))) out.caption = m[1].trim()
    else if (line.startsWith('|') && !/^\|[\s:|-]+\|$/.test(line)) table.push(cells(line))
  }
  out.columns = table.shift() || []
  out.rows = table
  return out
}

const num = s => {
  const n = parseFloat(String(s ?? '').replace(/[,%\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

const colIndex = (columns, ...names) => {
  const low = columns.map(c => c.toLowerCase())
  for (const n of names) {
    const i = low.indexOf(n.toLowerCase())
    if (i >= 0) return i
  }
  return -1
}

// Review rows of one week -> [{ member, planned, actual, variance, approved }]
export const reviewRows = model => {
  const c = model.columns
  const iw = colIndex(c, 'Week')
  const im = colIndex(c, 'Member')
  const ip = colIndex(c, 'Planned')
  const ia = colIndex(c, 'Actual')
  const iv = colIndex(c, 'Variance')
  const ix = colIndex(c, 'Approved', 'Approved hours')
  if (im < 0 || ia < 0) return []
  return model.rows.map(r => ({
    week: iw >= 0 ? r[iw] : null,
    member: r[im],
    planned: ip >= 0 ? num(r[ip]) : null,
    actual: num(r[ia]) ?? 0,
    variance: iv >= 0 ? num(r[iv]) : null,
    approved: ix >= 0 ? num(r[ix]) : null
  })).filter(r => r.member)
}

// What Approve writes: the Approved column where the meeting filled it in the
// sheet, else the hours given.
export const hoursToApprove = rows => rows.map(r => [r.member, r.approved ?? r.actual])

// Board figures from the model items on the board page.
export const boardData = models => {
  const review = models.find(m => m.sheet === 'Review' && colIndex(m.columns, 'Week') >= 0)
  const shares = models.find(m => m.sheet === 'Equity' || colIndex(m.columns, 'Share') >= 0)
  const rows = review ? reviewRows(review) : []
  const weeks = []
  for (const r of rows) {
    let w = weeks.find(x => x.week === r.week)
    if (!w) weeks.push((w = { week: r.week, members: [] }))
    w.members.push({ member: r.member, planned: r.planned ?? 0, actual: r.actual ?? 0 })
  }
  const perMember = []
  for (const r of rows) {
    let p = perMember.find(x => x.member === r.member)
    if (!p) perMember.push((p = { member: r.member, planned: 0, actual: 0 }))
    p.planned += r.planned ?? 0
    p.actual += r.actual ?? 0
  }
  let share = []
  if (shares) {
    const im = colIndex(shares.columns, 'Member')
    const is = colIndex(shares.columns, 'Share')
    share = shares.rows.filter(r => r[im] && r[im] !== 'Total').map(r => ({ member: r[im], share: num(r[is]) ?? 0 }))
  }
  return { weeks, perMember, share }
}

// --- drawing: plain SVG, no library, so the board draws offline ----------------

export const PALETTE = ['#2f6db3', '#d9822b', '#3a9a5b', '#b8466a', '#7a5cc2', '#8a7a2e']
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const barsSvg = (title, bars, { unit = 'h', width = 520 } = {}) => {
  const rowH = 30
  const left = 90
  const h = 34 + bars.length * rowH
  const max = Math.max(1e-9, ...bars.map(b => b.value))
  const span = width - left - 70
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="100%" font-family="sans-serif" font-size="13"><title>${esc(title)}</title>`,
    `<text x="0" y="16" font-weight="600">${esc(title)}</text>`]
  bars.forEach((b, i) => {
    const y = 28 + i * rowH
    const w = Math.max(0, (b.value / max) * span)
    const label = unit === '%' ? `${round(b.value)}%` : `${round(b.value)}${unit}`
    out.push(`<text x="${left - 8}" y="${y + 15}" text-anchor="end">${esc(b.label)}</text>`,
      `<rect x="${left}" y="${y + 3}" width="${w.toFixed(1)}" height="18" rx="3" fill="${b.color || PALETTE[i % PALETTE.length]}"/>`,
      `<text x="${(left + w + 6).toFixed(1)}" y="${y + 16}" fill="#444">${esc(label)}</text>`)
  })
  out.push('</svg>')
  return out.join('')
}

// Planned (pale) against actual (solid) per member, grouped by week.
export const plannedActualSvg = (title, weeks, members, { width = 720 } = {}) => {
  const groupW = (width - 50) / Math.max(1, weeks.length)
  const barW = Math.max(4, Math.min(16, (groupW - 16) / Math.max(1, members.length * 2)))
  const h = 250
  const top = 40
  const base = h - 40
  const max = Math.max(1e-9, ...weeks.flatMap(w => w.members.flatMap(m => [m.planned, m.actual])))
  const y = v => base - (v / max) * (base - top)
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="100%" font-family="sans-serif" font-size="12"><title>${esc(title)}</title>`,
    `<text x="0" y="16" font-weight="600" font-size="13">${esc(title)}</text>`,
    `<line x1="40" y1="${base}" x2="${width}" y2="${base}" stroke="#999"/>`]
  members.forEach((m, k) => {
    out.push(`<rect x="${40 + k * 110}" y="22" width="10" height="10" fill="${PALETTE[k % PALETTE.length]}"/><text x="${54 + k * 110}" y="31">${esc(m)}</text>`)
  })
  out.push(`<rect x="${40 + members.length * 110}" y="22" width="10" height="10" fill="#bbb" opacity="0.6"/><text x="${54 + members.length * 110}" y="31">planned</text>`)
  weeks.forEach((w, i) => {
    const x0 = 50 + i * groupW
    members.forEach((m, k) => {
      const r = w.members.find(x => x.member === m) || { planned: 0, actual: 0 }
      const x = x0 + k * barW * 2
      const color = PALETTE[k % PALETTE.length]
      out.push(`<rect x="${x.toFixed(1)}" y="${y(r.planned).toFixed(1)}" width="${barW.toFixed(1)}" height="${(base - y(r.planned)).toFixed(1)}" fill="${color}" opacity="0.3"><title>${esc(`${m}, ${w.week}: ${round(r.planned)}h planned`)}</title></rect>`,
        `<rect x="${(x + barW * 0.9).toFixed(1)}" y="${y(r.actual).toFixed(1)}" width="${barW.toFixed(1)}" height="${(base - y(r.actual)).toFixed(1)}" fill="${color}"><title>${esc(`${m}, ${w.week}: ${round(r.actual)}h given`)}</title></rect>`)
    })
    out.push(`<text x="${(x0 + (members.length * barW * 2) / 2).toFixed(1)}" y="${base + 16}" text-anchor="middle">${esc(String(w.week).replace(/^\d{4}-/, ''))}</text>`)
  })
  out.push(`<text x="36" y="${top + 4}" text-anchor="end" fill="#666">${round(max)}h</text><text x="36" y="${base}" text-anchor="end" fill="#666">0</text>`)
  out.push('</svg>')
  return out.join('')
}
