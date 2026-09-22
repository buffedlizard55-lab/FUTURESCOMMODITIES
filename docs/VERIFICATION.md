# Verification

The project's rule is simple: **a number is only published next to the official response it came from, and
anything that cannot be derived from such a response is published as a status, never as a value.**

`engine/verify.mjs` is an independent pass. It never trusts the tick's own summary: it re-reads the
append-only ledger and the published artifacts from disk and re-checks them from scratch. Its report is
committed to `data/verification/report.json` and rendered on the site.

## What every trade must carry

| Field | Meaning |
| --- | --- |
| `official_source` | The exact URL the prices came from |
| `official_source_sha256` | SHA-256 of that HTTP response body |
| `retrieved_at`, `verification_timestamp` | When the exchange served it, and when the trade was recorded |
| `exchange`, `venue_id`, `ticker`, `instrument_id` | Where the contract lives |
| `contract_specification` | Unit, tick, fee model, terms URL, settlement sources |
| `market_dates` | Open, close, expiration and last-trade dates as published |
| `market_at_decision` | Bid, offer, mid, spread, volume, open interest at the moment of the decision |
| `price`, `contracts`, `fill` | The simulated execution, including the ladder levels it consumed |
| `liquidity_consumed` | The capacity check that capped the size, with the exchange-published inputs |
| `slippage`, `fees`, `pnl` | Cost and result, or the explicit status explaining why it is unknown |
| `position_notional_usd`, `margin_usd`, `margin_model` | Position size and the collateral model used |

## The checks the verifier runs on every trade

1. **`mandatory_fields_present`** — no required field is missing.
2. **`official_source_url_recorded`** — a real exchange URL is attached.
3. **`payload_hash_recorded`** — the SHA-256 of the response is stored.
4. **`payload_hash_present_in_that_runs_provenance_log`** — the hash appears in the provenance log of the
   run that created the trade (`data/manifest/run-*.json`), i.e. the price really was fetched in that run
   and not copied from anywhere else.
5. **`fill_levels_reproduce_contracts_and_vwap`** — the recorded ladder levels re-compute to the recorded
   contract count and volume-weighted average price.
6. **`kalshi_fee_matches_official_formula`** — Kalshi fees are re-derived from the published schedule
   (`roundup(M × 0.07 × C × P × (1 − P))` for takers, `M × 0.0175 × …` for makers).
7. **`instrument_present_in_published_universe`** — the instrument is still published with its own listing
   provenance.

A trade is only counted as **fully verified** when every check passes. Anything else is listed as an
anomaly with its trade id and ticker. Anomalies are reported, never silently corrected.

## How fills are simulated

* **Taker fills on Kalshi event contracts** walk the exchange's published ladder level by level. Kalshi
  publishes resting *bids only*, so an offer is derived as the complement of the opposing bid
  (`yes_ask = 1 − best_no_bid`), and the derivation is stated on the quote itself. The fill record keeps
  every level consumed, so the VWAP can be reproduced by hand.
* **Quote-based fills** (MOEX futures, Kalshi perpetuals) execute at the exchange-published bid for a sale
  and offer for a purchase, capped at a small share of the published volume/open interest or 24-hour
  notional, whichever the venue publishes.
* **Maker fills** are registered as resting working orders. Such an order can only fill when a later
  snapshot shows the market trading *through* the resting price; the fill is then marked as modelled and
  counted separately in `data/verification/report.json` (`coverage.tiers.modelled_maker_fills`).

## Marking, settlement and accounting

* Open positions are marked at the price another participant is actually showing: longs at the published
  bid, shorts at the published offer, event contracts long at the bid of their own side and short at the
  ask of their own side. If only one side of the book exists, the position is reported with the status
  `one_sided_book_no_exit_price` and the portfolio's equity is marked incomplete — it is never given a
  made-up price.
* **Event contracts are fully funded** (the premium is the whole cost). **Futures and perpetuals are
  margined**: only the exchange-published collateral is set aside, the notional is never exchanged, and
  the collateral comes back when the position closes. MOEX initial margin comes from the exchange's own
  specification payload converted at the official USD/RUB rate; Kalshi perpetual collateral uses the
  exchange-implied leverage estimate in the contract record. When those inputs are absent, the order is
  refused with `margin_inputs_missing`.
* Positions only settle from a result the exchange itself publishes (`market.result`); before that the
  settlement status is `settlement_result_not_published`.

## Reproducing the audit

```bash
git clone https://github.com/buffedlizard55-lab/FUTURESCOMMODITIES
cd FUTURESCOMMODITIES
node engine/verify.mjs        # rebuild data/verification/report.json from the committed ledger
```

Then check any trade by hand: open `data/ledger/trades.jsonl`, take `official_source` and
`official_source_sha256`, find that hash in `data/manifest/run-<run_id>.json`, and compare
`market_at_decision` with the payload recorded there. The ledger is append-only: a trade is never edited
after it is written, and the provenance log of its run is immutable once pruned only by age (the last 24
runs are kept).
