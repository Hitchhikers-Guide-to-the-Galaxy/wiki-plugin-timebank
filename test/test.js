import { timebank } from '../src/client/timebank.js'
import { test, describe } from 'node:test'
import assert from 'node:assert'

const { parseEntries, extractDates, parseDate, totalHours, formatHours, formatDate, formatCaption } = timebank

describe('timebank plugin', () => {

  describe('parseDate', () => {
    test('parses ISO date', () => {
      const ms = parseDate('2026-06-07')
      assert.ok(ms > 0)
      assert.equal(new Date(ms).getUTCFullYear(), 2026)
      assert.equal(new Date(ms).getUTCMonth(), 5) // June
      assert.equal(new Date(ms).getUTCDate(), 7)
    })

    test('parses "7 June 2026"', () => {
      const ms = parseDate('7 June 2026')
      assert.ok(ms > 0)
      assert.equal(new Date(ms).getUTCDate(), 7)
    })

    test('parses "June 7 2026"', () => {
      const ms = parseDate('June 7 2026')
      assert.ok(ms > 0)
      assert.equal(new Date(ms).getUTCDate(), 7)
    })

    test('returns null for garbage', () => {
      assert.equal(parseDate('not a date'), null)
    })
  })

  describe('extractDates', () => {
    test('extracts start and end from text', () => {
      const text = 'start: 1 June 2026\nend: 7 June 2026\nMeeting: 2 hours'
      const dates = extractDates(text)
      assert.ok(dates.start > 0)
      assert.ok(dates.end > 0)
      assert.ok(dates.end > dates.start)
    })

    test('extracts only end if no start', () => {
      const text = 'end: 7 June 2026\nMeeting: 2 hours'
      const dates = extractDates(text)
      assert.equal(dates.start, undefined)
      assert.ok(dates.end > 0)
    })

    test('returns empty object if no date lines', () => {
      const dates = extractDates('Meeting: 2 hours\nAdmin tasks')
      assert.deepEqual(dates, {})
    })
  })

  describe('parseEntries', () => {
    test('skips start/end date lines', () => {
      const entries = parseEntries('start: 1 June 2026\nend: 7 June 2026\nMeeting: 2 hours')
      assert.equal(entries.length, 1)
    })

    test('parses hours entry', () => {
      const entries = parseEntries('Meeting with David: 2 hours')
      assert.equal(entries.length, 1)
      assert.equal(entries[0].time, 2)
    })

    test('parses multiple entries', () => {
      const entries = parseEntries('Call: 1 hour\nCode review: 30 mins')
      assert.equal(entries.length, 2)
    })

    test('handles entry with no time', () => {
      const entries = parseEntries('Admin tasks')
      assert.equal(entries[0].time, null)
    })

    test('ignores blank lines', () => {
      const entries = parseEntries('Task one: 1h\n\nTask two: 2h')
      assert.equal(entries.length, 2)
    })
  })

  describe('totalHours', () => {
    test('sums hours correctly', () => {
      const entries = parseEntries('Task A: 2 hours\nTask B: 1 hour')
      assert.equal(totalHours(entries), 3)
    })

    test('converts minutes to hours for total', () => {
      const entries = parseEntries('Task A: 30 mins')
      assert.equal(totalHours(entries), 0.5)
    })

    test('ignores entries with no time', () => {
      const entries = parseEntries('Task A: 1 hour\nAdmin tasks')
      assert.equal(totalHours(entries), 1)
    })
  })

  describe('formatHours', () => {
    test('formats whole hours', () => { assert.equal(formatHours(2), '2h') })
    test('formats minutes only', () => { assert.equal(formatHours(0.5), '30m') })
    test('formats hours and minutes', () => { assert.equal(formatHours(1.5), '1h 30m') })
    test('returns empty string for zero', () => { assert.equal(formatHours(0), '') })
  })

  describe('formatDate', () => {
    test('formats a known date', () => {
      const ms = new Date('2026-06-07T12:00:00Z').getTime()
      const result = formatDate(ms)
      assert.ok(result.includes('2026'))
      assert.ok(result.includes('June'))
      assert.ok(result.includes('7'))
    })
  })

  describe('formatCaption', () => {
    test('shows single date when no start', () => {
      const end = new Date('2026-06-07T12:00:00Z').getTime()
      const result = formatCaption(null, end)
      assert.ok(result.includes('7'))
      assert.ok(!result.includes('–'))
    })

    test('shows range when start differs from end', () => {
      const start = new Date('2026-06-01T12:00:00Z').getTime()
      const end = new Date('2026-06-07T12:00:00Z').getTime()
      const result = formatCaption(start, end)
      assert.ok(result.includes('–'))
    })
  })

})
