# Recommended next work

Everything below is ordered by leverage. The rule that produced this project — verify a market and a number
from an official source before it enters the database — applies to all of it.

## 1. Re-price the Kalshi candle universe (next live tick)

The candlestick parser bug (fixed 2026-09-22: `price.close` → the documented `price.close_dollars` schema)
left every committed candle cache null. The next live ticks will re-fetch them; until then the four
Kalshi backtests show `skipped_insufficient_official_history` and the candle-based strategies
(@vol-crusher, @tail-rider, @barrel-rider) are quiet by design. **Verification step:** after a live tick,
`data/history/kalshi/*.json` should contain non-null `close`/`yes_bid_close`/`yes_ask_close` values, and
`node engine/backtest.mjs` should produce Kalshi rows.

## 2. Widen candle coverage with the batch endpoint

Only ~30 series get candles today (`max_candle_series`), while ~75 commodity series are matched. Kalshi
publishes a batch candlestick endpoint (docs.kalshi.com, Batch Get Market Candlesticks) that would cover
every series in one request per page. This is the cheapest large win for both strategy signals and
backtests.

## 3. Trade the verified MOEX non-commodity sectors (or formally close the question)

Equity-index (MIX, RTS, NASD, SPYF…), interest-rate (RUONIA, 1MFR), FX (Si, CNY…) and crypto (BTC, ETH…)
futures are listed and verifiable through the same keyless ISS API, and are recorded `listed_only` in the
registry. Each needs: a classification entry, contract whitelisting, and at least one strategy per sector
(e.g. curve carry on RUONIA, cross-venue crypto basis vs Kalshi perps, index momentum). Alternatively,
record a decision that the competition stays commodities-only and move these entries to a reference-only
section of the site.

## 4. Kalshi perpetual fee schedule and funding

Both are published by Kalshi but were not retrieved: perp fees are `unknown` (never assumed zero), and no
funding cash-flow is modelled. Pull the official fee schedule PDF / docs page and the funding-rate fields;
then add funding accrual as an explicit, provenance-stamped ledger entry type at each funding timestamp
held. Until then the perp strategies' PnL is understated by exactly the unknown fee — the conservative
direction, but incomplete.

## 5. Cross-venue basis expansion

* **Crypto:** Kalshi crypto perps (payload-verified) vs MOEX crypto futures (BTC/ETH, listed) — both
  venues keyless. Needs the same normalisation treatment (contract_size on both legs) and the CFTC/MOEX
  contract-size documents cited per leg.
* **Energy:** MOEX WTI/Brent vs a second venue — blocked until a second verified energy feed exists
  (CME/ICE block automated access). The AAA-gasoline-lag idea stays parked for the same reason.

## 6. A second exchange would materially de-risk the venue concentration

Today the futures leg depends entirely on MOEX. Candidate free official sources worth a dedicated probe
session: HKEX (free daily derivatives reports, iron ore CNH), DME (settlement pages), JPX/TOCOM (daily
report CSVs), Euronext commodity settle prices, NZX dairy (announced auction data is free via GDT — a
different, event-driven market), and the CFTC COT public API as an official positioning *overlay* for
existing venues rather than a priced market. Each probe must record the same evidence style as the
existing access matrix (endpoint, status, terms), or the venue is marked blocked like CME/ICE/LME.

## 7. Settlement testing at scale

The season is young (2 ticks at this writing). The first natural experiments arrive when the front event
contracts settle: verify that `settlePosition` results reproduce the exchange's published `market.result`,
and that @fade-the-crowd vs @carry-collector start to accumulate the settlement distribution their theses
predict. The verification report already covers this; the review task is to read those two strategies'
settlement ledger monthly.

## 8. Ops

* Keep an eye on request budget as the MOEX universe grew from 25 to ~41 tracked contracts (first tick
  after this change also fetches ~41 reference descriptions; afterwards they are cached 12h).
* The GitHub Pages URL, the tick schedule (every 30 min) and the ledger are the competition's source of
  truth; the ledger is append-only and must never be rewritten (archives under `data/ledger/archive/` are
  the only sanctioned exclusions).
* If Kalshi adds commodity perp asset classes beyond Metals (`perp_asset_classes` in
  `config/watchlist.json`), extend the allowlist deliberately, not silently.
