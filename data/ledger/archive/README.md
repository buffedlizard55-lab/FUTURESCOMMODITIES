# Pilot ledger (archived)

These files are ledgers from the **development iterations** of the engine, kept for transparency. They were
written before the published schema was frozen (before per-trade payload hashes and the margin-aware
portfolio model existed), so the current verifier cannot validate them.

| Files | Engine generation | Why they are excluded |
| --- | --- | --- |
| `pilot-trades.jsonl`, `pilot-intents.jsonl` | first iteration: single-venue Kalshi prototype | pre-dates instrument ids, provenance hashes and the official fee formula |
| `pilot2-trades.jsonl`, `pilot2-intents.jsonl` | second iteration: universe + multi-venue prototype | pre-dates margin-aware accounting and per-series coverage; would misstate equity |
| `pilot3-trades.jsonl`, `pilot3-intents.jsonl` | first full multi-venue season start (29 trades, 29/29 verified) | includes `cross-venue-basis`, whose two legs were compared in different units; the strategy is disabled and the season was restarted so no scored trade rests on an unverifiable comparison |

They are **not part of the competition season**. The season that counts starts on 2026-09-22 from the
append-only `data/ledger/trades.jsonl`, which the tick writes and `engine/verify.mjs` audits.
