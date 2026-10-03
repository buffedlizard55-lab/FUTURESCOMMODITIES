# Competition results

Generated 2026-10-03T22:04:06.029Z from the committed ledger. Season season-2026-09-22_to_2027-09-22 (2026-09-22T00:00:00Z to 2027-09-22T00:00:00Z), 60 ticks completed.

> Every number below is computed from data fetched from an official source. Simulated fills are labelled: `taker_walks_official_order_book` means the order walked real resting size, `quote_based_fill_at_official_bid_offer` means it filled at the exchange quote with size capped by published liquidity, and `modelled` marks resting maker orders whose queue position cannot be observed publicly.

Independent verification: **263/1268** trades fully verified, 1371 anomalies (see `data/verification/report.json`).

## Leaderboard

| # | Username | Market type | Equity (USD) | Return % | Realized | Unrealized | Fees | Slippage | Open | Closed trades |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | @agri-trend | Exchange-listed commodity future | 104897.60 | 4.90 | 0.00 | 1015.18 | 5.76 | 3041.40 | 12 | 0 |
| 2 | @metal-trend | Exchange-listed commodity future | 102427.16 | 2.43 | 0.00 | 2488.07 | 6.57 | 676.33 | 12 | 0 |
| 3 | @basis-hunter | Cross-venue: Kalshi perpetual future vs exchange-listed future | 100710.19 | 0.71 | 0.00 | 846.54 | 34.94 | 507.31 | 2 | 4 |
| 4 | @index-mover | Exchange-listed equity index future | 100127.65 | 0.13 | 0.00 | 130.14 | 2.49 | 218.50 | 5 | 0 |
| 5 | @vol-crusher | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 6 | @mark-fade | Kalshi perpetual future | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 7 | @spread-hunter | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 8 | @donchian-desk | Exchange-listed commodity future | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 9 | @perp-surfer | Kalshi perpetual future | 99998.92 | -0.00 | 0.00 | -41.63 | 1586.19 | 242.25 | 10 | 195 |
| 10 | @ruonia-curve | Exchange-listed interest rate future | 99997.29 | -0.00 | 0.00 | 0.00 | 0.19 | 0.01 | 2 | 0 |
| 11 | @barrel-rider | Kalshi event contract | 99996.89 | -0.00 | 162.21 | 0.00 | 22.05 | 39.12 | 13 | 5 |
| 12 | @tail-rider | Kalshi event contract | 99993.07 | -0.01 | -8.65 | 0.00 | 3.05 | 10.51 | 6 | 1 |
| 13 | @book-watcher | Kalshi event contract | 99980.31 | -0.02 | -71.74 | -9.79 | 44.56 | 55.43 | 14 | 21 |
| 14 | @ladder-arb | Kalshi event contract | 99968.85 | -0.03 | -6702.42 | 0.00 | 202.67 | 10479.31 | 13 | 75 |
| 15 | @fade-the-crowd | Kalshi event contract | 99936.45 | -0.06 | 1297.10 | -14.53 | 150.61 | 1067.62 | 49 | 111 |
| 16 | @snap-fader | Kalshi event contract | 99933.94 | -0.07 | -66.06 | 0.00 | 3.46 | 3.50 | 0 | 3 |
| 17 | @rig-count | Exchange-listed commodity future | 99928.58 | -0.07 | 0.00 | 1237.59 | 6.75 | 937.76 | 21 | 0 |
| 18 | @usd-rub-desk | Exchange-listed FX future | 99863.58 | -0.14 | 0.00 | -135.98 | 0.45 | 0.21 | 2 | 0 |
| 19 | @carry-collector | Kalshi event contract | 98930.22 | -1.07 | -1001.29 | 0.00 | 95.32 | 314.74 | 5 | 70 |
| 20 | @calendar-carry | Exchange-listed commodity future | 95564.00 | -4.44 | 0.00 | -80.52 | 128.17 | 50777.47 | 7 | 155 |

## Per-strategy analysis

### @fade-the-crowd - Longshot Fade

- **Market type:** Kalshi event contract
- **Thesis:** Buy NO on commodity event contracts whose YES price is at or below 10 cents. If the longshot bias exists in Kalshi commodity ladders, the average NO leg should be profitable on a large number of observations; if the bias does not exist, this strategy loses and the leaderboard will show it.
- **Rules:** entry - YES mid <= 0.10, spread <= 3 cents, at least 2 hours to close, top-3 liquidity strikes only.; exit - No exit: positions are held to settlement, because the thesis is about the settlement distribution.
- **Result:** -0.06% (equity 99936.45 USD), 160 entries, 0 exits, 184 blocked order attempts.
- 160 ledger records so far: 7 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 150.61 USD of fees and 1067.62 USD of measured slippage against the mid.
- 4 open positions carry verified marks totalling -14.53 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Blocked order attempts and their recorded reasons: settlement_result_not_published (183), insufficient_depth_within_price_tolerance (1).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Brent Crude Oil (8 trades, 0 USD realized, 2.76 USD fees); Gasoline (US retail average) (88 trades, 0 USD realized, 111.01 USD fees); Natural Gas (1 trades, 0 USD realized, 0.09 USD fees); Gold (16 trades, 0 USD realized, 12.15 USD fees); WTI Crude Oil (19 trades, 0 USD realized, 17.57 USD fees); Copper (13 trades, 0 USD realized, 2.94 USD fees); Silver (15 trades, 0 USD realized, 4.09 USD fees)

### @carry-collector - Favourite Carry

- **Market type:** Kalshi event contract
- **Thesis:** Buy NO where YES is already at or above 90 cents and the contract closes within two days. This is the mirror image of the longshot fade: it wins often and loses big occasionally, which is exactly the return profile a highest-return-only competition is allowed to take.
- **Rules:** entry - YES mid >= 0.90, spread <= 3 cents, closes within 48 hours.; exit - No exit: held to settlement.
- **Result:** -1.07% (equity 98930.22 USD), 75 entries, 0 exits, 151 blocked order attempts.
- 75 ledger records so far: 7 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 95.32 USD of fees and 314.74 USD of measured slippage against the mid.
- Blocked order attempts and their recorded reasons: insufficient_depth_within_price_tolerance (2), settlement_result_not_published (149).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (3 trades, 0 USD realized, 0.67 USD fees); Gasoline (US retail average) (51 trades, 0 USD realized, 62 USD fees); WTI Crude Oil (8 trades, 0 USD realized, 14.95 USD fees); Copper (4 trades, 0 USD realized, 2.71 USD fees); Silver (6 trades, 0 USD realized, 11.61 USD fees); Natural Gas (1 trades, 0 USD realized, 0.02 USD fees); Brent Crude Oil (2 trades, 0 USD realized, 3.36 USD fees)

### @spread-hunter - Spread Capture

- **Market type:** Kalshi event contract
- **Thesis:** Rest passive bids one cent inside the spread on the most liquid commodity contracts and rely on the exchange order flow to cross them. The maker fee multiplier is zero for standard series per the official fee schedule, so a fill at the resting price is pure spread capture.
- **Rules:** entry - Spread >= 3 cents, resting bid at best bid + 1 cent, never crossing the offer.; exit - Working orders expire after the configured TTL; positions are marked to the opposite side of the book.
- **Result:** 0.00% (equity 100000.00 USD), 0 entries, 0 exits, 155 blocked order attempts.
- No trade has been placed yet. The strategy is live and evaluating Kalshi event contract markets every tick.
- Orders it tried to place were not executed, for these recorded reasons: resting_order_registered (155). Each of those is a liquidity or data limitation of the real market, not a strategy result.

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
- **Result:** -0.01% (equity 99993.07 USD), 7 entries, 0 exits, 7 blocked order attempts.
- 7 ledger records so far: 3 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 3.05 USD of fees and 10.51 USD of measured slippage against the mid.
- Blocked order attempts and their recorded reasons: settlement_result_not_published (4), already_holding (3).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Copper (1 trades, 0 USD realized, 0.55 USD fees); Gasoline (US retail average) (4 trades, 0 USD realized, 2.14 USD fees); Gold (2 trades, 0 USD realized, 0.36 USD fees)

### @ladder-arb - Ladder Arbitrage

- **Market type:** Kalshi event contract
- **Thesis:** Within one series and one expiry, the YES price must fall as the strike rises (for greater-than markets). When the published book violates that ordering by more than the configured tolerance, buy the underpriced YES leg and the NO of the overpriced leg.
- **Rules:** entry - Monotonicity violation of at least 2 cents between two strikes of the same series and expiry.; exit - Held to settlement (the two legs converge by construction).
- **Result:** -0.03% (equity 99968.85 USD), 88 entries, 0 exits, 128 blocked order attempts.
- 88 ledger records so far: 7 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 202.67 USD of fees and 10479.31 USD of measured slippage against the mid.
- Blocked order attempts and their recorded reasons: already_holding (4), settlement_result_not_published (120), insufficient_depth_within_price_tolerance (4).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Brent Crude Oil (6 trades, 0 USD realized, 1.61 USD fees); Gasoline (US retail average) (59 trades, 0 USD realized, 195.5 USD fees); Natural Gas (4 trades, 0 USD realized, 2.54 USD fees); WTI Crude Oil (2 trades, 0 USD realized, 0.89 USD fees); Palladium (7 trades, 0 USD realized, 0.11 USD fees); Copper (8 trades, 0 USD realized, 1.11 USD fees); Gold (2 trades, 0 USD realized, 0.91 USD fees)

### @barrel-rider - Oil Trend Rider

- **Market type:** Kalshi event contract
- **Thesis:** Trade the Kalshi WTI/Brent ladders in the direction of the verified trend in the same series own official candle history, taking the side whose price is closest to a coin flip so that a correct directional call pays multiples.
- **Rules:** entry - |5-day candle momentum| >= 2%, enter in the direction of the trend, YES mid between 0.2 and 0.6.; exit - Exit when momentum flips sign or the market closes.
- **Result:** -0.00% (equity 99996.89 USD), 18 entries, 0 exits, 35 blocked order attempts.
- 18 ledger records so far: 4 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 22.05 USD of fees and 39.12 USD of measured slippage against the mid.
- Blocked order attempts and their recorded reasons: settlement_result_not_published (30), already_holding (4), insufficient_depth_within_price_tolerance (1).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gasoline (US retail average) (10 trades, 0 USD realized, 5.48 USD fees); WTI Crude Oil (4 trades, 0 USD realized, 13.66 USD fees); Natural Gas (2 trades, 0 USD realized, 0.05 USD fees); Brent Crude Oil (2 trades, 0 USD realized, 2.86 USD fees)

### @perp-surfer - Perp Surfer

- **Market type:** Kalshi perpetual future
- **Thesis:** Take the direction of the last verified move in each Kalshi metal perpetual and hold it, re-evaluating on every snapshot. The perpetual is the only instrument in this project that trades continuously, so it is where an overnight trend can actually be captured.
- **Rules:** entry - Price changed since the previous committed snapshot, with a live two-sided quote.; exit - Exit when the direction of the last change flips.
- **Result:** -0.00% (equity 99998.92 USD), 205 entries, 264 exits, 20 blocked order attempts.
- 469 ledger records so far: 12 distinct commodity exposures across kalshi_margin.
- Closed-trade P&L is -4640.63 USD against 1586.19 USD of fees and 242.25 USD of measured slippage against the mid.
- Best closed trade: KXADAPERP at 242.956744 USD (perp_momentum_flip).
- Worst closed trade: KXBCHPERP at -200.260307 USD (perp_momentum_flip).
- 9 open positions carry verified marks totalling -41.63 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Blocked order attempts and their recorded reasons: insufficient_margin (20).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (49 trades, -323.590397 USD realized, 268.570509 USD fees); Silver (1 trades, 0 USD realized, 0 USD fees); 0.01 AAVE (12 trades, -77.138233 USD realized, 16.967929 USD fees); 1 ADA (57 trades, -261.855428 USD realized, 107.123998 USD fees); 0.01 BCH (47 trades, -996.251312 USD realized, 158.291618 USD fees); 0.001 BNB (51 trades, -101.330511 USD realized, 36.644925 USD fees); 0.0001 BTC (67 trades, -619.16037 USD realized, 401.56162 USD fees); 100 DOGE (54 trades, -303.972336 USD realized, 84.918886 USD fees); 0.001 ETH (63 trades, -1135.364407 USD realized, 377.839401 USD fees); 0.1 HYPE (37 trades, -637.124735 USD realized, 113.441033 USD fees); 1K kSHIB (29 trades, -180.92137 USD realized, 19.359856 USD fees); 1 LINK (2 trades, -3.916405 USD realized, 1.474005 USD fees)

### @metal-trend - Metals Trend

- **Market type:** Exchange-listed commodity future
- **Thesis:** Rank the MOEX metal futures by their official settlement momentum over the cached history window and take the extremes, long the strongest and short the weakest. Trades only when the exchange publishes both a live quote and USD valuation inputs.
- **Rules:** entry - 20-observation settlement momentum, long the top mover and short the bottom mover on each side when |momentum| >= 1%.; exit - Exit when the momentum flips sign.
- **Result:** 2.43% (equity 102427.16 USD), 12 entries, 0 exits, 0 blocked order attempts.
- 12 ledger records so far: 8 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 6.57 USD of fees and 676.33 USD of measured slippage against the mid.
- 8 open positions carry verified marks totalling 2488.07 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Copper (1 trades, 0 USD realized, 0.7696 USD fees); Zinc (1 trades, 0 USD realized, 0.5687 USD fees); Gold (2 trades, 0 USD realized, 1.166194 USD fees); Nickel (1 trades, 0 USD realized, 0.10682 USD fees); Platinum (mini) (2 trades, 0 USD realized, 0.791185 USD fees); Platinum (2 trades, 0 USD realized, 0.960459 USD fees); Aluminium (1 trades, 0 USD realized, 0.779742 USD fees); Silver (2 trades, 0 USD realized, 1.426816 USD fees)

### @calendar-carry - Calendar Carry

- **Market type:** Exchange-listed commodity future
- **Thesis:** Buy the near expiry and sell the far expiry (or the reverse) whenever the annualised spread between the official mid prices exceeds the exchange published round-trip fee converted at the official USD/RUB rate. Both legs are real orders with real fees.
- **Rules:** entry - Annualised calendar spread >= 12% after measured round-trip fees.; exit - Exit when the annualised spread compresses below 4%, or when either contract is within 5 days of expiry.
- **Result:** -4.44% (equity 95564.00 USD), 162 entries, 186 exits, 145 blocked order attempts.
- 348 ledger records so far: 5 distinct commodity exposures across moex_forts.
- Closed-trade P&L is -668.58 USD against 128.17 USD of fees and 50777.47 USD of measured slippage against the mid.
- Best closed trade: SAH7 at 281.147303 USD (calendar_carry_review).
- Worst closed trade: CCG7 at -245.827404 USD (calendar_carry_review).
- 5 open positions carry verified marks totalling -80.52 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Blocked order attempts and their recorded reasons: no_verified_quote (57), insufficient_margin (88).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Cocoa (84 trades, -81.557744 USD realized, 48.203435 USD fees); Sugar (31 trades, -48.422425 USD realized, 1.834165 USD fees); Orange Juice (ORANGE) (69 trades, -193.487809 USD realized, 18.348968 USD fees); Raw Sugar (SUGR) (77 trades, -208.005612 USD realized, 27.818387 USD fees); Wheat (87 trades, -137.108763 USD realized, 31.970014 USD fees)

### @agri-trend - Agri Trend

- **Market type:** Exchange-listed commodity future
- **Thesis:** Follow the official settlement trend in MOEX soft commodities and grains, taking the strongest movers on each side and holding while the trend persists.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 1.5%.; exit - Exit when the momentum flips sign.
- **Result:** 4.90% (equity 104897.60 USD), 12 entries, 0 exits, 0 blocked order attempts.
- 12 ledger records so far: 6 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 5.76 USD of fees and 3041.40 USD of measured slippage against the mid.
- 10 open positions carry verified marks totalling 1015.18 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Cocoa (2 trades, 0 USD realized, 1.287496 USD fees); Coffee (2 trades, 0 USD realized, 1.255037 USD fees); Sugar (1 trades, 0 USD realized, 0.030216 USD fees); Wheat (3 trades, 0 USD realized, 1.334012 USD fees); Orange Juice (ORANGE) (2 trades, 0 USD realized, 0.680356 USD fees); Raw Sugar (SUGR) (2 trades, 0 USD realized, 1.175643 USD fees)

### @basis-hunter - Cross-Venue Basis

- **Market type:** Cross-venue: Kalshi perpetual future vs exchange-listed future
- **Thesis:** Compare the Kalshi metal perpetual (price / contract_size = USD per ounce) with the front MOEX future on the same metal (mid = USD per ounce when UNIT=USD). When the normalised basis is large enough to cover both venues fees, buy the cheaper venue and sell the more expensive one. Both legs are simulated with their own venue fill model.
- **Rules:** entry - Normalised basis >= 0.5% between the perpetual (USD/oz via contract_size) and the MOEX front future (USD/oz via official UNIT/LOT SIZE).; exit - Exit when the basis compresses below 0.1%, or when either leg loses its verified quote or normalisation inputs.
- **Result:** 0.71% (equity 100710.19 USD), 6 entries, 4 exits, 5 blocked order attempts.
- 10 ledger records so far: 5 distinct commodity exposures across kalshi_margin, moex_forts.
- Closed-trade P&L is -101.40 USD against 34.94 USD of fees and 507.31 USD of measured slippage against the mid.
- Best closed trade: KXBTCPERP at 6.69026 USD (basis_leg_unavailable).
- Worst closed trade: ETZ6 at -101.103614 USD (unit_reconciliation_failed).
- 2 open positions carry verified marks totalling 846.54 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Blocked order attempts and their recorded reasons: no_verified_quote (5).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (3 trades, -0.424616 USD realized, 2.358696 USD fees); 0.001 ETH (2 trades, -6.559641 USD realized, 6.275541 USD fees); Ether (ETHA Trust ETF) (2 trades, -101.103614 USD realized, 15.873614 USD fees); 0.0001 BTC (2 trades, 6.69026 USD realized, 4.77934 USD fees); Bitcoin (1 trades, 0 USD realized, 5.652864 USD fees)

### @book-watcher - Order-Book Imbalance

- **Market type:** Kalshi event contract
- **Thesis:** Trade in the direction of the heavily unbalanced resting book: when the official order book shows at least 70% of visible depth on one side and the spread is tight, buy that side, betting that the resting liquidity reflects informed order flow.
- **Rules:** entry - Depth ratio >= 70% or <= 30% on visible book depth, spread <= 3 cents, YES mid between 0.15 and 0.85, at least 2 hours to close.; exit - Exit when the depth ratio crosses back through 50% or the market closes.
- **Result:** -0.02% (equity 99980.31 USD), 35 entries, 1 exits, 22 blocked order attempts.
- 36 ledger records so far: 6 distinct commodity exposures across kalshi.
- Closed-trade P&L is -5.74 USD against 44.56 USD of fees and 55.43 USD of measured slippage against the mid.
- Best closed trade: KXGOLDMON-26SEP3017-T4130.99 at -5.74 USD (book_imbalance_flip).
- Worst closed trade: KXGOLDMON-26SEP3017-T4130.99 at -5.74 USD (book_imbalance_flip).
- 2 open positions carry verified marks totalling -9.79 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Blocked order attempts and their recorded reasons: settlement_result_not_published (20), insufficient_depth_within_price_tolerance (2).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (8 trades, -5.74 USD realized, 11.41 USD fees); Brent Crude Oil (7 trades, 0 USD realized, 10.77 USD fees); Gasoline (US retail average) (10 trades, 0 USD realized, 8.84 USD fees); Copper (8 trades, 0 USD realized, 10.43 USD fees); Silver (2 trades, 0 USD realized, 2.23 USD fees); WTI Crude Oil (1 trades, 0 USD realized, 0.88 USD fees)

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
- **Result:** -0.07% (equity 99928.58 USD), 21 entries, 0 exits, 0 blocked order attempts.
- 21 ledger records so far: 8 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 6.75 USD of fees and 937.76 USD of measured slippage against the mid.
- 8 open positions carry verified marks totalling 1237.59 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gasoline AI-92 (2 trades, 0 USD realized, 0.217893 USD fees); Gasoline AI-95 (2 trades, 0 USD realized, 0.221318 USD fees); Brent Crude Oil (3 trades, 0 USD realized, 1.932535 USD fees); Diesel (DTL) (3 trades, 0 USD realized, 0.306386 USD fees); Natural Gas (TTF) (3 trades, 0 USD realized, 1.378729 USD fees); Natural Gas (NG) (3 trades, 0 USD realized, 1.312468 USD fees); Natural Gas (NGM) (3 trades, 0 USD realized, 1.145055 USD fees); WTI Crude Oil (2 trades, 0 USD realized, 0.235453 USD fees)

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
- **Result:** -0.07% (equity 99933.94 USD), 3 entries, 0 exits, 12 blocked order attempts.
- 3 ledger records so far: 1 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 3.46 USD of fees and 3.50 USD of measured slippage against the mid.
- Blocked order attempts and their recorded reasons: settlement_result_not_published (12).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (3 trades, 0 USD realized, 3.46 USD fees)

### @usd-rub-desk - FX Trend

- **Market type:** Exchange-listed FX future
- **Thesis:** Follow the official settlement trend in MOEX FX futures - the USD/RUB and CNY/RUB contracts - taking the strongest movers and holding while the trend persists. Same measured-momentum rule as the energy desk, applied to the FX sector the brief requires the universe to cover.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 1.5%.; exit - Exit when the momentum flips sign.
- **Result:** -0.14% (equity 99863.58 USD), 2 entries, 0 exits, 0 blocked order attempts.
- 2 ledger records so far: 1 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 0.45 USD of fees and 0.21 USD of measured slippage against the mid.
- 2 open positions carry verified marks totalling -135.98 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** CNY/RUB (2 trades, 0 USD realized, 0.445696 USD fees)

### @index-mover - Index Trend

- **Market type:** Exchange-listed equity index future
- **Thesis:** Trade the official settlement momentum in MOEX equity-index futures - IMOEX (MIX), RTS, Nasdaq-100 (NASD) and S&P 500 (SPYF) - long the 15-observation winners, short the losers, and exit when the momentum flips. The index sector is one of the market types the brief requires the universe to cover.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 2.0%.; exit - Exit when the momentum flips sign.
- **Result:** 0.13% (equity 100127.65 USD), 5 entries, 0 exits, 0 blocked order attempts.
- 5 ledger records so far: 3 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 2.49 USD of fees and 218.50 USD of measured slippage against the mid.
- 5 open positions carry verified marks totalling 130.14 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** IMOEX Index (2 trades, 0 USD realized, 0.360717 USD fees); Nasdaq-100 Index (2 trades, 0 USD realized, 1.90368 USD fees); RTS Index (1 trades, 0 USD realized, 0.227454 USD fees)

### @ruonia-curve - Rate Curve Carry

- **Market type:** Exchange-listed interest rate future
- **Thesis:** Buy the near expiry and sell the far expiry (or the reverse) of the same MOEX rate future whenever the annualised spread between the official mid prices exceeds the exchange-published round-trip fee. The interest-rate sector is one of the market types the brief requires the universe to cover; the rule is the calendar-carry rule applied to the rate curve.
- **Rules:** entry - Annualised calendar spread >= 8% after measured round-trip fees.; exit - Exit when the annualised spread compresses below 3%, or when either contract is within 5 days of expiry.
- **Result:** -0.00% (equity 99997.29 USD), 2 entries, 0 exits, 0 blocked order attempts.
- 2 ledger records so far: 1 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 0.19 USD of fees and 0.01 USD of measured slippage against the mid.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** RUONIA Rate (2 trades, 0 USD realized, 0.186545 USD fees)

## Execution composition

- Taker fills that walked the official ladder: 387
- Quote-based fills at the official bid/offer: 881
- Modelled resting maker fills: 0
- Orders that could not be executed, with the recorded reason: 864
  - settlement_result_not_published: 518
  - resting_order_registered: 155
  - insufficient_margin: 108
  - no_verified_quote: 62
  - already_holding: 11
  - insufficient_depth_within_price_tolerance: 10

## How to read this

These are simulated fills on real, verified market data. They are not exchange executions and they are not a track record. The point of the competition is to measure, over a full year, which of the twelve documented ideas survives contact with real liquidity, real spreads and real fees.
