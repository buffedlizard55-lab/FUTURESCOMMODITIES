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
import { kalshiPerpTakerFee, kalshiTakerFee } from './lib/portfolio.mjs';
import { paths, readJson, readJsonl, writeJson } from './lib/store.mjs';

const REQUIRED_FUNDING_FIELDS = [
  'id',
  'run_id',
  'strategy_id',
  'username',
  'ticker',
  'instrument_id',
  'funding_time',
  'mark_price',
  'funding_rate',
  'contracts',
  'side',
  'payment_usd',
  'official_source',
  'official_source_sha256',
  'retrieved_at',
  'verification_timestamp',
];

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

    if (trade.venue_id === 'kalshi_margin' && trade.fees?.fee_usd != null) {
      // Official perp fee schedule, tier 0: 12.0 bps of notional (price x contracts).
      const expected = kalshiPerpTakerFee({ notionalUsd: (Number(trade.price) || 0) * (Number(trade.contracts) || 0) });
      checks.push({
        check: 'kalshi_perp_fee_matches_official_schedule',
        ok: Math.abs((trade.fees.fee_usd ?? 0) - expected) < 0.0011,
        recorded_fee_usd: trade.fees.fee_usd,
        recomputed_fee_usd: expected,
        formula: 'tier-0 exchange taker fee = 12.0 bps of notional (official fee schedule, effective 2026-07-07)',
      });
    }

    if (trade.strategy_id === 'cross-venue-basis') {
      // The unit-defect audit: every cross-venue trade must carry the recorded normalisation to
      // USD per unit of the underlying (Kalshi contract_size; MOEX official quotation UNIT), and
      // the recorded basis must re-derive from the recorded leg mids.
      const n = trade.signal?.normalization ?? null;
      const perpSize = Number(n?.perp_contract_size ?? 0);
      const perpMid = Number(n?.perp_mid ?? 0);
      const moexMid = Number(n?.moex_mid ?? 0);
      const recordedBasis = Number(trade.signal?.basis ?? 0);
      const recomputed = perpSize > 0 && perpMid > 0 && moexMid > 0 ? ((perpMid / perpSize) - moexMid) / moexMid : null;
      checks.push({
        check: 'cross_venue_basis_normalisation_recorded',
        ok: !!n && perpSize > 0 && (n.moex_quote_unit === 'USD') && recomputed != null && Math.abs(recomputed - recordedBasis) < 1e-6,
        recorded_basis: recordedBasis,
        recomputed_basis: recomputed,
        perp_contract_size: perpSize || null,
        moex_quote_unit: n?.moex_quote_unit ?? null,
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

  /* ------------------------------------------------ perps funding ledger */

  const funding = readJsonl(`${paths.ledger}/funding.jsonl`);
  let fundingFullyVerified = 0;
  for (const entry of funding) {
    const checks = [];
    const missing = REQUIRED_FUNDING_FIELDS.filter((f) => entry[f] === undefined || entry[f] === null);
    checks.push({ check: 'mandatory_fields_present', ok: missing.length === 0, missing });

    const hash = entry.official_source_sha256 ?? null;
    checks.push({ check: 'payload_hash_recorded', ok: !!hash, sha256: hash });

    const hashes = perRunProvenance[entry.run_id];
    const hashInRun = hashes ? hashes.has(hash) : false;
    checks.push({
      check: 'payload_hash_present_in_that_runs_provenance_log',
      ok: hashes ? hashInRun : false,
      note: hashes ? (hashInRun ? 'The funding-rate payload hash appears in the run that applied the payment.' : 'The hash was not found in that run provenance log.') : 'No provenance log was found for this run.',
    });

    const rate = Number(entry.funding_rate);
    const mark = Number(entry.mark_price);
    const direction = entry.side === 'long' ? 1 : -1;
    const expected = Number(((Number(entry.contracts) || 0) * mark * rate * direction).toFixed(6));
    checks.push({
      check: 'payment_reproduces_from_exchange_published_inputs',
      ok: Math.abs((Number(entry.payment_usd) || 0) - expected) < 0.0011,
      recorded_payment_usd: entry.payment_usd,
      recomputed_payment_usd: expected,
      formula: 'payment = contracts x exchange mark_price x exchange funding_rate x direction',
    });
    checks.push({
      check: 'official_zero_threshold_respected',
      ok: Math.abs(rate) >= 0.0001,
      note: 'Kalshi treats |funding rate| < 0.01% as zero; such events must not produce a payment.',
    });

    const failed = checks.filter((c) => c.ok === false);
    if (failed.length === 0) fundingFullyVerified += 1;
    else {
      results.push({ trade_id: entry.id, run_id: entry.run_id, strategy_id: entry.strategy_id, ticker: entry.ticker, kind: 'funding', checks, failed_checks: failed.map((f) => f.check) });
      for (const fail of failed) anomalies.push({ trade_id: entry.id, ticker: entry.ticker, check: fail.check, detail: fail });
    }
  }

  const coverage = {
    trades: trades.length,
    intents: intents.length,
    funding_entries: funding.length,
    funding_fully_verified: fundingFullyVerified,
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
    funding_entries_checked: funding.length,
    funding_fully_verified: fundingFullyVerified,
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
      'A trade is only "fully verified" when its payload hash appears in that run provenance log, its per-level fill detail reproduces its own VWAP, its Kalshi fee matches the official formula (event contracts) or the official perp schedule (perpetuals), and its instrument is still published with its own provenance.',
      'Every perps funding payment is re-read from data/ledger/funding.jsonl and re-derived from the exchange-published mark price, funding rate and the position side, with the funding-rate payload hash matched to the run that applied it.',
      'Simulated maker fills are counted separately and are never presented as observed executions.',
      'Anomalies are reported, never silently corrected.',
    ],
  };

  writeJson(`${paths.verification}/report.json`, report);
  console.log(`verification: ${report.fully_verified}/${report.trades_checked} trades fully verified, ${fundingFullyVerified}/${funding.length} funding entries verified, ${report.anomaly_count} anomalies`);
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
