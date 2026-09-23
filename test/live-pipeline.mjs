#!/usr/bin/env node
/**
 * Offline replay of the live tick's strategy + execution pipeline.
 *
 * The sandbox has no egress to the exchanges, and the competition tick runs on GitHub Actions,
 * so a failed tick cannot be inspected from here. This harness rebuilds the exact context the
 * tick builds (same instrument/quote records, same portfolio state, same candle and MOEX history
 * caches, same previous-snapshot mids) from the last committed snapshot and runs the same
 * functions the live tick runs (engine/lib/execution.mjs + the strategies' decide/exit).
 *
 * What it proves:
 *   1. every strategy's decide() and exit() runs without throwing on real committed data;
 *   2. the execution path (working orders -> exits -> entries -> fills -> mark) runs without
 *      throwing and produces the same trade/intent record shapes the ledger uses;
 *   3. portfolio equity after the replay matches an independent recomputation.
 *
 * What it does NOT do: it places no real trades, appends nothing to the ledger, and writes no
 * published state. It is a read-only rehearsal of the live path.
 */

import { readdirSync } from 'node:fs';
import { STRATEGIES } from '../engine/strategies/index.mjs';
import {
  executeEventContractOrder,
  executeQuoteOrder,
  intentRecord,
  processWorkingOrders,
} from '../engine/lib/execution.mjs';
import { markPortfolio, newPortfolio, returnPct } from '../engine/lib/portfolio.mjs';
import { readJson, readJsonl } from '../engine/lib/store.mjs';

const competition = readJson('config/competition.json', null);
if (!competition) {
  console.error('missing config/competition.json');
  process.exit(2);
}

const snapshot = readJson('data/snapshots/latest.json', null);
const universe = readJson('data/universe/instruments.json', null);
const portfolios = readJson('data/state/portfolios.json', null);
const workingOrders = readJson('data/state/working_orders.json', { orders: [] });
const previousSnapshots = readdirSync('data/snapshots/by-run')
  .filter((f) => f.startsWith('run-') && f.endsWith('.json'))
  .sort();
const previousSnapshot = previousSnapshots.length ? readJson(`data/snapshots/by-run/${previousSnapshots[previousSnapshots.length - 2] ?? previousSnapshots[0]}`, null) : null;

if (!snapshot || !universe || !portfolios) {
  console.error('missing snapshot, universe or portfolios data');
  process.exit(2);
}

const quotes = snapshot.quotes;
const fx = snapshot.fx ?? null;
const allInstruments = universe.instruments;
const instrumentById = Object.fromEntries(allInstruments.map((i) => [i.instrument_id, i]));

/* Kalshi candle cache: series_ticker -> candles[] */
const kalshiCandles = {};
for (const f of readdirSync('data/history/kalshi').filter((f) => f.endsWith('.json'))) {
  const rec = readJson(`data/history/kalshi/${f}`, null);
  if (rec?.series_ticker) kalshiCandles[rec.series_ticker] = rec.candles ?? [];
}
/* MOEX history cache: secid -> rows[] */
const moexHistory = {};
for (const f of readdirSync('data/history/moex').filter((f) => f.endsWith('.json'))) {
  const rec = readJson(`data/history/moex/${f}`, null);
  if (rec?.instrument_id) moexHistory[rec.instrument_id.split(':')[1]] = rec.rows ?? [];
}

const runId = `harness-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const ctxBase = {
  now: new Date(),
  runId,
  competition,
  fx,
  portfolios,
  instrument: (id) => instrumentById[id] ?? null,
  quote: (id) => quotes[id] ?? null,
  listInstruments: ({ venue, groups } = {}) =>
    allInstruments.filter((i) => (!venue || i.venue === venue) && (!groups || groups.includes(i.group))),
  kalshiCandles: (seriesTicker) => kalshiCandles[seriesTicker] ?? [],
  moexHistory: (ticker) => moexHistory[ticker] ?? [],
  previousMid: (instrumentId) => {
    const prev = previousSnapshot?.quotes?.[instrumentId];
    return prev ? prev.mid ?? null : null;
  },
  note: (record) => harnessNotes.push(record),
};

const harnessNotes = [];
const newTrades = [];
const intents = [];
const errors = [];

const report = (label, fn) => {
  try {
    return fn();
  } catch (error) {
    errors.push({ label, error: String(error?.stack ?? error) });
    return null;
  }
};

/* ---------------- 1. working orders (same order as the live tick) ---------------- */

report('processWorkingOrders', () => {
  processWorkingOrders({ workingOrders, ctxBase, portfolios, runId, newTrades, intents, competition });
});

/* ---------------- 2. strategies: exits then entries ---------------- */

const perStrategy = [];
for (const strategy of STRATEGIES) {
  const name = strategy.username;
  // Same as the live tick: a strategy with no state yet gets its starting portfolio in-run.
  const portfolio = portfolios[strategy.id] ?? newPortfolio({
    strategyId: strategy.id,
    username: strategy.username,
    marketType: strategy.market_type,
    startingCashUsd: competition.starting_cash_usd,
    startedAt: competition.starts_at,
  });
  portfolios[strategy.id] = portfolio;
  if (strategy.enabled === false) {
    perStrategy.push({ username: name, status: 'disabled', reason: strategy.disabled_reason ?? null });
    continue;
  }
  const strategyNotes = [];
  const ctx = {
    ...ctxBase,
    portfolio,
    notes: strategyNotes,
    orders: [],
    exits: [],
    order: (order) => ctx.orders.push({ ...order, username: strategy.username, market_type_label: strategy.market_type, strategy_id: strategy.id }),
    exit: (instrumentId, reason, signal) => ctx.exits.push({ instrument_id: instrumentId, reason, signal }),
    note: (record) => strategyNotes.push(record),
  };

  report(`exit:${name}`, () => {
    for (const position of Object.values(portfolio.positions)) {
      if (typeof strategy.exit === 'function') {
        const decision = strategy.exit(ctx, position);
        if (decision) ctx.exits.push({ instrument_id: position.instrument_id, reason: decision.reason, signal: decision.signal ?? null });
      }
    }
  });

  report(`executeExits:${name}`, () => {
    for (const requested of ctx.exits) {
      const position = portfolio.positions[requested.instrument_id];
      if (!position) continue;
      const inst = instrumentById[requested.instrument_id];
      const quote = quotes[requested.instrument_id];
      if (!inst || !quote) {
        intents.push(intentRecord({ strategy_id: strategy.id, username: strategy.username, instrument_id: requested.instrument_id, action: 'exit' }, runId, 'no_verified_quote', 'harness: no quote'));
        continue;
      }
      if (inst.kind === 'event_contract') {
        const exitPrice = position.outcome === 'yes' ? quote.best_yes_bid : quote.best_no_bid;
        if (exitPrice == null) {
          intents.push(intentRecord({ strategy_id: strategy.id, username: strategy.username, instrument_id: requested.instrument_id, action: 'exit' }, runId, 'one_sided_book', 'harness: no resting bid'));
          continue;
        }
        executeEventContractOrder({
          ord: { strategy_id: strategy.id, username: strategy.username, market_type_label: strategy.market_type, instrument_id: inst.instrument_id, action: 'sell', outcome: position.outcome, contracts: position.contracts, limit_price: exitPrice, order_type: 'taker', is_exit: true, exit_reason: requested.reason, thesis: requested.reason, signal: requested.signal },
          inst, quote, portfolio, runId, newTrades, intents, instrumentById, competition, fx,
        });
      } else {
        executeQuoteOrder({
          ord: { strategy_id: strategy.id, username: strategy.username, market_type_label: strategy.market_type, instrument_id: inst.instrument_id, action: position.side === 'long' ? 'sell' : 'buy', side: position.side, contracts: position.contracts, order_type: 'taker', is_exit: true, exit_reason: requested.reason, thesis: requested.reason, signal: requested.signal },
          inst, quote, portfolio, runId, newTrades, intents, instrumentById, competition, fx,
        });
      }
    }
  });

  report(`decide:${name}`, () => {
    if (typeof strategy.decide === 'function') strategy.decide(ctx);
  });

  report(`executeOrders:${name}`, () => {
    for (const ord of ctx.orders) {
      if (ord.order_type === 'maker') {
        // maker orders are registered as working orders in the live tick via registerWorkingOrder;
        // the harness records them as intents so the count is comparable without mutating state.
        intents.push(intentRecord(ord, runId, 'resting_order_registered', 'harness: maker order would be registered as a working order'));
        continue;
      }
      if (ord.venue === 'kalshi') {
        executeEventContractOrder({ ord, inst: instrumentById[ord.instrument_id], quote: quotes[ord.instrument_id], portfolio, runId, newTrades, intents, instrumentById, competition, fx });
      } else {
        executeQuoteOrder({ ord, inst: instrumentById[ord.instrument_id], quote: quotes[ord.instrument_id], portfolio, runId, newTrades, intents, instrumentById, competition, fx });
      }
    }
  });

  report(`mark:${name}`, () => markPortfolio(portfolio, quotes));

  perStrategy.push({
    username: name,
    status: 'ran',
    exits: ctx.exits.length,
    orders: ctx.orders.length,
    equity_usd: portfolio.equity_usd,
    return_pct: returnPct(portfolio),
    open_positions: Object.keys(portfolio.positions).length,
    notes: strategyNotes.slice(0, 10),
  });
}

/* ---------------- 3. expired positions that need a live settlement fetch ---------------- */

const pendingSettlements = [];
for (const p of Object.values(portfolios)) {
  for (const position of Object.values(p.positions)) {
    if (position.kind !== 'event_contract') continue;
    const closeTime = position.market?.close_time ?? null;
    if (closeTime && new Date(closeTime).getTime() <= Date.now()) {
      pendingSettlements.push({ strategy: p.strategy_id, instrument_id: position.instrument_id, close_time: closeTime });
    }
  }
}

/* The live tick marks every portfolio once more before publishing (the settlement pass). */
for (const p of Object.values(portfolios)) markPortfolio(p, quotes);

/* ---------------- 4. independent equity recomputation ---------------- */

let mismatches = 0;
for (const p of Object.values(portfolios)) {
  let positionValue = 0;
  let allMarked = true;
  for (const position of Object.values(p.positions ?? {})) {
    const quote = quotes[position.instrument_id];
    const mult = position.usd_per_price_unit ?? 1;
    let mark = null;
    if (quote) {
      if (position.kind === 'event_contract') {
        mark = position.outcome === 'yes' ? quote.best_yes_bid : quote.best_no_bid;
      } else {
        mark = position.side === 'long' ? quote.bid : quote.offer;
      }
    }
    if (mark == null) {
      allMarked = false;
      if (position.kind !== 'event_contract') positionValue += position.margin_usd ?? 0;
      continue;
    }
    let pnl;
    if (position.kind === 'event_contract') {
      pnl = (mark - position.avg_entry_price) * position.contracts;
      positionValue += mark * position.contracts;
    } else {
      pnl = (mark - position.avg_entry_price) * position.contracts * mult * (position.side === 'short' ? -1 : 1);
      positionValue += (position.margin_usd ?? 0) + pnl;
    }
    const expectedPnl = Number(pnl.toFixed(6));
    if (Math.abs((position.unrealized_pnl_usd ?? -1e12) - expectedPnl) > 1e-6) {
      mismatches += 1;
      errors.push({ label: `pnl_mismatch:${p.strategy_id}:${position.instrument_id}`, error: `recorded ${position.unrealized_pnl_usd} vs recomputed ${expectedPnl}` });
    }
  }
  if (allMarked) {
    const expectedEquity = Number((p.cash_usd + positionValue).toFixed(6));
    if (Math.abs((p.equity_usd ?? -1e12) - expectedEquity) > 0.01) {
      mismatches += 1;
      errors.push({ label: `equity_mismatch:${p.strategy_id}`, error: `recorded ${p.equity_usd} vs recomputed ${expectedEquity}` });
    }
  } else if (p.equity_complete !== false) {
    mismatches += 1;
    errors.push({ label: `completeness_flag:${p.strategy_id}`, error: 'unmarked positions present but equity_complete is not false' });
  }
}

/* ---------------- 5. report ---------------- */

console.log(`== live-pipeline harness ${runId}`);
console.log(`snapshot: ${snapshot.run_id} (${snapshot.taken_at}), quotes: ${Object.keys(quotes).length}, instruments: ${allInstruments.length}`);
console.log(`strategies: ${STRATEGIES.length}, trades simulated: ${newTrades.length}, intents: ${intents.length}`);
for (const row of perStrategy) {
  console.log(`  ${row.username}: ${row.status}${row.status === 'ran' ? ` orders=${row.orders} exits=${row.exits} equity=${row.equity_usd} ret=${row.return_pct}% open=${row.open_positions}` : ` (${row.reason ?? ''})`}`);
}
if (pendingSettlements.length) {
  console.log(`expired event positions awaiting a live settlement fetch: ${pendingSettlements.length}`);
  for (const s of pendingSettlements) console.log(`  ${s.strategy} ${s.instrument_id} closed ${s.close_time}`);
}
if (errors.length) {
  console.log(`\n${errors.length} ERRORS:`);
  for (const e of errors) console.log(`  [${e.label}] ${e.error}`);
  process.exit(1);
}
console.log('OK: no exceptions, no equity mismatches.');
