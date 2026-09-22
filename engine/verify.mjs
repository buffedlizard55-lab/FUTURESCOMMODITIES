#!/usr/bin/env node
/**
 * Independent verification pass over everything the competition has published.
 *
 * It re-reads the committed artifacts and checks, trade by trade:
 *   1. every mandatory field required by the project brief is present;
 *   2. the trade points at an official source URL and carries the hash of the exact payload;
 *   3. that payload hash appears in the provenance log of the run that wrote the trade, i.e. the
 *      price really came from a request made in that run;
 *   4. the stored per-level fill detail re-derives the stored VWAP and contract count;
 *   5. Kalshi fees equal the official formula (or are explicitly unknown, never silently zero);
 *   6. the instrument is still listed in the universe file with its own provenance.
 *
 * Anomalies are reported, never auto-corrected. Output: data/verification/report.json
 */

import { existsSync, readdirSync } from 'node:fs';
import { nowIso } from './lib/http.mjs';
import { kalshiTakerFee } from './lib/portfolio.mjs';
import { paths, readJson, readJsonl, writeJson } from './lib/store.mjs';

const REQUIRED_TRADE_FIELDS = [
  'id',
  'run_id',
  'strategy_id',
  'username',
  'market_type',
  'venue',
  'exchange',
  'official_source',
  'retrieved_at',
  'verification_timestamp',
  'ticker',
  'instrument_id',
  'contract_specification',
  'market_dates',
  'action',
  'contracts',
  'price',
  'fill',
  'market_at_decision',
  'liquidity_consumed',
  'slippage',
  'fees',
  'pnl',
];

function main() {
  const trades = readJsonl(`${paths.ledger}/trades.jsonl`);
  const intents = readJsonl(`${paths.ledger}/intents.jsonl`);
  const universe = readJson(`${paths.universe}/instruments.json`, { instruments: [] });
  const leaderboard = readJson(`${paths.state}/leaderboard.json`, { leaderboard: [] });
  const manifest = readJson('data/manifest/latest.json', null);
  const perRunProvenance = loadRunProvenance();

  const instrumentsById = Object.fromEntries((universe.instruments ?? []).map((i) => [i.instrument_id, i]));

  const results = [];
  const anomalies = [];

  for (const trade of trades) {
    const checks = [];
    const missing = REQUIRED_TRADE_FIELDS.filter((f) => trade[f] === undefined || trade[f] === null);
    checks.push({ check: 'mandatory_fields_present', ok: missing.length === 0, missing });

    const sourceUrl = trade.official_source ?? trade.provenance?.source_url ?? null;
    checks.push({ check: 'official_source_url_recorded', ok: typeof sourceUrl === 'string' && sourceUrl.startsWith('http'), source_url: sourceUrl });

    const hash = trade.official_source_sha256 ?? trade.provenance?.response_sha256 ?? null;
    checks.push({
      check: 'payload_hash_recorded',
      ok: !!hash,
      sha256: hash,
      note: 'Every trade stores the SHA-256 of the exact HTTP response its prices came from.',
    });

    const hashes = perRunProvenance[trade.run_id];
    const hashInRun = hashes ? hashes.has(hash) : false;
    checks.push({
      check: 'payload_hash_present_in_that_runs_provenance_log',
      ok: hashInRun,
      note: hashInRun
        ? 'The hash appears in the provenance log of the run that created the trade.'
        : hashes
          ? 'The hash was not found in that run provenance log; treat this trade as unverified.'
          : 'No provenance log was found for this run (older runs may predate the log).',
    });

    if (Array.isArray(trade.fill?.levels) && trade.fill.levels.length) {
      const levelContracts = trade.fill.levels.reduce((sum, l) => sum + (Number(l.contracts) || 0), 0);
      const levelNotional = trade.fill.levels.reduce((sum, l) => sum + (Number(l.contracts) || 0) * (Number(l.price) || 0), 0);
      const recomputedVwap = levelContracts ? levelNotional / levelContracts : null;
      checks.push({
        check: 'fill_levels_reproduce_contracts_and_vwap',
        ok: Math.abs(levelContracts - (Number(trade.contracts) || 0)) < 0.51 && recomputedVwap != null && Math.abs(recomputedVwap - trade.price) < 1e-6,
        level_contracts: levelContracts,
        recorded_contracts: trade.contracts,
        recomputed_vwap: recomputedVwap,
        recorded_vwap: trade.price,
      });
    }

    if (trade.venue_id === 'kalshi' && trade.fill?.order_type === 'taker' && trade.fees?.fee_usd != null) {
      const expected = kalshiTakerFee({
        contracts: trade.contracts,
        price: trade.price,
        multiplier: trade.contract_specification?.fee_multiplier ?? 1,
        precision: 2,
      });
      checks.push({
        check: 'kalshi_fee_matches_official_formula',
        ok: Math.abs((trade.fees.fee_usd ?? 0) - expected) < 0.011,
        recorded_fee_usd: trade.fees.fee_usd,
        recomputed_fee_usd: expected,
        formula: 'roundup(multiplier x 0.07 x contracts x price x (1 - price)) rounded up to $0.01',
      });
    }

    const instrument = instrumentsById[trade.instrument_id];
    checks.push({
      check: 'instrument_present_in_published_universe',
      ok: !!instrument,
      note: instrument
        ? 'Instrument is listed in data/universe/instruments.json with its own listing provenance.'
        : 'Instrument no longer appears in the universe file (it may have settled and dropped out of the open-market listing).',
    });

    const failed = checks.filter((c) => c.ok === false);
    results.push({ trade_id: trade.id, run_id: trade.run_id, strategy_id: trade.strategy_id, ticker: trade.ticker, checks, failed_checks: failed.map((f) => f.check) });
    for (const fail of failed) anomalies.push({ trade_id: trade.id, ticker: trade.ticker, check: fail.check, detail: fail });
  }

  const coverage = {
    trades: trades.length,
    intents: intents.length,
    trades_by_venue: groupCount(trades, (t) => t.venue_id),
    trades_by_strategy: groupCount(trades, (t) => t.strategy_id),
    instruments: (universe.instruments ?? []).length,
    instruments_by_venue: groupCount(universe.instruments ?? [], (i) => i.venue),
    unclassified_series: (universe.unclassified_series ?? []).length,
    strategies: (leaderboard.leaderboard ?? []).length,
    season: manifest?.competition ?? null,
    tiers: {
      taker_fills_from_published_ladders: trades.filter((t) => t.fill?.execution_model === 'taker_walks_official_order_book').length,
      quote_based_fills: trades.filter((t) => t.fill?.execution_model === 'quote_based_fill_at_official_bid_offer').length,
      modelled_maker_fills: trades.filter((t) => t.fill?.modelled === true).length,
    },
  };

  const report = {
    generated_at: nowIso(),
    trades_checked: trades.length,
    fully_verified: results.filter((r) => r.failed_checks.length === 0).length,
    with_anomalies: results.filter((r) => r.failed_checks.length > 0).length,
    anomaly_count: anomalies.length,
    anomalies: anomalies.slice(-200),
    anomalies_by_check: Object.entries(anomalies.reduce((acc, a) => ({ ...acc, [a.check]: (acc[a.check] ?? 0) + 1 }), {})).map(([check, count]) => ({ check, count })),
    retention_note:
      'Run manifests carry the per-request provenance (URL, status, SHA-256) for the most recent runs only; older manifests are pruned so the repository stays small. A trade from a pruned run cannot be hash-matched and shows payload_hash_present_in_that_runs_provenance_log as failed - that is a retention limit, disclosed here, not a price discrepancy.',
    coverage,
    results: results.slice(-300),
    methodology: [
      'Every trade is re-read from data/ledger/trades.jsonl (append-only) and checked against the provenance log of the run that created it.',
      'A trade is only "fully verified" when its payload hash appears in that run provenance log, its per-level fill detail reproduces its own VWAP, its Kalshi fee matches the official formula, and its instrument is still published with its own provenance.',
      'Simulated maker fills are counted separately and are never presented as observed executions.',
      'Anomalies are reported, never silently corrected.',
    ],
  };

  writeJson(`${paths.verification}/report.json`, report);
  console.log(`verification: ${report.fully_verified}/${report.trades_checked} trades fully verified, ${report.anomaly_count} anomalies`);
  for (const anomaly of anomalies.slice(0, 15)) console.log(`  - ${anomaly.ticker}: ${anomaly.check}`);
}

function loadRunProvenance() {
  const out = {};
  const manifest = readJson('data/manifest/latest.json', null);
  if (manifest?.run_id && Array.isArray(manifest.provenance)) {
    out[manifest.run_id] = new Set(manifest.provenance.map((p) => p.sha256).filter(Boolean));
  }
  const dir = 'data/manifest';
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json') || file === 'latest.json') continue;
      const parsed = readJson(`${dir}/${file}`, null);
      if (parsed?.run_id && Array.isArray(parsed.provenance)) {
        out[parsed.run_id] = new Set(parsed.provenance.map((p) => p.sha256).filter(Boolean));
      }
    }
  }
  return out;
}

function groupCount(list, keyFn) {
  const out = {};
  for (const item of list) {
    const key = keyFn(item) ?? 'unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

main();
