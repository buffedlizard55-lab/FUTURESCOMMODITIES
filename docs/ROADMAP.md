# Recommended next work

Everything below is ordered by leverage. The rule that produced this project — verify a market and a number
from an official source before it enters the database — applies to all of it.

## Completed 2026-09-22 (this session)

1. **Kalshi candle universe re-priced** — the candle parser fix from the previous session is in place;
   the tick now re-fetches any cache that does not contain prices, so the next live tick re-prices every
   committed candle cache. **Verification step (still to confirm from the live run):** after a live tick,
   `data/history/kalshi/*.json` should contain non-null `close`/`yes_bid_close`/`yes_ask_close` values,
   and `node engine/backtest.mjs` should produce Kalshi rows.
2. **Candle coverage widened with the official batch endpoint** — `GET /markets/candlesticks`
   (docs.kalshi.com "Batch Get Market Candlesticks": up to 100 tickers per request, up to 10,000 candles
   per response, no authentication) is implemented in `engine/lib/venues/kalshi.mjs` (`candlesticksBatch`)
   and used by the tick: `max_candle_series` is 100 (was 30), so the whole matched commodity universe is
   covered in one or two calls, with a per-market fallback to the single-market endpoint when a market is
   absent from a batch response.
3. **MOEX non-commodity sectors are traded** — equity index (MIX, RTS, NASD, SPYF), interest rate (RUONIA,
   1MFR), FX (Si USD/RUB, CNY) and crypto (BTC, ETH) futures now enter the universe with the same
   asset-code + name gate as commodities, a dedicated 12-contract slot of the quote budget, sector-aware
   market-type labels, and one strategy per sector (`@index-mover`, `@ruonia-curve`, `@usd-rub-desk`);
   crypto is covered by the cross-venue strategy.
4. **Kalshi perpetual fee schedule and funding** — the official fee schedule
   (kalshi.com/docs/kalshi-fee-schedule.pdf, effective 2026-07-07: tier-0 taker 12.0 bps of notional) is
   applied to every perp fill; funding is settled from the keyless official endpoint
   `GET /margin/funding_rates/historical` (finalised 8-hourly events with exchange mark price and rate;
   |rate| < 0.01% treated as zero per the official rules), and every payment is a provenance-stamped entry
   in `data/ledger/funding.jsonl` audited by `engine/verify.mjs`. The in-progress estimate
   (`GET /margin/funding_rates/estimate`) is published on each perp quote for the live desk.
5. **Cross-venue basis expanded to crypto** — BTC and ETH pairs (Kalshi crypto perp vs MOEX crypto
   future) were added to `@basis-hunter`. The perp leg is matched by exchange-published fields
   (`asset_class` + title), never a hard-coded ticker; the MOEX leg only trades when its official
   description states quotation UNIT=USD.
6. **Tick robustness** — the order-execution paths (exits, entries, marking, settlements) can no longer
   take down the whole run, and a Kalshi request-budget overrun degrades the venue instead of throwing
   (the 23:05Z tick failure of 2026-09-22 is recorded in `docs/LIMITATIONS.md` §7).
7. **Offline replay harness** — `test/live-pipeline.mjs` replays the exact live strategy + execution path
   against the last committed snapshot (working orders, exits, entries, fills, marks, independent equity
   recomputation) with no network. It is how a failed remote tick can be investigated without egress.

## Next

1. **Confirm the candle re-price from the live run** (item 1's verification step) and read the first
   non-null Kalshi backtest rows against the exchange's own candle endpoint.
2. **Settlement testing at scale** — the season is young. When the front event contracts settle, verify
   that `settlePosition` results reproduce the exchange's published `market.result`, and that
   @fade-the-crowd vs @carry-collector start to accumulate the settlement distribution their theses
   predict. The verification report already covers this; the review task is to read those two
   strategies' settlement ledger monthly.
3. **A second exchange would materially de-risk the venue concentration** — today the futures leg depends
   on MOEX. Candidate free official sources worth a dedicated probe session (from a host with egress; the
   current sandbox cannot reach the exchanges directly): HKEX (free daily derivatives reports), DME
   (settlement pages), JPX/TOCOM (daily report CSVs), Euronext commodity settle prices, NZX dairy (GDT
   auction data), and the CFTC COT public API as an official positioning *overlay*. Each probe must
   record the same evidence style as the existing access matrix (endpoint, status, terms), or the venue
   is marked blocked like CME/ICE/LME.
4. **Energy cross-venue basis** — MOEX WTI/Brent vs a second venue stays blocked until a second verified
   energy feed exists (CME/ICE block automated access).
5. **Lot-size-aware sizing** — `sizeContracts` sizes by `price × usd_per_price_unit`, i.e. one contract =
   one unit of the underlying. For lots with LOT SIZE > 1 (e.g. SVZ6 LOT SIZE=10) this overestimates the
   contract count, which the published-liquidity caps then trim; the result is conservative but suboptimal.
   Use the exchange-published LOT SIZE in the sizing formula.
6. **Ops** — keep an eye on the request budget as the MOEX universe grew to ~56 tracked contracts
   (quotes per tick; descriptions and histories are cached 12h). The GitHub Pages URL, the tick schedule
   (every 30 min) and the ledger are the competition's source of truth; the ledger is append-only and must
   never be rewritten (archives under `data/ledger/archive/` are the only sanctioned exclusions). If
   Kalshi adds perp asset classes beyond Metals/Crypto (`perp_asset_classes` in `config/watchlist.json`),
   extend the allowlist deliberately, not silently.
