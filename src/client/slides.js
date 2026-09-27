// Slides — the Review Board as a deck of 16:9 slides (0.9.0).
// Pure functions, no DOM, no wiki globals: the board draws them in the page,
// and tools/deck-slides.mjs draws the same SVG for the report tool's --deck,
// whose slide pages Wiki Deck compiles into a reveal.js deck.
//
// Every slide is drawn into one 1280 by 720 frame — Wiki Deck's WIDTH and
// HEIGHT — with preserveAspectRatio meet, so it scales as a whole and nothing
// depends on the width of the screen: a title band, the body, a footer.
// Fonts are fixed for that frame: titles 44, labels 26, values 24.

import { PALETTE, boardData, modelOf } from './review.js'

export const SLIDE_W = 1280
export const SLIDE_H = 720
export const FONT = { title: 44, label: 26, value: 24, footer: 20, headline: 64 }
export const BAND = { h: 116, fill: '#20364f', fg: '#ffffff', sub: '#c9d6e4' }
export const FOOT = { y: 668, rule: '#d6dbe1', fg: '#5f6b7a' }
export const BODY = { top: 150, bottom: 640, left: 60, right: 1220 }
export const MAX_ROWS = 8

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r2 = h => Math.round(h * 100) / 100
const hrs = h => (r2(h) === 1 ? '1 hour' : `${r2(h)} hours`)
const short = h => `${r2(h)}h`
const weekLabel = w => String(w || '').replace(/^\d{4}-/, '')

// Names through the fish masks (--masks on the report tool): exact name first,
// then the first word, so "David Bovill" wears David's mask.
export const masker = (map = null) => name => {
  if (!map || name == null) return name
  const n = String(name)
  if (Object.prototype.hasOwnProperty.call(map, n)) return map[n]
  const first = n.split(/\s+/)[0]
  return Object.prototype.hasOwnProperty.call(map, first) ? map[first] : n
}

// ISO week -> its Monday and Sunday (UTC dates).
export const weekBounds = week => {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(week || ''))
  if (!m) return null
  const jan4 = new Date(Date.UTC(+m[1], 0, 4))
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 864e5 + (+m[2] - 1) * 7 * 864e5)
  return [monday, new Date(monday.getTime() + 6 * 864e5)]
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const day = d => `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
export const weekSpan = week => {
  const b = weekBounds(week)
  return b ? `${day(b[0])} to ${day(b[1])} ${b[1].getUTCFullYear()}` : ''
}

// --- the frame -------------------------------------------------------------------

export const frame = ({ title, subtitle = '', footer = '', counter = '', body = '' }) => [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}" width="${SLIDE_W}" height="${SLIDE_H}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;height:auto" font-family="Helvetica, Arial, sans-serif">`,
  `<title>${esc(title)}</title>`,
  `<rect x="0" y="0" width="${SLIDE_W}" height="${SLIDE_H}" fill="#ffffff"/>`,
  `<rect x="0" y="0" width="${SLIDE_W}" height="${BAND.h}" fill="${BAND.fill}"/>`,
  `<text x="${BODY.left}" y="74" font-size="${FONT.title}" font-weight="600" fill="${BAND.fg}">${esc(title)}</text>`,
  subtitle ? `<text x="${BODY.right}" y="72" font-size="${FONT.value}" text-anchor="end" fill="${BAND.sub}">${esc(subtitle)}</text>` : '',
  body,
  `<line x1="${BODY.left}" y1="${FOOT.y - 32}" x2="${BODY.right}" y2="${FOOT.y - 32}" stroke="${FOOT.rule}" stroke-width="2"/>`,
  `<text x="${BODY.left}" y="${FOOT.y + 12}" font-size="${FONT.footer}" fill="${FOOT.fg}">${esc(footer)}</text>`,
  counter ? `<text x="${BODY.right}" y="${FOOT.y + 12}" font-size="${FONT.footer}" text-anchor="end" fill="${FOOT.fg}">${esc(counter)}</text>` : '',
  '</svg>'
].filter(Boolean).join('')

const note = (text, y = BODY.top + 200) =>
  `<text x="${SLIDE_W / 2}" y="${y}" font-size="${FONT.label}" text-anchor="middle" fill="#5f6b7a">${esc(text)}</text>`

// --- bodies ------------------------------------------------------------------------

// Horizontal bars, one row per member (at most MAX_ROWS drawn).
export const barsBody = (bars, { unit = 'h' } = {}) => {
  if (!bars.length) return note('No figures for this slide yet.')
  const shown = bars.slice(0, MAX_ROWS)
  const labelX = 340
  const x0 = 360
  const span = BODY.right - x0 - 130
  const room = BODY.bottom - BODY.top - 20
  const rowH = Math.min(90, room / shown.length)
  const barH = Math.min(46, rowH * 0.62)
  const max = Math.max(1e-9, ...shown.map(b => b.value))
  const top = BODY.top + 10 + (room - rowH * shown.length) / 2
  const out = []
  shown.forEach((b, i) => {
    const cy = top + i * rowH + rowH / 2
    const w = Math.max(0, (b.value / max) * span)
    const label = unit === '%' ? `${r2(b.value)}%` : short(b.value)
    out.push(`<text x="${labelX}" y="${(cy + 9).toFixed(1)}" font-size="${FONT.label}" text-anchor="end" fill="#1f2933">${esc(b.label)}</text>`,
      `<rect x="${x0}" y="${(cy - barH / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${barH.toFixed(1)}" rx="6" fill="${b.color || PALETTE[i % PALETTE.length]}"/>`,
      `<text x="${(x0 + w + 14).toFixed(1)}" y="${(cy + 8).toFixed(1)}" font-size="${FONT.value}" fill="#1f2933">${esc(label)}</text>`)
  })
  if (bars.length > shown.length) out.push(`<text x="${x0}" y="${BODY.bottom}" font-size="${FONT.value}" fill="#5f6b7a">and ${bars.length - shown.length} more</text>`)
  return out.join('')
}

// Planned (pale) against actual (solid) per member, grouped by week (the last 8 weeks).
export const plannedActualBody = (weeks, members, colour) => {
  if (!weeks.length || !members.length) return note('No planned weeks yet.')
  const ws = weeks.slice(-8)
  const out = []
  // legend
  let lx = BODY.left + 80
  members.slice(0, MAX_ROWS).forEach(m => {
    out.push(`<rect x="${lx}" y="${BODY.top}" width="24" height="24" rx="4" fill="${colour(m)}"/>`,
      `<text x="${lx + 34}" y="${BODY.top + 21}" font-size="${FONT.value}" fill="#1f2933">${esc(m)}</text>`)
    lx += 34 + 14 * String(m).length + 40
  })
  out.push(`<rect x="${lx}" y="${BODY.top}" width="24" height="24" rx="4" fill="#8894a3" opacity="0.35"/>`,
    `<text x="${lx + 34}" y="${BODY.top + 21}" font-size="${FONT.value}" fill="#5f6b7a">planned (pale)</text>`)
  const plotTop = BODY.top + 70
  const base = BODY.bottom - 50
  const x0 = BODY.left + 80
  const width = BODY.right - x0
  const max = Math.max(1e-9, ...ws.flatMap(w => w.members.flatMap(m => [m.planned, m.actual])))
  const y = v => base - (v / max) * (base - plotTop)
  out.push(`<line x1="${x0}" y1="${base}" x2="${BODY.right}" y2="${base}" stroke="#8894a3" stroke-width="2"/>`,
    `<line x1="${x0}" y1="${plotTop}" x2="${BODY.right}" y2="${plotTop}" stroke="#e3e7ec" stroke-width="1"/>`,
    `<text x="${x0 - 12}" y="${plotTop + 8}" font-size="${FONT.value}" text-anchor="end" fill="#5f6b7a">${esc(short(max))}</text>`,
    `<text x="${x0 - 12}" y="${base + 8}" font-size="${FONT.value}" text-anchor="end" fill="#5f6b7a">0</text>`)
  const groupW = width / ws.length
  const n = Math.max(1, members.length)
  const barW = Math.max(6, Math.min(34, (groupW * 0.8) / (n * 1.9)))
  ws.forEach((w, i) => {
    const gx = x0 + i * groupW + (groupW - n * barW * 1.9) / 2
    members.forEach((m, k) => {
      const r = w.members.find(x => x.member === m) || { planned: 0, actual: 0 }
      const x = gx + k * barW * 1.9
      out.push(`<rect x="${x.toFixed(1)}" y="${y(r.planned).toFixed(1)}" width="${barW.toFixed(1)}" height="${(base - y(r.planned)).toFixed(1)}" fill="${colour(m)}" opacity="0.3"><title>${esc(`${m}, ${w.week}: ${short(r.planned)} planned`)}</title></rect>`,
        `<rect x="${(x + barW * 0.9).toFixed(1)}" y="${y(r.actual).toFixed(1)}" width="${barW.toFixed(1)}" height="${(base - y(r.actual)).toFixed(1)}" fill="${colour(m)}"><title>${esc(`${m}, ${w.week}: ${short(r.actual)} given`)}</title></rect>`)
    })
    out.push(`<text x="${(x0 + i * groupW + groupW / 2).toFixed(1)}" y="${base + 38}" font-size="${FONT.label}" text-anchor="middle" fill="#1f2933">${esc(weekLabel(w.week))}</text>`)
  })
  return out.join('')
}

// Per member: given, received, net, awaiting — one row each.
export const ledgerBody = rows => {
  if (!rows.length) return note('No ledger figures for this week yet.')
  const shown = rows.slice(0, MAX_ROWS)
  const cols = [['Member', BODY.left + 20, 'start'], ['Given', 640, 'end'], ['Received', 820, 'end'], ['Net', 990, 'end'], ['Awaiting', BODY.right - 20, 'end']]
  const top = BODY.top + 20
  const rowH = Math.min(62, (BODY.bottom - top - 60) / shown.length)
  const out = [`<rect x="${BODY.left}" y="${top}" width="${BODY.right - BODY.left}" height="52" fill="#eef2f6"/>`]
  cols.forEach(([h, x, a]) => out.push(`<text x="${x}" y="${top + 36}" font-size="${FONT.label}" font-weight="600" text-anchor="${a}" fill="#1f2933">${h}</text>`))
  shown.forEach((r, i) => {
    const y = top + 52 + i * rowH
    const cy = y + rowH / 2 + 8
    const net = r.net ?? ((r.given || 0) - (r.received || 0))
    const vals = [r.member, short(r.given || 0), short(r.received || 0), `${net > 0 ? '+' : ''}${short(net)}`, String(r.awaiting ?? 0)]
    out.push(`<line x1="${BODY.left}" y1="${(y + rowH).toFixed(1)}" x2="${BODY.right}" y2="${(y + rowH).toFixed(1)}" stroke="#e3e7ec"/>`)
    if (r.color) out.push(`<rect x="${BODY.left}" y="${(y + 10).toFixed(1)}" width="8" height="${(rowH - 20).toFixed(1)}" fill="${r.color}"/>`)
    vals.forEach((v, k) => out.push(`<text x="${cols[k][1]}" y="${cy.toFixed(1)}" font-size="${k ? FONT.value : FONT.label}" text-anchor="${cols[k][2]}" fill="${k === 4 && +v > 0 ? '#9b5a00' : '#1f2933'}">${esc(v)}</text>`))
  })
  return out.join('')
}

export const titleBody = ({ week, site, attendance = [], mood = [] }) => {
  const out = []
  if (week) out.push(`<text x="${BODY.left}" y="${BODY.top + 70}" font-size="${FONT.title}" font-weight="700" fill="#20364f">${esc(weekSpan(week))}</text>`)
  if (site) out.push(`<text x="${BODY.left}" y="${BODY.top + 122}" font-size="${FONT.value}" fill="#5f6b7a">${esc(site)}</text>`)
  const inRoom = attendance.length ? `In the room last time: ${attendance.join(', ')}` : 'Attendance: taken from the room'
  out.push(`<text x="${BODY.left}" y="${BODY.top + 200}" font-size="${FONT.label}" fill="#1f2933">${esc(inRoom)}</text>`)
  if (mood.length) out.push(`<text x="${BODY.left}" y="${BODY.top + 252}" font-size="${FONT.label}" font-weight="600" fill="#1f2933">Mood lines</text>`)
  mood.slice(0, 5).forEach(([who, line], i) => {
    out.push(`<text x="${BODY.left}" y="${BODY.top + 294 + i * 38}" font-size="${FONT.value}" fill="#1f2933"><tspan font-weight="600">${esc(who)}:</tspan> ${esc(line)}</text>`)
  })
  return out.join('')
}

// --- the deck ----------------------------------------------------------------------

// data: boardData(...) plus { ledger: { week, rows } }; meta: { week, site, broker,
// generated, page, attendance: [names], mood: [[name, line]], masks: {name: fish} }.
// -> [{ key, title, svg, notes }]
export const deckSlides = (data, meta = {}) => {
  const mask = masker(meta.masks)
  const perMember = (data.perMember || []).map(p => ({ ...p, member: mask(p.member) }))
  const members = perMember.map(p => p.member)
  const colour = m => PALETTE[Math.max(0, members.indexOf(m)) % PALETTE.length]
  const weeks = (data.weeks || []).map(w => ({ ...w, members: w.members.map(m => ({ ...m, member: mask(m.member) })) }))
  const share = (data.share || []).map(s => ({ ...s, member: mask(s.member) }))
  const ledgerRows = ((data.ledger && data.ledger.rows) || []).map(r => ({ ...r, member: mask(r.member) }))
  const week = meta.week || (data.ledger && data.ledger.week) || (weeks.length ? weeks[weeks.length - 1].week : '')
  const span = weeks.length ? `${weekLabel(weeks[0].week)} to ${weekLabel(weeks[weeks.length - 1].week)}` : ''
  const thisWeek = weeks.find(w => w.week === week)
  const footer = [meta.broker && `Broker ${mask(meta.broker)}`, meta.generated && `generated ${meta.generated}`, meta.page].filter(Boolean).join(' · ')
  const attendance = (meta.attendance || []).map(mask)
  const mood = (meta.mood || []).map(([w, l]) => [mask(w), l])

  const slides = []
  slides.push({
    key: 'title', title: `Weekly Review ${week}`.trim(),
    body: titleBody({ week, site: meta.site, attendance, mood }),
    subtitle: meta.subtitle || '',
    notes: [`The Weekly Review for ${week}${week ? `, ${weekSpan(week)}` : ''}.`,
      attendance.length ? `Last time in the room: ${attendance.join(', ')}.` : 'Take attendance from the room roster.',
      ...mood.map(([w, l]) => `${w}'s mood line: ${l}.`)].join(' ')
  })
  const hoursBars = (thisWeek ? thisWeek.members.map(m => ({ member: m.member, value: m.actual })) : perMember.map(p => ({ member: p.member, value: p.actual })))
    .map(b => ({ label: b.member, value: b.value, color: colour(b.member) }))
  const hoursScope = thisWeek ? weekLabel(week) : span
  slides.push({
    key: 'hours', title: `Hours given per member, ${hoursScope}`, body: barsBody(hoursBars), subtitle: meta.site || '',
    notes: hoursBars.length
      ? `Hours given in ${hoursScope}: ` + hoursBars.map(b => `${b.label} ${hrs(b.value)}`).join(', ') + `. In all, ${hrs(hoursBars.reduce((a, b) => a + b.value, 0))}.`
      : 'No hours given yet.'
  })
  const variance = weeks.map(w => `${weekLabel(w.week)}: ` + w.members.map(m => `${m.member} ${short(m.planned)} planned, ${short(m.actual)} given`).join('; ')).join('. ')
  slides.push({
    key: 'planned', title: 'Planned against actual, per week', body: plannedActualBody(weeks, members, colour), subtitle: span,
    notes: weeks.length ? `Planned against actual, week by week. ${variance}.` : 'No planned weeks yet.'
  })
  if (share.length) {
    slides.push({
      key: 'shares', title: 'Shares of dynamic equity',
      body: barsBody(share.map(s => ({ label: s.member, value: s.share, color: colour(s.member) })), { unit: '%' }), subtitle: 'approved hours, vested',
      notes: 'Each member\'s share of dynamic equity, from the approved hours: ' + share.map(s => `${s.member} ${r2(s.share)}%`).join(', ') + '.'
    })
  }
  slides.push({
    key: 'ledger', title: `Ledger check, ${weekLabel((data.ledger && data.ledger.week) || week)}`,
    body: ledgerBody(ledgerRows.map(r => ({ ...r, color: colour(r.member) }))), subtitle: 'given · received · net · awaiting',
    notes: ledgerRows.length
      ? 'Per member this week: ' + ledgerRows.map(r => `${r.member} gave ${hrs(r.given || 0)}, received ${hrs(r.received || 0)}, net ${short(r.net ?? 0)}, ${r.awaiting || 0} awaiting the other side`).join('; ') + '.'
      : 'No ledger figures for this week yet.'
  })
  return slides.map((s, i) => ({
    key: s.key, title: s.title, notes: s.notes,
    svg: frame({ title: s.title, subtitle: s.subtitle, footer, counter: `${i + 1} / ${slides.length}`, body: s.body })
  }))
}

// The board's own figures: its model items and, when present, a table item
// captioned "Ledger check, <week>" the report tool keeps beside them.
export const ledgerOf = table => {
  if (!table) return null
  const t = modelOf(table)
  const m = /(\d{4}-W\d{2})/.exec(t.caption || '')
  const c = t.columns.map(x => x.toLowerCase())
  const at = n => c.indexOf(n)
  const num = s => { const v = parseFloat(String(s ?? '').replace(/[^\d.+-]/g, '')); return Number.isFinite(v) ? v : 0 }
  return {
    week: m ? m[1] : null,
    rows: t.rows.map(r => ({ member: r[at('member')], given: num(r[at('given')]), received: num(r[at('received')]), net: num(r[at('net')]), awaiting: num(r[at('awaiting')]) })).filter(r => r.member)
  }
}

export const boardSlides = (modelTexts, ledgerText, meta = {}) => {
  const data = boardData(modelTexts.map(modelOf))
  data.ledger = ledgerOf(ledgerText)
  return deckSlides(data, meta)
}

// BOARD item text: optional WEEK, ATTENDANCE and MOOD lines under BOARD.
export const boardMeta = text => {
  const out = { week: null, attendance: [], mood: [] }
  String(text || '').split('\n').forEach(raw => {
    const line = raw.trim()
    let m
    if ((m = /^WEEK\s*:?\s*(\d{4}-W\d{2})$/i.exec(line))) out.week = m[1].toUpperCase()
    else if ((m = /^ATTENDANCE\s*:?\s*(.+)$/i.exec(line))) out.attendance = m[1].split(/\s*,\s*/).filter(Boolean)
    else if ((m = /^MOOD\s*:?\s*([^:]+?)\s*:\s*(.+)$/i.exec(line))) out.mood.push([m[1], m[2]])
  })
  return out
}
