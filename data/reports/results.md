# Competition results

Generated 2026-09-22T18:55:08.540Z from the committed ledger. Season n/a (? to ?), 0 ticks completed.

> Every number below is computed from data fetched from an official source. Simulated fills are labelled: `taker_walks_official_order_book` means the order walked real resting size, `quote_based_fill_at_official_bid_offer` means it filled at the exchange quote with size capped by published liquidity, and `modelled` marks resting maker orders whose queue position cannot be observed publicly.

Independent verification: **0/26** trades fully verified, 111 anomalies (see `data/verification/report.json`).

## Leaderboard

| # | Username | Market type | Equity (USD) | Return % | Realized | Unrealized | Fees | Slippage | Open | Closed trades |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | @fade-the-crowd | Kalshi event contracts | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | n/a | 0 | 0 |
| 2 | @spread-hunter | Kalshi event contracts | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | n/a | 0 | 0 |
| 3 | @vol-crusher | Kalshi event contracts | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | n/a | 0 | 0 |
| 4 | @perp-surfer | Kalshi perpetual futures | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | n/a | 0 | 0 |
| 5 | @barrel-rider | Kalshi event contracts (signal from official EIA benchmarks) | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | n/a | 0 | 0 |
| 6 | @basis-hunter | Kalshi perpetual futures vs exchange futures (pairs) | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | n/a | 0 | 0 |
| 7 | @tail-rider | Kalshi event contracts | 99998.88 | -0.00 | 0.00 | -0.70 | 0.42 | n/a | 1 | 0 |
| 8 | @calendar-carry | Futures (exchange-listed, MOEX FORTS) | 99998.65 | -0.00 | 0.00 | -1.35 | 0.00 | n/a | 6 | 0 |
| 9 | @agri-seasonal | Futures (exchange-listed, MOEX FORTS) | 99990.98 | -0.01 | 0.00 | -9.02 | 0.00 | n/a | 2 | 0 |
| 10 | @carry-collector | Kalshi event contracts | 99990.36 | -0.01 | 0.00 | -7.97 | 1.67 | n/a | 3 | 0 |
| 11 | @gold-grinder | Kalshi event contracts | 99984.63 | -0.02 | 0.00 | -10.14 | 5.23 | n/a | 3 | 0 |
| 12 | @metal-trend | Futures (exchange-listed, MOEX FORTS) | 99929.47 | -0.07 | 0.00 | -70.53 | 0.00 | n/a | 11 | 0 |

## Per-strategy analysis

### @fade-the-crowd - Longshot Fade

- **Market type:** Kalshi event contract
- **Thesis:** Buy NO on commodity event contracts whose YES price is at or below 10 cents. If the longshot bias exists in Kalshi commodity ladders, the average NO leg should be profitable on a large number of observations; if the bias does not exist, this strategy loses and the leaderboard will show it.
- **Rules:** entry - YES mid <= 0.10, spread <= 3 cents, at least 2 hours to close, top-3 liquidity strikes only.; exit - No exit: positions are held to settlement, because the thesis is about the settlement distribution.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.

### @carry-collector - Favourite Carry

- **Market type:** Kalshi event contract
- **Thesis:** Buy NO where YES is already at or above 90 cents and the contract closes within two days. This is the mirror image of the longshot fade: it wins often and loses big occasionally, which is exactly the return profile a highest-return-only competition is allowed to take.
- **Rules:** entry - YES mid >= 0.90, spread <= 3 cents, closes within 48 hours.; exit - No exit: held to settlement.
- **Result:** n/a% (equity n/a USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.

### @spread-hunter - Spread Capture

- **Market type:** Kalshi event contract
- **Thesis:** Rest passive bids one cent inside the spread on the most liquid commodity contracts and rely on the exchange order flow to cross them. The maker fee multiplier is zero for standard series per the official fee schedule, so a fill at the resting price is pure spread capture.
- **Rules:** entry - Spread >= 3 cents, resting bid at best bid + 1 cent, never crossing the offer.; exit - Working orders expire after the configured TTL; positions are marked to the opposite side of the book.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 3 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.
- Orders it tried to place were not executed, for these recorded reasons: resting_order (3). Each of those is a liquidity or data limitation of the real market, not a strategy result.

### @vol-crusher - Extreme Reversion

- **Market type:** Kalshi event contract
- **Thesis:** When a series candle history shows a move of more than four standard deviations of its own daily changes, take the opposite side of that move in the front ladder. Measured entirely from Kalshi's own official candle payload.
- **Rules:** entry - Last completed daily candle change >= 4 standard deviations of the series history, trade the opposite direction.; exit - Exit when the mid returns to within half the gap, or when the market closes.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.

### @tail-rider - Cheap Momentum

- **Market type:** Kalshi event contract
- **Thesis:** Buy YES at 10 cents or less only when the series own official candle history is trending up. This strategy is deliberately the opposite bet to @fade-the-crowd, so the leaderboard measures which view of cheap contracts is right.
- **Rules:** entry - YES mid <= 0.10, 5-day candle momentum > 0, spread <= 3 cents.; exit - Exit when 5-day momentum turns negative or the market closes.
- **Result:** -0.00% (equity 99998.88 USD), 1 entries, 0 exits, 0 blocked order attempts.
- 1 ledger records so far: 1 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 0.42 USD of fees and 0.42 USD of measured slippage against the mid.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** KXGOLDD-26SEP2217-T4365 (1 trades, 0 USD realized, 0.42 USD fees)

### @ladder-arb - Ladder Arbitrage

- **Market type:** Kalshi event contract
- **Thesis:** Within one series and one expiry, the YES price must fall as the strike rises (for greater-than markets). When the published book violates that ordering by more than the configured tolerance, buy the underpriced YES leg and the NO of the overpriced leg.
- **Rules:** entry - Monotonicity violation of at least 2 cents between two strikes of the same series and expiry.; exit - Held to settlement (the two legs converge by construction).
- **Result:** n/a% (equity n/a USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.

### @barrel-rider - Oil Trend Rider

- **Market type:** Kalshi event contract
- **Thesis:** Trade the Kalshi WTI/Brent ladders in the direction of the verified trend in the same series own official candle history, taking the side whose price is closest to a coin flip so that a correct directional call pays multiples.
- **Rules:** entry - |5-day candle momentum| >= 2%, enter in the direction of the trend, YES mid between 0.2 and 0.6.; exit - Exit when momentum flips sign or the market closes.
- **Result:** n/a% (equity n/a USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.

### @perp-surfer - Perp Surfer

- **Market type:** Kalshi perpetual future
- **Thesis:** Take the direction of the last verified move in each Kalshi metal perpetual and hold it, re-evaluating on every snapshot. The perpetual is the only instrument in this project that trades continuously, so it is where an overnight trend can actually be captured.
- **Rules:** entry - Price changed since the previous committed snapshot, with a live two-sided quote.; exit - Exit when the direction of the last change flips.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi perpetual future markets every tick.

### @metal-trend - Metals Trend

- **Market type:** Exchange-listed commodity future
- **Thesis:** Rank the MOEX metal futures by their official settlement momentum over the cached history window and take the extremes, long the strongest and short the weakest. Trades only when the exchange publishes both a live quote and USD valuation inputs.
- **Rules:** entry - 20-observation settlement momentum, long the top mover and short the bottom mover on each side when |momentum| >= 1%.; exit - Exit when the momentum flips sign.
- **Result:** -0.07% (equity 99929.47 USD), 11 entries, 0 exits, 0 blocked order attempts.
- 11 ledger records so far: 11 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 21.10 USD of fees and 0.00 USD of measured slippage against the mid.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** ANZ6 (1 trades, 0 USD realized, 1.516165 USD fees); CEZ6 (1 trades, 0 USD realized, 3.25156 USD fees); GDZ6 (1 trades, 0 USD realized, 2.8966 USD fees); GDH7 (1 trades, 0 USD realized, 2.93437 USD fees); LTZ6 (1 trades, 0 USD realized, 2.036685 USD fees); LTH7 (1 trades, 0 USD realized, 0.024433 USD fees); NCZ6 (1 trades, 0 USD realized, 0.10682 USD fees); PTZ6 (1 trades, 0 USD realized, 3.107299 USD fees); PTH7 (1 trades, 0 USD realized, 0.24339 USD fees); SVZ6 (1 trades, 0 USD realized, 3.178476 USD fees); SVH7 (1 trades, 0 USD realized, 1.80122 USD fees)

### @calendar-carry - Calendar Carry

- **Market type:** Exchange-listed commodity future
- **Thesis:** Buy the near expiry and sell the far expiry (or the reverse) whenever the annualised spread between the official mid prices exceeds the exchange published round-trip fee converted at the official USD/RUB rate. Both legs are real orders with real fees.
- **Rules:** entry - Annualised calendar spread >= 12% after measured round-trip fees.; exit - Exit when the annualised spread compresses below 4%, or when either contract is within 5 days of expiry.
- **Result:** -0.00% (equity 99998.65 USD), 6 entries, 0 exits, 0 blocked order attempts.
- 6 ledger records so far: 6 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 0.07 USD of fees and 0.00 USD of measured slippage against the mid.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** CCX6 (1 trades, 0 USD realized, 0.0072 USD fees); CCG7 (1 trades, 0 USD realized, 0.007436 USD fees); SuV6 (1 trades, 0 USD realized, 0.007554 USD fees); SuX6 (1 trades, 0 USD realized, 0.00779 USD fees); W4U6 (1 trades, 0 USD realized, 0.017233 USD fees); W4V6 (1 trades, 0 USD realized, 0.019948 USD fees)

### @agri-trend - Agri Trend

- **Market type:** Exchange-listed commodity future
- **Thesis:** Follow the official settlement trend in MOEX soft commodities and grains, taking the strongest movers on each side and holding while the trend persists.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 1.5%.; exit - Exit when the momentum flips sign.
- **Result:** n/a% (equity n/a USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Exchange-listed commodity future markets every tick.

### @basis-hunter - Cross-Venue Basis

- **Market type:** Cross-venue: Kalshi perpetual future vs exchange-listed future
- **Thesis:** Compare the Kalshi metal perpetual with the front MOEX future on the same metal. When the percentage spread between them is large enough to cover both venues fees, buy the cheaper venue and sell the more expensive one. Both legs are simulated with their own venue fill model.
- **Rules:** entry - Basis >= 0.5% between the perpetual mid and the MOEX future mid.; exit - Exit when the basis compresses below 0.1%.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Cross-venue: Kalshi perpetual future vs exchange-listed future markets every tick.

## Execution composition

- Taker fills that walked the official ladder: 0
- Quote-based fills at the official bid/offer: 0
- Modelled resting maker fills: 0
- Orders that could not be executed, with the recorded reason: 3
  - resting_order: 3

## How to read this

These are simulated fills on real, verified market data. They are not exchange executions and they are not a track record. The point of the competition is to measure, over a full year, which of the twelve documented ideas survives contact with real liquidity, real spreads and real fees.
