# Strategies

Twelve strategies compete, one per username. Each one states which market type it trades, the claim it
came from, the rules it follows, and — once it has traded — what its own results actually show.
The live version of this page, with each strategy's current return, attribution and blocked orders, is on
the [competition site](https://buffedlizard55-lab.github.io/FUTURESCOMMODITIES/#strategies).

Two rules apply to all of them:

* **Returns only.** Risk management is deliberately out of scope; these are return-maximising simulations.
* **Verified inputs only.** A strategy can only trade an instrument for which the current run holds a
  live two-sided quote from the exchange's own API, and it can only size against liquidity the exchange
  published. Where an input is missing (a USD valuation, a margin figure, a settlement result), the order
  is refused and recorded as an intent with the reason instead of being given an invented value.

## Kalshi event contracts

| Username | Strategy id | Idea | Entry | Exit |
| --- | --- | --- | --- | --- |
| `@fade-the-crowd` | `kalshi-longshot-fade` | Longshot bias: binary markets overprice very unlikely outcomes | YES mid ≤ 0.10, spread ≤ 3c, ≥ 2h to close, top-3 liquidity strikes | None — held to settlement (the thesis is about the settlement distribution) |
| `@carry-collector` | `kalshi-favourite-carry` | The mirror image: near-certain outcomes are underpriced | YES mid ≥ 0.90, spread ≤ 3c, closes within 48h | Held to settlement |
| `@spread-hunter` | `kalshi-spread-capture` | Standard Kalshi series charge no maker fee, so resting inside a wide spread is spread capture at zero commission | Spread ≥ 3c; resting bid at best bid + 1c, never crossing | Working order expires after the configured TTL |
| `@vol-crusher` | `kalshi-extreme-reversion` | Single-day gaps in thin ladders are order-flow, not information, and partly retrace | Last completed daily candle change ≥ 4σ of the series history | Mid returns to within half the gap, or the market closes |
| `@tail-rider` | `kalshi-cheap-momentum` | The explicit counter-hypothesis to the longshot fade: cheap contracts that are trending keep trending | YES mid ≤ 0.10, 5-day candle momentum > 0, spread ≤ 3c | 5-day momentum turns negative, or the market closes |
| `@ladder-arb` | `kalshi-ladder-arbitrage` | Two strikes of the same series cannot price in an order that contradicts the strike order | Monotonicity violation ≥ 2c between two strikes of one series and expiry | Held to settlement — the legs converge by construction |
| `@barrel-rider` | `kalshi-oil-trend` | Energy event contracts follow the crude complex with a lag, visible in the exchange's own candles | \|5-day momentum\| ≥ 2%, enter with the trend, YES mid between 0.20 and 0.60 | Momentum flips, or the market closes |

## Kalshi perpetual futures

| Username | Strategy id | Idea | Entry | Exit |
| --- | --- | --- | --- | --- |
| `@perp-surfer` | `kalshi-perp-trend` | A listed metal perpetual must carry the move that happened while the underlying session was closed | Price changed since the previous committed snapshot, with a live two-sided quote | Direction of the last change flips |

## Exchange-listed commodity futures (MOEX FORTS)

| Username | Strategy id | Idea | Entry | Exit |
| --- | --- | --- | --- | --- |
| `@metal-trend` | `moex-metals-trend` | Cross-sectional momentum in metals futures | 20-observation settlement momentum, \|momentum\| ≥ 1%, long the strongest and short the weakest | Momentum flips sign |
| `@calendar-carry` | `moex-calendar-carry` | The spread between two expiries is financing/storage carry; capture it when it exceeds the exchange-published round-trip cost | Annualised calendar spread ≥ 12% after measured fees, both legs quoted | Spread compresses below 4%, or a leg is within 5 days of expiry |
| `@agri-trend` | `moex-agri-trend` | Soft commodities trade in supply-driven trends visible in official settlement history | 15-observation settlement momentum, \|momentum\| ≥ 1.5% | Momentum flips sign |

## Cross-venue

| Username | Strategy id | Idea | Entry | Exit |
| --- | --- | --- | --- | --- |
| `@basis-hunter` | `cross-venue-basis` | A 24/7 perpetual and a session-based future on the same metal cannot diverge indefinitely | **Not trading.** Comparing the two legs requires the underlying quantity per contract on both venues: Kalshi publishes `contract_size` in its payload, MOEX does not publish it in its machine-readable payload. The strategy is disabled rather than comparing prices in different units. | — |

The cross-venue strategy is **disabled** and places no orders. Its first iteration compared the Kalshi
perpetual price directly with the MOEX future price, which are quoted in different units (Kalshi per
contract of a published size, MOEX in its own price units); the engine's own reporting surfaced the
inconsistency and the strategy was taken out of the competition. It stays published, with its reason, so the
correction is visible rather than hidden. Re-enabling it requires verifying the underlying quantity per
contract for each MOEX pair from an official MOEX source.

## Where the ideas came from

* **Documented anomalies** — the longshot/favourite pair is a deliberate head-to-head: both strategies
  trade the *same* mispricing claim from opposite ends, so the leaderboard decides which side of it is
  real in the current market.
* **Market structure** — the maker-fee structure, the published strike ladders, the perpetual-versus-future
  basis and the calendar spread are properties of the venues themselves, not forecasts.
* **Trend and mean-reversion hypotheses** — carried by the candle and settlement histories the exchanges
  publish. These are labelled *hypothesis under test*; the site reports what actually happened, including
  when the answer is "the strategy has not traded yet".

## Honesty rules for this page

* A strategy with no closed trades has **no** stated result analysis — the site says so rather than
  inventing a narrative.
* Attribution is computed from the ledger: realised PnL, fees and slippage per commodity, plus the mark and
  mark source of every open position.
* Orders that were refused are published with their reason (`insufficient_depth_within_price_tolerance`,
  `size_below_liquidity_cap`, `margin_inputs_missing`, `one_sided_book_no_exit_price`, and so on).
* Strategies that cannot be backtested from official historical data are forward-tested and marked
  accordingly — see [`LIMITATIONS.md`](LIMITATIONS.md).
