# Limitations and known blockers

This file is deliberately blunt. Everything below is a real constraint of the data or the environment, not
a roadmap item dressed up as one.

## 1. Simulated fills are not exchange executions

No order is ever sent to an exchange. Fills are simulated against the order books, quotes and settlement
prices the venues publish at snapshot time. Deep, immediately-crossable size in a real book can vanish
before a real order would arrive; the simulator walks the *published* ladder and caps size at a
participating share of published liquidity, which is the most honest thing that can be done with public
data. The verification report counts modelled maker fills separately from taker fills taken from a
published ladder.

## 2. Which venues can actually be traded, and which cannot

| Venue | Status in this project |
| --- | --- |
| Kalshi | Traded. Public Trade API v2, keyless: series, open markets, order books, perpetuals, candlesticks, exchange status. |
| MOEX (FORTS) | Traded. Keyless ISS: quotes, specifications, initial margin, fee schedules, daily history, USD/RUB. |
| CME Group (CME/CBOT/NYMEX/COMEX) | **Not traded.** Automated requests are blocked (HTTP 403); settlement data after midnight CT needs an authenticated DataMine subscription. Contract specifications are cited from official product pages and no CME price is invented. |
| ICE | **Not traded.** Public EOD reports are behind a reCAPTCHA and the historical service is subscriber-only. |
| LME, Eurex, JPX, SGX, B3, SHFE, CZCE | **Not traded.** Either blocked (Cloudflare / 403), or the public endpoint requires account-level parameters that could not be verified. |
| USDA AMS Market News | Read-only reference. Report rows are stored exactly as the publisher emits them; no price translation is attempted. |
| EIA | Historical only. EIA stopped publishing NYMEX futures prices after **2024-04-05**; the archived series are kept for historical analysis and are never used to price a live trade. |

Consequence: strategies that would need CME, ICE or Asian futures liquidity are **unavailable for
backtesting** and are not simulated. Where a commodity is only available on those venues, the universe
lists it as covered-but-not-tradable rather than silently dropping it.

## 3. Coverage is bounded by what the free official APIs publish

* Kalshi commodity series are matched by an ordered rule list in `config/watchlist.json`. A series that
  matches no rule lands in `unclassified_series` and is **never** traded.
* Kalshi quotes in each run are limited to the most liquid markets within a request budget; the rest are
  counted in `data/universe/coverage.json` but do not carry a price.
* MOEX contracts are kept only when the exchange's asset code *and* the contract's own name agree with the
  commodity whitelist; a mismatch is dropped rather than guessed.
* The competition therefore trades a **subset** of what each exchange lists. Coverage numbers on the site
  state both the listed count and the quoted count so the difference is visible.

## 4. Data that simply does not exist publicly

* **Kalshi perpetual funding rates and fee schedule for perpetuals** were not retrieved. Perp fees are
  published as `not_applied_fee_schedule_unverified` (null) rather than assumed to be zero.
* **Historical Kalshi order books** are not published, so no historical liquidity can be reconstructed.
  Backtests that need liquidity are impossible; the strategies are forward-tested instead.
* **CME/ICE options and spread books**, and any venue that blocks scripted access, have no price source at
  all in this project.
* The EIA futures archive ends in April 2024, which is ~2.5 years before this competition's start; it is
  not a usable price feed for the season.

## 5. Modelling choices that a reader should discount

* Slippage is measured against the published book at snapshot time: the difference between the
  pre-trade mid (or the complementary-side mid for NO legs) and the achieved VWAP. It is a *cost of size*,
  not a market-impact model.
* Maker fills are conservative: they require the market to trade through the resting price, so real fills
  will differ.
* Marks are conservative (longs at the bid, shorts at the offer). A portfolio whose equity is marked
  incomplete shows its last complete equity plus an explicit "mark incomplete" badge.
* Fees use the official published formulas. Where a fee is not verifiable for a venue/instrument, it is
  reported as unknown, not zero — which makes some results worse than an optimistic simulator would show.
* Nothing here models taxes, borrow, funding payments, or the cash-flow timing of margin calls.

## 6. Operational limits

* The tick runs on GitHub Actions runners every 30 minutes, which is the effective resolution of the
  competition: intra-tick price paths are not observed, only the snapshots.
* Each run has a request budget (`--max-requests`, default 400); when the budget or a venue's rate limit is
  reached, the remaining work is recorded as degraded in the run manifest instead of being retried
  indefinitely.
* Perpetual-size caps are a small share of published 24-hour notional; this is what keeps the simulated
  size defensible, and it is also why perp positions are small in dollar terms.
* Rebuilding the site and committing the artifacts on every tick keeps the repository self-contained, but
  it means the published artifacts are only as fresh as the last successful workflow run.

## 7. A modelling correction that is on the record (resolved 2026-09-22)

The cross-venue basis strategy (`@basis-hunter`) originally compared a Kalshi perpetual price directly with
a MOEX future price. Those are quoted in different units: Kalshi's perpetual payload publishes
`contract_size` (for example 0.001 oz on gold, 0.1 oz on silver), while the MOEX quote carries its own
price units. The comparison was therefore unit-inconsistent; the strategy was disabled, its paper trades
archived under `data/ledger/archive/` and excluded from the season, and the reason published.

**The blocker was resolved the same day with official data, and the strategy was re-enabled:**

* The MOEX ISS `description` table publishes `LOT SIZE`, quotation `UNIT` and settlement `FACEUNIT` per
  contract. Verified 2026-09-22: GDZ6 LOT SIZE=1 / UNIT=USD / FACEUNIT=USD; SVZ6 LOT SIZE=10 / UNIT=USD /
  FACEUNIT=USD; PTZ6 LOT SIZE=1 / UNIT=USD / FACEUNIT=USD — the quote is USD per unit of the underlying.
* Kalshi's perp specification documents contract sizes in units of the underlying
  (help.kalshi.com, article 15357587), so `price ÷ contract_size` is USD per ounce.
* Cross-check on 2026-09-22 22:23Z: gold 4,363.25 vs 4,433.25 USD/oz (+1.6%); silver 67.23 vs 68.36
  (+1.7%) — two independent venues within ~2% corroborates the chain (a unit error would show 10×/32×).
* Evidence file: `data/raw-evidence/cross-venue-basis-normalisation-2026-09-22.json`; the verifier now
  requires the normalisation to be recorded on every basis trade.

A related correction made the same day: the USD valuation of a USD-quoted MOEX contract now comes from the
exchange's own `UNIT=USD` reference field (factor exactly 1.0) instead of the older `STEPPRICE ÷ MINSTEP ÷
USD/RUB` approximation, which mixed in MOEX's RUB step valuation and a separately captured FX rate and
understated the USD value by the fixing difference (~0.7% on gold at the time). Contracts whose quotation
is not USD keep the STEPPRICE-derived valuation. Positions opened before the correction keep their recorded
entry multiplier; the difference is on the record in each instrument's `usd_valuation.basis`.

A second defect found and fixed the same day: the Kalshi candlestick parser read the wrong field names
(`price.close` instead of the documented `price.close_dollars`, etc.), which had left the committed candle
caches null and starved the candle-based strategies of signals. The parser now follows the official schema
(docs.kalshi.com, Get Market Candlesticks), and unusable caches are re-fetched rather than trusted.

## 8. Verified but not traded: MOEX non-commodity sectors

The exchange's own FORTS listing (verified 2026-09-22) also contains equity-index futures (MIX, RTS, NASD,
SPYF, DJ30, DAX, NIKK and others), interest-rate futures (RUONIA, 1MFR, RGBI), FX futures (Si, CNY, Eu and
others), crypto futures (BTC, ETH, SOL, XRP, TRX) and perpetual-style continuous contracts (USDRUBF,
GLDRUBF, SLVRUBF and others). The official keyless ISS API can price them, but the competition does not
trade them yet: sector classification, contract whitelisting and strategy rules are pending (see
`docs/ROADMAP.md`). They are recorded in `engine/universe/futures-registry.json` as `listed_only` so the
universe statement stays accurate: listed, verified, not traded.

## 9. Provenance retention

Run manifests (`data/manifest/run-*.json`, one per tick, with the URL/status/SHA-256 of every response the
run received) are pruned to the most recent runs so the repository stays small. A ledger trade from a pruned
run therefore cannot be hash-matched anymore and fails
`payload_hash_present_in_that_runs_provenance_log`; `data/verification/report.json` discloses this as a
retention limit and breaks anomalies down per check. The price itself is still checkable: every trade also
carries the source URL and the response hash, so any number can be re-derived against the venue at any time.

## 10. What is deliberately absent

Risk management, position limits, drawdown controls and portfolio-level hedging are intentionally **not**
implemented: the competition is scored on returns only. A strategy that takes a large, unhedged position
is behaving exactly as designed. The verification layer is the counterweight: it guarantees the numbers are
real, not that the trades are sensible.
