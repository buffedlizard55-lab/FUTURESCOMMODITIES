# Strategies

Twenty strategies compete, one per username. Each one states which market type it trades, the claim it
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
| `@rig-count` | `moex-energy-trend` | Energy futures trend on supply shocks; the strategy trades the WTI, Brent, natural gas (NG/NGM/TTF), diesel and AI-92/95 gasoline contracts the exchange itself lists | 15-observation settlement momentum, \|momentum\| ≥ 1.5% | Momentum flips sign |
| `@donchian-desk` | `moex-metal-breakout` | The public-domain Turtle channel-breakout rule ([original Turtle rules](https://www.turtletrader.com/turtle/)): buy a 20-period high, sell a 20-period low | Daily settlement CLOSE crosses the prior 20-observation high/low | Close crosses the opposite 10-observation extreme |

## Exchange-listed non-commodity futures (MOEX FORTS)

Added 2026-09-22 (roadmap item 3): the project brief requires the universe to cover equity-index,
interest-rate, FX and crypto futures, and the same keyless MOEX ISS API verifies all four sectors.
The asset codes were verified in the official FORTS listing on 2026-09-22 (`engine/universe/futures-registry.json`),
and the live classifier re-verifies them against the exchange listing on every tick.

| Username | Strategy id | Idea | Entry | Exit |
| --- | --- | --- | --- | --- |
| `@usd-rub-desk` | `moex-fx-trend` | FX futures trend over multi-week policy/flow stretches | 15-observation settlement momentum, \|momentum\| ≥ 1.5% | Momentum flips sign |
| `@index-mover` | `moex-index-trend` | Equity-index futures are the canonical momentum market (IMOEX, RTS, Nasdaq-100, S&P 500) | 15-observation settlement momentum, \|momentum\| ≥ 2.0% | Momentum flips sign |
| `@ruonia-curve` | `moex-rate-curve` | The near/far rate spread is the market's own estimate of the future short rate; capture the carry when it exceeds round-trip cost | Annualised curve spread ≥ 8% after measured fees, both legs quoted | Spread compresses below 3%, or a leg is within 5 days of expiry |

Crypto futures are covered by the cross-venue strategy below (BTC and ETH pairs), which is the
sector's most distinctive edge: the same asset is simultaneously traded on Kalshi (24/7 perp) and
MOEX (session future).

## Cross-venue

| Username | Strategy id | Idea | Entry | Exit |
| --- | --- | --- | --- | --- |
| `@basis-hunter` | `cross-venue-basis` | A 24/7 perpetual and a session-based future on the same metal cannot diverge indefinitely; MOEX's persistent premium/discount to the world metal price is a documented phenomenon | Normalised basis ≥ 0.5%: Kalshi perp (`price ÷ contract_size` = USD/oz) vs MOEX front future (mid = USD/oz when the official description states quotation UNIT=USD) | Basis compresses below 0.1%, or either leg loses its verified quote or normalisation inputs |

The cross-venue strategy was **disabled on 2026-09-22** (first iteration compared prices in different units)
and was **re-enabled the same day** after the missing normalisation was verified from official sources:

* **Kalshi leg** — the Perps API payload publishes `contract_size` per traded unit (gold 0.001, silver 0.1,
  platinum 0.001), and the official help-centre contract specification states contract sizes in units of the
  underlying ([help.kalshi.com perp specification](https://help.kalshi.com/en/articles/15357587-btc-perpetual-futures-contract-specifications)).
  USD per ounce = price ÷ contract_size.
* **MOEX leg** — the ISS description table publishes `LOT SIZE`, quotation `UNIT` and settlement `FACEUNIT`
  per contract ([GDZ6 description](https://iss.moex.com/iss/securities/GDZ6.json?iss.meta=off&iss.only=description)).
  Verified 2026-09-22: GDZ6 LOT SIZE=1 / UNIT=USD / FACEUNIT=USD; SVZ6 LOT SIZE=10 / UNIT=USD / FACEUNIT=USD;
  PTZ6 LOT SIZE=1 / UNIT=USD / FACEUNIT=USD. The MOEX quote is therefore already USD per ounce.
* **Cross-check** — on 2026-09-22 22:23Z, Kalshi gold 4,363.25 USD/oz vs MOEX GDZ6 4,433.25 (+1.6%); silver
  67.23 vs 68.36 (+1.7%). Two independent regulated venues within ~2% corroborates the unit chain; a
  lot-vs-unit or gram-vs-ounce error would show a 10× or ~32× gap instead. Raw evidence:
  `data/raw-evidence/cross-venue-basis-normalisation-2026-09-22.json`.
* **Guardrails** — the strategy refuses to trade any pair whose normalisation inputs are missing in the run,
  and the verifier re-checks every basis trade for the recorded normalisation (`cross_venue_basis_normalisation_recorded`).
* Palladium has **no MOEX listing** (verified in the FORTS listing on 2026-09-22), so no palladium pair exists.
* **Crypto pairs (added 2026-09-22, roadmap "cross-venue basis expansion")** — BTC and ETH join the
  pairs list. The Kalshi perp leg is identified by exchange-published fields (`asset_class === 'Crypto'`
  plus the asset name in the official title) rather than a hard-coded ticker, and the MOEX leg only
  trades when its official description states quotation UNIT=USD. If either venue removes or relists
  the contract, the pair finds nothing and trades nothing.
* **Crypto contract units (verified 2026-09-22 from official sources)** — the MOEX BTC leg is the
  Bitcoin **Index** future: the official specification (Appendix 1, order MB-P-2026-1883, in force
  14.05.2026) fixes the value of the 1 USD price step at **0.001 USD per contract** (lot = 0.001 BTC),
  cross-checked against the exchange's own volume statistics (1,501,894,597.1 RUB / 207,750 contracts
  = 7,229 RUB/contract). The MOEX ETH leg points at the **ETHA Trust ETF** future (ASSETCODE `ETHA`;
  the MOEX-Ether-Index futures were not found in the listing): one contract = one ETHA share.
* **Unit-reconciliation gate (added 2026-09-23 after a live defect)** — a cross-venue "basis" is
  only defined when both legs quote the **same asset unit**. The first live tick (2026-09-23 00:32Z)
  opened the ETH pair comparing the Kalshi ETH perp (2,761 USD/ETH) with the ETHA ETF share
  (21.05 USD/share — a share holds ~0.76% of an ETH, not one): the computed "basis" was a 13,000%
  unit artefact. The position was unwound on the next tick and the strategy now refuses any pair
  whose normalised leg prices differ by more than 10x, records the refusal, and unwinds any
  position opened before the premise failed. The BTC pair passes the gate (both legs quote USD/BTC);
  the ETH pair will trade automatically if MOEX ever lists a genuine Ether index future quoted in
  USD/ETH.

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
