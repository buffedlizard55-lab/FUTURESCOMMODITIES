# Pilot ledger (archived)

These two files are the ledger produced by the **first iteration** of the engine, kept for
transparency. They were written before the current schema (no `instrument_id`, no payload hash
on each trade, and price feeds that were later replaced), so the current verifier cannot validate
them. They are **not** part of the competition season and are excluded from the leaderboard,
which is rebuilt from the append-only `data/ledger/trades.jsonl` written by the current engine.
