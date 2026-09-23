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
| Kalshi | Traded. Public Trade API v2, keyless: series, open markets, order books, perpetuals, candlesticks (single and official batch endpoint), perps funding rates (finalised events and estimates), exchange status. Perp fees per the official fee schedule (tier 0), funding settled from the exchange's finalised events. |
| MOEX (FORTS) | Traded. Keyless ISS: quotes, specifications (including the per-contract description table: LOT SIZE / UNIT / FACEUNIT), initial margin, fee schedules, daily history, USD/RUB. Covers commodity, equity-index, interest-rate, FX and crypto futures. |
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

* **Kalshi perpetual funding rates and fee schedule** — resolved 2026-09-22. The official fee schedule
  (kalshi.com/docs/kalshi-fee-schedule.pdf, effective 2026-07-07) publishes the perps fee tables
  (tier-0 taker 12.0 bps of notional, tier-0 maker 5.0 bps; fees are charged on notional at open and
  close), and the keyless perps REST API publishes the finalised funding events
  (`GET /margin/funding_rates/historical`) plus the in-progress estimate (`GET /margin/funding_rates/estimate`).
  The engine now applies the tier-0 taker fee to every perp fill and settles funding from the
  exchange-published events (8-hourly, |rate| < 0.01% treated as zero per the official rules), with each
  payment recorded in `data/ledger/funding.jsonl` with the funding-rate payload's provenance. Volume-tier
  discounts (10 bps at ≥ $100K 30-day volume, down to 2.6 bps at ≥ $3B) exist but this competition account
  has no volume, so tier 0 is the verified rate.
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
* **USD-quoted MOEX contracts** are valued from the exchange's own published tick value (STEPPRICE per
  MINSTEP, in RUB per the official spec "the value of the tick is calculated in rubles at the USD
  rate"). If that converts to ~1 USD per 1.0 of price at the published USD/RUB rate, the lot is one
  underlying unit and 1.0 of price movement is exactly 1 USD (verified 2026-09-22: GOLD 8.40954/0.1,
  ETHA 0.84095/0.01); otherwise the lot is a fraction of the price unit and the tick value is the
  verified USD value per contract (verified 2026-09-22: BTC 0.08410 RUB per 1.0 USD step = 0.001 USD
  per contract, matching the official specification's Appendix 1). The residual gap between the
  exchange's embedded fixing and the live USD/RUB is ~1% at most and is stated on each instrument's
  `usd_valuation.basis`.
* Nothing here models taxes, borrow, or the cash-flow timing of margin calls. Perps funding **is**
  modelled (see §4): settled from the exchange's finalised 8-hourly events, never estimated.

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

A third robustness fix made the same day: the tick's order-execution paths (exits, entries, marking,
settlements) and the request-budget check were previously able to throw and kill the whole competition
run (the 2026-09-22 23:05Z push-triggered tick failed at the tick step; the offline replay harness
`test/live-pipeline.mjs` found no fault in the strategy/execution pipeline on committed data, so the
failure is recorded as a suspected transient and the engine was made unable to crash: budget overruns
degrade the venue, and per-strategy execution failures are recorded as degraded instead of aborting the
run).

## 8. MOEX non-commodity sectors (trading since 2026-09-22)

The exchange's own FORTS listing (verified 2026-09-22) contains equity-index futures (MIX, RTS, NASD,
SPYF, and others), interest-rate futures (RUONIA, 1MFR, and others), FX futures (Si, CNY, and others),
crypto futures (BTC, ETH, and others) and perpetual-style continuous contracts (USDRUBF, GLDRUBF, SLVRUBF
and others). The project brief requires the universe to cover equity-index, interest-rate, FX and crypto
futures, so the competition now trades a **deliberately limited** slice:

* Equity index: MIX (IMOEX), RTS, NASD (Nasdaq-100), SPYF (S&P 500) — `@index-mover`.
* Interest rate: RUONIA, 1MFR — `@ruonia-curve` (curve carry). Each contract carries an
  exchange-published notional of RUB 1,000,000 (official specification: "Nominal value 1 mln RUB";
  ISS `LOTVOLUME = 1,000,000`), which the engine uses for the recorded notional — the rate is quoted
  as a per-cent, so price × USD-per-price-unit is **not** the contract notional for these two
  instruments.
* FX: Si (USD/RUB), CNY (CNY/RUB) — `@usd-rub-desk`.
* Crypto: BTC (Bitcoin Index future, lot 0.001 BTC per the official specification's Appendix 1) and
  ETH (via the ETHA Trust ETF future, one contract = one share; the MOEX-Ether-Index futures were not
  found in the FORTS listing on 2026-09-22) — `@basis-hunter` (Kalshi crypto perp vs MOEX crypto
  future; the sector's most distinctive edge).

The same asset-code + name-keyword gate applies: a contract enters the universe only when the exchange's
own listing publishes that asset code and its name agrees with it, and sector contracts get a dedicated
slot of the quote budget (12 contracts, `config/watchlist.json`) so commodities keep the remainder.
Codes the exchange does not list simply trade nothing. Continuous/perpetual-style contracts (USDRUBF,
GLDRUBF, SLVRUBF, ...) remain `listed_only` in the registry: they are a different instrument type and
need their own treatment before they may be traded.

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
