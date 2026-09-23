# Competition results

Generated 2026-09-23T00:32:39.620Z from the committed ledger. Season season-2026-09-22_to_2027-09-22 (2026-09-22T00:00:00Z to 2027-09-22T00:00:00Z), 3 ticks completed.

> Every number below is computed from data fetched from an official source. Simulated fills are labelled: `taker_walks_official_order_book` means the order walked real resting size, `quote_based_fill_at_official_bid_offer` means it filled at the exchange quote with size capped by published liquidity, and `modelled` marks resting maker orders whose queue position cannot be observed publicly.

Independent verification: **50/73** trades fully verified, 23 anomalies (see `data/verification/report.json`).

## Leaderboard

| # | Username | Market type | Equity (USD) | Return % | Realized | Unrealized | Fees | Slippage | Open | Closed trades |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | @tail-rider | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 2 | @vol-crusher | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 3 | @carry-collector | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 4 | @barrel-rider | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 5 | @spread-hunter | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 6 | @book-watcher | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 7 | @mark-fade | Kalshi perpetual future | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 8 | @donchian-desk | Exchange-listed commodity future | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 9 | @snap-fader | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 10 | @ruonia-curve | Exchange-listed interest rate future | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 11 | @perp-surfer | Kalshi perpetual future | 99998.92 | -0.00 | 0.00 | 1.37 | 0.00 | 0.54 | 2 | 0 |
| 12 | @usd-rub-desk | Exchange-listed FX future | 99994.64 | -0.01 | 0.00 | -4.91 | 0.45 | 0.21 | 2 | 0 |
| 13 | @index-mover | Exchange-listed equity index future | 99994.60 | -0.01 | 0.00 | -4.09 | 1.31 | 184.50 | 3 | 0 |
| 14 | @rig-count | Exchange-listed commodity future | 99990.11 | -0.01 | 0.00 | -9.56 | 0.33 | 405.00 | 3 | 0 |
| 15 | @ladder-arb | Kalshi event contract | 99968.85 | -0.03 | 0.00 | -7.69 | 2.47 | 25.26 | 12 | 0 |
| 16 | @calendar-carry | Exchange-listed commodity future | 99946.49 | -0.05 | 0.00 | -18.54 | 7.14 | 7990.55 | 4 | 8 |
| 17 | @fade-the-crowd | Kalshi event contract | 99936.45 | -0.06 | 0.00 | -2.25 | 20.54 | 26.12 | 9 | 0 |
| 18 | @agri-trend | Exchange-listed commodity future | 99913.03 | -0.09 | 0.00 | -82.44 | 4.53 | 1215.19 | 9 | 0 |
| 19 | @basis-hunter | Cross-venue: Kalshi perpetual future vs exchange-listed future | 99897.38 | -0.10 | 0.00 | -89.21 | 13.41 | 44.60 | 4 | 0 |
| 20 | @metal-trend | Exchange-listed commodity future | 99863.54 | -0.14 | 0.00 | -131.34 | 5.12 | 673.80 | 9 | 0 |

## Per-strategy analysis

### @fade-the-crowd - Longshot Fade

- **Market type:** Kalshi event contract
- **Thesis:** Buy NO on commodity event contracts whose YES price is at or below 10 cents. If the longshot bias exists in Kalshi commodity ladders, the average NO leg should be profitable on a large number of observations; if the bias does not exist, this strategy loses and the leaderboard will show it.
- **Rules:** entry - YES mid <= 0.10, spread <= 3 cents, at least 2 hours to close, top-3 liquidity strikes only.; exit - No exit: positions are held to settlement, because the thesis is about the settlement distribution.
- **Result:** -0.06% (equity 99936.45 USD), 9 entries, 0 exits, 0 blocked order attempts.
- 9 ledger records so far: 3 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 20.54 USD of fees and 26.12 USD of measured slippage against the mid.
- 1 open positions carry verified marks totalling -2.25 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Brent Crude Oil (2 trades, 0 USD realized, 0.31 USD fees); Gasoline (US retail average) (6 trades, 0 USD realized, 20.14 USD fees); Natural Gas (1 trades, 0 USD realized, 0.09 USD fees)

### @carry-collector - Favourite Carry

- **Market type:** Kalshi event contract
- **Thesis:** Buy NO where YES is already at or above 90 cents and the contract closes within two days. This is the mirror image of the longshot fade: it wins often and loses big occasionally, which is exactly the return profile a highest-return-only competition is allowed to take.
- **Rules:** entry - YES mid >= 0.90, spread <= 3 cents, closes within 48 hours.; exit - No exit: held to settlement.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.

### @spread-hunter - Spread Capture

- **Market type:** Kalshi event contract
- **Thesis:** Rest passive bids one cent inside the spread on the most liquid commodity contracts and rely on the exchange order flow to cross them. The maker fee multiplier is zero for standard series per the official fee schedule, so a fill at the resting price is pure spread capture.
- **Rules:** entry - Spread >= 3 cents, resting bid at best bid + 1 cent, never crossing the offer.; exit - Working orders expire after the configured TTL; positions are marked to the opposite side of the book.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 9 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.
- Orders it tried to place were not executed, for these recorded reasons: resting_order_registered (9). Each of those is a liquidity or data limitation of the real market, not a strategy result.

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
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.

### @ladder-arb - Ladder Arbitrage

- **Market type:** Kalshi event contract
- **Thesis:** Within one series and one expiry, the YES price must fall as the strike rises (for greater-than markets). When the published book violates that ordering by more than the configured tolerance, buy the underpriced YES leg and the NO of the overpriced leg.
- **Rules:** entry - Monotonicity violation of at least 2 cents between two strikes of the same series and expiry.; exit - Held to settlement (the two legs converge by construction).
- **Result:** -0.03% (equity 99968.85 USD), 12 entries, 0 exits, 0 blocked order attempts.
- 12 ledger records so far: 3 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 2.47 USD of fees and 25.26 USD of measured slippage against the mid.
- 2 open positions carry verified marks totalling -7.69 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Brent Crude Oil (6 trades, 0 USD realized, 1.61 USD fees); Gasoline (US retail average) (4 trades, 0 USD realized, 0.55 USD fees); Natural Gas (2 trades, 0 USD realized, 0.31 USD fees)

### @barrel-rider - Oil Trend Rider

- **Market type:** Kalshi event contract
- **Thesis:** Trade the Kalshi WTI/Brent ladders in the direction of the verified trend in the same series own official candle history, taking the side whose price is closest to a coin flip so that a correct directional call pays multiples.
- **Rules:** entry - |5-day candle momentum| >= 2%, enter in the direction of the trend, YES mid between 0.2 and 0.6.; exit - Exit when momentum flips sign or the market closes.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.

### @perp-surfer - Perp Surfer

- **Market type:** Kalshi perpetual future
- **Thesis:** Take the direction of the last verified move in each Kalshi metal perpetual and hold it, re-evaluating on every snapshot. The perpetual is the only instrument in this project that trades continuously, so it is where an overnight trend can actually be captured.
- **Rules:** entry - Price changed since the previous committed snapshot, with a live two-sided quote.; exit - Exit when the direction of the last change flips.
- **Result:** -0.00% (equity 99998.92 USD), 2 entries, 0 exits, 0 blocked order attempts.
- 2 ledger records so far: 2 distinct commodity exposures across kalshi_margin.
- Closed-trade P&L is 0.00 USD against 0.00 USD of fees and 0.54 USD of measured slippage against the mid.
- 1 open positions carry verified marks totalling 1.37 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (1 trades, 0 USD realized, 0 USD fees); Silver (1 trades, 0 USD realized, 0 USD fees)

### @metal-trend - Metals Trend

- **Market type:** Exchange-listed commodity future
- **Thesis:** Rank the MOEX metal futures by their official settlement momentum over the cached history window and take the extremes, long the strongest and short the weakest. Trades only when the exchange publishes both a live quote and USD valuation inputs.
- **Rules:** entry - 20-observation settlement momentum, long the top mover and short the bottom mover on each side when |momentum| >= 1%.; exit - Exit when the momentum flips sign.
- **Result:** -0.14% (equity 99863.54 USD), 9 entries, 0 exits, 0 blocked order attempts.
- 9 ledger records so far: 7 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 5.12 USD of fees and 673.80 USD of measured slippage against the mid.
- 9 open positions carry verified marks totalling -131.34 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Copper (1 trades, 0 USD realized, 0.7696 USD fees); Zinc (1 trades, 0 USD realized, 0.5687 USD fees); Gold (2 trades, 0 USD realized, 1.166194 USD fees); Nickel (1 trades, 0 USD realized, 0.10682 USD fees); Platinum (mini) (1 trades, 0 USD realized, 0.766752 USD fees); Platinum (2 trades, 0 USD realized, 0.960459 USD fees); Aluminium (1 trades, 0 USD realized, 0.779742 USD fees)

### @calendar-carry - Calendar Carry

- **Market type:** Exchange-listed commodity future
- **Thesis:** Buy the near expiry and sell the far expiry (or the reverse) whenever the annualised spread between the official mid prices exceeds the exchange published round-trip fee converted at the official USD/RUB rate. Both legs are real orders with real fees.
- **Rules:** entry - Annualised calendar spread >= 12% after measured round-trip fees.; exit - Exit when the annualised spread compresses below 4%, or when either contract is within 5 days of expiry.
- **Result:** -0.05% (equity 99946.49 USD), 12 entries, 8 exits, 0 blocked order attempts.
- 20 ledger records so far: 3 distinct commodity exposures across moex_forts.
- Closed-trade P&L is -27.83 USD against 7.14 USD of fees and 7990.55 USD of measured slippage against the mid.
- Best closed trade: CCX6 at 5.86736 USD (calendar_carry_review).
- Worst closed trade: CCG7 at -13.460295 USD (calendar_carry_review).
- 4 open positions carry verified marks totalling -18.54 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Cocoa (10 trades, -18.231196 USD realized, 6.29348 USD fees); Sugar (8 trades, -9.602457 USD realized, 0.183184 USD fees); Orange Juice (ORANGE) (2 trades, 0 USD realized, 0.660408 USD fees)

### @agri-trend - Agri Trend

- **Market type:** Exchange-listed commodity future
- **Thesis:** Follow the official settlement trend in MOEX soft commodities and grains, taking the strongest movers on each side and holding while the trend persists.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 1.5%.; exit - Exit when the momentum flips sign.
- **Result:** -0.09% (equity 99913.03 USD), 9 entries, 0 exits, 0 blocked order attempts.
- 9 ledger records so far: 6 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 4.53 USD of fees and 1215.19 USD of measured slippage against the mid.
- 9 open positions carry verified marks totalling -82.44 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Cocoa (2 trades, 0 USD realized, 1.287496 USD fees); Coffee (2 trades, 0 USD realized, 1.255037 USD fees); Sugar (1 trades, 0 USD realized, 0.030216 USD fees); Wheat (1 trades, 0 USD realized, 0.654854 USD fees); Orange Juice (ORANGE) (2 trades, 0 USD realized, 0.680356 USD fees); Raw Sugar (SUGR) (1 trades, 0 USD realized, 0.623232 USD fees)

### @basis-hunter - Cross-Venue Basis

- **Market type:** Cross-venue: Kalshi perpetual future vs exchange-listed future
- **Thesis:** Compare the Kalshi metal perpetual (price / contract_size = USD per ounce) with the front MOEX future on the same metal (mid = USD per ounce when UNIT=USD). When the normalised basis is large enough to cover both venues fees, buy the cheaper venue and sell the more expensive one. Both legs are simulated with their own venue fill model.
- **Rules:** entry - Normalised basis >= 0.5% between the perpetual (USD/oz via contract_size) and the MOEX front future (USD/oz via official UNIT/LOT SIZE).; exit - Exit when the basis compresses below 0.1%, or when either leg loses its verified quote or normalisation inputs.
- **Result:** -0.10% (equity 99897.38 USD), 4 entries, 0 exits, 0 blocked order attempts.
- 4 ledger records so far: 3 distinct commodity exposures across kalshi_margin, moex_forts.
- Closed-trade P&L is 0.00 USD against 13.41 USD of fees and 44.60 USD of measured slippage against the mid.
- 4 open positions carry verified marks totalling -89.21 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (2 trades, 0 USD realized, 2.338218 USD fees); 0.001 ETH (1 trades, 0 USD realized, 3.1376 USD fees); Ether (ETHA Trust ETF) (1 trades, 0 USD realized, 7.936807 USD fees)

### @book-watcher - Order-Book Imbalance

- **Market type:** Kalshi event contract
- **Thesis:** Trade in the direction of the heavily unbalanced resting book: when the official order book shows at least 70% of visible depth on one side and the spread is tight, buy that side, betting that the resting liquidity reflects informed order flow.
- **Rules:** entry - Depth ratio >= 70% or <= 30% on visible book depth, spread <= 3 cents, YES mid between 0.15 and 0.85, at least 2 hours to close.; exit - Exit when the depth ratio crosses back through 50% or the market closes.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.

### @mark-fade - Perp Mark Fade

- **Market type:** Kalshi perpetual future
- **Thesis:** When the Kalshi perpetual mid deviates from the exchange-published mark price by 0.3% or more, trade back toward the mark; exit when the deviation decays below 0.08%. Both the deviation and its anchor come from the exchange payload in the same snapshot.
- **Rules:** entry - |perp mid / exchange mark - 1| >= 0.30%, with a live two-sided book; trade toward the mark.; exit - Exit when the deviation decays below 0.08% or the two-sided quote disappears.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi perpetual future markets every tick.

### @rig-count - Energy Trend

- **Market type:** Exchange-listed commodity future
- **Thesis:** Follow the official settlement trend in MOEX energy futures - crude (WTI, Brent), products (diesel, AI-92/95 gasoline) and gas (NG, NGM, TTF) - taking the strongest movers on each side and holding while the trend persists.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 1.5%.; exit - Exit when the momentum flips sign.
- **Result:** -0.01% (equity 99990.11 USD), 3 entries, 0 exits, 0 blocked order attempts.
- 3 ledger records so far: 2 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 0.33 USD of fees and 405.00 USD of measured slippage against the mid.
- 3 open positions carry verified marks totalling -9.56 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gasoline AI-92 (1 trades, 0 USD realized, 0.109065 USD fees); Gasoline AI-95 (2 trades, 0 USD realized, 0.221318 USD fees)

### @donchian-desk - Channel Breakout

- **Market type:** Exchange-listed commodity future
- **Thesis:** Run the classic 20/10 channel breakout on MOEX metals futures using only the exchange's official daily settlement history: buy the 20-day high breakout, short the 20-day low breakout, exit on the opposite 10-day extreme.
- **Rules:** entry - Daily settlement CLOSE crosses above the prior 20-observation high (long) or below the prior 20-observation low (short).; exit - Close crosses the opposite 10-observation extreme.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Exchange-listed commodity future markets every tick.

### @snap-fader - Jump Reversal

- **Market type:** Kalshi event contract
- **Thesis:** When a contract's official mid moves by 6 cents or more between two consecutive verified snapshots, take the opposite side: fade the jump. Deliberately distinct from @vol-crusher (which fades daily-candle extremes from the exchange candle history), this acts on tick-to-tick snapshot moves.
- **Rules:** entry - |mid change between the previous committed snapshot and this one| >= 6 cents, spread <= 4 cents, at least 2 hours to close, mid between 0.08 and 0.92.; exit - Exit when the mid retraces half of the measured jump, or the market closes.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.

### @usd-rub-desk - FX Trend

- **Market type:** Exchange-listed FX future
- **Thesis:** Follow the official settlement trend in MOEX FX futures - the USD/RUB and CNY/RUB contracts - taking the strongest movers and holding while the trend persists. Same measured-momentum rule as the energy desk, applied to the FX sector the brief requires the universe to cover.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 1.5%.; exit - Exit when the momentum flips sign.
- **Result:** -0.01% (equity 99994.64 USD), 2 entries, 0 exits, 0 blocked order attempts.
- 2 ledger records so far: 1 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 0.45 USD of fees and 0.21 USD of measured slippage against the mid.
- 2 open positions carry verified marks totalling -4.91 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** CNY/RUB (2 trades, 0 USD realized, 0.445696 USD fees)

### @index-mover - Index Trend

- **Market type:** Exchange-listed equity index future
- **Thesis:** Trade the official settlement momentum in MOEX equity-index futures - IMOEX (MIX), RTS, Nasdaq-100 (NASD) and S&P 500 (SPYF) - long the 15-observation winners, short the losers, and exit when the momentum flips. The index sector is one of the market types the brief requires the universe to cover.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 2.0%.; exit - Exit when the momentum flips sign.
- **Result:** -0.01% (equity 99994.60 USD), 3 entries, 0 exits, 0 blocked order attempts.
- 3 ledger records so far: 2 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 1.31 USD of fees and 184.50 USD of measured slippage against the mid.
- 3 open positions carry verified marks totalling -4.09 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** IMOEX Index (2 trades, 0 USD realized, 0.360717 USD fees); Nasdaq-100 Index (1 trades, 0 USD realized, 0.95184 USD fees)

### @ruonia-curve - Rate Curve Carry

- **Market type:** Exchange-listed interest rate future
- **Thesis:** Buy the near expiry and sell the far expiry (or the reverse) of the same MOEX rate future whenever the annualised spread between the official mid prices exceeds the exchange-published round-trip fee. The interest-rate sector is one of the market types the brief requires the universe to cover; the rule is the calendar-carry rule applied to the rate curve.
- **Rules:** entry - Annualised calendar spread >= 8% after measured round-trip fees.; exit - Exit when the annualised spread compresses below 3%, or when either contract is within 5 days of expiry.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Exchange-listed interest rate future markets every tick.

## Execution composition

- Taker fills that walked the official ladder: 21
- Quote-based fills at the official bid/offer: 52
- Modelled resting maker fills: 0
- Orders that could not be executed, with the recorded reason: 9
  - resting_order_registered: 9

## How to read this

These are simulated fills on real, verified market data. They are not exchange executions and they are not a track record. The point of the competition is to measure, over a full year, which of the twelve documented ideas survives contact with real liquidity, real spreads and real fees.
