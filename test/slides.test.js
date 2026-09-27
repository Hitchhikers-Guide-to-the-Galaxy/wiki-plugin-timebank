import { test, describe } from 'node:test'
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { deckSlides, boardSlides, boardMeta, ledgerOf, weekBounds, weekSpan, masker, frame, SLIDE_W, SLIDE_H, FONT, MAX_ROWS } from '../src/client/slides.js'

const REVIEW = `MODEL /assets/review-model/review-model.xlsx
SHEET Review
CAPTION Planned against actual, every planned week

| Week | Member | Planned | Actual | Variance |
|---|---|---|---|---|
| 2026-W39 | Alice | 3.0 | 4.0 | 1.0 |
| 2026-W39 | David Bovill | 2.0 | 1.5 | -0.5 |
| 2026-W40 | Alice | 4.0 | 3.0 | -1.0 |
| 2026-W40 | David Bovill | 3.0 | 2.0 | -1.0 |`
const EQUITY = `MODEL /assets/review-model/review-model.xlsx
SHEET Equity
CAPTION Equity shares

| Member | Approved hours | Weighted hours | Vested hours | Share |
|---|---|---|---|---|
| Alice | 10.0 | 10.9 | 8.38 | 52.4% |
| David Bovill | 8.0 | 9.15 | 6.95 | 47.6% |
| Total | 18 | 20 | 15 | 100.0% |`
const LEDGER = `CAPTION Ledger check, 2026-W40 — given, received, net and awaiting per member
LAYOUT table

| Member | Given | Received | Net | Awaiting |
|---|---|---|---|---|
| Alice | 3 | 2 | 1 | 1 |
| David Bovill | 2 | 2.5 | -0.5 | 0 |`

const viewBox = svg => (/viewBox="([^"]+)"/.exec(svg) || [])[1]
const numbers = (svg, attr) => [...svg.matchAll(new RegExp(`\\s${attr}="(-?[\\d.]+)"`, 'g'))].map(m => parseFloat(m[1]))

describe('slides (0.9.0)', () => {
  const deck = boardSlides([REVIEW, EQUITY], LEDGER, { site: 'ledger.example', broker: 'David Bovill', generated: '27 September 2026', page: 'Review Deck 2026-W40' })

  test('five slides, one fact each, in order', () => {
    assert.deepEqual(deck.map(s => s.key), ['title', 'hours', 'planned', 'shares', 'ledger'])
    assert.equal(deck[0].title, 'Weekly Review 2026-W40')
  })

  test('every slide is a 1280 by 720 frame that scales whole', () => {
    for (const s of deck) {
      assert.equal(viewBox(s.svg), `0 0 ${SLIDE_W} ${SLIDE_H}`)
      assert.match(s.svg, /preserveAspectRatio="xMidYMid meet"/)
      assert.match(s.svg, /height:auto/)
    }
  })

  test('nothing is drawn outside the frame', () => {
    for (const s of deck) {
      const ys = [...numbers(s.svg, 'y'), ...numbers(s.svg, 'y1'), ...numbers(s.svg, 'y2')]
      const xs = [...numbers(s.svg, 'x'), ...numbers(s.svg, 'x1'), ...numbers(s.svg, 'x2')]
      assert.ok(Math.max(...ys) <= SLIDE_H, `${s.key}: y ${Math.max(...ys)}`)
      assert.ok(Math.min(...ys) >= 0, `${s.key}: y ${Math.min(...ys)}`)
      assert.ok(Math.max(...xs) <= SLIDE_W, `${s.key}: x ${Math.max(...xs)}`)
      for (const [, y, h] of s.svg.matchAll(/<rect[^>]*\sy="([\d.]+)"[^>]*\sheight="([\d.]+)"/g)) assert.ok(+y + +h <= SLIDE_H + 0.01)
    }
  })

  test('fonts fixed for the frame: title 44, labels 26, values 24', () => {
    assert.deepEqual([FONT.title, FONT.label, FONT.value], [44, 26, 24])
    const sizes = new Set(deck.flatMap(s => numbers(s.svg, 'font-size')))
    for (const n of sizes) assert.ok(n >= 20, `font-size ${n} too small for a room`)
    assert.ok(sizes.has(44) && sizes.has(26) && sizes.has(24))
  })

  test('title band, footer and counter on every slide', () => {
    deck.forEach((s, i) => {
      assert.match(s.svg, /fill="#20364f"/)
      assert.ok(s.svg.includes(`${i + 1} / 5`))
      assert.ok(s.svg.includes('Broker David Bovill · generated 27 September 2026 · Review Deck 2026-W40'))
    })
  })

  test('notes carry the figures as prose', () => {
    const n = Object.fromEntries(deck.map(s => [s.key, s.notes]))
    assert.match(n.title, /Monday 28 September to Sunday 4 October 2026/)
    assert.match(n.hours, /Alice 3 hours, David Bovill 2 hours/)
    assert.match(n.planned, /W39: Alice 3h planned, 4h given/)
    assert.match(n.shares, /Alice 52.4%/)
    assert.match(n.ledger, /Alice gave 3 hours, received 2 hours, net 1h, 1 awaiting/)
  })

  test('ledger table and board meta read back', () => {
    const l = ledgerOf(LEDGER)
    assert.equal(l.week, '2026-W40')
    assert.deepEqual(l.rows[1], { member: 'David Bovill', given: 2, received: 2.5, net: -0.5, awaiting: 0 })
    assert.deepEqual(boardMeta('BOARD\nWEEK 2026-w39\nATTENDANCE David, Max, Mitch\nMOOD Max: tired, but the seed swap went well'),
      { week: '2026-W39', attendance: ['David', 'Max', 'Mitch'], mood: [['Max', 'tired, but the seed swap went well']] })
  })

  test('attendance and mood lines on the title slide', () => {
    const d = boardSlides([REVIEW], LEDGER, { attendance: ['David', 'Max', 'Mitch'], mood: [['Mitch', 'steady']] })
    assert.ok(d[0].svg.includes('In the room last time: David, Max, Mitch'))
    assert.ok(d[0].svg.includes('Mitch:</tspan> steady'))
  })

  test('masks: exact name, then first word; nothing else changes', () => {
    const m = masker({ David: 'Koi', Alice: 'Pike' })
    assert.equal(m('David Bovill'), 'Koi')
    assert.equal(m('Alice'), 'Pike')
    assert.equal(m('Bob'), 'Bob')
    const d = boardSlides([REVIEW, EQUITY], LEDGER, { broker: 'David Bovill', masks: { David: 'Koi', Alice: 'Pike' } })
    for (const s of d) {
      assert.ok(!/David|Alice/.test(s.svg.replace(/<title>[^<]*<\/title>/g, '')) || false, `${s.key} leaks a name`)
      assert.ok(!/David|Alice/.test(s.notes), `${s.key} notes leak a name`)
    }
    assert.ok(d[1].svg.includes('>Koi<'))
  })

  test('at most eight rows drawn; an empty board still draws a frame', () => {
    const many = { perMember: Array.from({ length: 11 }, (_, i) => ({ member: `M${i}`, planned: 1, actual: i + 1 })), weeks: [], share: [] }
    const d = deckSlides(many, { week: '2026-W40' })
    assert.equal((d[1].svg.match(/rx="6"/g) || []).length, MAX_ROWS)
    assert.ok(d[1].svg.includes('and 3 more'))
    const empty = deckSlides({ perMember: [], weeks: [], share: [] }, {})
    assert.equal(empty.length, 4)
    empty.forEach(s => assert.equal(viewBox(s.svg), '0 0 1280 720'))
  })

  test('ISO weeks', () => {
    assert.deepEqual(weekBounds('2026-W01').map(d => d.toISOString().slice(0, 10)), ['2025-12-29', '2026-01-04'])
    assert.equal(weekSpan('2026-W53'), 'Monday 28 December to Sunday 3 January 2027')
    assert.equal(weekBounds('nope'), null)
  })

  test('frame escapes text', () => {
    assert.ok(frame({ title: 'A <b> & "c"' }).includes('A &lt;b&gt; &amp; &quot;c&quot;'))
  })

  test('tools/deck-slides.mjs draws the same slides', () => {
    const out = JSON.parse(execFileSync('node', ['tools/deck-slides.mjs'], { input: JSON.stringify({ models: [REVIEW, EQUITY], ledger: LEDGER, meta: { site: 'ledger.example', broker: 'David Bovill', generated: '27 September 2026', page: 'Review Deck 2026-W40' } }) }))
    assert.deepEqual(out.map(s => s.svg), deck.map(s => s.svg))
  })
})
