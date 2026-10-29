# Competition results

Generated 2026-10-29T21:42:05.949Z from the committed ledger. Season season-2026-09-22_to_2027-09-22 (2026-09-22T00:00:00Z to 2027-09-22T00:00:00Z), 192 ticks completed.

> Every number below is computed from data fetched from an official source. Simulated fills are labelled: `taker_walks_official_order_book` means the order walked real resting size, `quote_based_fill_at_official_bid_offer` means it filled at the exchange quote with size capped by published liquidity, and `modelled` marks resting maker orders whose queue position cannot be observed publicly.

Independent verification: **7/2062** trades fully verified, 3430 anomalies (see `data/verification/report.json`).

## Leaderboard

| # | Username | Market type | Equity (USD) | Return % | Realized | Unrealized | Fees | Slippage | Open | Closed trades |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | @metal-trend | Exchange-listed commodity future | 105814.52 | 5.81 | 0.00 | 5821.09 | 6.57 | 676.33 | 12 | 0 |
| 2 | @agri-trend | Exchange-listed commodity future | 104897.60 | 4.90 | 0.00 | 1856.53 | 5.76 | 3041.40 | 12 | 0 |
| 3 | @basis-hunter | Cross-venue: Kalshi perpetual future vs exchange-listed future | 103151.16 | 3.15 | 0.00 | 1895.67 | 112.48 | 106678.25 | 3 | 11 |
| 4 | @vol-crusher | Kalshi event contract | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 5 | @donchian-desk | Exchange-listed commodity future | 100000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| 6 | @perp-surfer | Kalshi perpetual future | 99998.92 | -0.00 | 0.00 | 848550227390857.75 | 1106804646461.90 | 461168601843139.13 | 12 | 266 |
| 7 | @ruonia-curve | Exchange-listed interest rate future | 99997.29 | -0.00 | 0.00 | 0.00 | 0.19 | 0.01 | 2 | 0 |
| 8 | @barrel-rider | Kalshi event contract | 99996.89 | -0.00 | 366.82 | 0.00 | 30.03 | 63.19 | 19 | 8 |
| 9 | @spread-hunter | Kalshi event contract | 99994.40 | -0.01 | -5.60 | 0.00 | 0.00 | 0.00 | 0 | 2 |
| 10 | @tail-rider | Kalshi event contract | 99993.07 | -0.01 | -8.65 | 0.00 | 5.59 | 22.30 | 11 | 1 |
| 11 | @book-watcher | Kalshi event contract | 99980.31 | -0.02 | -1075.46 | 0.00 | 183.56 | 167.53 | 31 | 73 |
| 12 | @ladder-arb | Kalshi event contract | 99968.85 | -0.03 | -19528.11 | -10.18 | 660.97 | 23705.89 | 32 | 181 |
| 13 | @fade-the-crowd | Kalshi event contract | 99936.45 | -0.06 | 2197.84 | 91.80 | 292.08 | 2178.82 | 95 | 281 |
| 14 | @rig-count | Exchange-listed commodity future | 99928.58 | -0.07 | 0.00 | 6468.74 | 8.10 | 1131.35 | 26 | 0 |
| 15 | @mark-fade | Kalshi perpetual future | 99921.26 | -0.08 | 0.00 | -4.49 | 21.89 | 3041406929152860672.00 | 1 | 12 |
| 16 | @snap-fader | Kalshi event contract | 99718.47 | -0.28 | -316.63 | 0.00 | 18.94 | 17.68 | 0 | 7 |
| 17 | @usd-rub-desk | Exchange-listed FX future | 99618.44 | -0.38 | 0.00 | -381.11 | 0.45 | 0.21 | 2 | 0 |
| 18 | @index-mover | Exchange-listed equity index future | 98673.38 | -1.33 | 0.00 | -1324.13 | 2.49 | 218.50 | 5 | 0 |
| 19 | @calendar-carry | Exchange-listed commodity future | 95564.00 | -4.44 | 0.00 | 56.82 | 128.28 | 50917.50 | 9 | 156 |
| 20 | @carry-collector | Kalshi event contract | 87802.29 | -12.20 | -12197.71 | 0.00 | 789.19 | 2881.17 | 0 | 183 |

## Per-strategy analysis

### @fade-the-crowd - Longshot Fade

- **Market type:** Kalshi event contract
- **Thesis:** Buy NO on commodity event contracts whose YES price is at or below 10 cents. If the longshot bias exists in Kalshi commodity ladders, the average NO leg should be profitable on a large number of observations; if the bias does not exist, this strategy loses and the leaderboard will show it.
- **Rules:** entry - YES mid <= 0.10, spread <= 3 cents, at least 2 hours to close, top-3 liquidity strikes only.; exit - No exit: positions are held to settlement, because the thesis is about the settlement distribution.
- **Result:** -0.06% (equity 99936.45 USD), 376 entries, 0 exits, 420 blocked order attempts.
- 376 ledger records so far: 7 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 292.08 USD of fees and 2178.82 USD of measured slippage against the mid.
- 1 open positions carry verified marks totalling 91.80 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Blocked order attempts and their recorded reasons: settlement_result_not_published (409), insufficient_depth_within_price_tolerance (11).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Brent Crude Oil (29 trades, 0 USD realized, 9.65 USD fees); Gasoline (US retail average) (173 trades, 0 USD realized, 196.02 USD fees); Natural Gas (11 trades, 0 USD realized, 4.48 USD fees); Gold (50 trades, 0 USD realized, 24.07 USD fees); WTI Crude Oil (46 trades, 0 USD realized, 39.56 USD fees); Copper (26 trades, 0 USD realized, 6.01 USD fees); Silver (41 trades, 0 USD realized, 12.29 USD fees)

### @carry-collector - Favourite Carry

- **Market type:** Kalshi event contract
- **Thesis:** Buy NO where YES is already at or above 90 cents and the contract closes within two days. This is the mirror image of the longshot fade: it wins often and loses big occasionally, which is exactly the return profile a highest-return-only competition is allowed to take.
- **Rules:** entry - YES mid >= 0.90, spread <= 3 cents, closes within 48 hours.; exit - No exit: held to settlement.
- **Result:** -12.20% (equity 87802.29 USD), 183 entries, 0 exits, 295 blocked order attempts.
- 183 ledger records so far: 7 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 789.19 USD of fees and 2881.17 USD of measured slippage against the mid.
- Blocked order attempts and their recorded reasons: insufficient_depth_within_price_tolerance (2), settlement_result_not_published (293).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (10 trades, 0 USD realized, 5.57 USD fees); Gasoline (US retail average) (124 trades, 0 USD realized, 711.61 USD fees); WTI Crude Oil (16 trades, 0 USD realized, 27.89 USD fees); Copper (9 trades, 0 USD realized, 6.06 USD fees); Silver (17 trades, 0 USD realized, 22.25 USD fees); Natural Gas (1 trades, 0 USD realized, 0.02 USD fees); Brent Crude Oil (6 trades, 0 USD realized, 15.79 USD fees)

### @spread-hunter - Spread Capture

- **Market type:** Kalshi event contract
- **Thesis:** Rest passive bids one cent inside the spread on the most liquid commodity contracts and rely on the exchange order flow to cross them. The maker fee multiplier is zero for standard series per the official fee schedule, so a fill at the resting price is pure spread capture.
- **Rules:** entry - Spread >= 3 cents, resting bid at best bid + 1 cent, never crossing the offer.; exit - Working orders expire after the configured TTL; positions are marked to the opposite side of the book.
- **Result:** -0.01% (equity 99994.40 USD), 2 entries, 0 exits, 458 blocked order attempts.
- 2 ledger records so far: 1 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 0.00 USD of fees and 0.00 USD of measured slippage against the mid.
- Blocked order attempts and their recorded reasons: resting_order_registered (458).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (2 trades, 0 USD realized, 0 USD fees)

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
- **Result:** -0.01% (equity 99993.07 USD), 12 entries, 0 exits, 14 blocked order attempts.
- 12 ledger records so far: 3 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 5.59 USD of fees and 22.30 USD of measured slippage against the mid.
- Blocked order attempts and their recorded reasons: settlement_result_not_published (4), already_holding (10).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Copper (5 trades, 0 USD realized, 2.91 USD fees); Gasoline (US retail average) (5 trades, 0 USD realized, 2.32 USD fees); Gold (2 trades, 0 USD realized, 0.36 USD fees)

### @ladder-arb - Ladder Arbitrage

- **Market type:** Kalshi event contract
- **Thesis:** Within one series and one expiry, the YES price must fall as the strike rises (for greater-than markets). When the published book violates that ordering by more than the configured tolerance, buy the underpriced YES leg and the NO of the overpriced leg.
- **Rules:** entry - Monotonicity violation of at least 2 cents between two strikes of the same series and expiry.; exit - Held to settlement (the two legs converge by construction).
- **Result:** -0.03% (equity 99968.85 USD), 213 entries, 0 exits, 268 blocked order attempts.
- 213 ledger records so far: 9 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 660.97 USD of fees and 23705.89 USD of measured slippage against the mid.
- 4 open positions carry verified marks totalling -10.18 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Blocked order attempts and their recorded reasons: already_holding (11), settlement_result_not_published (227), insufficient_depth_within_price_tolerance (30).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Brent Crude Oil (6 trades, 0 USD realized, 1.61 USD fees); Gasoline (US retail average) (144 trades, 0 USD realized, 643.26 USD fees); Natural Gas (13 trades, 0 USD realized, 6.35 USD fees); WTI Crude Oil (9 trades, 0 USD realized, 1.11 USD fees); Palladium (9 trades, 0 USD realized, 0.23 USD fees); Copper (12 trades, 0 USD realized, 3.59 USD fees); Gold (9 trades, 0 USD realized, 2.88 USD fees); Silver (7 trades, 0 USD realized, 0.44 USD fees); Platinum (4 trades, 0 USD realized, 1.5 USD fees)

### @barrel-rider - Oil Trend Rider

- **Market type:** Kalshi event contract
- **Thesis:** Trade the Kalshi WTI/Brent ladders in the direction of the verified trend in the same series own official candle history, taking the side whose price is closest to a coin flip so that a correct directional call pays multiples.
- **Rules:** entry - |5-day candle momentum| >= 2%, enter in the direction of the trend, YES mid between 0.2 and 0.6.; exit - Exit when momentum flips sign or the market closes.
- **Result:** -0.00% (equity 99996.89 USD), 27 entries, 0 exits, 48 blocked order attempts.
- 27 ledger records so far: 4 distinct commodity exposures across kalshi.
- Closed-trade P&L is 0.00 USD against 30.03 USD of fees and 63.19 USD of measured slippage against the mid.
- Blocked order attempts and their recorded reasons: settlement_result_not_published (41), already_holding (5), insufficient_depth_within_price_tolerance (2).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gasoline (US retail average) (10 trades, 0 USD realized, 5.48 USD fees); WTI Crude Oil (10 trades, 0 USD realized, 17.05 USD fees); Natural Gas (2 trades, 0 USD realized, 0.05 USD fees); Brent Crude Oil (5 trades, 0 USD realized, 7.45 USD fees)

### @perp-surfer - Perp Surfer

- **Market type:** Kalshi perpetual future
- **Thesis:** Take the direction of the last verified move in each Kalshi metal perpetual and hold it, re-evaluating on every snapshot. The perpetual is the only instrument in this project that trades continuously, so it is where an overnight trend can actually be captured.
- **Rules:** entry - Price changed since the previous committed snapshot, with a live two-sided quote.; exit - Exit when the direction of the last change flips.
- **Result:** -0.00% (equity 99998.92 USD), 278 entries, 365 exits, 569 blocked order attempts.
- 643 ledger records so far: 14 distinct commodity exposures across kalshi_margin.
- Closed-trade P&L is -923444008334711.38 USD against 1106804646461.90 USD of fees and 461168601843139.13 USD of measured slippage against the mid.
- Best closed trade: KXADAPERP at 242.956744 USD (perp_momentum_flip).
- Worst closed trade: KXALUMINUMPERP at -923444008329897.2 USD (perp_momentum_flip).
- 11 open positions carry verified marks totalling 848550227390857.75 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Blocked order attempts and their recorded reasons: insufficient_margin (569).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (73 trades, -436.723058 USD realized, 393.158009 USD fees); Silver (1 trades, 0 USD realized, 0 USD fees); 0.01 AAVE (12 trades, -77.138233 USD realized, 16.967929 USD fees); 1 ADA (76 trades, -550.486718 USD realized, 131.192475 USD fees); 0.01 BCH (69 trades, -1076.613763 USD realized, 183.343218 USD fees); 0.001 BNB (71 trades, -103.190701 USD realized, 45.485568 USD fees); 0.0001 BTC (85 trades, -463.549117 USD realized, 509.328974 USD fees); 100 DOGE (73 trades, -439.38668 USD realized, 109.885358 USD fees); 0.001 ETH (81 trades, -874.058357 USD realized, 485.3478 USD fees); 0.1 HYPE (45 trades, -548.420818 USD realized, 132.194727 USD fees); 1K kSHIB (29 trades, -180.92137 USD realized, 19.359856 USD fees); 1 LINK (2 trades, -3.916405 USD realized, 1.474005 USD fees); Aluminum (13 trades, -923444008329924.4 USD realized, 1106804644423.277 USD fees); Copper (13 trades, -32.674884 USD realized, 10.880652 USD fees)

### @metal-trend - Metals Trend

- **Market type:** Exchange-listed commodity future
- **Thesis:** Rank the MOEX metal futures by their official settlement momentum over the cached history window and take the extremes, long the strongest and short the weakest. Trades only when the exchange publishes both a live quote and USD valuation inputs.
- **Rules:** entry - 20-observation settlement momentum, long the top mover and short the bottom mover on each side when |momentum| >= 1%.; exit - Exit when the momentum flips sign.
- **Result:** 5.81% (equity 105814.52 USD), 12 entries, 0 exits, 0 blocked order attempts.
- 12 ledger records so far: 8 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 6.57 USD of fees and 676.33 USD of measured slippage against the mid.
- 12 open positions carry verified marks totalling 5821.09 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Copper (1 trades, 0 USD realized, 0.7696 USD fees); Zinc (1 trades, 0 USD realized, 0.5687 USD fees); Gold (2 trades, 0 USD realized, 1.166194 USD fees); Nickel (1 trades, 0 USD realized, 0.10682 USD fees); Platinum (mini) (2 trades, 0 USD realized, 0.791185 USD fees); Platinum (2 trades, 0 USD realized, 0.960459 USD fees); Aluminium (1 trades, 0 USD realized, 0.779742 USD fees); Silver (2 trades, 0 USD realized, 1.426816 USD fees)

### @calendar-carry - Calendar Carry

- **Market type:** Exchange-listed commodity future
- **Thesis:** Buy the near expiry and sell the far expiry (or the reverse) whenever the annualised spread between the official mid prices exceeds the exchange published round-trip fee converted at the official USD/RUB rate. Both legs are real orders with real fees.
- **Rules:** entry - Annualised calendar spread >= 12% after measured round-trip fees.; exit - Exit when the annualised spread compresses below 4%, or when either contract is within 5 days of expiry.
- **Result:** -4.44% (equity 95564.00 USD), 165 entries, 187 exits, 1458 blocked order attempts.
- 352 ledger records so far: 7 distinct commodity exposures across moex_forts.
- Closed-trade P&L is -672.79 USD against 128.28 USD of fees and 50917.50 USD of measured slippage against the mid.
- Best closed trade: SAH7 at 281.147303 USD (calendar_carry_review).
- Worst closed trade: CCG7 at -245.827404 USD (calendar_carry_review).
- 5 open positions carry verified marks totalling 56.82 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Blocked order attempts and their recorded reasons: no_verified_quote (465), insufficient_margin (993).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Cocoa (84 trades, -81.557744 USD realized, 48.203435 USD fees); Sugar (31 trades, -48.422425 USD realized, 1.834165 USD fees); Orange Juice (ORANGE) (69 trades, -193.487809 USD realized, 18.348968 USD fees); Raw Sugar (SUGR) (77 trades, -208.005612 USD realized, 27.818387 USD fees); Wheat (87 trades, -137.108763 USD realized, 31.970014 USD fees); Coffee (2 trades, -4.208425 USD realized, 0.061392 USD fees); Nickel (2 trades, 0 USD realized, 0.041297 USD fees)

### @agri-trend - Agri Trend

- **Market type:** Exchange-listed commodity future
- **Thesis:** Follow the official settlement trend in MOEX soft commodities and grains, taking the strongest movers on each side and holding while the trend persists.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 1.5%.; exit - Exit when the momentum flips sign.
- **Result:** 4.90% (equity 104897.60 USD), 12 entries, 0 exits, 0 blocked order attempts.
- 12 ledger records so far: 6 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 5.76 USD of fees and 3041.40 USD of measured slippage against the mid.
- 9 open positions carry verified marks totalling 1856.53 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Cocoa (2 trades, 0 USD realized, 1.287496 USD fees); Coffee (2 trades, 0 USD realized, 1.255037 USD fees); Sugar (1 trades, 0 USD realized, 0.030216 USD fees); Wheat (3 trades, 0 USD realized, 1.334012 USD fees); Orange Juice (ORANGE) (2 trades, 0 USD realized, 0.680356 USD fees); Raw Sugar (SUGR) (2 trades, 0 USD realized, 1.175643 USD fees)

### @basis-hunter - Cross-Venue Basis

- **Market type:** Cross-venue: Kalshi perpetual future vs exchange-listed future
- **Thesis:** Compare the Kalshi metal perpetual (price / contract_size = USD per ounce) with the front MOEX future on the same metal (mid = USD per ounce when UNIT=USD). When the normalised basis is large enough to cover both venues fees, buy the cheaper venue and sell the more expensive one. Both legs are simulated with their own venue fill model.
- **Rules:** entry - Normalised basis >= 0.5% between the perpetual (USD/oz via contract_size) and the MOEX front future (USD/oz via official UNIT/LOT SIZE).; exit - Exit when the basis compresses below 0.1%, or when either leg loses its verified quote or normalisation inputs.
- **Result:** 3.15% (equity 103151.16 USD), 14 entries, 11 exits, 7 blocked order attempts.
- 25 ledger records so far: 5 distinct commodity exposures across kalshi_margin, moex_forts.
- Closed-trade P&L is 1376.20 USD against 112.48 USD of fees and 106678.25 USD of measured slippage against the mid.
- Best closed trade: BTV6 at 814.981621 USD (basis_convergence).
- Worst closed trade: BTV6 at -207.089652 USD (basis_convergence).
- 3 open positions carry verified marks totalling 1895.67 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Blocked order attempts and their recorded reasons: no_verified_quote (7).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (3 trades, -0.424616 USD realized, 2.358696 USD fees); 0.001 ETH (2 trades, -6.559641 USD realized, 6.275541 USD fees); Ether (ETHA Trust ETF) (2 trades, -101.103614 USD realized, 15.873614 USD fees); 0.0001 BTC (9 trades, -162.444776 USD realized, 21.252102 USD fees); Bitcoin (9 trades, 1646.728793 USD realized, 66.724112 USD fees)

### @book-watcher - Order-Book Imbalance

- **Market type:** Kalshi event contract
- **Thesis:** Trade in the direction of the heavily unbalanced resting book: when the official order book shows at least 70% of visible depth on one side and the spread is tight, buy that side, betting that the resting liquidity reflects informed order flow.
- **Rules:** entry - Depth ratio >= 70% or <= 30% on visible book depth, spread <= 3 cents, YES mid between 0.15 and 0.85, at least 2 hours to close.; exit - Exit when the depth ratio crosses back through 50% or the market closes.
- **Result:** -0.02% (equity 99980.31 USD), 104 entries, 16 exits, 38 blocked order attempts.
- 120 ledger records so far: 7 distinct commodity exposures across kalshi.
- Closed-trade P&L is -289.99 USD against 183.56 USD of fees and 167.53 USD of measured slippage against the mid.
- Best closed trade: KXAAAGASW-26OCT05-4.3800 at 2.45 USD (book_imbalance_flip).
- Worst closed trade: KXCOPPERMON-26OCT3017-T6.63 at -88.578475 USD (book_imbalance_flip).
- Blocked order attempts and their recorded reasons: settlement_result_not_published (27), insufficient_depth_within_price_tolerance (11).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (29 trades, -96.852662 USD realized, 53.28 USD fees); Brent Crude Oil (22 trades, -5.95 USD realized, 27.65 USD fees); Gasoline (US retail average) (16 trades, -14.57 USD realized, 13.57 USD fees); Copper (20 trades, -132.398475 USD realized, 28.25 USD fees); Silver (15 trades, -2.649968 USD realized, 31.2 USD fees); WTI Crude Oil (12 trades, -37.56808 USD realized, 21.89 USD fees); Natural Gas (6 trades, 0 USD realized, 7.72 USD fees)

### @mark-fade - Perp Mark Fade

- **Market type:** Kalshi perpetual future
- **Thesis:** When the Kalshi perpetual mid deviates from the exchange-published mark price by 0.3% or more, trade back toward the mark; exit when the deviation decays below 0.08%. Both the deviation and its anchor come from the exchange payload in the same snapshot.
- **Rules:** entry - |perp mid / exchange mark - 1| >= 0.30%, with a live two-sided book; trade toward the mark.; exit - Exit when the deviation decays below 0.08% or the two-sided quote disappears.
- **Result:** -0.08% (equity 99921.26 USD), 13 entries, 29 exits, 0 blocked order attempts.
- 42 ledger records so far: 6 distinct commodity exposures across kalshi_margin.
- Closed-trade P&L is -209.85 USD against 21.89 USD of fees and 3041406929152860672.00 USD of measured slippage against the mid.
- Best closed trade: KXADAPERP at 10.282415 USD (perp_mark_reached).
- Worst closed trade: KXBCHPERP at -92.989987 USD (perp_mark_reached).
- 1 open positions carry verified marks totalling -4.49 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** 1 ADA (8 trades, -51.683387 USD realized, 5.530694 USD fees); Aluminum (16 trades, -5.72371 USD realized, 1.146892 USD fees); 0.01 BCH (5 trades, -122.183782 USD realized, 6.31715 USD fees); Copper (10 trades, -17.943498 USD realized, 2.778471 USD fees); 100 DOGE (2 trades, -12.314952 USD realized, 1.317952 USD fees); 0.1 HYPE (1 trades, 0 USD realized, 4.798873 USD fees)

### @rig-count - Energy Trend

- **Market type:** Exchange-listed commodity future
- **Thesis:** Follow the official settlement trend in MOEX energy futures - crude (WTI, Brent), products (diesel, AI-92/95 gasoline) and gas (NG, NGM, TTF) - taking the strongest movers on each side and holding while the trend persists.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 1.5%.; exit - Exit when the momentum flips sign.
- **Result:** -0.07% (equity 99928.58 USD), 26 entries, 0 exits, 0 blocked order attempts.
- 26 ledger records so far: 8 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 8.10 USD of fees and 1131.35 USD of measured slippage against the mid.
- 15 open positions carry verified marks totalling 6468.74 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gasoline AI-92 (3 trades, 0 USD realized, 0.324194 USD fees); Gasoline AI-95 (3 trades, 0 USD realized, 0.329136 USD fees); Brent Crude Oil (3 trades, 0 USD realized, 1.932535 USD fees); Diesel (DTL) (3 trades, 0 USD realized, 0.306386 USD fees); Natural Gas (TTF) (3 trades, 0 USD realized, 1.378729 USD fees); Natural Gas (NG) (4 trades, 0 USD realized, 1.966016 USD fees); Natural Gas (NGM) (4 trades, 0 USD realized, 1.501494 USD fees); WTI Crude Oil (3 trades, 0 USD realized, 0.363779 USD fees)

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
- **Result:** -0.28% (equity 99718.47 USD), 7 entries, 1 exits, 12 blocked order attempts.
- 8 ledger records so far: 2 distinct commodity exposures across kalshi.
- Closed-trade P&L is 35.10 USD against 18.94 USD of fees and 17.68 USD of measured slippage against the mid.
- Best closed trade: KXCOPPERMON-26OCT3017-T6.69 at 35.1 USD (jump_retrace_target).
- Worst closed trade: KXCOPPERMON-26OCT3017-T6.69 at 35.1 USD (jump_retrace_target).
- Blocked order attempts and their recorded reasons: settlement_result_not_published (12).
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** Gold (6 trades, 0 USD realized, 14.98 USD fees); Copper (2 trades, 35.1 USD realized, 3.96 USD fees)

### @usd-rub-desk - FX Trend

- **Market type:** Exchange-listed FX future
- **Thesis:** Follow the official settlement trend in MOEX FX futures - the USD/RUB and CNY/RUB contracts - taking the strongest movers and holding while the trend persists. Same measured-momentum rule as the energy desk, applied to the FX sector the brief requires the universe to cover.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 1.5%.; exit - Exit when the momentum flips sign.
- **Result:** -0.38% (equity 99618.44 USD), 2 entries, 0 exits, 0 blocked order attempts.
- 2 ledger records so far: 1 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 0.45 USD of fees and 0.21 USD of measured slippage against the mid.
- 2 open positions carry verified marks totalling -381.11 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
- Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.
- **Attribution by commodity:** CNY/RUB (2 trades, 0 USD realized, 0.445696 USD fees)

### @index-mover - Index Trend

- **Market type:** Exchange-listed equity index future
- **Thesis:** Trade the official settlement momentum in MOEX equity-index futures - IMOEX (MIX), RTS, Nasdaq-100 (NASD) and S&P 500 (SPYF) - long the 15-observation winners, short the losers, and exit when the momentum flips. The index sector is one of the market types the brief requires the universe to cover.
- **Rules:** entry - 15-observation settlement momentum, |momentum| >= 2.0%.; exit - Exit when the momentum flips sign.
- **Result:** -1.33% (equity 98673.38 USD), 5 entries, 0 exits, 0 blocked order attempts.
- 5 ledger records so far: 3 distinct commodity exposures across moex_forts.
- Closed-trade P&L is 0.00 USD against 2.49 USD of fees and 218.50 USD of measured slippage against the mid.
- 5 open positions carry verified marks totalling -1324.13 USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.
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

- Taker fills that walked the official ladder: 939
- Quote-based fills at the official bid/offer: 1121
- Modelled resting maker fills: 2
- Orders that could not be executed, with the recorded reason: 3587
  - insufficient_margin: 1562
  - settlement_result_not_published: 1013
  - no_verified_quote: 472
  - resting_order_registered: 458
  - insufficient_depth_within_price_tolerance: 56
  - already_holding: 26

## How to read this

These are simulated fills on real, verified market data. They are not exchange executions and they are not a track record. The point of the competition is to measure, over a full year, which of the twelve documented ideas survives contact with real liquidity, real spreads and real fees.
