# Competition results

Generated 2026-09-24T01:15:59.520Z from the committed ledger. Season season-2026-09-22_to_2027-09-22 (2026-09-22T00:00:00Z to 2027-09-22T00:00:00Z), 11 ticks completed.

> Every number below is computed from data fetched from an official source. Simulated fills are labelled: `taker_walks_official_order_book` means the order walked real resting size, `quote_based_fill_at_official_bid_offer` means it filled at the exchange quote with size capped by published liquidity, and `modelled` marks resting maker orders whose queue position cannot be observed publicly.

Independent verification: **206/278** trades fully verified, 72 anomalies (see `data/verification/report.json`).

## Leaderboard

| # | Username | Market type | Equity (USD) | Return % | Realized | Unrealized | Fees | Slippage | Open | Closed trades |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | @metal-trend | Exchange-listed commodity future | 100983.99 | 0.98 | 0.00 | 990.56 | 6.57 | 676.33 | 12 | 0 |
| 2 | @basis-hunter | Cross-venue: Kalshi perpetual future vs exchange-listed future | 100166.01 | 0.17 | 0.00 | 298.17 | 24.49 | 87.27 | 2 | 2 |
| 3 | @usd-rub-desk | Exchange-listed FX future | 100010.89 | 0.01 | 0.00 | 11.33 | 0.45 | 0.21 | 2 | 0 |
| 4 | @agri-trend | Exchange-listed commodity future | 100000.89 | 0.00 | 0.00 | 6.63 | 5.74 | 3031.40 | 11 | 0 |
| 5 | @vol-crusher | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 6 | @snap-fader | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 7 | @mark-fade | Kalshi perpetual future | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 8 | @spread-hunter | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 9 | @donchian-desk | Exchange-listed commodity future | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 10 | @ruonia-curve | Exchange-listed interest rate future | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 11 | @perp-surfer | Kalshi perpetual future | 99998.92 | -0.00 | 0.00 | 242.96 | 288.20 | 71.99 | 11 | 23 |
| 12 | @barrel-rider | Kalshi event contract | 99996.89 | -0.00 | 0.00 | -1.55 | 0.42 | 2.35 | 2 | 0 |
| 13 | @carry-collector | Kalshi event contract | 99995.71 | -0.00 | 4.39 | 0.00 | 3.39 | 20.11 | 3 | 3 |
| 14 | @tail-rider | Kalshi event contract | 99993.07 | -0.01 | 0.00 | 0.00 | 0.55 | 3.80 | 1 | 0 |
| 15 | @book-watcher | Kalshi event contract | 99980.31 | -0.02 | -230.51 | -3.20 | 9.29 | 8.74 | 4 | 3 |
| 16 | @ladder-arb | Kalshi event contract | 99968.85 | -0.03 | -0.35 | -11.20 | 9.29 | 171.96 | 26 | 4 |
| 17 | @calendar-carry | Exchange-listed commodity future | 99957.68 | -0.04 | 0.00 | -14.80 | 34.23 | 8304.24 | 4 | 40 |
| 18 | @fade-the-crowd | Kalshi event contract | 99936.45 | -0.06 | 17.80 | -198.32 | 39.81 | 222.22 | 27 | 4 |
| 19 | @rig-count | Exchange-listed commodity future | 99928.58 | -0.07 | 0.00 | 763.10 | 5.77 | 637.70 | 15 | 0 |
| 20 | @index-mover | Exchange-listed equity index future | 99874.33 | -0.13 | 0.00 | -123.40 | 2.26 | 208.50 | 4 | 0 |

## Per-strategy analysis

### @fade-the-crowd - Longshot Fade

- **Market type:** Kalshi event contract
- **Thesis:** Buy NO on commodity event contracts whose YES price is at or below 10 cents. If the longshot bias exists in Kalshi commodity ladders, the average NO leg should be profitable on a large number of observations; if the bias does not exist, this strategy loses and the leaderboard will show it.
- **Rules:** entry - YES mid <= 0.10, spread <= 3 cents, at least 2 hours to close, top-3 liquidity strikes only.; exit - No exit: positions are held to settlement, because the thesis is about the settlement distribution.
- **Result:** -0.06% (equity 99936.45 USD), 31 entries, 0 exits, 0 blocked order attempts.
- 31 ledger records so far: 6 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 39.81 USD of fees and 222.22 USD of measured slippage against the mid.
- 6 open positions carry verified marks totalling -198.32 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Brent Crude Oil (3 trades, 0 USD realized, 0.62 USD fees); Gasoline (US retail average) (17 trades, 0 USD realized, 37.46 USD fees); Natural Gas (1 trades, 0 USD realized, 0.09 USD fees); Gold (4 trades, 0 USD realized, 1.31 USD fees); WTI Crude Oil (4 trades, 0 USD realized, 0.22 USD fees); Copper (2 trades, 0 USD realized, 0.11 USD fees)

### @carry-collector - Favourite Carry

- **Market type:** Kalshi event contract
- **Thesis:** Buy NO where YES is already at or above 90 cents and the contract closes within two days. This is the mirror image of the longshot fade: it wins often and loses big occasionally, which is exactly the return profile a highest-return-only competition is allowed to take.
- **Rules:** entry - YES mid >= 0.90, spread <= 3 cents, closes within 48 hours.; exit - No exit: held to settlement.
- **Result:** -0.00% (equity 99995.71 USD), 6 entries, 0 exits, 1 blocked order attempts.
- 6 ledger records so far: 2 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 3.39 USD of fees and 20.11 USD of measured slippage against the mid.
- Blocked order attempts and their recorded reasons: insufficient_depth_within_price_tolerance (1).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (3 trades, 0 USD realized, 0.67 USD fees); Gasoline (US retail average) (3 trades, 0 USD realized, 2.72 USD fees)

### @spread-hunter - Spread Capture

- **Market type:** Kalshi event contract
- **Thesis:** Rest passive bids one cent inside the spread on the most liquid commodity contracts and rely on the exchange order flow to cross them. The maker fee multiplier is zero for standard series per the official fee schedule, so a fill at the resting price is pure spread capture.
- **Rules:** entry - Spread >= 3 cents, resting bid at best bid + 1 cent, never crossing the offer.; exit - Working orders expire after the configured TTL; positions are marked to the opposite side of the book.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 27 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.
- Orders it tried to place were not executed, for these recorded reasons: resting_order_registered (27). Each of those is a liquidity or data limitation of the real market, not a strategy result.

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
- **Result:** -0.01% (equity 99993.07 USD), 1 entries, 0 exits, 0 blocked order attempts.
- 1 ledger records so far: 1 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 0.55 USD of fees and 3.80 USD of measured slippage against the mid.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Copper (1 trades, 0 USD realized, 0.55 USD fees)

### @ladder-arb - Ladder Arbitrage

- **Market type:** Kalshi event contract
- **Thesis:** Within one series and one expiry, the YES price must fall as the strike rises (for greater-than markets). When the published book violates that ordering by more than the configured tolerance, buy the underpriced YES leg and the NO of the overpriced leg.
- **Rules:** entry - Monotonicity violation of at least 2 cents between two strikes of the same series and expiry.; exit - Held to settlement (the two legs converge by construction).
- **Result:** -0.03% (equity 99968.85 USD), 30 entries, 0 exits, 2 blocked order attempts.
- 30 ledger records so far: 6 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 9.29 USD of fees and 171.96 USD of measured slippage against the mid.
- 4 open positions carry verified marks totalling -11.20 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Blocked order attempts and their recorded reasons: already_holding (2).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Brent Crude Oil (6 trades, 0 USD realized, 1.61 USD fees); Gasoline (US retail average) (12 trades, 0 USD realized, 5.97 USD fees); Natural Gas (2 trades, 0 USD realized, 0.31 USD fees); WTI Crude Oil (2 trades, 0 USD realized, 0.89 USD fees); Palladium (4 trades, 0 USD realized, 0.05 USD fees); Copper (4 trades, 0 USD realized, 0.46 USD fees)

### @barrel-rider - Oil Trend Rider

- **Market type:** Kalshi event contract
- **Thesis:** Trade the Kalshi WTI/Brent ladders in the direction of the verified trend in the same series own official candle history, taking the side whose price is closest to a coin flip so that a correct directional call pays multiples.
- **Rules:** entry - |5-day candle momentum| >= 2%, enter in the direction of the trend, YES mid between 0.2 and 0.6.; exit - Exit when momentum flips sign or the market closes.
- **Result:** -0.00% (equity 99996.89 USD), 2 entries, 0 exits, 0 blocked order attempts.
- 2 ledger records so far: 1 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 0.42 USD of fees and 2.35 USD of measured slippage against the mid.
- 1 open positions carry verified marks totalling -1.55 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gasoline (US retail average) (2 trades, 0 USD realized, 0.42 USD fees)

### @perp-surfer - Perp Surfer

- **Market type:** Kalshi perpetual future
- **Thesis:** Take the direction of the last verified move in each Kalshi metal perpetual and hold it, re-evaluating on every snapshot. The perpetual is the only instrument in this project that trades continuously, so it is where an overnight trend can actually be captured.
- **Rules:** entry - Price changed since the previous committed snapshot, with a live two-sided quote.; exit - Exit when the direction of the last change flips.
- **Result:** -0.00% (equity 99998.92 USD), 34 entries, 29 exits, 0 blocked order attempts.
- 63 ledger records so far: 11 distinct commodity exposures across kalshi_margin.
- Closed-trade P&L is -849.85 USD against 288.20 USD of fees and 71.99 USD of measured slippage against the mid.
- Best closed trade: KXADAPERP at 242.956744 USD (perp_momentum_flip).
- Worst closed trade: KXBCHPERP at -200.260307 USD (perp_momentum_flip).
- 10 open positions carry verified marks totalling 242.96 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (5 trades, 42.192612 USD realized, 23.914989 USD fees); Silver (1 trades, 0 USD realized, 0 USD fees); 0.01 AAVE (6 trades, -57.768465 USD realized, 14.431588 USD fees); 1 ADA (6 trades, 171.917654 USD realized, 35.184746 USD fees); 0.01 BCH (9 trades, -645.640861 USD realized, 53.935588 USD fees); 0.001 BNB (10 trades, -56.649825 USD realized, 15.055924 USD fees); 0.0001 BTC (7 trades, -1.254753 USD realized, 41.820253 USD fees); 100 DOGE (6 trades, -77.10012 USD realized, 29.820311 USD fees); 0.001 ETH (7 trades, -86.182335 USD realized, 41.943435 USD fees); 0.1 HYPE (5 trades, -139.366805 USD realized, 29.452663 USD fees); 1K kSHIB (1 trades, 0 USD realized, 2.637279 USD fees)

### @metal-trend - Metals Trend

- **Market type:** Exchange-listed commodity future
- **Thesis:** Rank the MOEX metal futures by their official settlement momentum over the cached history window and take the extremes, long the strongest and short the weakest. Trades only when the exchange publishes both a live quote and USD valuation inputs.
- **Rules:** entry - 20-observation settlement momentum, long the top mover and short the bottom mover on each side when |momentum| >= 1%.; exit - Exit when the momentum flips sign.
- **Result:** 0.98% (equity 100983.99 USD), 12 entries, 0 exits, 0 blocked order attempts.
- 12 ledger records so far: 8 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 6.57 USD of fees and 676.33 USD of measured slippage against the mid.
- 12 open positions carry verified marks totalling 990.56 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Copper (1 trades, 0 USD realized, 0.7696 USD fees); Zinc (1 trades, 0 USD realized, 0.5687 USD fees); Gold (2 trades, 0 USD realized, 1.166194 USD fees); Nickel (1 trades, 0 USD realized, 0.10682 USD fees); Platinum (mini) (2 trades, 0 USD realized, 0.791185 USD fees); Platinum (2 trades, 0 USD realized, 0.960459 USD fees); Aluminium (1 trades, 0 USD realized, 0.779742 USD fees); Silver (2 trades, 0 USD realized, 1.426816 USD fees)

### @calendar-carry - Calendar Carry

- **Market type:** Exchange-listed commodity future
- **Thesis:** Buy the near expiry and sell the far expiry (or the reverse) whenever the annualised spread between the official mid prices exceeds the exchange published round-trip fee converted at the official USD/RUB rate. Both legs are real orders with real fees.
- **Rules:** entry - Annualised calendar spread >= 12% after measured round-trip fees.; exit - Exit when the annualised spread compresses below 4%, or when either contract is within 5 days of expiry.
- **Result:** -0.04% (equity 99957.68 USD), 44 entries, 44 exits, 1 blocked order attempts.
- 88 ledger records so far: 5 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 2.44 USD against 34.23 USD of fees and 8304.24 USD of measured slippage against the mid.
- Best closed trade: CCX6 at 249.510501 USD (calendar_carry_review).
- Worst closed trade: CCG7 at -245.827404 USD (calendar_carry_review).
- 4 open positions carry verified marks totalling -14.80 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Blocked order attempts and their recorded reasons: no_verified_quote (1).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Cocoa (39 trades, 49.726152 USD realized, 23.907578 USD fees); Sugar (8 trades, -9.602457 USD realized, 0.183184 USD fees); Orange Juice (ORANGE) (29 trades, -72.967879 USD realized, 8.422495 USD fees); Raw Sugar (SUGR) (8 trades, 35.478281 USD realized, 1.646191 USD fees); Wheat (4 trades, -0.191883 USD realized, 0.073847 USD fees)

### @agri-trend - Agri Trend

- **Market type:** Exchange-listed commodity future
- **Thesis:** Follow the official settlement trend in MOEX soft commodities and grains, taking the strongest movers on each side and holding while the trend persists.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 1.5%.; exit - Exit when the momentum flips sign.
- **Result:** 0.00% (equity 100000.89 USD), 11 entries, 0 exits, 0 blocked order attempts.
- 11 ledger records so far: 6 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 5.74 USD of fees and 3031.40 USD of measured slippage against the mid.
- 11 open positions carry verified marks totalling 6.63 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Cocoa (2 trades, 0 USD realized, 1.287496 USD fees); Coffee (2 trades, 0 USD realized, 1.255037 USD fees); Sugar (1 trades, 0 USD realized, 0.030216 USD fees); Wheat (2 trades, 0 USD realized, 1.313138 USD fees); Orange Juice (ORANGE) (2 trades, 0 USD realized, 0.680356 USD fees); Raw Sugar (SUGR) (2 trades, 0 USD realized, 1.175643 USD fees)

### @basis-hunter - Cross-Venue Basis

- **Market type:** Cross-venue: Kalshi perpetual future vs exchange-listed future
- **Thesis:** Compare the Kalshi metal perpetual (price / contract_size = USD per ounce) with the front MOEX future on the same metal (mid = USD per ounce when UNIT=USD). When the normalised basis is large enough to cover both venues fees, buy the cheaper venue and sell the more expensive one. Both legs are simulated with their own venue fill model.
- **Rules:** entry - Normalised basis >= 0.5% between the perpetual (USD/oz via contract_size) and the MOEX front future (USD/oz via official UNIT/LOT SIZE).; exit - Exit when the basis compresses below 0.1%, or when either leg loses its verified quote or normalisation inputs.
- **Result:** 0.17% (equity 100166.01 USD), 4 entries, 2 exits, 0 blocked order attempts.
- 6 ledger records so far: 3 distinct commodity exposures across kalshi_margin, moex_forts.
- Closed-trade P&L is -107.66 USD against 24.49 USD of fees and 87.27 USD of measured slippage against the mid.
- Best closed trade: KXETHPERP at -6.559641 USD (unit_reconciliation_failed).
- Worst closed trade: ETZ6 at -101.103614 USD (unit_reconciliation_failed).
- 2 open positions carry verified marks totalling 298.17 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (2 trades, 0 USD realized, 2.338218 USD fees); 0.001 ETH (2 trades, -6.559641 USD realized, 6.275541 USD fees); Ether (ETHA Trust ETF) (2 trades, -101.103614 USD realized, 15.873614 USD fees)

### @book-watcher - Order-Book Imbalance

- **Market type:** Kalshi event contract
- **Thesis:** Trade in the direction of the heavily unbalanced resting book: when the official order book shows at least 70% of visible depth on one side and the spread is tight, buy that side, betting that the resting liquidity reflects informed order flow.
- **Rules:** entry - Depth ratio >= 70% or <= 30% on visible book depth, spread <= 3 cents, YES mid between 0.15 and 0.85, at least 2 hours to close.; exit - Exit when the depth ratio crosses back through 50% or the market closes.
- **Result:** -0.02% (equity 99980.31 USD), 7 entries, 0 exits, 0 blocked order attempts.
- 7 ledger records so far: 3 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 9.29 USD of fees and 8.74 USD of measured slippage against the mid.
- 3 open positions carry verified marks totalling -3.20 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (3 trades, 0 USD realized, 6.97 USD fees); Brent Crude Oil (1 trades, 0 USD realized, 0.06 USD fees); Gasoline (US retail average) (3 trades, 0 USD realized, 2.26 USD fees)

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
- **Result:** -0.07% (equity 99928.58 USD), 15 entries, 0 exits, 0 blocked order attempts.
- 15 ledger records so far: 8 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 5.77 USD of fees and 637.70 USD of measured slippage against the mid.
- 13 open positions carry verified marks totalling 763.10 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gasoline AI-92 (1 trades, 0 USD realized, 0.109065 USD fees); Gasoline AI-95 (2 trades, 0 USD realized, 0.221318 USD fees); Brent Crude Oil (2 trades, 0 USD realized, 1.28836 USD fees); Diesel (DTL) (2 trades, 0 USD realized, 0.205855 USD fees); Natural Gas (TTF) (2 trades, 0 USD realized, 1.356655 USD fees); Natural Gas (NG) (2 trades, 0 USD realized, 1.221082 USD fees); Natural Gas (NGM) (2 trades, 0 USD realized, 1.137048 USD fees); WTI Crude Oil (2 trades, 0 USD realized, 0.235453 USD fees)

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
- **Result:** 0.01% (equity 100010.89 USD), 2 entries, 0 exits, 0 blocked order attempts.
- 2 ledger records so far: 1 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 0.45 USD of fees and 0.21 USD of measured slippage against the mid.
- 2 open positions carry verified marks totalling 11.33 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** CNY/RUB (2 trades, 0 USD realized, 0.445696 USD fees)

### @index-mover - Index Trend

- **Market type:** Exchange-listed equity index future
- **Thesis:** Trade the official settlement momentum in MOEX equity-index futures - IMOEX (MIX), RTS, Nasdaq-100 (NASD) and S&P 500 (SPYF) - long the 15-observation winners, short the losers, and exit when the momentum flips. The index sector is one of the market types the brief requires the universe to cover.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 2.0%.; exit - Exit when the momentum flips sign.
- **Result:** -0.13% (equity 99874.33 USD), 4 entries, 0 exits, 0 blocked order attempts.
- 4 ledger records so far: 2 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 2.26 USD of fees and 208.50 USD of measured slippage against the mid.
- 4 open positions carry verified marks totalling -123.40 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** IMOEX Index (2 trades, 0 USD realized, 0.360717 USD fees); Nasdaq-100 Index (2 trades, 0 USD realized, 1.90368 USD fees)

### @ruonia-curve - Rate Curve Carry

- **Market type:** Exchange-listed interest rate future
- **Thesis:** Buy the near expiry and sell the far expiry (or the reverse) of the same MOEX rate future whenever the annualised spread between the official mid prices exceeds the exchange-published round-trip fee. The interest-rate sector is one of the market types the brief requires the universe to cover; the rule is the calendar-carry rule applied to the rate curve.
- **Rules:** entry - Annualised calendar spread >= 8% after measured round-trip fees.; exit - Exit when the annualised spread compresses below 3%, or when either contract is within 5 days of expiry.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 0 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Exchange-listed interest rate future markets every tick.

## Execution composition

- Taker fills that walked the official ladder: 77
- Quote-based fills at the official bid/offer: 201
- Modelled resting maker fills: 0
- Orders that could not be executed, with the recorded reason: 31
  - resting_order_registered: 27
  - already_holding: 2
  - insufficient_depth_within_price_tolerance: 1
  - no_verified_quote: 1

## How to read this

These are simulated fills on real, verified market data. They are not exchange executions and they are not a track record. The point of the competition is to measure, over a full year, which of the twelve documented ideas survives contact with real liquidity, real spreads and real fees.
