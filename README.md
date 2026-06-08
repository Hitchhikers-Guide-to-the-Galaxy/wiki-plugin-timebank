# wiki-plugin-timebank

A [Federated Wiki](https://fed.wiki) plugin that displays time entries as a dated ledger with totals.

Each `timebank` item holds newline-separated text. Lines are classified and rendered as a table with a running total and optional date range header.

## Usage

Double-click a timebank item to edit. Each line is one entry:

```
START: 1 June 2026
END: 7 June 2026
Meeting with David: 2 hours
Code review: 1 hour
Admin tasks
Call with team: 30 mins
A short description of this period's work.
```

- Lines with `START:` / `END:` set the date range shown in the header
- Lines ending in a time amount (`2 hours`, `30 mins`, `1.5h`, `90m`) are summed into a **Total** row
- Lines without a time are shown as notes
- Prose sentences (containing punctuation) appear as an italic caption below the table

## Supported Time Formats

`2 hours` · `1 hour` · `30 mins` · `45 minutes` · `1.5h` · `90m` · `2 hrs`

## Build

```bash
npm install
npm run build
```

The build step runs tests then compiles `src/client/timebank.js` → `client/timebank.js` via esbuild.

## Install into Federated Wiki

```bash
cd ~/.nvm/versions/node/$(node -v | tr -d v)/lib/node_modules/wiki
npm install wiki-plugin-timebank
```

Then restart your wiki server.

## Development

Source lives in `src/client/timebank.js`. After editing, run `npm run build` to recompile. The `npm run about` script starts a local wiki server on port 3010 pointing at the plugin directory, which is useful for previewing the about page.

## License

MIT © David Bovill
