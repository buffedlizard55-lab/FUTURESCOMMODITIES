# FUTURESCOMMODITIES

A research, strategy and **paper-trading competition** platform for commodity markets, built so that every
number it publishes can be traced back to an official public source.

Seventeen strategies — one per username — trade three kinds of instrument against prices pulled from the
exchanges' own APIs:

* **Kalshi commodity/prediction event contracts** (binary commodity, energy and metals markets),
* **Kalshi perpetual futures** where the exchange publishes them,
* **exchange-listed commodity futures** on **MOEX FORTS** — metals, grains, softs and (verified into the
  universe on 2026-09-22) WTI, Brent, natural gas (NG/NGM/TTF), diesel, AI-92/95 gasoline and orange
  juice — through a free, keyless official API with quotes, settlement prices, open interest, fee
  schedules, reference contract data and full price history.

The competition runs for one year from 2026-09-22. All executions are **simulated paper fills**: the
engine never sends an order to an exchange. Fills are simulated against the *published order books* of
each venue, and every trade record states the execution model that produced it.

**Live page:** https://buffedlizard55-lab.github.io/FUTURESCOMMODITIES/

## What is on the page

| Section | What it shows |
| --- | --- |
| Leaderboard | Every strategy ranked by return on the starting $100,000; realised and unrealised PnL, fees, slippage, open and closed trades |
| Strategies | Which market type each username trades, the claim it came from (with source links), its entry/exit rules, and what the results so far actually show |
| Live trade desk | The simulator's desk: the verified book every strategy places orders against (bid/ask/mid/depth, official URL + payload hash + retrieval time per row), the orders being placed right now, the intents that could not execute and why, and the most recent fills |
| Open positions | Side, size, entry, published mark, collateral and the mark's official source link |
| Trades | Every trade with all mandatory verification fields: source URL and payload hash, exchange, ticker, contract specification, dates, published bid/ask, execution price, size, liquidity consumed, slippage, fees, PnL, retrieval and verification timestamps |
| Upcoming & resting | Intents that could not be executed (with the reason) and maker orders resting at a published price |
| Market universe | Per-series counts of every market read from the exchange, contract terms links, settlement sources, and the exchange access matrix |
| Research & backtests | Documented rules re-run on official daily price history (Kalshi candles, MOEX settlements) with every source file cited, plus the strategies marked unavailable for backtesting and the research register of parked ideas with citations |
| Verification | The independent audit report: how many trades reproduce exactly, every anomaly it found, and the per-check anomaly breakdown |

## How a tick works

```
engine/tick.mjs      fetch official data -> build the universe -> run strategies -> simulate fills
                     -> mark positions -> publish snapshot, coverage, leaderboard, ledger, run manifest
engine/verify.mjs    re-read the append-only ledger and audit every trade against that run's provenance
engine/report.mjs    per-strategy attribution: where the return came from, what blocked orders
engine/backtest.mjs  documented rules re-run on committed official daily histories (never season trades)
engine/build-site.mjs build the self-contained index.html the pages site serves
```

Nothing is installed: the engine uses only the Node standard library (`node >= 20`).

```bash
node engine/tick.mjs               # one full market moment (needs egress to the exchanges)
node engine/tick.mjs --offline     # cache rebuild only: never trades, never touches the ledger or season state
node engine/verify.mjs             # independent verification pass
node engine/report.mjs             # strategy result reports
node engine/backtest.mjs           # research backtests over committed official history
node engine/build-site.mjs         # regenerate index.html
```

## Where the data comes from

Only free, official, public endpoints — no trials, no paid subscriptions, no scraping of pages that
forbid it, and no invented values.

| Venue | Access | Used for |
| --- | --- | --- |
| Kalshi Trade API v2 (`api.elections.kalshi.com`) | keyless | series, open markets, order books, perps (`/margin`), candlesticks (official `*_dollars` schema), exchange status |
| MOEX ISS (`iss.moex.com`) | keyless | FORTS futures quotes, reference descriptions (LOT SIZE / quotation UNIT / FACEUNIT per contract), initial margin, fees, daily history, USD/RUB |
| EIA (`eia.gov`) | keyless files | archived historical NYMEX futures series (discontinued after 2024-04-05) and spot benchmarks |
| USDA AMS Market News DataMart (`mpr.datamart.ams.usda.gov`) | keyless | physical commodity report rows, stored exactly as published |
| CME Group, ICE, LME, Eurex, JPX, SGX, B3 and others | blocked to scripts or account-gated | contract specifications are cited from official pages; live prices are **not** simulated for them |

Where an exchange blocks scripted access, the strategy is labelled **unavailable for backtesting** and no
price is fabricated for it. The full access matrix with per-venue evidence lives in
`engine/universe/futures-registry.json` and is rendered on the site.

## Repository layout

```
engine/
  tick.mjs               the orchestrator (one market moment)
  verify.mjs             independent verification of the ledger
  report.mjs             per-strategy result attribution
  build-site.mjs         builds index.html from committed artifacts
  lib/http.mjs           fetch wrapper + the per-run provenance log
  lib/store.mjs          JSON/JSONL store that writes only on change
  lib/portfolio.mjs      fee formulas, ladder walking, fill simulation, margining, marking
  lib/universe.mjs       classification of series and construction of instrument records
  lib/venues/            kalshi.mjs, moex.mjs, eia.mjs, usda.mjs
  strategies/index.mjs   the twelve strategies
  universe/futures-registry.json  verified exchange/product reference registry
config/
  competition.json       season, starting capital, liquidity and fee settings
  watchlist.json         series classification rules, perp allowlist, MOEX asset whitelist
docs/
  STRATEGIES.md  VERIFICATION.md  LIMITATIONS.md
data/                    everything the system knows: universe, snapshots, ledger, state, manifests
```

## Verification, in one paragraph

Every trade stores the URL and SHA-256 of the exact HTTP response its price came from, plus the
provenance log of the run that produced it under `data/manifest/`. `engine/verify.mjs` re-reads the
ledger from scratch and checks that the mandatory fields are present, that the payload hash appears in
that run's provenance log, that the recorded fill levels reproduce the recorded contracts and VWAP, that
Kalshi fees match the official published formula, and that the instrument is still published with its own
listing provenance. Anomalies are reported on the site; they are never silently corrected.

## Documentation

* [`docs/STRATEGIES.md`](docs/STRATEGIES.md) — every strategy, its market type, origin and rules
* [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — what is verified and how to reproduce it
* [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — what this platform does not claim, and what is blocked

## Scope

This is a returns-only simulator: strategies are deliberately not risk-managed, because the competition
is scored on returns alone. Simulated fills are never presented as exchange executions.
