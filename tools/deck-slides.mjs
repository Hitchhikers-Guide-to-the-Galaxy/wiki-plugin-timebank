#!/usr/bin/env node
// deck-slides — draw the Review Board's slides for the report tool's --deck.
// The same code the board draws in the page (src/client/slides.js), so the
// deck and the board never disagree.
//
//   echo '{"models": [...model item texts], "ledger": {"week": "2026-W40", "rows": [...]},
//          "meta": {"week": "2026-W40", "site": "...", "broker": "...", "masks": {...}}}' | node tools/deck-slides.mjs
//   -> [{ "key", "title", "svg", "notes" }, ...]

/* global process */
import { boardData, modelOf } from '../src/client/review.js'
import { deckSlides, ledgerOf } from '../src/client/slides.js'

let raw = ''
for await (const chunk of process.stdin) raw += chunk
const input = JSON.parse(raw || '{}')
const data = boardData((input.models || []).map(modelOf))
data.ledger = typeof input.ledger === 'string' ? ledgerOf(input.ledger) : (input.ledger || null)
process.stdout.write(JSON.stringify(deckSlides(data, input.meta || {})))
