import { timebank } from '../src/client/timebank.js'
import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

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

// ---------------------------------------------------------------------------
// 0.2.0 — markup, linked-ledger grammar, verification, messages
// ---------------------------------------------------------------------------

const {
  markup, escape, extractCaption, extractCommands, asSlug, normLabel, isCommand,
  matchLedgers, deriveStatus, verifyItem, formatVerifyMessages, entryKey, periodOf, schemeFor
} = timebank

// A stand-in for wiki.resolveLinks with the same four-phase contract:
// adulterate stray markers, stash links as 〖n〗, sanitize, unstash.
const fakeResolve = (string, sanitize) => {
  const stashed = []
  const stash = html => { stashed.push(html); return `〖${stashed.length - 1}〗` }
  string = string
    .replace(/〖(\d+)〗/g, '〖 $1 〗')
    .replace(/\[\[([^\]]+)\]\]/g, (m, name) => stash(`<a class="internal" data-page-name="${asSlug(name)}">${name}</a>`))
  return sanitize(string).replace(/〖(\d+)〗/g, (m, d) => stashed[+d])
}

describe('timebank 0.2.0', () => {

  describe('markup', () => {
    test('fallback escapes html when no resolver', () => {
      assert.equal(markup('<script>alert(1)</script> & [[Home]]'), '&lt;script&gt;alert(1)&lt;/script&gt; &amp; [[Home]]')
    })

    test('with a resolver: script escaped, link markers survive the sanitiser', () => {
      const html = markup('See [[Alice Ledger]] <script>x</script>', fakeResolve)
      assert.ok(html.includes('<a class="internal" data-page-name="alice-ledger">Alice Ledger</a>'))
      assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'))
      assert.ok(!html.includes('〖'))
    })

    test('escape passes 〖n〗 markers untouched', () => {
      assert.equal(escape('a〖0〗<b>'), 'a〖0〗&lt;b&gt;')
    })
  })

  describe('linked-ledger grammar', () => {
    test('for and to are hours I gave', () => {
      const [a, b] = parseEntries('Gardening for [[Alice Ledger]]: 2 hours\nLessons to [[Bob Ledger]]: 30 mins')
      assert.equal(a.linked, true)
      assert.equal(a.direction, 'gave')
      assert.equal(a.label, 'Gardening')
      assert.deepEqual(a.counterparty, { name: 'Alice Ledger', slug: 'alice-ledger' })
      assert.equal(b.direction, 'gave')
      assert.equal(b.time, 0.5)
    })

    test('from and by are hours I received', () => {
      const [a, b] = parseEntries('Repairs from [[Alice Ledger]]: 1 hour\nLift given by [[Bob]]: 1h')
      assert.equal(a.direction, 'received')
      assert.equal(a.label, 'Repairs')
      assert.equal(b.direction, 'received')
      assert.equal(b.counterparty.slug, 'bob')
    })

    test('a wikilink without a direction word stays unlinked', () => {
      const [e] = parseEntries('Meeting with [[David]]: 2 hours')
      assert.equal(e.linked, false)
      assert.equal(e.label, 'Meeting with [[David]]')
      assert.equal(e.time, 2)
    })

    test('counterparty slug follows the wiki rule', () => {
      const [e] = parseEntries("Help for [[Carol's Ledger 2]]: 1 hour")
      assert.equal(e.counterparty.slug, 'carols-ledger-2')
    })

    test('NOTIFY is a command, not an entry or caption; LEDGER is no longer a command', () => {
      const text = 'NOTIFY: ntfy.sh/timebank-david\nGardening for [[Alice Ledger]]: 2 hours\nA prose caption with [[Links]].'
      assert.ok(!isCommand('LEDGER: alice.localhost/alice-ledger'))
      assert.ok(isCommand('notify: ntfy.sh/x'))
      assert.equal(parseEntries(text).length, 1)
      assert.equal(extractCaption(text), 'A prose caption with [[Links]].')
    })

    test('a label that merely starts with a command word is still an entry', () => {
      const entries = parseEntries('Starting the garden: 2 hours\nEndless admin: 1 hour')
      assert.equal(entries.length, 2)
      assert.equal(totalHours(entries), 3)
    })

    test('extractCommands normalises NOTIFY urls', () => {
      const c = extractCommands('NOTIFY: ntfy.sh/timebank-david')
      assert.deepEqual(c, { notify: 'https://ntfy.sh/timebank-david', lineup: false, tool: false, watch: [], owner: null, periods: null, index: false, balance: null })
      assert.equal(extractCommands('NOTIFY: http://pi:4280/timebank').notify, 'http://pi:4280/timebank')
      assert.equal(extractCommands('Gardening: 1h').notify, null)
    })

    test('normLabel lowercases, collapses space, strips trailing punctuation', () => {
      assert.equal(normLabel('  Garden   Work. '), 'garden work')
      assert.equal(normLabel('Repairs!!'), 'repairs')
    })
  })

  describe('matchLedgers', () => {
    const mine = text => parseEntries(text).filter(e => e.linked)
    const theirs = (text, period = null) => parseEntries(text).filter(e => e.linked).map(e => ({ ...e, period }))
    const opts = { title: 'David Ledger', period: null }

    test('exact opposite entry matches', () => {
      const m = matchLedgers(mine('Gardening for [[Alice Ledger]]: 2 hours'), theirs('Gardening from [[David Ledger]]: 2 hours'), opts)
      assert.equal(m.matched.length, 1)
      assert.equal(m.unmatched.length, 0)
    })

    test('the same direction on both sides does not match', () => {
      const m = matchLedgers(mine('Gardening for [[Alice Ledger]]: 2 hours'), theirs('Gardening for [[David Ledger]]: 2 hours'), opts)
      assert.equal(m.matched.length, 0)
    })

    test('different hours do not match; 120 mins equals 2 hours', () => {
      assert.equal(matchLedgers(mine('Gardening for [[Alice Ledger]]: 2 hours'), theirs('Gardening from [[David Ledger]]: 3 hours'), opts).matched.length, 0)
      assert.equal(matchLedgers(mine('Gardening for [[Alice Ledger]]: 2 hours'), theirs('Gardening from [[David Ledger]]: 120 mins'), opts).matched.length, 1)
    })

    test('labels match after normalisation', () => {
      const m = matchLedgers(mine('Garden  work. for [[Alice Ledger]]: 2 hours'), theirs('garden work from [[David Ledger]]: 2 hours'), opts)
      assert.equal(m.matched.length, 1)
    })

    test('multiset: each counter-entry is consumed once', () => {
      const m = matchLedgers(
        mine('Gardening for [[Alice Ledger]]: 1 hour\nGardening for [[Alice Ledger]]: 1 hour'),
        theirs('Gardening from [[David Ledger]]: 1 hour'), opts)
      assert.equal(m.matched.length, 1)
      assert.equal(m.unmatched.length, 1)
    })

    test('the counter-entry must point back at my page', () => {
      const m = matchLedgers(mine('Gardening for [[Alice Ledger]]: 2 hours'), theirs('Gardening from [[Someone Else]]: 2 hours'), opts)
      assert.equal(m.matched.length, 0)
    })

    test('periods must overlap when both declare them; a missing period skips the check', () => {
      const sep = periodOf(extractDates('START: 1 September 2026\nEND: 7 September 2026'))
      const oct = periodOf(extractDates('START: 1 October 2026\nEND: 7 October 2026'))
      const mid = periodOf(extractDates('START: 5 September 2026\nEND: 12 September 2026'))
      const e = mine('Gardening for [[Alice Ledger]]: 2 hours')
      const f = 'Gardening from [[David Ledger]]: 2 hours'
      assert.equal(matchLedgers(e, theirs(f, oct), { ...opts, period: sep }).matched.length, 0)
      assert.equal(matchLedgers(e, theirs(f, mid), { ...opts, period: sep }).matched.length, 1)
      assert.equal(matchLedgers(e, theirs(f, null), { ...opts, period: sep }).matched.length, 1)
      assert.equal(matchLedgers(e, theirs(f, oct), opts).matched.length, 1)
    })

    test('entryKey is stable across direction, slug, minutes and label', () => {
      const [e] = mine('Gardening for [[Alice Ledger]]: 2 hours')
      assert.equal(entryKey(e), 'gave|alice-ledger|120|gardening')
    })
  })

  describe('deriveStatus', () => {
    test('ok when every linked entry matched', () => { assert.equal(deriveStatus({ linked: 2, matched: 2 }), 'ok') })
    test('partial when some matched', () => { assert.equal(deriveStatus({ linked: 3, matched: 2 }), 'partial') })
    test('fail when nothing matched', () => { assert.equal(deriveStatus({ linked: 2, matched: 0 }), 'fail') })
    test('fail when a counterparty is unreachable', () => { assert.equal(deriveStatus({ linked: 3, matched: 2, unreachable: ['carol-ledger'] }), 'fail') })
    test('none when there are no linked entries', () => { assert.equal(deriveStatus({ linked: 0, matched: 0 }), 'none') })
  })

  describe('verifyItem', () => {
    const page = (title, text) => ({ title, story: [{ type: 'timebank', id: 'x', text }] })
    const fakeCtx = (pages, sitemap = {}) => {
      const calls = []
      return {
        calls,
        title: 'David Ledger',
        site: 'localhost:4243',
        fetchPage: async (site, slug) => { calls.push(`${site}/${slug}`); return pages[`${site}/${slug}`] || null },
        sitesFor: slug => Object.keys(sitemap).filter(site => sitemap[site].includes(slug))
      }
    }
    const david = [
      'START: 1 September 2026', 'END: 7 September 2026', 'NOTIFY: ntfy.sh/timebank-demo-david',
      'Gardening for [[Alice Ledger]]: 2 hours', 'Repairs from [[Alice Ledger]]: 1 hour', 'Cooking for [[Bob Ledger]]: 1 hour'
    ].join('\n')
    const alice = page('Alice Ledger', 'Gardening from [[David Ledger]]: 2 hours\nRepairs for [[David Ledger]]: 1 hour')
    const bob = page('Bob Ledger', 'Cooking from [[Carol Ledger]]: 1 hour')

    test('own site first: partial when one counterparty has not recorded it', async () => {
      const ctx = fakeCtx({ 'localhost:4243/alice-ledger': alice, 'localhost:4243/bob-ledger': bob })
      const r = await verifyItem({ text: david }, ctx)
      assert.equal(r.status, 'partial')
      assert.equal(r.linked, 3)
      assert.deepEqual(r.matched.sort(), ['gave|alice-ledger|120|gardening', 'received|alice-ledger|60|repairs'])
      assert.equal(r.unmatched.length, 1)
      assert.equal(r.unmatched[0].site, 'localhost:4243')
      assert.equal(r.notify, 'https://ntfy.sh/timebank-demo-david')
      assert.equal(ctx.calls[0], 'localhost:4243/alice-ledger')
    })

    test('a wikilink names a ledger on my own site only: a same-slug page elsewhere is never fetched', async () => {
      const ctx = fakeCtx({ 'alice.example.org/alice-ledger': alice }, { 'alice.example.org': ['alice-ledger'] })
      const r = await verifyItem({ text: 'Gardening for [[Alice Ledger]]: 2 hours' }, ctx)
      assert.equal(r.status, 'fail')
      assert.deepEqual(ctx.calls, ['localhost:4243/alice-ledger'])
      assert.deepEqual(r.unreachable, ['localhost:4243/alice-ledger'])
    })

    test('404 everywhere means unreachable and red', async () => {
      const ctx = fakeCtx({})
      ctx.title = 'Bob Ledger'
      const r = await verifyItem({ text: 'Cooking from [[Carol Ledger]]: 1 hour' }, ctx)
      assert.equal(r.status, 'fail')
      assert.deepEqual(r.unreachable, ['localhost:4243/carol-ledger'])
    })

    test('a thrown fetch counts as unreachable', async () => {
      const ctx = fakeCtx({})
      ctx.fetchPage = async () => { throw new Error('offline') }
      const r = await verifyItem({ text: 'Gardening for [[Alice Ledger]]: 2 hours' }, ctx)
      assert.equal(r.status, 'fail')
    })

    test('no linked entries: status none, nothing fetched', async () => {
      const ctx = fakeCtx({})
      const r = await verifyItem({ text: 'Meeting with [[David]]: 2 hours' }, ctx)
      assert.equal(r.status, 'none')
      assert.equal(ctx.calls.length, 0)
    })

    test('the counterparty sees green for the same pair', async () => {
      const ctx = fakeCtx({ 'localhost:4243/david-ledger': page('David Ledger', david) })
      ctx.title = 'Alice Ledger'
      const r = await verifyItem(alice.story[0], ctx)
      assert.equal(r.status, 'ok')
    })
  })

  describe('formatVerifyMessages', () => {
    const david = [
      'START: 1 September 2026', 'END: 7 September 2026', 'NOTIFY: ntfy.sh/timebank-demo-david',
      'Gardening for [[Alice Ledger]]: 2 hours', 'Cooking for [[Bob Ledger]]: 1 hour'
    ].join('\n')
    const pages = {
      'localhost:4243/alice-ledger': { title: 'Alice Ledger', story: [{ type: 'timebank', text: 'Gardening from [[David Ledger]]: 2 hours' }] },
      'localhost:4243/bob-ledger': { title: 'Bob Ledger', story: [{ type: 'timebank', text: 'Cooking from [[Carol Ledger]]: 1 hour' }] }
    }
    const ctx = { title: 'David Ledger — café', site: 'localhost:4243', fetchPage: async (s, slug) => pages[`localhost:4243/${slug}`] || null, sitesFor: () => [] }

    test('one message per counterparty with ASCII title, tags, click and body', async () => {
      const r = await verifyItem({ text: david }, { ...ctx, title: 'David Ledger' })
      const msgs = formatVerifyMessages(r, ctx)
      assert.equal(msgs.length, 2)
      const [a, b] = msgs
      assert.equal(a.url, 'https://ntfy.sh/timebank-demo-david')
      assert.equal(a.title, 'Timebank verification: David Ledger')
      assert.equal(a.tags, 'hourglass,white_check_mark')
      assert.equal(a.click, 'http://localhost:4243/view/alice-ledger')
      assert.equal(a.body, 'Confirmed: David Ledger gave Alice Ledger 2h Gardening (1 Sep 2026 – 7 Sep 2026) — matched')
      assert.equal(b.tags, 'hourglass,x')
      assert.equal(b.body, 'Verify: David Ledger gave Bob Ledger 1h Cooking (1 Sep 2026 – 7 Sep 2026) — unmatched in http://localhost:4243/view/bob-ledger')
    })

    test('title stays ASCII even when the page title is not', async () => {
      const r = await verifyItem({ text: david }, ctx)
      const [a] = formatVerifyMessages(r, ctx)
      assert.match(a.title, /^[\x20-\x7E]+$/)
      assert.equal(a.title, 'Timebank verification: David Ledger - caf')
    })

    test('received entries and unreachable ledgers read plainly; partial is a warning', async () => {
      const text = 'NOTIFY: ntfy.sh/t\nRepairs from [[Alice Ledger]]: 1 hour\nWeeding for [[Alice Ledger]]: 1 hour\nSoup for [[Carol Ledger]]: 30 mins'
      const alicePages = { 'localhost:4243/alice-ledger': { title: 'Alice Ledger', story: [{ type: 'timebank', text: 'Repairs for [[David Ledger]]: 1 hour' }] } }
      const c = { ...ctx, title: 'David Ledger', fetchPage: async (s, slug) => alicePages[`${s}/${slug}`] || null }
      const msgs = formatVerifyMessages(await verifyItem({ text }, c), c)
      assert.equal(msgs[0].tags, 'hourglass,warning')
      assert.equal(msgs[0].body, 'Confirmed: David Ledger received from Alice Ledger 1h Repairs — matched\nVerify: David Ledger gave Alice Ledger 1h Weeding — unmatched in http://localhost:4243/view/alice-ledger')
      assert.equal(msgs[1].tags, 'hourglass,x')
      assert.equal(msgs[1].body, 'Verify: David Ledger gave Carol Ledger 30m Soup — http://localhost:4243/view/carol-ledger unreachable')
    })

    test('no NOTIFY line, no messages', async () => {
      const r = await verifyItem({ text: 'Gardening for [[Alice Ledger]]: 2 hours' }, { ...ctx, title: 'David Ledger' })
      assert.deepEqual(formatVerifyMessages(r, ctx), [])
    })

    test('click scheme: http for localhost and ported hosts, https otherwise', () => {
      assert.equal(schemeFor('localhost:4243'), 'http:')
      assert.equal(schemeFor('alice.localhost'), 'http:')
      assert.equal(schemeFor('mini.local'), 'http:')
      assert.equal(schemeFor('time.peoplepowered.money'), 'https:')
    })
  })
})

// ---------------------------------------------------------------------------
// 0.3.0 — cross-site ledgers by external link, and the Ledger Verification Tool
// ---------------------------------------------------------------------------

const {
  parseLedgerUrl, ledgerUrl, ledgerId, normSite, sameSite, rewriteEntries,
  findCandidates, renderReport, entryRows, formatStamp, TOOL_TITLE
} = timebank

describe('timebank 0.3.0 cross-site ledgers', () => {

  describe('external-link counterparties', () => {
    test('https link parses into site, slug and display name', () => {
      const [e] = parseEntries("Gardening for [https://alice.wiki/alice-ledger Alice's Ledger]: 2 hours")
      assert.equal(e.linked, true)
      assert.equal(e.direction, 'gave')
      assert.equal(e.label, 'Gardening')
      assert.equal(e.time, 2)
      assert.equal(e.counterparty.site, 'alice.wiki')
      assert.equal(e.counterparty.slug, 'alice-ledger')
      assert.equal(e.counterparty.name, "Alice's Ledger")
      assert.equal(e.counterparty.external, true)
    })

    test('http with a port, /view/ path and received direction', () => {
      const [e] = parseEntries("Repairs from [http://david.localhost:4242/view/davids-ledger David's Ledger]: 1 hour")
      assert.equal(e.direction, 'received')
      assert.equal(e.counterparty.site, 'david.localhost:4242')
      assert.equal(e.counterparty.slug, 'davids-ledger')
      assert.equal(e.counterparty.scheme, 'http:')
    })

    test('scheme-relative, trailing slash, .html and .json suffixes, lineup urls', () => {
      assert.deepEqual(parseLedgerUrl('//alice.wiki/alice-ledger'), { site: 'alice.wiki', slug: 'alice-ledger', scheme: null })
      assert.equal(parseLedgerUrl('https://alice.wiki/alice-ledger/').slug, 'alice-ledger')
      assert.equal(parseLedgerUrl('https://alice.wiki/alice-ledger.html').slug, 'alice-ledger')
      assert.equal(parseLedgerUrl('https://alice.wiki/alice-ledger.json').slug, 'alice-ledger')
      assert.equal(parseLedgerUrl('https://alice.wiki/view/welcome-visitors/view/alice-ledger').slug, 'alice-ledger')
      assert.equal(parseLedgerUrl('https://Alice.Wiki:443/alice-ledger').site, 'alice.wiki')
      assert.equal(parseLedgerUrl('http://alice.wiki:8080/alice-ledger').site, 'alice.wiki:8080')
    })

    test('a link with no page path is not a ledger, so the entry stays unlinked', () => {
      assert.equal(parseLedgerUrl('https://alice.wiki/'), null)
      assert.equal(parseLedgerUrl('https://alice.wiki/view/'), null)
      const [e] = parseEntries('Gardening for [https://alice.wiki Alice]: 2 hours')
      assert.equal(e.linked, false)
      assert.equal(e.time, 2)
    })

    test('the wikilink form carries no site: it names a ledger on its own page\'s site', () => {
      const [e] = parseEntries('Gardening for [[Alice Ledger]]: 2 hours')
      assert.deepEqual(e.counterparty, { name: 'Alice Ledger', slug: 'alice-ledger' })
    })

    test('the external form renders through the resolver unchanged, as an external link', () => {
      // wiki.resolveLinks' own external rule, reproduced
      const resolve = (string, sanitize) => {
        const stashed = []
        const stash = h => { stashed.push(h); return `〖${stashed.length - 1}〗` }
        string = string.replace(/\[((?:(?:https?|ftp):|\/).*?) (.*?)\]/gi, (m, href, rest) =>
          stash(`<a class="external" target="_blank" href="${href}">${escape(rest)}</a>`))
        return sanitize(string).replace(/〖(\d+)〗/g, (m, d) => stashed[+d])
      }
      const html = markup("Gardening for [https://alice.wiki/alice-ledger Alice's Ledger]: 2 hours", resolve)
      assert.ok(html.includes('<a class="external" target="_blank" href="https://alice.wiki/alice-ledger">Alice\'s Ledger</a>'))
    })

    test('ledger address, identity and site comparison', () => {
      assert.equal(ledgerUrl({ site: 'alice.wiki', slug: 'alice-ledger' }), 'https://alice.wiki/view/alice-ledger')
      assert.equal(ledgerUrl({ site: 'david.localhost:4242', slug: 'davids-ledger' }), 'http://david.localhost:4242/view/davids-ledger')
      assert.equal(ledgerUrl({ site: 'alice.wiki', slug: 'a', scheme: 'http:' }), 'http://alice.wiki/view/a')
      assert.equal(ledgerId({ site: 'Alice.Wiki', slug: 'alice-ledger' }), 'alice.wiki/alice-ledger')
      assert.equal(normSite('Alice.Wiki:80'), 'alice.wiki')
      assert.ok(sameSite('alice.wiki', 'ALICE.WIKI'))
      assert.ok(!sameSite('alice.wiki', 'bob.wiki'))
      assert.ok(!sameSite('alice.wiki:8080', 'alice.wiki'))
      // a *.localhost dev farm answers with and without its port
      assert.ok(sameSite('demo.localhost', 'demo.localhost:4242'))
      assert.ok(!sameSite('demo.localhost:4242', 'demo.localhost:4243'))
      assert.ok(!sameSite('david.localhost:4242', 'demo.localhost:4242'))
    })
  })

  describe('identity by site plus slug', () => {
    const page = (title, text) => ({ title, story: [{ type: 'timebank', id: 'x', text }] })
    const fake = (pages, me) => {
      const calls = []
      return {
        calls, ...me,
        fetchPage: async (site, slug) => { calls.push(`${site}/${slug}`); return pages[`${site}/${slug}`] || null }
      }
    }
    const DAVID = 'http://david.localhost:4242/view/davids-ledger'
    const ALICE = 'http://demo.localhost:4242/view/alices-ledger'
    const aliceText = `Gardening from [${DAVID} David's Ledger]: 2 hours\nRepairs for [${DAVID} David's Ledger]: 1 hour`
    const davidText = `Gardening for [${ALICE} Alice's Ledger]: 2 hours\nRepairs from [${ALICE} Alice's Ledger]: 1 hour`
    const otherDavidText = "Gardening for [[Alice's Ledger]]: 2 hours"
    const pages = {
      'demo.localhost:4242/alices-ledger': page("Alice's Ledger", aliceText),
      'david.localhost:4242/davids-ledger': page("David's Ledger", davidText),
      'demo.localhost:4242/davids-ledger': page("David's Ledger", otherDavidText)
    }

    test('cross-site pair by external links is green on both sides', async () => {
      const a = fake(pages, { title: "Alice's Ledger", slug: 'alices-ledger', site: 'demo.localhost:4242' })
      const ra = await verifyItem({ text: aliceText }, a)
      assert.equal(ra.status, 'ok')
      assert.deepEqual(a.calls, ['david.localhost:4242/davids-ledger'])
      const d = fake(pages, { title: "David's Ledger", slug: 'davids-ledger', site: 'david.localhost:4242' })
      assert.equal((await verifyItem({ text: davidText }, d)).status, 'ok')
    })

    test('same-title ledgers on two sites never match each other', async () => {
      // the other David on demo.localhost claims the same gardening with Alice
      const o = fake(pages, { title: "David's Ledger", slug: 'davids-ledger', site: 'demo.localhost:4242' })
      const r = await verifyItem({ text: otherDavidText }, o)
      assert.deepEqual(o.calls, ['demo.localhost:4242/alices-ledger'])
      assert.equal(r.status, 'fail')
      assert.equal(r.matched.length, 0)
      assert.equal(r.unmatched[0].reachable, true)
      assert.equal(r.unmatched[0].href, 'http://demo.localhost:4242/view/alices-ledger')
    })

    test('a wikilink back-pointer names its own site, so it matches only on the same site', async () => {
      // Alice on alice.wiki writes [[David's Ledger]]: that is alice.wiki/davids-ledger
      const alicePages = { 'alice.wiki/alices-ledger': page("Alice's Ledger", "Gardening from [[David's Ledger]]: 2 hours") }
      const d = fake(alicePages, { title: "David's Ledger", slug: 'davids-ledger', site: 'david.wiki' })
      const r = await verifyItem({ text: "Gardening for [https://alice.wiki/alices-ledger Alice's Ledger]: 2 hours" }, d)
      assert.equal(r.status, 'fail')
      // the same pair on one site matches
      const same = { 'alice.wiki/alices-ledger': alicePages['alice.wiki/alices-ledger'] }
      const d2 = fake(same, { title: "David's Ledger", slug: 'davids-ledger', site: 'alice.wiki' })
      assert.equal((await verifyItem({ text: "Gardening for [[Alice's Ledger]]: 2 hours" }, d2)).status, 'ok')
    })

    test('an external link to my own site counts as naming me', async () => {
      const selfPages = { 'alice.wiki/alices-ledger': page("Alice's Ledger", 'Gardening from [https://alice.wiki/view/davids-ledger David]: 2 hours') }
      const d = fake(selfPages, { title: "David's Ledger", slug: 'davids-ledger', site: 'alice.wiki' })
      assert.equal((await verifyItem({ text: "Gardening for [[Alice's Ledger]]: 2 hours" }, d)).status, 'ok')
    })

    test('matchLedgers without sites keeps the slug-only back-pointer', () => {
      const mine = parseEntries('Gardening for [[Alice Ledger]]: 2 hours').filter(e => e.linked)
      const theirs = parseEntries('Gardening from [[David Ledger]]: 2 hours').filter(e => e.linked)
      assert.equal(matchLedgers(mine, theirs, { title: 'David Ledger' }).matched.length, 1)
      assert.equal(matchLedgers(mine, theirs.map(f => ({ ...f, counterparty: { ...f.counterparty, site: 'b.wiki' } })), { title: 'David Ledger', site: 'a.wiki' }).matched.length, 0)
    })

    test('entry keys carry the site of an external counterparty', () => {
      const [e] = parseEntries(`Gardening for [${ALICE} Alice's Ledger]: 2 hours`)
      assert.equal(entryKey(e), 'gave|demo.localhost:4242/alices-ledger|120|gardening')
    })

    test('the message Click link and unmatched text use the external ledger address', async () => {
      const o = fake(pages, { title: "David's Ledger", slug: 'davids-ledger', site: 'demo.localhost:4242' })
      const r = await verifyItem({ text: `NOTIFY: ntfy.sh/t\n${otherDavidText}` }, o)
      const [m] = formatVerifyMessages(r, o)
      assert.equal(m.click, 'http://demo.localhost:4242/view/alices-ledger')
      assert.equal(m.body, "Verify: David's Ledger gave Alice's Ledger 2h Gardening — unmatched in http://demo.localhost:4242/view/alices-ledger")
      const d = fake(pages, { title: "David's Ledger", slug: 'davids-ledger', site: 'david.localhost:4242' })
      const [n] = formatVerifyMessages(await verifyItem({ text: `NOTIFY: ntfy.sh/t\n${davidText}` }, d), d)
      assert.equal(n.click, ALICE)
      assert.equal(n.tags, 'hourglass,white_check_mark')
    })
  })

  describe('rewriteEntries (Fix)', () => {
    const href = "http://david.localhost:4242/view/davids-ledger"
    test('rewrites only the given lines, keeping label, direction word and time', () => {
      const text = "START: 1 September 2026\nCooking from [[David's Ledger]]: 1 hour\nGardening for [[Alice Ledger]]: 2 hours"
      const out = rewriteEntries(text, ["Cooking from [[David's Ledger]]: 1 hour"], { href, name: "David's Ledger" })
      assert.equal(out, `START: 1 September 2026\nCooking from [${href} David's Ledger]: 1 hour\nGardening for [[Alice Ledger]]: 2 hours`)
      const [e] = parseEntries(out).filter(x => x.counterparty && x.counterparty.external)
      assert.equal(e.counterparty.site, 'david.localhost:4242')
      assert.equal(e.direction, 'received')
    })

    test('an external counterparty can be re-pointed; duplicate lines are each rewritten once', () => {
      const line = 'Soup for [https://old.wiki/bob Bob]: 30 mins'
      const out = rewriteEntries(`${line}\n${line}\n${line}`, [line, line], { href: 'https://new.wiki/view/bob', name: 'Bob [x]' })
      assert.deepEqual(out.split('\n'), ['Soup for [https://new.wiki/view/bob Bob x]: 30 mins', 'Soup for [https://new.wiki/view/bob Bob x]: 30 mins', line])
    })
  })
})

describe('timebank 0.3.0 Ledger Verification Tool', () => {
  const page = (title, text) => ({ title, story: [{ type: 'timebank', id: 'x', text }] })
  const DAVID = 'http://david.localhost:4242/view/davids-ledger'
  const bobText = "START: 1 September 2026\nEND: 7 September 2026\nNOTIFY: ntfy.sh/timebank-demo-david\nCooking from [[David's Ledger]]: 1 hour\nBread for [[Erin's Ledger]]: 2 hours"
  const pages = {
    'demo.localhost:4242/davids-ledger': page("David's Ledger", "Gardening for [[Alice's Ledger]]: 2 hours")
  }
  const ctx = {
    title: "Bob's Ledger", slug: 'bobs-ledger', site: 'demo.localhost:4242',
    fetchPage: async (site, slug) => pages[`${site}/${slug}`] || null
  }
  const sitemaps = {
    'demo.localhost:4242': [
      { slug: 'davids-ledger', title: "David's Ledger" },
      { slug: 'bobs-ledger', title: "Bob's Ledger" },
      { slug: 'welcome-visitors', title: 'Welcome Visitors' }
    ],
    'david.localhost:4242': [{ slug: 'davids-ledger', title: "David's Ledger" }],
    'demo.localhost': [{ slug: 'davids-ledger', title: "David's Ledger" }],
    'far.wiki': [{ slug: 'david-s-ledger', title: 'David’s  Ledger' }, { slug: 'erins-garden', title: 'Erin Garden' }],
    'broken.wiki': null
  }

  describe('findCandidates', () => {
    test('lists same-title pages elsewhere, never the ledger already checked nor myself', async () => {
      const r = await verifyItem({ text: bobText }, ctx)
      assert.equal(r.status, 'fail')
      const groups = findCandidates(r, sitemaps)
      assert.equal(groups.length, 2)
      const [david, erin] = groups
      assert.equal(david.reason, 'unmatched')
      assert.equal(david.ledger.id, 'demo.localhost:4242/davids-ledger')
      assert.deepEqual(david.candidates.map(c => `${c.site}/${c.slug}`), ['david.localhost:4242/davids-ledger', 'far.wiki/david-s-ledger'])
      assert.equal(david.candidates[0].href, DAVID)
      assert.equal(david.candidates[0].title, "David's Ledger")
      assert.equal(david.searched, 4)
      assert.equal(erin.reason, 'unreachable')
      assert.deepEqual(erin.candidates, [])
    })

    test('a fully matched counterparty needs no finding', async () => {
      const r = { site: 'a.wiki', slug: 'me', counterparties: [{ site: 'b.wiki', slug: 'x', name: 'X', reachable: true, matched: [{}], unmatched: [] }] }
      assert.deepEqual(findCandidates(r, sitemaps), [])
    })

    test('slug match finds a page whose title differs', () => {
      const r = { site: 'a.wiki', slug: 'me', counterparties: [{ site: 'a.wiki', slug: 'erins-garden', name: 'Erins Garden', reachable: false, matched: [], unmatched: [{ raw: 'x' }] }] }
      const [g] = findCandidates(r, sitemaps)
      assert.deepEqual(g.candidates.map(c => c.site), ['far.wiki'])
      assert.equal(g.candidates[0].href, 'https://far.wiki/view/erins-garden')
    })
  })

  describe('renderReport (the TOOL item on the Ledger Verification Tool page)', () => {
    test('the report: status pill, entries with Result first, send, find, fix', async () => {
      const r = await verifyItem({ text: bobText }, ctx)
      const groups = findCandidates(r, sitemaps)
      const at = Date.UTC(2026, 8, 23, 14, 5)
      const html = renderReport({ result: r, groups, verified: { at, by: 'demo.localhost:4242' }, context: ['demo.localhost:4242'] })
      assert.equal(TOOL_TITLE, 'Ledger Verification Tool')
      assert.ok(html.includes('<span class="timebank-badge fail" style="margin-left:0">Not verified</span>'))
      assert.ok(html.includes('href="http://demo.localhost:4242/view/bobs-ledger"'))
      assert.ok(html.includes('checked 23 Sep 2026, 14:05 UTC from demo.localhost:4242'))
      assert.ok(html.includes('0 of 2 linked entries matched; 1 counterparty ledger could not be reached'))
      const head = html.match(/<thead><tr>(.*?)<\/tr><\/thead>/)[1]
      assert.deepEqual([...head.matchAll(/<th [^>]*>([^<]*)<\/th>/g)].map(m => m[1]), ['Result', 'Direction', 'Hours', 'Label', 'Counterparty ledger', 'Transaction page'])
      assert.ok(html.includes('https://ntfy.sh/timebank-demo-david'))
      assert.ok(html.includes('<button data-timebank-action="send">Send verification message</button>'))
      assert.ok(html.includes('data-timebank-out="send"'))
      assert.ok(html.includes('data-timebank-action="fix" data-timebank-group="0" data-timebank-candidate="0"'))
      assert.ok(html.includes('logged in as the owner of demo.localhost:4242'))
      assert.ok(html.includes("<b>Erin&#39;s Ledger</b> could not be reached") || html.includes("<b>Erin's Ledger</b> could not be reached"))
      assert.ok(html.includes('No page with this title or slug among the 4 sites searched'))
      assert.ok(!/\[\[|\]\]/.test(html), 'no raw wikilink markup in the report')
      assert.ok(!html.includes('<script'))
    })

    test('entry rows put a coloured Result pill first', async () => {
      const r = await verifyItem({ text: bobText }, ctx)
      const rows = entryRows(r, ['demo.localhost:4242'])
      assert.equal(rows.length, 2)
      assert.ok(rows[0][0].includes('timebank-badge fail') && rows[0][0].includes('unmatched'))
      assert.equal(rows[0][1], 'received')
      assert.equal(rows[0][2], '1h')
      assert.equal(rows[0][3], 'Cooking')
      assert.ok(rows[1][0].includes('ledger unreachable'))
      assert.ok(rows[0][5].includes('none'))
    })

    test('green ledger: matched pills, nothing to find; no NOTIFY means no send button', async () => {
      const p2 = { 'b.wiki/b': page('B', 'Gardening from [https://a.wiki/view/a A]: 2 hours') }
      const r = await verifyItem({ text: 'Gardening for [https://b.wiki/view/b B]: 2 hours' }, { title: 'A', slug: 'a', site: 'a.wiki', fetchPage: async (s, slug) => p2[`${s}/${slug}`] || null })
      assert.equal(r.status, 'ok')
      const html = renderReport({ result: r, groups: findCandidates(r, sitemaps), verified: { at: 0, by: 'a.wiki' } })
      assert.ok(html.includes('timebank-badge ok" style="margin-left:0">Verified<'))
      assert.ok(html.includes('timebank-badge ok" style="margin-left:0">matched<'))
      assert.ok(html.includes('no ledger to find'))
      assert.ok(html.includes('no <code>NOTIFY:</code> line'))
      assert.ok(!html.includes('data-timebank-action'))
    })

    test('a note from the last action appears under the status line', async () => {
      const r = await verifyItem({ text: bobText }, ctx)
      const html = renderReport({ result: r, note: 'Fixed: 1 entry line now names x' })
      assert.ok(html.includes('<b>Fixed: 1 entry line now names x</b>'))
    })

    test('formatStamp is UTC and fixed-format', () => {
      assert.equal(formatStamp(Date.UTC(2026, 0, 2, 3, 4)), '2 Jan 2026, 03:04 UTC')
    })
  })
})

describe('timebank 0.3.0 known sites', () => {
  const { sitesMentioned } = timebank
  test('sites named by external links anywhere on the page, minus my own, once each', () => {
    const page = { story: [
      { type: 'markdown', text: 'See [http://david.localhost:4242/view/davids-ledger David] and [https://alice.wiki/a A] and [https://alice.wiki/b B].' },
      { type: 'timebank', text: 'Soup for [//carol.wiki/view/carol Carol]: 1h\nOwn [http://demo.localhost:4242/view/x X]' },
      { type: 'image', url: 'https://ignored.example/x.png' }
    ] }
    assert.deepEqual(sitesMentioned(page, 'demo.localhost:4242'), ['david.localhost:4242', 'alice.wiki', 'carol.wiki'])
  })
})

describe('timebank 0.4.0 Time Transaction pages', () => {
  const {
    parseTransaction, pageTransactions, parseMinutes, minutesText, entryLineFor, pullEntries, freezeText,
    signOffState, forkComments, suggestTitle, transactionCandidates, txnRefOf, signOffs, verifyItem, matchLedgers,
    resolveLike, internalAnchor, renderReport, findCandidates, extractCommands, isCommand, parseEntries
  } = timebank

  const ALICE = 'http://demo.localhost:4242/view/alices-ledger'
  const DAVID = 'http://david.localhost:4242/view/davids-ledger'
  const TXN = 'http://demo.localhost:4242/view/repairs-for-david-3-september'
  const txnText = [
    `GIVER: [[Alice's Ledger]]`,
    `RECEIVER: [${DAVID} David's Ledger]`,
    'HOURS: 1 hour',
    'DATE: 3 September 2026',
    'WHAT: Repairs',
    'SOURCE: audio note',
    'Fixed the shed door and re-hung the gate.'
  ].join('\n')
  const txnPage = { title: 'Repairs for David, 3 September', story: [{ type: 'markdown', id: 'm1', text: 'intro' }, { type: 'transaction', id: 't1', text: txnText }] }
  const alice = { site: 'demo.localhost:4242', slug: 'alices-ledger' }
  const david = { site: 'david.localhost:4242', slug: 'davids-ledger' }

  describe('the transaction item', () => {
    test('facts: giver on the page site, receiver by external link, minutes, date, label, source, note', () => {
      const f = parseTransaction(txnText, { site: 'demo.localhost:4242', slug: 'repairs-for-david-3-september', title: 'Repairs for David, 3 September', itemId: 't1' })
      assert.equal(f.valid, true)
      assert.deepEqual(f.giver, { name: "Alice's Ledger", slug: 'alices-ledger', site: 'demo.localhost:4242', external: false })
      assert.equal(f.receiver.site, 'david.localhost:4242')
      assert.equal(f.receiver.slug, 'davids-ledger')
      assert.equal(f.receiver.external, true)
      assert.equal(f.minutes, 60)
      assert.equal(f.time, 1)
      assert.equal(new Date(f.date).getUTCDate(), 3)
      assert.equal(f.label, 'Repairs')
      assert.equal(f.source, 'audio note')
      assert.equal(f.note, 'Fixed the shed door and re-hung the gate.')
      assert.deepEqual(f.page, { site: 'demo.localhost:4242', slug: 'repairs-for-david-3-september', title: 'Repairs for David, 3 September', itemId: 't1' })
    })

    test('missing parties or hours make it invalid; the label defaults to the page title', () => {
      const f = parseTransaction('HOURS: 2\nGIVER: [[A]]', { site: 'x.wiki', title: 'Soup Night' })
      assert.equal(f.valid, false)
      assert.equal(f.label, 'Soup Night')
      assert.equal(f.page.slug, 'soup-night')
    })

    test('hours in every ledger spelling', () => {
      assert.equal(parseMinutes('2'), 120)
      assert.equal(parseMinutes('1.5h'), 90)
      assert.equal(parseMinutes('90 minutes'), 90)
      assert.equal(parseMinutes('30 mins'), 30)
      assert.equal(parseMinutes('two'), null)
      assert.equal(minutesText(60), '1 hour')
      assert.equal(minutesText(120), '2 hours')
      assert.equal(minutesText(90), '90 minutes')
    })

    test('pageTransactions reads every transaction item on a page', () => {
      const [f] = pageTransactions(txnPage, 'demo.localhost:4242')
      assert.equal(f.page.slug, 'repairs-for-david-3-september')
      assert.equal(f.page.itemId, 't1')
    })
  })

  describe('label links to the transaction page', () => {
    test('a [[wikilink]] label is the transaction page on the ledger\'s own site', () => {
      const [e] = parseEntries(`[[Repairs for David, 3 September]] for [${DAVID} David's Ledger]: 1 hour`)
      assert.equal(e.linked, true)
      assert.equal(e.direction, 'gave')
      assert.equal(e.label, 'Repairs for David, 3 September')
      assert.deepEqual(e.txn, { title: 'Repairs for David, 3 September', slug: 'repairs-for-david-3-september', external: false })
      assert.equal(e.counterparty.site, 'david.localhost:4242')
    })

    test('an external-link label names a transaction page on another site', () => {
      const [e] = parseEntries(`[${TXN} Repairs for David, 3 September] from [${ALICE} Alice's Ledger]: 1 hour`)
      assert.equal(e.direction, 'received')
      assert.equal(e.txn.site, 'demo.localhost:4242')
      assert.equal(e.txn.slug, 'repairs-for-david-3-september')
      assert.equal(e.txn.external, true)
      assert.equal(e.counterparty.slug, 'alices-ledger')
    })

    test('a plain label or a label with more than a link has no transaction page', () => {
      assert.equal(parseEntries(`Repairs for [${ALICE} A]: 1h`)[0].txn, null)
      assert.equal(parseEntries(`Repairs, see [[X]] for [${ALICE} A]: 1h`)[0].txn, null)
      assert.equal(txnRefOf('[[Soup]]').slug, 'soup')
    })

    test('LINEUP and TOOL are commands, never entries or caption', () => {
      assert.ok(isCommand('LINEUP'))
      assert.ok(isCommand('tool'))
      assert.ok(!isCommand('Lineup of dancers.'))
      const c = extractCommands('LINEUP\nGardening: 1h')
      assert.equal(c.lineup, true)
      assert.equal(c.tool, false)
      assert.equal(parseEntries('LINEUP\nTOOL\nGardening: 1h').length, 1)
    })
  })

  describe('shared transaction page is the strongest match', () => {
    const aliceLines = `[[Repairs for David, 3 September]] for [${DAVID} David's Ledger]: 1 hour`
    const davidLines = `[${TXN} Repairs for David, 3 September] from [${ALICE} Alice's Ledger]: 1 hour`
    const pages = {
      'demo.localhost:4242/alices-ledger': { title: "Alice's Ledger", story: [{ type: 'timebank', id: 'a', text: 'START: 1 September 2026\nEND: 7 September 2026\n' + aliceLines }] },
      'david.localhost:4242/davids-ledger': { title: "David's Ledger", story: [{ type: 'timebank', id: 'd', text: davidLines }] },
      'demo.localhost:4242/repairs-for-david-3-september': txnPage
    }
    const fetchPage = async (site, slug) => pages[`${site}/${slug}`] || null

    test('both ledgers link one page: matched by page, from both sides', async () => {
      const a = await verifyItem({ text: aliceLines }, { title: "Alice's Ledger", slug: 'alices-ledger', site: 'demo.localhost:4242', fetchPage })
      assert.equal(a.status, 'ok')
      assert.equal(a.counterparties[0].matched[0].matchedBy, 'page')
      const d = await verifyItem({ text: davidLines }, { title: "David's Ledger", slug: 'davids-ledger', site: 'david.localhost:4242', fetchPage })
      assert.equal(d.status, 'ok')
      assert.equal(d.counterparties[0].matched[0].matchedBy, 'page')
    })

    test('the page match needs no agreement on label or hours; label matching stays the fallback', () => {
      const mine = parseEntries(`[${TXN} Shed door] from [${ALICE} Alice's Ledger]: 90 minutes`).map(e => e)
      const theirs = parseEntries(`[[Repairs for David, 3 September]] for [${DAVID} David's Ledger]: 1 hour`)
        .map(e => ({ ...e, counterparty: { ...e.counterparty }, txn: { ...e.txn, site: 'demo.localhost:4242' }, period: null }))
      const m = matchLedgers(mine, theirs, { slug: 'davids-ledger', site: 'david.localhost:4242' })
      assert.equal(m.matched.length, 1)
      assert.equal(m.matched[0].by, 'page')
      const plain = matchLedgers(parseEntries(`Repairs from [${ALICE} A]: 1 hour`), theirs.map(f => ({ ...f, label: 'Repairs', txn: null })), { slug: 'davids-ledger', site: 'david.localhost:4242' })
      assert.equal(plain.matched[0].by, 'label')
    })

    test('two different pages never match by label', () => {
      const mine = parseEntries(`[http://demo.localhost:4242/view/other-page Repairs] from [${ALICE} A]: 1 hour`)
      const theirs = parseEntries(`[[Repairs]] for [${DAVID} D]: 1 hour`).map(e => ({ ...e, txn: { ...e.txn, site: 'demo.localhost:4242' }, period: null }))
      assert.equal(matchLedgers(mine, theirs, { slug: 'davids-ledger', site: 'david.localhost:4242' }).matched.length, 0)
    })

    test('a matched pair with no page is valid: ok, and no sign-off rows', async () => {
      const p = { 'b.wiki/b': { title: 'B', story: [{ type: 'timebank', text: 'Soup from [https://a.wiki/view/a A]: 1h' }] } }
      const r = await verifyItem({ text: 'Soup for [https://b.wiki/view/b B]: 1h' }, { title: 'A', slug: 'a', site: 'a.wiki', fetchPage: async (s, slug) => p[`${s}/${slug}`] || null })
      assert.equal(r.status, 'ok')
      assert.deepEqual(await signOffs(r, { fetchPage: async () => null }), [])
    })
  })

  describe('thaw: the lineup gather', () => {
    const facts = pageTransactions(txnPage, 'demo.localhost:4242')

    test('the line a transaction implies, from each side', () => {
      assert.equal(entryLineFor(facts[0], alice), `2026-09-03 [[Repairs for David, 3 September]] for [${DAVID} David's Ledger]: 1 hour`)
      assert.equal(entryLineFor(facts[0], david), `2026-09-03 [${TXN} Repairs for David, 3 September] from [${ALICE} Alice's Ledger]: 1 hour`)
      assert.equal(entryLineFor(facts[0], { site: 'demo.localhost:4242', slug: 'bobs-ledger' }), null)
    })

    test('pulled entries for a ledger that has not written the line', () => {
      const { pulled, frozen, stale } = pullEntries([...facts, ...facts], david, parseEntries('START: 1 September 2026'))
      assert.equal(pulled.length, 1, 'the same item gathered twice counts once')
      assert.equal(pulled[0].pulled, true)
      assert.equal(pulled[0].direction, 'received')
      assert.equal(pulled[0].txn.site, 'demo.localhost:4242')
      assert.deepEqual([frozen.length, stale.length], [0, 0])
    })

    test('a written line linking the same page is frozen, not shown twice; a differing one is stale', () => {
      const written = parseEntries(`[${TXN} Repairs for David, 3 September] from [${ALICE} Alice's Ledger]: 1 hour`)
      const a = pullEntries(facts, david, written)
      assert.deepEqual([a.pulled.length, a.frozen.length, a.stale.length], [0, 1, 0])
      const old = parseEntries(`[${TXN} Repairs for David, 3 September] from [${ALICE} Alice's Ledger]: 2 hours`)
      const b = pullEntries(facts, david, old)
      assert.deepEqual([b.pulled.length, b.frozen.length, b.stale.length], [0, 0, 1])
    })

    test('the pulled entry verifies against the giver\'s ledger by page', async () => {
      const { pulled } = pullEntries(facts, david, [])
      const aliceLedger = { title: "Alice's Ledger", story: [{ type: 'timebank', text: `[[Repairs for David, 3 September]] for [${DAVID} David's Ledger]: 1 hour` }] }
      const r = await verifyItem({ text: 'LINEUP' }, { title: "David's Ledger", slug: 'davids-ledger', site: 'david.localhost:4242', pulled, fetchPage: async (s, slug) => slug === 'alices-ledger' ? aliceLedger : null })
      assert.equal(r.status, 'ok')
      assert.equal(r.lineup, true)
      assert.equal(r.pulled, 1)
      assert.equal(r.counterparties[0].matched[0].pulled, true)
    })
  })

  describe('freeze', () => {
    const facts = pageTransactions(txnPage, 'demo.localhost:4242')
    test('writes pulled lines after the last entry, keeps LINEUP and the caption', () => {
      const text = 'START: 1 September 2026\nLINEUP\nSoup for [[Bob]]: 1h\nDavid\'s week.'
      const { pulled } = pullEntries(facts, david, parseEntries(text))
      const out = freezeText(text, pulled, [])
      assert.deepEqual(out.split('\n'), ['START: 1 September 2026', 'LINEUP', 'Soup for [[Bob]]: 1h', pulled[0].raw, "David's week."])
      assert.equal(pullEntries(facts, david, parseEntries(out)).pulled.length, 0, 'thawing again adds nothing twice')
      assert.equal(freezeText(out, pulled, []), out, 'freezing twice is a no-op')
    })

    test('with no entries yet the line goes after the commands', () => {
      const { pulled } = pullEntries(facts, david, [])
      assert.deepEqual(freezeText('LINEUP\nA caption sentence here.', pulled, []).split('\n'), ['LINEUP', pulled[0].raw, 'A caption sentence here.'])
    })

    test('a stale line is replaced by the page\'s current facts', () => {
      const text = `LINEUP\n[${TXN} Repairs for David, 3 September] from [${ALICE} Alice's Ledger]: 2 hours`
      const { stale } = pullEntries(facts, david, parseEntries(text))
      assert.equal(freezeText(text, [], stale), `LINEUP\n2026-09-03 [${TXN} Repairs for David, 3 September] from [${ALICE} Alice's Ledger]: 1 hour`)
    })
  })

  describe('sign-off', () => {
    test('giver side: accepted when the receiver\'s ledger holds the line, dialogue when they forked, else awaiting', () => {
      assert.equal(signOffState({ direction: 'gave', matched: true }), 'accepted')
      assert.equal(signOffState({ direction: 'gave', matched: false, fork: true }), 'dialogue')
      assert.equal(signOffState({ direction: 'gave', matched: false }), 'awaiting')
    })

    test('receiver side: a written line is the sign-off; a pulled one awaits freeze', () => {
      assert.equal(signOffState({ direction: 'received', pulled: false }), 'accepted')
      assert.equal(signOffState({ direction: 'received', pulled: true }), 'awaiting')
      assert.equal(signOffState({ direction: 'received', pulled: true, fork: true }), 'dialogue')
    })

    test('fork comments are the items the original does not have', () => {
      const fork = { story: [...txnPage.story, { type: 'markdown', id: 'q1', text: 'Was it one hour or two?' }] }
      assert.equal(forkComments(txnPage, fork), 1)
      assert.equal(forkComments(txnPage, null), 0)
    })

    test('signOffs: awaiting until David writes the line, in dialogue once he forks the page', async () => {
      const aliceText = `[[Repairs for David, 3 September]] for [${DAVID} David's Ledger]: 1 hour`
      const pages = { 'demo.localhost:4242/repairs-for-david-3-september': txnPage, 'david.localhost:4242/davids-ledger': { title: "David's Ledger", story: [] } }
      const fetchPage = async (s, slug) => pages[`${s}/${slug}`] || null
      const ctx = { title: "Alice's Ledger", slug: 'alices-ledger', site: 'demo.localhost:4242', fetchPage }
      let r = await verifyItem({ text: aliceText }, ctx)
      let [s] = await signOffs(r, ctx)
      assert.equal(s.state, 'awaiting')
      assert.equal(s.reachable, true)
      pages['david.localhost:4242/repairs-for-david-3-september'] = { story: [...txnPage.story, { type: 'markdown', id: 'q1', text: 'A query' }] }
      r = await verifyItem({ text: aliceText }, ctx)
      ;[s] = await signOffs(r, ctx)
      assert.equal(s.state, 'dialogue')
      assert.equal(s.forkSite, 'david.localhost:4242')
      assert.equal(s.comments, 1)
      pages['david.localhost:4242/davids-ledger'] = { title: "David's Ledger", story: [{ type: 'timebank', text: `[${TXN} Repairs for David, 3 September] from [${ALICE} Alice's Ledger]: 1 hour` }] }
      r = await verifyItem({ text: aliceText }, ctx)
      ;[s] = await signOffs(r, ctx)
      assert.equal(s.state, 'accepted')
    })
  })

  describe('the report for Phase 7', () => {
    const pages = { 'demo.localhost:4242/repairs-for-david-3-september': txnPage }
    const fetchPage = async (s, slug) => pages[`${s}/${slug}`] || null

    test('transaction pages, sign-off pills, a freeze button and create-from-template offers', async () => {
      const facts = pageTransactions(txnPage, 'demo.localhost:4242')
      const text = `LINEUP\nSoup for [${ALICE} Alice's Ledger]: 1 hour`
      const pull = pullEntries(facts, david, parseEntries(text))
      const ctx = { title: "David's Ledger", slug: 'davids-ledger', site: 'david.localhost:4242', fetchPage, pulled: pull.pulled }
      const r = await verifyItem({ text }, ctx)
      const html = renderReport({ result: r, signoffs: await signOffs(r, ctx), groups: findCandidates(r, {}), freeze: pull, context: ['david.localhost:4242'] })
      assert.ok(html.includes('data-page-name="repairs-for-david-3-september"'))
      assert.ok(html.includes('title="demo.localhost:4242 =&gt; david.localhost:4242"') || html.includes('title="demo.localhost:4242 => david.localhost:4242"'))
      assert.ok(html.includes('timebank-badge partial" style="margin-left:0">awaiting sign-off<'))
      assert.ok(html.includes('<button data-timebank-action="freeze">Freeze 1 entry into the ledger</button>'))
      assert.ok(html.includes('timebank-badge pending" style="margin-left:0">pulled<'))
      assert.ok(html.includes('data-page-name="soup-for-alice"'), 'an entry with no page is offered a new page, named for the work and the person')
      assert.ok(html.includes('create from Time Transaction Template'))
    })

    test('suggested titles and sitemap candidates', () => {
      const [e] = parseEntries(`Gardening for [${ALICE} Alice's Ledger]: 2 hours`)
      assert.equal(suggestTitle(e), 'Gardening for Alice')
      const [r] = parseEntries(`Soup from [${ALICE} Alice’s Ledger]: 1 hour`)
      assert.equal(suggestTitle(r), 'Soup from Alice')
      const map = [
        { slug: 'repairs-for-david-3-september', links: { 'time-transaction': 'x', 'alices-ledger': 'y' } },
        { slug: 'time-transaction-template', links: { 'time-transaction': 'x' } },
        { slug: 'welcome-visitors', links: {} },
        { slug: 'no-links' }
      ]
      assert.deepEqual(transactionCandidates(map).map(p => p.slug), ['repairs-for-david-3-september'])
      assert.deepEqual(transactionCandidates(null), [])
    })
  })

  describe('links drawn after emit', () => {
    test('resolveLike writes what wiki.resolveLinks writes, with an explicit search path', () => {
      const html = resolveLike(`[[Repairs for David]] for [${DAVID} David's Ledger]: 1 hour <b>`, ['demo.localhost:4242', 'view'])
      assert.ok(html.startsWith('<a class="internal" href="/repairs-for-david.html" data-page-name="repairs-for-david" title="demo.localhost:4242 =&gt; view">Repairs for David</a>'))
      assert.ok(html.includes(`<a class="external" target="_blank" href="${DAVID}" title="${DAVID}" rel="noopener">David&#39;s Ledger <img src="/images/external-link-ltr-icon.png"></a>`) || html.includes("David's Ledger <img"))
      assert.ok(html.endsWith('1 hour &lt;b&gt;'))
    })

    test('an internal anchor for a page on another site searches that site first', () => {
      assert.ok(internalAnchor('X', ['a.wiki', 'b.wiki'], 'b.wiki').includes('title="b.wiki =&gt; a.wiki"'))
    })
  })
})

describe('timebank 0.4.0 forks of a transaction page', () => {
  const { pageTransactions, pullEntries, signOffs, verifyItem, forkedFrom } = timebank
  const DAVID = 'http://david.localhost:4242/view/davids-ledger'
  const ALICE = 'http://demo.localhost:4242/view/alices-ledger'
  const soup = {
    title: 'Soup for Alice, 5 September',
    story: [{ type: 'transaction', id: 's1', text: `GIVER: [${DAVID} David's Ledger]\nRECEIVER: [${ALICE} Alice's Ledger]\nHOURS: 1 hour\nWHAT: Soup` }],
    journal: [{ type: 'create' }]
  }
  const fork = { ...soup, story: [...soup.story, { type: 'markdown', id: 'q', text: 'Was it longer?' }], journal: [{ type: 'create' }, { type: 'fork', site: 'david.localhost:4242' }] }
  const alice = { site: 'demo.localhost:4242', slug: 'alices-ledger' }

  test('the original in the lineup and the fork on the own site are one transaction', () => {
    const facts = [...pageTransactions(soup, 'david.localhost:4242'), ...pageTransactions(fork, 'demo.localhost:4242')]
    const { pulled } = pullEntries(facts, alice, [])
    assert.equal(pulled.length, 1)
    assert.equal(pulled[0].txn.site, 'david.localhost:4242', 'the first gathered, the lineup copy, wins')
  })

  test('forkedFrom reads the journal', () => {
    assert.equal(forkedFrom(fork, 'demo.localhost:4242'), 'david.localhost:4242')
    assert.equal(forkedFrom(soup, 'david.localhost:4242'), null)
  })

  test('a pulled entry from the receiver\'s own fork is in dialogue, counting her comments', async () => {
    const { pulled } = pullEntries(pageTransactions(fork, 'demo.localhost:4242'), alice, [])
    const pages = { 'demo.localhost:4242/soup-for-alice-5-september': fork, 'david.localhost:4242/soup-for-alice-5-september': soup }
    const ctx = { title: "Alice's Ledger", slug: 'alices-ledger', site: 'demo.localhost:4242', pulled, fetchPage: async (s, slug) => pages[`${s}/${slug}`] || null }
    const r = await verifyItem({ text: 'LINEUP' }, ctx)
    const [s] = await signOffs(r, ctx)
    assert.equal(s.state, 'dialogue')
    assert.equal(s.comments, 1)
  })
})

test('a line written against the original page freezes the fork gathered on the own site too', () => {
  const { pageTransactions, pullEntries, parseEntries } = timebank
  const soup = { title: 'Soup for Alice, 5 September', story: [{ type: 'transaction', id: 's1', text: 'GIVER: [http://david.localhost:4242/view/davids-ledger D]\nRECEIVER: [http://demo.localhost:4242/view/alices-ledger A]\nHOURS: 1 hour' }] }
  const written = parseEntries('[http://david.localhost:4242/view/soup-for-alice-5-september Soup for Alice, 5 September] from [http://david.localhost:4242/view/davids-ledger D]: 1 hour')
  const r = pullEntries(pageTransactions(soup, 'demo.localhost:4242'), { site: 'demo.localhost:4242', slug: 'alices-ledger' }, written)
  assert.deepEqual([r.pulled.length, r.frozen.length], [0, 1])
})

describe('timebank 0.5.0 Thank You Invoice: watched sites, awaiting, Reconcile', () => {
  const {
    extractCommands, parseWatch, isCommand, extractCaption, parseEntries, pageTransactions, watchedSites,
    awaitingEntries, awaitingMinutes, reconcilePlan, pullEntries, verifyItem, renderReport, renderAwaiting, awaitingText
  } = timebank

  const ALICE = 'https://timebank.private.fish/view/alices-ledger'
  const DAVID = 'https://ledger.timebank.private.fish/view/davids-ledger'
  const PAGE = 'https://ledger.timebank.private.fish/view/event-help-from-alice-23-september'
  // A thank-you: David (receiver) wrote this on his own site, naming Alice as giver.
  const thanksText = [
    `GIVER: [${ALICE} Alice's Ledger]`,
    `RECEIVER: [${DAVID} David's Ledger]`,
    'HOURS: 6 hours',
    'DATE: 23 September 2026',
    'WHAT: Event help',
    'SOURCE: chat message'
  ].join('\n')
  const thanksPage = { title: 'Event help from Alice, 23 September', story: [{ type: 'markdown', id: 'm1', text: 'This page is a [[Time Transaction]].' }, { type: 'transaction', id: 'tx1', text: thanksText }] }
  const facts = pageTransactions(thanksPage, 'ledger.timebank.private.fish')
  const alice = { site: 'timebank.private.fish', slug: 'alices-ledger' }
  const aliceText = [
    'START: 1 September 2026',
    'END: 30 September 2026',
    'WATCH: ledger.timebank.private.fish',
    `Gardening from [${DAVID} David's Ledger]: 2 hours`,
    'Two swaps with David across sites.'
  ].join('\n')

  describe('the WATCH command', () => {
    test('WATCH lists sites, from bare hosts, urls and commas, deduplicated', () => {
      assert.deepEqual(parseWatch('a.site, https://B.site/view/x c.site:4242 //d.site'), ['a.site', 'b.site', 'c.site:4242', 'd.site'])
      const c = extractCommands('WATCH: a.site\nWATCH: a.site b.site')
      assert.deepEqual(c.watch, ['a.site', 'b.site'])
      assert.deepEqual(parseWatch('not a site!'), ['not', 'a'])
    })
    test('a WATCH line is a command: it never leaks into the caption or the entries', () => {
      assert.ok(isCommand('WATCH: ledger.timebank.private.fish'))
      assert.equal(extractCaption(aliceText), 'Two swaps with David across sites.')
      assert.equal(parseEntries(aliceText).length, 1)
    })
  })

  describe('watched sites', () => {
    test('WATCH lines first, then counterparty sites, never the own site', () => {
      const text = `WATCH: other.site, timebank.private.fish\nSoup for [https://third.site/view/bobs-ledger Bob's Ledger]: 1 hour\n${aliceText}`
      assert.deepEqual(watchedSites(text, 'timebank.private.fish'), ['other.site', 'ledger.timebank.private.fish', 'third.site'])
    })
    test('a ledger naming no one and watching nothing watches no site', () => {
      assert.deepEqual(watchedSites('Admin: 1 hour', 'timebank.private.fish'), [])
    })
  })

  describe('awaiting reconcile', () => {
    test('the giver\'s ledger finds the thank-you written on the receiver\'s site', () => {
      const awaiting = awaitingEntries(facts, alice, parseEntries(aliceText), [])
      assert.equal(awaiting.length, 1)
      assert.equal(awaiting[0].awaiting, true)
      assert.equal(awaiting[0].direction, 'gave')
      assert.equal(awaiting[0].raw, `2026-09-23 [${PAGE} Event help from Alice, 23 September] for [${DAVID} David's Ledger]: 6 hours`)
      assert.equal(awaitingMinutes(awaiting), 360)
      assert.equal(awaitingText(awaiting), '6h awaiting reconcile')
    })
    test('a line already written for the page is not awaiting', () => {
      const text = `${aliceText}\n[${PAGE} Event help from Alice, 23 September] for [${DAVID} David's Ledger]: 6 hours`
      assert.equal(awaitingEntries(facts, alice, parseEntries(text), []).length, 0)
    })
    test('an entry already pulled from the lineup is not counted twice', () => {
      const { pulled } = pullEntries(facts, alice, [])
      assert.equal(awaitingEntries(facts, alice, [], pulled).length, 0)
    })
    test('pages on the ledger\'s own site are LINEUP\'s business, not awaiting', () => {
      const own = pageTransactions(thanksPage, 'timebank.private.fish')
      assert.equal(awaitingEntries(own, alice, [], []).length, 0)
    })
    test('a page naming someone else is ignored', () => {
      assert.equal(awaitingEntries(facts, { site: 'timebank.private.fish', slug: 'bobs-ledger' }, [], []).length, 0)
    })
    test('the awaiting entry is not part of the verification count', async () => {
      const davidLedger = { title: "David's Ledger", story: [{ type: 'timebank', text: `Gardening for [${ALICE} Alice's Ledger]: 2 hours` }] }
      const r = await verifyItem({ text: aliceText }, { title: "Alice's Ledger", slug: 'alices-ledger', site: 'timebank.private.fish', fetchPage: async () => davidLedger })
      assert.equal(r.linked, 1)
      assert.equal(r.status, 'ok')
    })
  })

  describe('Reconcile, the pure part', () => {
    const awaiting = awaitingEntries(facts, alice, parseEntries(aliceText), [])
    test('forks the page to the ledger\'s site and freezes its line after the last entry', () => {
      const plan = reconcilePlan(aliceText, awaiting, ['alices-ledger'])
      assert.deepEqual(plan.forks, [{ site: 'ledger.timebank.private.fish', slug: 'event-help-from-alice-23-september', title: 'Event help from Alice, 23 September' }])
      assert.deepEqual(plan.kept, [])
      const lines = plan.text.split('\n')
      assert.equal(lines[4], awaiting[0].raw)
      assert.equal(lines[5], 'Two swaps with David across sites.')
      assert.equal(awaitingEntries(facts, alice, parseEntries(plan.text), []).length, 0, 'nothing awaits after reconcile')
    })
    test('never forks over a page the ledger\'s site already holds by that slug', () => {
      const plan = reconcilePlan(aliceText, awaiting, ['event-help-from-alice-23-september'])
      assert.deepEqual(plan.forks, [])
      assert.equal(plan.kept.length, 1)
      assert.ok(plan.text.includes(awaiting[0].raw))
    })
    test('the frozen line matches the receiver\'s line by page, so the pair verifies green', async () => {
      const { text } = reconcilePlan(aliceText, awaiting, [])
      const davidLedger = { title: "David's Ledger", story: [{ type: 'timebank', text: [
        `Gardening for [${ALICE} Alice's Ledger]: 2 hours`,
        `[[Event help from Alice, 23 September]] from [${ALICE} Alice's Ledger]: 6 hours`
      ].join('\n') }] }
      const r = await verifyItem({ text }, { title: "Alice's Ledger", slug: 'alices-ledger', site: 'timebank.private.fish', fetchPage: async () => davidLedger })
      assert.equal(r.status, 'ok')
      assert.equal(r.matched.length, 2)
      assert.equal(r.counterparties[0].matched.find(e => e.txn).matchedBy, 'page')
    })
  })

  describe('the report', () => {
    const awaiting = awaitingEntries(facts, alice, parseEntries(aliceText), [])
    const result = { title: "Alice's Ledger", site: 'timebank.private.fish', slug: 'alices-ledger', status: 'ok', linked: 1, matched: ['k'], unmatched: [], unreachable: [], counterparties: [], pulled: 0, notify: null }
    test('Awaiting reconcile lists the page and offers Reconcile, owner login stated', () => {
      const html = renderAwaiting(result, awaiting, ['ledger.timebank.private.fish'])
      assert.ok(html.includes('Awaiting reconcile'))
      assert.ok(html.includes(`href="${PAGE}"`))
      assert.ok(html.includes('data-timebank-action="reconcile"'))
      assert.ok(html.includes('6h awaiting reconcile'))
      assert.ok(html.includes('logged in as the owner of timebank.private.fish'))
    })
    test('with nothing awaiting it says what is watched, and how to watch when nothing is', () => {
      assert.ok(renderAwaiting(result, [], ['ledger.timebank.private.fish']).includes('Watched: ledger.timebank.private.fish'))
      assert.ok(renderAwaiting(result, [], []).includes('WATCH: ledger.timebank.private.fish'))
    })
    test('renderReport carries the awaiting headline and section only when asked', () => {
      const html = renderReport({ result, awaiting, watched: ['ledger.timebank.private.fish'] })
      assert.ok(html.includes('1 transaction page on watched sites names this ledger'))
      assert.ok(!renderReport({ result }).includes('Awaiting reconcile'))
    })
  })
})

describe('shared fixtures for the broker report tool (tools/timebank_report.py)', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/transactions.json', import.meta.url), 'utf8'))
  const { parseTransaction, parseMinutes, parseDate, parseLedgerUrl, sameSite } = timebank
  for (const c of fixtures.cases) {
    test(`parseTransaction: ${c.name}`, () => {
      assert.deepEqual(JSON.parse(JSON.stringify(parseTransaction(c.text, c.page))), c.expect)
    })
  }
  test('minutes, dates, ledger addresses and sites', () => {
    for (const [s, want] of fixtures.minutes) assert.equal(parseMinutes(s), want, s)
    for (const [s, want] of fixtures.dates) assert.equal(parseDate(s), want, s)
    for (const [s, want] of fixtures.urls) assert.deepEqual(parseLedgerUrl(s), want, s)
    for (const [a, b, want] of fixtures.sameSite) assert.equal(sameSite(a, b), want, `${a} ${b}`)
  })
})

// --- 0.6.0: occasions, period ledgers, summary, index, balance ---

const {
  periodOfTitle, periodPagesOf, ledgersInSitemap, identitySlug, monthBounds, periodLedger, aggregateStatus,
  summariseLedger, classifyOccasions, stateCounts, orphanPlan, indexCandidates, ownerName, signedHours,
  renderSummary, renderBalance, renderIndex, claimWritten: claimW, occasionKey, inPeriod, personOf: personOfName,
  counterpartyEntries, pageTransactions, pullEntries, isoDay
} = timebank

describe('timebank 0.6.0 recurring work: page plus item', () => {
  const A = 'http://alice.localhost:4242/view/alices-ledger'
  const D = 'http://david.localhost:4242/view/davids-ledger'
  const P = 'http://alice.localhost:4242/view/childcare-for-david'
  const item = (id, date, hours) => ({ type: 'transaction', id, text: `GIVER: [${A} Alice's Ledger]\nRECEIVER: [${D} David's Ledger]\nHOURS: ${hours}\nDATE: ${date}\nWHAT: Childcare` })
  const page = { title: 'Childcare for David', story: [item('c1', '18 June 2026', '3 hours'), { type: 'date', id: 'd2', text: '2026-07-16 Childcare for David' }, item('c2', '16 July 2026', '3 hours'), item('c3', '10 September 2026', '4 hours')] }
  const facts = pageTransactions(page, 'alice.localhost:4242', 'childcare-for-david')
  const david = { site: 'david.localhost:4242', slug: 'davids-ledger' }

  test('one fact per transaction item, each an occasion of the page', () => {
    assert.equal(facts.length, 3)
    assert.deepEqual(facts.map(f => f.occasion), [{ n: 1, of: 3 }, { n: 2, of: 3 }, { n: 3, of: 3 }])
    assert.deepEqual(facts.map(occasionKey), ['childcare-for-david#c1', 'childcare-for-david#c2', 'childcare-for-david#c3'])
  })

  test('a dated line names its occasion; the date prefix is parsed off the label', () => {
    const [e] = parseEntries(`2026-07-16 [${P} Childcare for David] from [${A} Alice's Ledger]: 3 hours`)
    assert.equal(e.linked, true)
    assert.equal(e.label, 'Childcare for David')
    assert.equal(e.txn.slug, 'childcare-for-david')
    assert.equal(e.date, parseDate('16 July 2026'))
  })

  test('pulled lines carry the date, and each written line holds one occasion', () => {
    const written = parseEntries(`2026-06-18 [${P} Childcare for David] from [${A} Alice's Ledger]: 3 hours\n2026-07-16 [${P} Childcare for David] from [${A} Alice's Ledger]: 3 hours`)
    const { pulled, frozen, stale } = pullEntries(facts, david, written)
    assert.deepEqual([pulled.length, frozen.length, stale.length], [1, 2, 0])
    assert.ok(pulled[0].raw.startsWith('2026-09-10 [http://alice.localhost:4242/view/childcare-for-david Childcare for David] from'))
    assert.equal(pulled[0].facts.page.itemId, 'c3')
  })

  test('an undated line claims the occasion of the same minutes, once', () => {
    const written = parseEntries(`[${P} Childcare for David] from [${A} Alice's Ledger]: 4 hours`)
    const used = new Set()
    const e3 = pullEntries([facts[2]], david, []).pulled[0]
    const e1 = pullEntries([facts[0]], david, []).pulled[0]
    assert.equal(claimW(written, e3, used, david.site), written[0])
    assert.equal(claimW(written, e1, used, david.site), null, 'a claimed line holds no second occasion')
  })

  test('a period ledger pulls only the occasions dated inside it', () => {
    const period = { start: parseDate('1 July 2026'), end: parseDate('31 July 2026') }
    const { pulled } = pullEntries(facts, david, [], period)
    assert.deepEqual(pulled.map(e => e.facts.page.itemId), ['c2'])
    assert.equal(inPeriod({ date: null }, period), false)
    assert.equal(inPeriod({ date: null }, null), true)
  })

  test('the matcher pairs page plus occasion: dated lines by day, never across days', () => {
    const mine = parseEntries(`2026-06-18 [${P} Childcare for David] from [${A} Alice's Ledger]: 3 hours\n2026-07-16 [${P} Childcare for David] from [${A} Alice's Ledger]: 3 hours`)
      .map(e => ({ ...e, counterparty: { ...e.counterparty } }))
    const theirs = parseEntries(`2026-07-16 [[Childcare for David]] for [${D} David's Ledger]: 3 hours\n2026-09-10 [[Childcare for David]] for [${D} David's Ledger]: 4 hours`)
      .map(e => ({ ...e, txn: { ...e.txn, site: 'alice.localhost:4242' }, period: null }))
    const m = matchLedgers(mine, theirs, { slug: 'davids-ledger', site: 'david.localhost:4242' })
    assert.equal(m.matched.length, 1)
    assert.equal(m.matched[0].mine.date, parseDate('16 July 2026'))
    assert.equal(m.matched[0].by, 'page')
    assert.equal(m.unmatched[0].date, parseDate('18 June 2026'), 'the June line finds no June line on her side')
  })

  test('undated lines of a recurring page pair by minutes before any other', () => {
    const mine = parseEntries(`[${P} Childcare for David] from [${A} Alice's Ledger]: 4 hours\n[${P} Childcare for David] from [${A} Alice's Ledger]: 3 hours`)
    const theirs = parseEntries(`[[Childcare for David]] for [${D} David's Ledger]: 3 hours\n[[Childcare for David]] for [${D} David's Ledger]: 4 hours`)
      .map(e => ({ ...e, txn: { ...e.txn, site: 'alice.localhost:4242' }, period: null }))
    const m = matchLedgers(mine, theirs, { slug: 'davids-ledger', site: 'david.localhost:4242' })
    assert.deepEqual(m.matched.map(x => [x.mine.time, x.theirs.time]), [[4, 4], [3, 3]])
  })

  test('titles name the work and the person, with no date', () => {
    assert.equal(personOfName("Alice's Ledger"), 'Alice')
    assert.equal(personOfName('David Ledger'), 'David')
    assert.equal(personOfName('Known Ledgers'), 'Known Ledgers')
  })
})

describe('timebank 0.6.0 period ledgers and the summary', () => {
  const A = 'http://alice.localhost:4242/view/alices-ledger'
  const B = 'http://bob.localhost:4242/view/bobs-ledger'
  const sitemap = [
    { slug: 'alices-ledger', title: "Alice's Ledger", links: { 'about-alice': 'x' } },
    { slug: 'alices-ledger-2026-07', title: "Alice's Ledger 2026-07" },
    { slug: 'alices-ledger-2026-06', title: "Alice's Ledger 2026-06" },
    { slug: 'alices-ledger-2026-13', title: "Alice's Ledger 2026-13" },
    { slug: 'bobs-ledger-2026-06', title: "Bob's Ledger 2026-06" },
    { slug: 'gardening-for-bob', title: 'Gardening for Bob', links: { 'time-transaction': 'x' } },
    { slug: 'time-transaction-template', title: 'Time Transaction Template', links: { 'time-transaction': 'x' } }
  ]

  test('period titles, month bounds and the identity of a period page', () => {
    assert.deepEqual(periodOfTitle("Alice's Ledger 2026-09"), { base: "Alice's Ledger", month: '2026-09' })
    assert.equal(periodOfTitle("Alice's Ledger"), null)
    assert.equal(periodOfTitle('Report 2026-13'), null)
    const b = monthBounds('2026-02')
    assert.equal(b.start, parseDate('1 February 2026'))
    assert.equal(b.end, parseDate('28 February 2026'))
    assert.equal(identitySlug("Alice's Ledger 2026-09", 'alices-ledger-2026-09'), 'alices-ledger')
    assert.equal(identitySlug("Alice's Ledger", 'alices-ledger'), 'alices-ledger')
  })

  test('PERIODS discovery: period pages by title prefix from the sitemap, oldest first', () => {
    assert.deepEqual(periodPagesOf(sitemap, "Alice's Ledger").map(p => p.slug), ['alices-ledger-2026-06', 'alices-ledger-2026-07'])
    assert.deepEqual(ledgersInSitemap(sitemap).map(l => [l.slug, l.periods.length]), [['alices-ledger', 2], ['bobs-ledger', 1]])
    assert.deepEqual(extractCommands('OWNER: [[About Alice]]\nPERIODS: 5').periods, { recent: 5 })
    assert.equal(extractCommands('OWNER: [[About Alice]]\nPERIODS').owner.slug, 'about-alice')
    assert.equal(extractCommands('PERIODS').periods.recent, 10)
    assert.equal(ownerName({ name: 'About Alice' }), 'Alice')
  })

  test('the aggregate badge: the worst wins, empty periods do not count', () => {
    assert.equal(aggregateStatus(['ok', 'ok']), 'ok')
    assert.equal(aggregateStatus(['ok', 'partial', 'none']), 'partial')
    assert.equal(aggregateStatus(['partial', 'fail', 'ok']), 'fail')
    assert.equal(aggregateStatus(['none']), 'none')
    assert.equal(aggregateStatus([]), 'none')
  })

  const june = periodLedger({ title: "Alice's Ledger 2026-06", story: [{ type: 'timebank', id: 'j', text: `START: 1 June 2026\nEND: 30 June 2026\n2026-06-06 [[Gardening for Bob]] for [${B} Bob's Ledger]: 2 hours\n2026-06-20 [http://bob.localhost:4242/view/dog-walking-for-alice Dog walking for Alice] from [${B} Bob's Ledger]: 1.5 hours\nAdmin: 1 hour` }] }, { slug: 'alices-ledger-2026-06', month: '2026-06' })
  const july = periodLedger({ title: "Alice's Ledger 2026-07", story: [{ type: 'timebank', id: 'k', text: `START: 1 July 2026\nEND: 31 July 2026\nLINEUP\n2026-07-11 [[Gardening for Bob]] for [${B} Bob's Ledger]: 2 hours\n2026-07-02 [[Soup]] for [${B} Bob's Ledger]: 30 minutes` }] }, { slug: 'alices-ledger-2026-07', month: '2026-07' })

  test('a period page read from its site', () => {
    assert.equal(june.month, '2026-06')
    assert.equal(june.period.start, parseDate('1 June 2026'))
    assert.equal(july.lineup, true)
    assert.equal(june.written.filter(e => e.linked).length, 2)
  })

  test('BALANCE numbers: given, received and net across periods; the most recent first', () => {
    const s = summariseLedger([{ ...june, status: 'ok' }, { ...july, status: 'partial' }], { recent: 3 })
    assert.equal(s.given, 4.5)
    assert.equal(s.received, 1.5)
    assert.equal(s.net, 3)
    assert.equal(s.count, 4)
    assert.equal(s.status, 'partial')
    assert.deepEqual(s.periods.map(p => [p.month, p.given, p.received, p.net]), [['2026-06', 2, 1.5, 0.5], ['2026-07', 2.5, 0, 2.5]])
    assert.deepEqual(s.recent.map(e => isoDay(e.date)), ['2026-07-11', '2026-07-02', '2026-06-20'])
    assert.equal(signedHours(3, formatHours), '+3h')
    assert.equal(signedHours(-1.5, formatHours), '-1h 30m')
    assert.equal(signedHours(0, formatHours), '0h')
    const html = renderSummary({ ...s, title: "Alice's Ledger", site: 'alice.localhost:4242', owner: { name: 'About Alice', slug: 'about-alice' }, ownerName: 'Alice' })
    assert.ok(html.includes('net +3h'))
    assert.ok(html.includes('data-page-name="alices-ledger-2026-07"'))
    assert.ok(html.includes('data-page-name="about-alice"'))
    const bal = renderBalance({ ...s, title: "Alice's Ledger", site: 'alice.localhost:4242', ownerName: 'Alice' })
    assert.ok(bal.includes('+3h') && bal.includes('4h 30m') && bal.includes('1h 30m'))
    assert.ok(bal.includes('data-page-name="transactions-index"'))
  })

  test('a period page matches as the ledger it belongs to: a summary counterparty is read through its periods', async () => {
    const bobSummary = { title: "Bob's Ledger", story: [{ type: 'timebank', text: 'OWNER: [[About Bob]]\nPERIODS' }] }
    const bobJune = { title: "Bob's Ledger 2026-06", story: [{ type: 'timebank', text: `START: 1 June 2026\nEND: 30 June 2026\n2026-06-06 [http://alice.localhost:4242/view/gardening-for-bob Gardening for Bob] from [${A} Alice's Ledger]: 2 hours` }] }
    const bobJuly = { title: "Bob's Ledger 2026-07", story: [{ type: 'timebank', text: 'START: 1 July 2026\nEND: 31 July 2026' }] }
    const pages = { 'bobs-ledger': bobSummary, 'bobs-ledger-2026-06': bobJune, 'bobs-ledger-2026-07': bobJuly }
    const ctx = {
      title: "Alice's Ledger 2026-06", slug: 'alices-ledger', pageSlug: 'alices-ledger-2026-06', site: 'alice.localhost:4242',
      fetchPage: async (s, slug) => pages[slug] || null,
      fetchSitemap: async () => [{ slug: 'bobs-ledger', title: "Bob's Ledger" }, { slug: 'bobs-ledger-2026-06', title: "Bob's Ledger 2026-06" }, { slug: 'bobs-ledger-2026-07', title: "Bob's Ledger 2026-07" }]
    }
    const text = `START: 1 June 2026\nEND: 30 June 2026\n2026-06-06 [[Gardening for Bob]] for [${B} Bob's Ledger]: 2 hours`
    const r = await verifyItem({ text }, ctx)
    assert.equal(r.status, 'ok')
    assert.equal(r.pageSlug, 'alices-ledger-2026-06')
    assert.deepEqual(r.counterparties[0].periods, ['bobs-ledger-2026-06'], 'only the overlapping period page is read')
    const all = await counterpartyEntries(bobSummary, 'bob.localhost:4242', null, ctx)
    assert.deepEqual(all.periods, ['bobs-ledger-2026-06', 'bobs-ledger-2026-07'])
  })

  test('index candidates leave out the template, the topic and ledgers', () => {
    assert.deepEqual(indexCandidates(sitemap, ['alices-ledger']).map(p => p.slug), ['gardening-for-bob'])
  })
})

describe('timebank 0.6.0 Transactions Index classification', () => {
  const site = 'alice.localhost:4242'
  const A = 'http://alice.localhost:4242/view/alices-ledger'
  const B = 'http://bob.localhost:4242/view/bobs-ledger'
  const C = 'https://carol.timebank.example/view/carols-ledger'
  const txnPage = (title, date, hours, giver = A, receiver = B) => ({ title, story: [{ type: 'transaction', id: asSlug(title) + date.replace(/\s/g, ''), text: `GIVER: [${giver} G]\nRECEIVER: [${receiver} R]\nHOURS: ${hours}\nDATE: ${date}` }] })
  const facts = [
    ...pageTransactions(txnPage('Gardening for Bob', '6 June 2026', '2 hours'), site),
    ...pageTransactions(txnPage('Jam for Bob', '9 June 2026', '1 hour'), site),
    ...pageTransactions(txnPage('Soup for Bob', '2 July 2026', '30 minutes'), site),
    ...pageTransactions(txnPage('Plants for Bob', '4 August 2026', '1 hour'), site),
    ...pageTransactions(txnPage('Lesson for Carol', '5 June 2026', '1 hour', A, C), site),
    ...pageTransactions(txnPage('Bread for Bob', '7 July 2026', '1 hour', B, C), site)
  ]
  const june = periodLedger({ title: "Alice's Ledger 2026-06", story: [{ type: 'timebank', id: 'j', text: `START: 1 June 2026\nEND: 30 June 2026\n2026-06-06 [[Gardening for Bob]] for [${B} Bob's Ledger]: 2 hours` }] }, { slug: 'alices-ledger-2026-06', month: '2026-06' })
  const july = periodLedger({ title: "Alice's Ledger 2026-07", story: [{ type: 'timebank', id: 'k', text: 'START: 1 July 2026\nEND: 31 July 2026\nLINEUP' }] }, { slug: 'alices-ledger-2026-07', month: '2026-07' })
  const ledgers = [{ title: "Alice's Ledger", slug: 'alices-ledger', site, periods: [june, july] }]
  const rows = classifyOccasions(facts, ledgers, site)
  const state = t => rows.find(r => r.facts.page.title === t)

  test('logged, awaiting and orphan', () => {
    assert.equal(state('Gardening for Bob').state, 'logged')
    assert.equal(state('Gardening for Bob').period.slug, 'alices-ledger-2026-06')
    assert.equal(state('Soup for Bob').state, 'awaiting', 'July pulls it (LINEUP)')
    assert.equal(state('Jam for Bob').state, 'orphan', 'June is closed and has no line')
    assert.match(state('Plants for Bob').reason, /no period ledger holds 2026-08/)
    assert.equal(state('Lesson for Carol').state, 'orphan')
    assert.equal(state('Bread for Bob').reason, 'names no ledger on this site')
    assert.deepEqual(stateCounts(rows), { logged: 1, awaiting: 1, orphan: 4 })
  })

  test('Log the orphans: into the period that holds the date, or a new period page', () => {
    const plan = orphanPlan(rows, site)
    assert.deepEqual(plan.edits.map(e => [e.slug, e.lines.length]), [['alices-ledger-2026-06', 2]])
    assert.ok(plan.edits[0].text.includes('2026-06-09 [[Jam for Bob]] for [http://bob.localhost:4242/view/bobs-ledger R]: 1 hour'))
    assert.deepEqual(plan.creates.map(c => [c.title, c.lines.length]), [["Alice's Ledger 2026-08", 1]])
    assert.ok(plan.creates[0].text.startsWith('START: 1 August 2026\nEND: 31 August 2026\n2026-08-04 [[Plants for Bob]]'))
    assert.equal(plan.skipped.length, 1)
  })

  test('the index draws states, unknown parties and the lineup and log buttons', () => {
    const html = renderIndex({ site, rows, unknown: ['carol.timebank.example/carols-ledger'], pages: 6 })
    assert.ok(html.includes('1 logged') && html.includes('1 awaiting') && html.includes('4 orphan'))
    assert.ok(html.includes('unknown party'))
    assert.ok(html.includes('data-timebank-action="lineup"'))
    assert.ok(html.includes('Log the 4 orphans'))
  })
})
