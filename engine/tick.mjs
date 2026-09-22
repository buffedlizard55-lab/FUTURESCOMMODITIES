#!/usr/bin/env node
/**
 * Competition tick.
 *
 * One tick = fetch verified market data from official sources -> build/verify the universe ->
 * let every strategy decide -> simulate size-aware fills against the real book -> mark and
 * settle positions -> publish state, ledger and manifests.
 *
 * Usage:
 *   node engine/tick.mjs [--dry-run] [--max-requests=N] [--offline]
 *
 * Guarantees:
 *  - No price, size, date or contract fact is ever fabricated. Everything written to the
 *    ledger is copied from a payload fetched in this run (hash + URL + timestamp recorded).
 *  - If a venue is unreachable the run is marked degraded and existing state is preserved.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { KalshiClient, bookFromRaw, walkBookForTaker } from './lib/kalshi.mjs';
import { moexHistory } from './lib/moex.mjs';
import { fetchJson, nowIso } from './lib/http.mjs';
import {
  applyEventContractClose,
  applyEventContractOpen,
  markToMarket,
  newPortfolio,
  openPositionValue,
  returnPct,
  simulateEventContractFill,
  simulateEventContractMakerFill,
  simulateFuturesFill,
  tradeId,
  upsertPosition,
} from './lib/portfolio.mjs';
import { appendJsonlUnique, ensureDir, paths, readJson, readJsonl, writeJsonIfChanged } from './lib/store.mjs';
import {
  collectEiaBenchmarks,
  collectKalshiInstruments,
  collectKalshiPerps,
  collectMoexInstruments,
  liquidityScore,
  quoteKalshiInstruments,
  resolveKalshiSeries,
} from './lib/market.mjs';
import { STRATEGIES, strategyCatalog } from './strategies/index.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const OFFLINE = args.includes('--offline');
const maxRequestsArg = args.find((a) => a.startsWith('--max-requests='));
const MAX_REQUESTS = maxRequestsArg ? Number(maxRequestsArg.split('=')[1]) : 250;

const config = {
  competition: readJson(`${paths.config}/competition.json`),
  watchlist: readJson(`${paths.config}/watchlist.json`),
  sources: readJson(`${paths.config}/sources.json`),
};
if (!config.competition || !config.watchlist) {
  console.error('FATAL: config/competition.json and config/watchlist.json are required.');
  process.exit(2);
}

const KC = config.competition;
const WL = config.watchlist;

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000);
}

function isoDate(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

async function main() {
  const startedAt = nowIso();
  const runId = `run-${startedAt.replace(/[:.]/g, '-')}`;
  const degraded = [];
  const manifests = [];
  const notes = [];

  console.log(`== FUTURESCOMMODITIES tick ${runId}${DRY_RUN ? ' (dry run)' : ''}`);

  /* ------------------------- 1. Kalshi universe ------------------------- */
  const kalshi = new KalshiClient({ requestSpacingMs: KC.request_spacing_ms ?? 120, maxRequests: MAX_REQUESTS });
  let exchangeStatus = null;
  if (!OFFLINE) {
    try {
      const st = await kalshi.exchangeStatus();
      exchangeStatus = st.json;
      manifests.push(st.provenance);
    } catch (err) {
      degraded.push({ venue: 'kalshi', error: `exchange/status failed: ${err.message}` });
    }
  }

  const seriesRes = OFFLINE ? { series: [], calls: [] } : await resolveKalshiSeries(kalshi, WL);
  manifests.push(...seriesRes.calls.filter((c) => c.provenance).map((c) => c.provenance));
  const instrumentsRes = OFFLINE ? { instruments: [], calls: [] } : await collectKalshiInstruments(kalshi, seriesRes.series);
  manifests.push(...instrumentsRes.calls.filter((c) => c.provenance).map((c) => c.provenance));
  const quotesRes = OFFLINE
    ? { quotes: {}, calls: [] }
    : await quoteKalshiInstruments(kalshi, instrumentsRes.instruments, { maxQuoted: WL.kalshi.max_quoted_markets });
  manifests.push(...quotesRes.calls.filter((c) => c.provenance).map((c) => c.provenance));

  const perpsRes = OFFLINE ? { instruments: [], quotes: {}, calls: [] } : await collectKalshiPerps(kalshi, { maxQuoted: WL.kalshi_margin_perps.max_quoted }, notes);
  manifests.push(...perpsRes.calls.filter((c) => c.provenance).map((c) => c.provenance));

  /* --------------------------- 2. MOEX futures -------------------------- */
  const moexRes = OFFLINE ? { instruments: [], quotes: {}, contracts: [] } : await collectMoexInstruments(WL.moex, notes);
  manifests.push(...notes.filter((n) => n.provenance).map((n) => n.provenance));

  /* ---------------------- 3. Benchmark publications --------------------- */
  const benchmarks = OFFLINE ? {} : await collectEiaBenchmarks(WL.benchmarks?.eia, notes);
  manifests.push(...notes.filter((n) => n.provenance).map((n) => n.provenance));

  /* --------------------------- 4. FX for RUB fees ----------------------- */
  const fx = OFFLINE ? null : await collectUsdRub(notes);
  if (fx?.provenance) manifests.push(fx.provenance);

  /* --------------------------- 5. Price history ------------------------- */
  const kalshiHistory = OFFLINE ? {} : await refreshKalshiHistory(kalshi, seriesRes.series, manifests, degraded);
  const moexHistory = OFFLINE ? {} : await refreshMoexHistory(moexRes.instruments, manifests, degraded);

  const instruments = [...instrumentsRes.instruments, ...perpsRes.instruments, ...moexRes.instruments];
  const quotes = { ...quotesRes.quotes, ...perpsRes.quotes, ...moexRes.quotes };
  const instrumentById = Object.fromEntries(instruments.map((i) => [i.instrument_id, i]));

  console.log(`   instruments: ${instruments.length}  quotes: ${Object.keys(quotes).length}  kalshi series matched: ${seriesRes.series.length}`);
  console.log(`   requests used: ${kalshi.requests}  degraded: ${degraded.length}`);

  /* ----------------------------- 6. State ------------------------------- */
  const previousSnapshot = readJson(`${paths.snapshots}/latest.json`, null);
  const portfolios = readJson(`${paths.state}/portfolios.json`, null) ?? {};
  const openingCash = KC.starting_cash_usd;

  for (const s of STRATEGIES) {
    if (!portfolios[s.id]) portfolios[s.id] = newPortfolio(s, openingCash);
  }

  const ctx = buildContext({
    instruments,
    instrumentById,
    quotes,
    previousSnapshot,
    kalshiHistory,
    moexHistory,
    benchmarks,
    portfolios,
    fx,
  });

  /* -------------------------- 7. Strategy pass -------------------------- */
  const newTrades = [];
  const intents = [];
  const strategyActivity = [];

  for (const strategy of STRATEGIES) {
    const portfolio = portfolios[strategy.id];
    let decision = { orders: [], notes: [] };
    try {
      decision = strategy.decide(ctx) ?? { orders: [], notes: [] };
    } catch (err) {
      strategyActivity.push({ strategy_id: strategy.id, error: String(err.message ?? err) });
      continue;
    }

    // exits first so capital frees up for the same tick's entries
    const exitOrders = [];
    for (const [instrumentId, pos] of Object.entries(portfolio.positions)) {
      if (pos.strategy_id !== strategy.id) continue;
      if (typeof strategy.exit !== 'function') continue;
      try {
        const dec = strategy.exit(ctx, pos);
        if (dec) {
          exitOrders.push({
            strategy_id: strategy.id,
            username: strategy.username,
            instrument_id: instrumentId,
            venue: pos.venue,
            market_type_label: strategy.market_type,
            action: pos.kind === 'event_contract' ? 'sell' : pos.side === 'long' ? 'sell' : 'buy',
            outcome: pos.kind === 'event_contract' ? pos.outcome : null,
            side: pos.kind === 'event_contract' ? null : pos.side === 'long' ? 'short' : 'long',
            contracts: pos.contracts,
            limit_price: dec.limit_price ?? null,
            order_type: dec.order_type ?? 'taker',
            thesis: `Exit: ${dec.reason}`,
            exit_reason: dec.reason,
            is_exit: true,
            signal: { name: 'strategy_exit_rule', value: dec.reason },
          });
        }
      } catch (err) {
        strategyActivity.push({ strategy_id: strategy.id, instrument_id: instrumentId, error: String(err.message ?? err) });
      }
    }

    for (const ord of [...exitOrders, ...(decision.orders ?? [])]) {
      const outcome = executeOrder({ ord, ctx, portfolio, runId, newTrades, intents });
      strategyActivity.push({ strategy_id: strategy.id, instrument_id: ord.instrument_id, ...outcome });
    }

    markToMarket(portfolio, quotes);
    strategyActivity.push({
      strategy_id: strategy.id,
      notes: (decision.notes ?? []).slice(0, 40),
      orders_produced: (decision.orders ?? []).length,
      exits_produced: exitOrders.length,
      equity_usd: portfolio.equity_usd,
      return_pct: returnPct(portfolio),
    });
  }

  /* -------------------------- 8. Settlements ---------------------------- */
  const settlements = [];
  if (!OFFLINE) {
    for (const strategy of STRATEGIES) {
      const portfolio = portfolios[strategy.id];
      for (const [instrumentId, pos] of Object.entries(portfolio.positions)) {
        if (pos.kind !== 'event_contract') continue;
        const inst = instrumentById[instrumentId];
        if (!inst || inst.venue !== 'kalshi') continue;
        const expiry = inst.expiration_time ?? inst.close_time ?? null;
        if (!expiry || new Date(expiry) > new Date()) continue;
        const settled = await settleEventContract({ kalshi, inst, pos, portfolio, runId, strategy, manifests });
        if (settled) {
          settlements.push(settled);
          newTrades.push(settled.closing_trade);
          delete portfolio.positions[instrumentId];
        }
      }
    }
  }

  /* ---------------------------- 9. Publish ------------------------------ */
  const quotesForSite = Object.fromEntries(
    Object.entries(quotes).map(([id, q]) => [
      id,
      {
        instrument_id: q.instrument_id,
        venue: q.venue,
        kind: q.kind,
        best_yes_bid: q.best_yes_bid ?? null,
        best_yes_ask: q.best_yes_ask ?? null,
        best_no_bid: q.best_no_bid ?? null,
        best_no_ask: q.best_no_ask ?? null,
        bid: q.bid ?? null,
        offer: q.offer ?? null,
        mid: q.mid ?? null,
        spread: q.spread ?? null,
        depth_yes_contracts: q.depth_yes_contracts ?? null,
        depth_no_contracts: q.depth_no_contracts ?? null,
        volume_today: q.volume_today ?? null,
        open_interest: q.open_interest ?? null,
        settle_price: q.settle_price ?? null,
        trade_date: q.trade_date ?? null,
        contract_size: q.contract_size ?? null,
        lot_volume: q.lot_volume ?? null,
        buy_yes_levels: q.buy_yes_levels ?? null,
        buy_no_levels: q.buy_no_levels ?? null,
        source: q.source ?? null,
      },
    ]),
  );

  const leaderboard = Object.values(portfolios)
    .map((p) => {
      const strategy = STRATEGIES.find((s) => s.id === p.strategy_id);
      return {
        strategy_id: p.strategy_id,
        username: p.username,
        display_name: strategy?.display_name ?? p.strategy_id,
        market_type: strategy?.market_type ?? null,
        equity_usd: Number(p.equity_usd?.toFixed(2) ?? p.cash_usd.toFixed(2)),
        cash_usd: Number(p.cash_usd.toFixed(2)),
        realized_pnl_usd: Number(p.realized_pnl_usd.toFixed(2)),
        unrealized_pnl_usd: Number((p.unrealized_pnl_usd ?? 0).toFixed(2)),
        fees_paid_usd: Number((p.fees_paid_usd ?? 0).toFixed(2)),
        open_positions: Object.keys(p.positions).length,
        closed_trades: p.closed_trade_count,
        return_pct: returnPct(p),
        status: strategy?.status ?? null,
      };
    })
    .sort((a, b) => b.return_pct - a.return_pct);

  const allTrades = readJsonl(`${paths.ledger}/trades.jsonl`);
  const competitionState = {
    season: {
      season_id: KC.season_id,
      starts_at: KC.starts_at,
      ends_at: KC.ends_at,
      duration_note: KC.duration_note,
      starting_cash_usd: openingCash,
    },
    last_tick: {
      run_id: runId,
      started_at: startedAt,
      finished_at: nowIso(),
      requests_used: kalshi.requests,
      degraded,
      exchange_status: exchangeStatus,
      instruments: instruments.length,
      quotes: Object.keys(quotes).length,
      kalshi_series_matched: seriesRes.series.length,
      new_trades: newTrades.length,
      intents: intents.length,
      settlements: settlements.length,
    },
    totals: {
      trades_recorded: allTrades.length + newTrades.length,
      open_positions: Object.values(portfolios).reduce((s, p) => s + Object.keys(p.positions).length, 0),
      strategies: STRATEGIES.length,
    },
  };

  if (DRY_RUN) {
    console.log(JSON.stringify({ leaderboard, newTrades: newTrades.length, intents: intents.length, degraded }, null, 2));
    return;
  }

  /* ---------------------------- 10. Write ------------------------------- */
  ensureDir(paths.registry);
  ensureDir(paths.snapshots);
  ensureDir(paths.state);
  ensureDir(paths.ledger);
  ensureDir(paths.manifests);
  ensureDir(`${paths.history}/kalshi`);
  ensureDir(`${paths.history}/moex`);

  const universe = {
    generated_at: nowIso(),
    venues: buildVenueCatalog(config.sources, { exchangeStatus, fx, benchmarks }),
    counts: {
      instruments: instruments.length,
      kalshi_event_contracts: instrumentsRes.instruments.length,
      kalshi_perps: perpsRes.instruments.length,
      moex_futures: moexRes.instruments.length,
    },
    instruments: instruments.map((i) => ({
      ...i,
      liquidity_score: liquidityScore(i),
      quote: quotes[i.instrument_id]
        ? {
            best_yes_bid: quotes[i.instrument_id].best_yes_bid ?? null,
            best_yes_ask: quotes[i.instrument_id].best_yes_ask ?? null,
            best_no_bid: quotes[i.instrument_id].best_no_bid ?? null,
            best_no_ask: quotes[i.instrument_id].best_no_ask ?? null,
            bid: quotes[i.instrument_id].bid ?? null,
            offer: quotes[i.instrument_id].offer ?? null,
            mid: quotes[i.instrument_id].mid ?? null,
            spread: quotes[i.instrument_id].spread ?? null,
            volume_today: quotes[i.instrument_id].volume_today ?? null,
            open_interest: quotes[i.instrument_id].open_interest ?? null,
            source: quotes[i.instrument_id].source ?? null,
          }
        : null,
    })),
    matched_series: seriesRes.series,
    unresolved_series_count: seriesRes.unresolved_count,
    note:
      'Every instrument above was returned by the official API named in its provenance block during this run. Instruments listed by the project brief but absent here are not currently listed/tradable on the source checked, or their data feed requires a licence (see venues[].status).',
  };

  writeJsonIfChanged(`${paths.registry}/universe.json`, universe);
  writeJsonIfChanged(`${paths.registry}/strategies.json`, {
    generated_at: nowIso(),
    strategies: strategyCatalog(),
  });
  writeJsonIfChanged(`${paths.snapshots}/latest.json`, {
    run_id: runId,
    retrieved_at: nowIso(),
    season_id: KC.season_id,
    quotes: quotesForSite,
    instruments: Object.fromEntries(
      instruments.map((i) => [
        i.instrument_id,
        {
          instrument_id: i.instrument_id,
          venue: i.venue,
          market_type: i.market_type,
          ticker: i.ticker,
          series_ticker: i.series_ticker ?? null,
          title: i.title,
          group: i.group ?? null,
          close_time: i.close_time ?? null,
          expiration_time: i.expiration_time ?? null,
          last_trade_date: i.last_trade_date ?? null,
          contract_size: i.contract_size ?? null,
          lot_volume: i.lot_volume ?? null,
          fee_multiplier: i.fee_multiplier ?? null,
          settlement_source: i.settlement_source ?? null,
          contract_terms_url: i.contract_terms_url ?? null,
          faceunit: i.faceunit ?? null,
        },
      ]),
    ),
    benchmarks,
    fx,
  });
  writeJsonIfChanged(`${paths.state}/portfolios.json`, portfolios);
  writeJsonIfChanged(`${paths.state}/leaderboard.json`, { generated_at: nowIso(), season: competitionState.season, leaderboard });
  writeJsonIfChanged(`${paths.state}/competition.json`, competitionState);
  writeJsonIfChanged(`${paths.state}/activity.json`, { generated_at: nowIso(), strategies: strategyActivity.slice(-200), settlements });
  appendJsonlUnique(`${paths.ledger}/trades.jsonl`, newTrades, 'id');
  appendJsonlUnique(`${paths.ledger}/intents.jsonl`, intents, 'id');
  writeJsonIfChanged(`${paths.manifests}/${runId}.json`, {
    run_id: runId,
    started_at: startedAt,
    finished_at: nowIso(),
    requests: kalshi.requests,
    provenance: manifests,
    degraded,
    notes,
  });

  appendDailyHistory({ quotes, instrumentById });

  console.log(`   wrote ${newTrades.length} trades, ${intents.length} intents, ${settlements.length} settlements`);
  console.log(`   leaderboard: ${leaderboard.map((l) => `${l.username} ${l.return_pct}%`).join('  |  ')}`);
}

/* --------------------------------------------------------------------- */
/* helpers                                                               */
/* --------------------------------------------------------------------- */

function buildContext({ instruments, instrumentById, quotes, previousSnapshot, kalshiHistory, moexHistory, benchmarks, portfolios, fx }) {
  return {
    now: new Date(),
    instruments: instrumentById,
    quotes,
    candles: kalshiHistory,
    moexHistory,
    benchmarks,
    fx,
    listInstruments({ venue, groups } = {}) {
      return instruments.filter((i) => (!venue || i.venue === venue) && (!groups || groups.includes(i.group)));
    },
    hasPosition(instrumentId) {
      return Object.values(portfolios).some((p) => p.positions[instrumentId]);
    },
    previousMid(instrumentId) {
      return previousSnapshot?.quotes?.[instrumentId]?.mid ?? null;
    },
    signalSeriesFor(inst) {
      if (!inst) return null;
      const group = inst.group;
      const asset = inst.asset_code ?? inst.series_ticker ?? '';
      if (group === 'Precious Metals' && /GOLD/i.test(asset)) {
        const goldInstrument = instruments.find((i) => i.venue === 'moex_forts' && i.asset_code === 'GOLD');
        const gold = goldInstrument ? moexHistory[goldInstrument.ticker] : null;
        if (gold?.length) {
          const closes = gold.map((r) => r.CLOSE ?? r.SETTLEPRICE).filter((x) => x != null);
          if (closes.length > 6) {
            return {
              name: 'MOEX GOLD front-future settlements',
              url: 'https://iss.moex.com/iss/history/engines/futures/markets/forts/securities/GDZ6.json',
              trend: { return: (closes.at(-1) - closes[0]) / closes[0], observations: closes.length },
            };
          }
        }
      }
      if (group === 'Energy') {
        const wti = benchmarks.RCLC1;
        if (wti?.rows?.length > 6) {
          const closes = wti.rows.map((r) => r.value);
          return {
            name: 'EIA Cushing WTI daily spot (RCLC1)',
            url: wti.page,
            trend: { return: (closes.at(-1) - closes[0]) / closes[0], observations: closes.length },
          };
        }
      }
      const seriesCandles = kalshiHistory[inst.series_ticker];
      if (seriesCandles?.length > 6) {
        const closes = seriesCandles.map((c) => c.yes_bid_close ?? c.price_close).filter((x) => x != null);
        if (closes.length > 6) {
          return {
            name: `Kalshi official candlesticks for ${inst.series_ticker}`,
            url: `https://api.elections.kalshi.com/trade-api/v2/series/${inst.series_ticker}/markets/{ticker}/candlesticks`,
            trend: { return: (closes.at(-1) - closes[0]) / closes[0], observations: closes.length },
          };
        }
      }
      return null;
    },
  };
}

function executeOrder({ ord, ctx, portfolio, runId, newTrades, intents }) {
  const inst = ctx.instruments[ord.instrument_id];
  if (!inst) {
    intents.push(intentRecord(ord, runId, 'instrument_not_in_snapshot', 'No verified listing for this instrument in the current snapshot.'));
    return { executed: false, reason: 'instrument_not_in_snapshot' };
  }
  const q = ctx.quotes[ord.instrument_id];
  if (!q) {
    intents.push(intentRecord(ord, runId, 'no_verified_quote', 'Instrument listed but no order-book/quote snapshot was retrieved this tick.'));
    return { executed: false, reason: 'no_verified_quote' };
  }

  const isExit = !!ord.is_exit;
  const existing = portfolio.positions[ord.instrument_id];

  if (!isExit && existing) {
    intents.push(intentRecord(ord, runId, 'already_holding', 'Strategy already holds this instrument; one position per instrument per strategy.'));
    return { executed: false, reason: 'already_holding' };
  }
  if (isExit && !existing) {
    intents.push(intentRecord(ord, runId, 'no_position_to_exit', 'Exit rule fired but no open position was recorded.'));
    return { executed: false, reason: 'no_position_to_exit' };
  }

  if (inst.market_type === 'event_contract') {
    return executeEventContractOrder({ ord, inst, q, portfolio, runId, newTrades, intents, existing });
  }
  if (inst.market_type === 'perpetual') {
    return executePerpOrder({ ord, inst, q, portfolio, runId, newTrades, intents, existing });
  }
  if (inst.market_type === 'future') {
    return executeFutureOrder({ ord, inst, q, portfolio, runId, newTrades, intents, existing, ctx });
  }
  intents.push(intentRecord(ord, runId, 'unsupported_market_type', `Market type ${inst.market_type} has no execution model.`));
  return { executed: false, reason: 'unsupported_market_type' };
}

function executeEventContractOrder({ ord, inst, q, portfolio, runId, newTrades, intents, existing }) {
  const book = {
    buyYesLevels: q.buy_yes_levels ?? [],
    buyNoLevels: q.buy_no_levels ?? [],
    yesBids: q.yes_bid_levels ?? [],
    noBids: q.no_bid_levels ?? [],
    bestYesBid: q.best_yes_bid,
    bestYesAsk: q.best_yes_ask,
    bestNoBid: q.best_no_bid,
    bestNoAsk: q.best_no_ask,
    mid: q.mid,
    spread: q.spread,
    yesDepthContracts: q.depth_yes_contracts ?? 0,
    noDepthContracts: q.depth_no_contracts ?? 0,
  };
  const feeMultiplier = inst.fee_multiplier ?? 1;
  const fill =
    ord.order_type === 'maker'
      ? simulateEventContractMakerFill({
          book,
          outcome: ord.outcome,
          action: ord.action,
          contracts: ord.contracts,
          restingPrice: ord.limit_price,
          feeMultiplier: 0,
          feePrecision: 2,
        })
      : simulateEventContractFill({
          book,
          outcome: ord.outcome,
          action: ord.action,
          contracts: ord.contracts,
          limitPrice: ord.limit_price,
          feeMultiplier,
          walkBookForTaker,
        });

  if (!fill || !fill.filled) {
    intents.push(intentRecord(ord, runId, 'unfilled', fill?.reason ?? 'no liquidity', { fill }));
    return { executed: false, reason: 'unfilled' };
  }

  const contracts = fill.filled;
  const price = fill.vwap;
  const fee = fill.fee_usd ?? 0;
  const trade = {
    id: tradeId(runId, ord.strategy_id, inst.instrument_id, ord.action, ord.outcome ?? '', String(contracts), String(price), isExitFlag(ord)),
    run_id: runId,
    strategy_id: ord.strategy_id,
    username: ord.username,
    leg: ord.is_exit ? 'close' : 'open',
    is_exit: !!ord.is_exit,
    exit_reason: ord.exit_reason ?? null,
    market_type: 'Kalshi event contract',
    venue: 'Kalshi',
    venue_id: 'kalshi',
    official_source: q.source?.url ?? null,
    exchange: 'Kalshi (CFTC-regulated designated contract market)',
    ticker: inst.ticker,
    series_ticker: inst.series_ticker,
    instrument_title: inst.title,
    contract_specification: {
      notional_value_dollars: inst.notional_value_dollars ?? 1,
      price_level_structure: inst.price_level_structure ?? null,
      fee_type: inst.fee_type ?? null,
      fee_multiplier: feeMultiplier,
      contract_terms_url: inst.contract_terms_url ?? null,
      settlement_source: inst.settlement_source ?? null,
      rules_primary: inst.rules_primary ? String(inst.rules_primary).slice(0, 400) : null,
    },
    market_dates: {
      open_time: inst.open_time ?? null,
      close_time: inst.close_time ?? null,
      expiration_time: inst.expiration_time ?? null,
      expected_expiration_time: inst.expected_expiration_time ?? null,
    },
    action: ord.action,
    outcome: ord.outcome,
    contracts,
    requested_contracts: ord.contracts,
    unfilled_contracts: fill.unfilled ?? 0,
    fill: {
      order_type: ord.order_type ?? 'taker',
      vwap_price: price,
      best_price: fill.bestPrice,
      worst_price: fill.worstPrice,
      levels: fill.levels,
      notional_usd: fill.notional_usd,
      limit_price: ord.limit_price ?? null,
    },
    market_at_decision: {
      best_yes_bid: q.best_yes_bid,
      best_yes_ask: q.best_yes_ask,
      best_no_bid: q.best_no_bid,
      best_no_ask: q.best_no_ask,
      mid: q.mid,
      spread: q.spread,
      depth_yes_contracts: q.depth_yes_contracts,
      depth_no_contracts: q.depth_no_contracts,
    },
    slippage: {
      reference_price: fill.reference_price ?? null,
      reference_note: fill.reference_note ?? null,
      per_contract_usd: fill.slippage_per_contract_usd ?? null,
      total_usd: fill.slippage_usd ?? null,
    },
    fees: {
      fee_usd: fee,
      model: fill.fee_model ?? null,
      schedule: KC.fee_schedule_url ?? null,
    },
    liquidity_consumed: {
      contracts,
      available_within_1_cent: availableWithin(fill.levels),
      note: 'Liquidity taken is the sum of order-book levels actually consumed by this simulated fill.',
    },
    thesis: ord.thesis,
    signal: ord.signal ?? null,
    provenance: {
      source_name: 'Kalshi public Trade API v2',
      source_url: q.source?.url ?? null,
      endpoint: q.source?.endpoint ?? null,
      retrieved_at: q.source?.retrieved_at ?? null,
      http_status: q.source?.http_status ?? null,
      response_sha256: q.source?.sha256 ?? null,
      listing_endpoint: inst.listing_provenance?.endpoint ?? null,
      listing_retrieved_at: inst.listing_provenance?.retrieved_at ?? null,
      listing_sha256: inst.listing_provenance?.sha256 ?? null,
      verification_timestamp: nowIso(),
      note: q.source?.note ?? null,
    },
    created_at: nowIso(),
  };

  if (!ord.is_exit) {
    const cost = contracts * price;
    trade.pnl = { realized_pnl_usd: null, status: 'open_position_cost_recorded' };
    applyEventContractOpen(portfolio, { feeUsd: fee, costUsd: cost });
    upsertPosition(portfolio, inst.instrument_id, {
      strategy_id: ord.strategy_id,
      kind: 'event_contract',
      venue: 'kalshi',
      outcome: ord.outcome,
      contracts,
      avg_entry_price: price,
      entry_fee_usd: fee,
      entry_trade_id: trade.id,
      entry_at: nowIso(),
      entry_thesis: ord.thesis,
      expiration_time: inst.expiration_time ?? inst.close_time ?? null,
      entry_slippage_usd: fill.slippage_usd ?? null,
    });
  } else {
    const pos = existing;
    const proceeds = contracts * price;
    const realized = (price - pos.avg_entry_price) * contracts - (fee + (pos.entry_fee_usd ?? 0));
    trade.pnl = {
      entry_price: pos.avg_entry_price,
      exit_price: price,
      realized_pnl_usd: Number(realized.toFixed(6)),
      entry_fee_usd: pos.entry_fee_usd ?? 0,
      exit_fee_usd: fee,
      status: 'closed',
    };
    applyEventContractClose(portfolio, { proceedsUsd: proceeds, feeUsd: fee, realizedPnlUsd: realized });
    delete portfolio.positions[inst.instrument_id];
    trade.linked_entry_trade_id = pos.entry_trade_id ?? null;
  }

  newTrades.push(trade);
  return { executed: true, contracts, price, fee, action: ord.action, outcome: ord.outcome, is_exit: !!ord.is_exit };
}

function executePerpOrder({ ord, inst, q, portfolio, runId, newTrades, intents, existing }) {
  const price = ord.action === 'buy' ? q.offer : q.bid;
  if (price == null) {
    intents.push(intentRecord(ord, runId, 'no_quote', 'Perp bid/offer missing in the official payload.'));
    return { executed: false, reason: 'no_quote' };
  }
  const fill = simulateFuturesFill({
    action: ord.action,
    contracts: ord.contracts,
    bid: q.bid,
    offer: q.offer,
    lotVolume: q.contract_size ?? 1,
    feePerContract: null,
    feeCurrency: 'USD',
  });
  const trade = {
    id: tradeId(runId, ord.strategy_id, inst.instrument_id, ord.action, 'perp', String(ord.contracts), String(price), isExitFlag(ord)),
    run_id: runId,
    strategy_id: ord.strategy_id,
    username: ord.username,
    leg: ord.is_exit ? 'close' : 'open',
    is_exit: !!ord.is_exit,
    exit_reason: ord.exit_reason ?? null,
    market_type: 'Kalshi perpetual future',
    venue: 'Kalshi Perps (margin)',
    venue_id: 'kalshi_margin',
    official_source: q.source?.url ?? null,
    exchange: 'Kalshi (official Perps API; CFTC-regulated)',
    ticker: inst.ticker,
    instrument_title: inst.ticker,
    contract_specification: {
      contract_size: q.contract_size ?? inst.contract_size ?? null,
      leverage_estimate: inst.leverage_estimate ?? null,
      asset_class: inst.asset_class ?? null,
      funding_rate: inst.funding_rate ?? null,
    },
    market_dates: { retrieved_at: q.source?.retrieved_at ?? null },
    action: ord.action,
    side: ord.side,
    contracts: ord.contracts,
    fill: {
      order_type: 'taker',
      vwap_price: price,
      levels: fill.levels,
      reference_price: fill.reference_price,
      slippage_per_contract: fill.slippage_per_contract,
    },
    slippage: { reference_price: fill.reference_price, per_contract: fill.slippage_per_contract, total_quote_ccy: fill.slippage_cost_quote_ccy },
    fees: {
      fee_usd: null,
      model: 'Perp fee schedule not retrieved from an official source in this project; recorded as null rather than assumed zero.',
      status: 'not_applied_fee_schedule_unverified',
    },
    liquidity_consumed: { contracts: ord.contracts, note: 'Perp depth is not published per level in the official payload; best bid/offer used with the exchange-reported size fields where present.' },
    thesis: ord.thesis,
    signal: ord.signal ?? null,
    provenance: {
      source_name: 'Kalshi Perps API (margin namespace)',
      source_url: q.source?.url ?? null,
      endpoint: q.source?.endpoint ?? null,
      retrieved_at: q.source?.retrieved_at ?? null,
      http_status: q.source?.http_status ?? null,
      response_sha256: q.source?.sha256 ?? null,
      verification_timestamp: nowIso(),
      note: q.source?.note ?? null,
    },
    created_at: nowIso(),
  };

  if (!ord.is_exit) {
    upsertPosition(portfolio, inst.instrument_id, {
      strategy_id: ord.strategy_id,
      kind: 'perpetual',
      venue: 'kalshi_margin',
      side: ord.side,
      contracts: ord.contracts,
      avg_entry_price: price,
      contract_size: q.contract_size ?? 1,
      entry_trade_id: trade.id,
      entry_at: nowIso(),
      entry_thesis: ord.thesis,
    });
    trade.pnl = { realized_pnl_usd: null, status: 'open_position_cost_recorded' };
  } else if (existing) {
    const sign = existing.side === 'long' ? 1 : -1;
    const pnl = (price - existing.avg_entry_price) * existing.contracts * (existing.contract_size ?? 1) * sign;
    trade.pnl = { entry_price: existing.avg_entry_price, exit_price: price, realized_pnl_usd: Number(pnl.toFixed(6)), status: 'closed' };
    portfolio.realized_pnl_usd = Number((portfolio.realized_pnl_usd + pnl).toFixed(6));
    portfolio.cash_usd = Number((portfolio.cash_usd + pnl).toFixed(6));
    portfolio.closed_trade_count += 1;
    delete portfolio.positions[inst.instrument_id];
    trade.linked_entry_trade_id = existing.entry_trade_id ?? null;
  }
  newTrades.push(trade);
  return { executed: true, contracts: ord.contracts, price, action: ord.action };
}

function executeFutureOrder({ ord, inst, q, portfolio, runId, newTrades, intents, existing, ctx }) {
  const price = ord.action === 'buy' ? q.offer : q.bid;
  if (price == null) {
    intents.push(intentRecord(ord, runId, 'no_quote', 'Exchange bid/offer missing in the official payload.'));
    return { executed: false, reason: 'no_quote' };
  }
  if (!inst.pnl_currency_ready) {
    intents.push(
      intentRecord(ord, runId, 'fx_conversion_required', `Contract face currency ${inst.faceunit ?? 'unknown'} requires an official FX conversion before USD PnL can be computed.`),
    );
    return { executed: false, reason: 'fx_conversion_required' };
  }
  const feePerContractRub = inst.fees_reported?.buy_sell_fee_rub ?? null;
  const usdRub = ctx.fx?.rate ?? null;
  const feePerContractUsd = feePerContractRub != null && usdRub ? Number((feePerContractRub / usdRub).toFixed(6)) : null;
  const fill = simulateFuturesFill({
    action: ord.action,
    contracts: ord.contracts,
    bid: q.bid,
    offer: q.offer,
    lotVolume: inst.lot_volume ?? 1,
    feePerContract: feePerContractUsd,
    feeCurrency: 'USD',
    tickSize: inst.min_step,
  });
  const trade = {
    id: tradeId(runId, ord.strategy_id, inst.instrument_id, ord.action, ord.side ?? '', String(ord.contracts), String(price), isExitFlag(ord)),
    run_id: runId,
    strategy_id: ord.strategy_id,
    username: ord.username,
    leg: ord.is_exit ? 'close' : 'open',
    is_exit: !!ord.is_exit,
    exit_reason: ord.exit_reason ?? null,
    market_type: 'Exchange-listed commodity future',
    venue: 'Moscow Exchange (MOEX) FORTS',
    venue_id: 'moex_forts',
    official_source: q.source?.url ?? null,
    exchange: 'Moscow Exchange (MOEX), FORTS derivatives market',
    ticker: inst.ticker,
    instrument_title: inst.title,
    contract_specification: {
      asset_code: inst.asset_code,
      lot_volume: inst.lot_volume,
      min_step: inst.min_step,
      faceunit: inst.faceunit,
      last_trade_date: inst.last_trade_date,
      initial_margin_rub: inst.fees_reported?.initial_margin_rub ?? null,
      buy_sell_fee_rub: feePerContractRub,
      step_price_rub: inst.fees_reported?.step_price_rub ?? null,
    },
    market_dates: { last_trade_date: inst.last_trade_date, trade_date: q.trade_date },
    action: ord.action,
    side: ord.side,
    contracts: ord.contracts,
    fill: {
      order_type: 'taker',
      vwap_price: price,
      levels: fill.levels,
      reference_price: fill.reference_price,
      units: fill.units,
      tick_size: fill.tick_size,
    },
    slippage: {
      reference_price: fill.reference_price,
      per_unit: fill.slippage_per_contract,
      total_quote_ccy: fill.slippage_cost_quote_ccy,
      note: 'Reference is the official bid/ask midpoint published in the same MOEX ISS payload.',
    },
    fees: {
      fee_usd: fill.fee_total_quote_ccy,
      fee_rub: feePerContractRub == null ? null : Number((feePerContractRub * ord.contracts).toFixed(2)),
      fx_rate_used: usdRub,
      fx_source: ctx.fx?.source ?? null,
      model: fill.fee_model,
      status: feePerContractUsd == null ? 'fee_recorded_in_rub_only_missing_fx' : 'applied',
    },
    liquidity_consumed: {
      contracts: ord.contracts,
      volume_today: q.volume_today,
      open_interest: q.open_interest,
      note: 'MOEX ISS publishes best bid/offer and aggregate volume/open interest (no per-level depth), so a per-level book walk is not possible; the trade records the aggregate liquidity that existed and the exact execution price.',
    },
    thesis: ord.thesis,
    signal: ord.signal ?? null,
    provenance: {
      source_name: 'MOEX ISS official market data',
      source_url: q.source?.url ?? null,
      endpoint: q.source?.endpoint ?? null,
      retrieved_at: q.source?.retrieved_at ?? null,
      http_status: q.source?.http_status ?? null,
      response_sha256: q.source?.sha256 ?? null,
      listing_endpoint: inst.listing_provenance?.endpoint ?? null,
      listing_retrieved_at: inst.listing_provenance?.retrieved_at ?? null,
      listing_sha256: inst.listing_provenance?.sha256 ?? null,
      verification_timestamp: nowIso(),
      note: q.source?.note ?? null,
    },
    created_at: nowIso(),
  };

  if (!ord.is_exit) {
    upsertPosition(portfolio, inst.instrument_id, {
      strategy_id: ord.strategy_id,
      kind: 'future',
      venue: 'moex_forts',
      side: ord.side,
      contracts: ord.contracts,
      avg_entry_price: price,
      lot_volume: inst.lot_volume ?? 1,
      entry_fee_usd: fill.fee_total_quote_ccy ?? 0,
      entry_trade_id: trade.id,
      entry_at: nowIso(),
      entry_thesis: ord.thesis,
      last_trade_date: inst.last_trade_date,
    });
    trade.pnl = { realized_pnl_usd: null, status: 'open_position_cost_recorded' };
  } else if (existing) {
    const sign = existing.side === 'long' ? 1 : -1;
    const gross = (price - existing.avg_entry_price) * existing.contracts * (existing.lot_volume ?? 1) * sign;
    const fees = (fill.fee_total_quote_ccy ?? 0) + (existing.entry_fee_usd ?? 0);
    const pnl = gross - fees;
    trade.pnl = {
      entry_price: existing.avg_entry_price,
      exit_price: price,
      gross_pnl_usd: Number(gross.toFixed(6)),
      fees_usd: Number(fees.toFixed(6)),
      realized_pnl_usd: Number(pnl.toFixed(6)),
      status: 'closed',
    };
    portfolio.realized_pnl_usd = Number((portfolio.realized_pnl_usd + pnl).toFixed(6));
    portfolio.cash_usd = Number((portfolio.cash_usd + pnl).toFixed(6));
    portfolio.fees_paid_usd = Number((portfolio.fees_paid_usd + (fill.fee_total_quote_ccy ?? 0)).toFixed(6));
    portfolio.closed_trade_count += 1;
    delete portfolio.positions[inst.instrument_id];
    trade.linked_entry_trade_id = existing.entry_trade_id ?? null;
  }
  newTrades.push(trade);
  return { executed: true, contracts: ord.contracts, price, action: ord.action, side: ord.side };
}

async function settleEventContract({ kalshi, inst, pos, portfolio, runId, strategy, manifests }) {
  let res;
  try {
    res = await kalshi.market(inst.ticker);
  } catch (err) {
    return null;
  }
  manifests.push(res.provenance);
  const m = res.json?.market;
  if (!m || (m.status !== 'settled' && m.status !== 'finalized')) return null;
  const result = m.result; // 'yes' | 'no' | ''
  if (result !== 'yes' && result !== 'no') return null;
  const payout = pos.outcome === result ? pos.contracts * 1 : 0;
  const cost = pos.contracts * pos.avg_entry_price + (pos.entry_fee_usd ?? 0);
  const pnl = payout - cost;
  applyEventContractClose(portfolio, { proceedsUsd: payout, feeUsd: 0, realizedPnlUsd: pnl });
  const trade = {
    id: tradeId(runId, strategy.id, inst.instrument_id, 'settlement', result, String(pos.contracts)),
    run_id: runId,
    strategy_id: strategy.id,
    username: strategy.username,
    leg: 'close',
    is_exit: true,
    exit_reason: 'settlement',
    market_type: 'Kalshi event contract',
    venue: 'Kalshi',
    venue_id: 'kalshi',
    official_source: res.provenance.url,
    exchange: 'Kalshi (CFTC-regulated designated contract market)',
    ticker: inst.ticker,
    series_ticker: inst.series_ticker,
    instrument_title: inst.title,
    contract_specification: { notional_value_dollars: inst.notional_value_dollars ?? 1, contract_terms_url: inst.contract_terms_url ?? null },
    market_dates: { expiration_time: inst.expiration_time ?? null, settled_at: m.settlement_ts ?? null },
    action: 'settle',
    outcome: pos.outcome,
    contracts: pos.contracts,
    fill: { order_type: 'settlement', vwap_price: payout / pos.contracts, levels: [], notional_usd: payout },
    market_at_decision: { result, settlement_value: m.expiration_value ?? null },
    slippage: { reference_price: null, note: 'Settlement is a cash payout at $1 or $0 per contract; slippage does not apply.' },
    fees: { fee_usd: 0, model: 'Kalshi charges no settlement fee (official fee schedule).', schedule: KC.fee_schedule_url ?? null },
    liquidity_consumed: { contracts: pos.contracts, note: 'Settled against the exchange settlement value; no order book interaction.' },
    thesis: `Position held to settlement; market resolved ${result.toUpperCase()}.`,
    signal: null,
    pnl: {
      entry_price: pos.avg_entry_price,
      exit_price: payout / pos.contracts,
      realized_pnl_usd: Number(pnl.toFixed(6)),
      entry_fee_usd: pos.entry_fee_usd ?? 0,
      settlement_result: result,
      status: 'closed',
    },
    provenance: {
      source_name: 'Kalshi public Trade API v2 (market settlement record)',
      source_url: res.provenance.url,
      retrieved_at: res.provenance.retrieved_at,
      http_status: res.provenance.http_status,
      response_sha256: res.provenance.sha256,
      verification_timestamp: nowIso(),
      note: 'Settlement result and expiration value read directly from the exchange market record.',
    },
    linked_entry_trade_id: pos.entry_trade_id ?? null,
    created_at: nowIso(),
  };
  return {
    strategy_id: strategy.id,
    instrument_id: inst.instrument_id,
    ticker: inst.ticker,
    result,
    payout_usd: payout,
    realized_pnl_usd: Number(pnl.toFixed(6)),
    closing_trade: trade,
  };
}

function availableWithin(levels = []) {
  if (!levels?.length) return 0;
  const best = levels[0].price;
  return levels.filter((l) => Math.abs(l.price - best) <= 0.01).reduce((s, l) => s + l.contracts, 0);
}

function intentRecord(ord, runId, reason, detail) {
  return {
    id: tradeId('intent', runId, ord.strategy_id, ord.instrument_id, ord.action, ord.outcome ?? ord.side ?? '', reason),
    run_id: runId,
    strategy_id: ord.strategy_id,
    username: ord.username,
    instrument_id: ord.instrument_id,
    venue: ord.venue,
    market_type_label: ord.market_type_label ?? null,
    action: ord.action,
    outcome: ord.outcome ?? null,
    side: ord.side ?? null,
    contracts: ord.contracts,
    limit_price: ord.limit_price ?? null,
    order_type: ord.order_type ?? 'taker',
    thesis: ord.thesis,
    signal: ord.signal ?? null,
    status: 'not_executed',
    reason,
    detail,
    created_at: nowIso(),
  };
}

function isExitFlag(ord) {
  return ord.is_exit ? 'exit' : 'entry';
}

/** Official USD/RUB reference for converting MOEX fees: use the exchange's own FX market. */
async function collectUsdRub(notes) {
  const url = 'https://iss.moex.com/iss/engines/currency/markets/selt/securities/USD000UTSTOM.json?iss.meta=off&iss.only=marketdata,securities';
  const res = await fetchJson(url, { note: 'MOEX ISS USD/RUB spot (official exchange data, used only to convert published fees)' });
  if (!res.ok) {
    notes.push({ endpoint: url, error: 'USD/RUB unavailable', provenance: res.provenance });
    return { rate: null, source: url, status: 'unavailable', provenance: res.provenance };
  }
  const md = res.json?.marketdata;
  const cols = md?.columns ?? [];
  const row = md?.data?.[0] ?? [];
  const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
  const rate = Number(obj.LAST ?? obj.MARKETPRICE ?? NaN);
  return {
    rate: Number.isFinite(rate) ? rate : null,
    last_trade_time: obj.TIME ?? null,
    trade_date: obj.TRADEDATE ?? null,
    source: url,
    status: Number.isFinite(rate) ? 'ok' : 'no_price_in_payload',
    provenance: res.provenance,
  };
}

/** Official Kalshi candle history per series (cached for historyRefreshHours). */
async function refreshKalshiHistory(kalshi, seriesList, manifests, degraded) {
  const out = {};
  const cacheHours = KC.history_refresh_hours ?? 12;
  const maxSeries = KC.max_candle_series ?? 30;
  let refreshed = 0;
  for (const s of seriesList.slice(0, maxSeries)) {
    const file = `${paths.history}/kalshi/${s.ticker}.json`;
    const cached = readJson(file, null);
    if (cached?.retrieved_at && (Date.now() - new Date(cached.retrieved_at)) / 3600000 < cacheHours) {
      out[s.ticker] = cached.candles ?? [];
      continue;
    }
    try {
      let marketTicker = null;
      let source = null;
      // Prefer the most recently settled market in the series: it carries real history.
      try {
        const settled = await kalshi.markets({ status: 'settled', seriesTicker: s.ticker, limit: 1 });
        manifests.push(settled.provenance);
        marketTicker = settled.json?.markets?.[0]?.ticker ?? null;
        source = settled.provenance;
      } catch (err) {
        degraded.push({ series: s.ticker, step: 'settled_market_lookup', error: String(err.message ?? err) });
      }
      if (!marketTicker) {
        const open = await kalshi.markets({ status: 'open', seriesTicker: s.ticker, limit: 1 });
        manifests.push(open.provenance);
        marketTicker = open.json?.markets?.[0]?.ticker ?? null;
        source = open.provenance;
      }
      if (!marketTicker) continue;
      const endTs = Math.floor(Date.now() / 1000);
      const startTs = endTs - 60 * 86400;
      let candles = null;
      let candleProv = null;
      try {
        const live = await kalshi.candlesticks(s.ticker, marketTicker, { startTs, endTs, periodInterval: 1440 });
        candles = live.json?.candlesticks ?? null;
        candleProv = live.provenance;
      } catch (err) {
        // fall through to the historical endpoint
      }
      if (!candles?.length) {
        const hist = await kalshi.historicalCandlesticks(marketTicker, { startTs, endTs, periodInterval: 1440 });
        candles = hist.json?.candlesticks ?? [];
        candleProv = hist.provenance;
      }
      manifests.push(candleProv);
      const normalised = (candles ?? []).map((c) => ({
        end_period_ts: c.end_period_ts,
        yes_bid_open: c.yes_bid?.open_dollars != null ? Number(c.yes_bid.open_dollars) : null,
        yes_bid_close: c.yes_bid?.close_dollars != null ? Number(c.yes_bid.close_dollars) : null,
        yes_ask_close: c.yes_ask?.close_dollars != null ? Number(c.yes_ask.close_dollars) : null,
        price_close: c.price?.close_dollars != null ? Number(c.price.close_dollars) : null,
        volume: c.volume_fp != null ? Number(c.volume_fp) : null,
        open_interest: c.open_interest_fp != null ? Number(c.open_interest_fp) : null,
      }));
      out[s.ticker] = normalised;
      writeJsonIfChanged(file, {
        series_ticker: s.ticker,
        market_ticker_used: marketTicker,
        retrieved_at: candleProv?.retrieved_at ?? nowIso(),
        source: {
          endpoint: candleProv?.url ?? null,
          http_status: candleProv?.http_status ?? null,
          sha256: candleProv?.sha256 ?? null,
          note: 'Official Kalshi candlestick history (yes bid/ask OHLC, traded price OHLC, volume, open interest).',
        },
        candles: normalised,
      });
      refreshed += 1;
    } catch (err) {
      degraded.push({ series: s.ticker, step: 'candles', error: String(err.message ?? err) });
    }
  }
  console.log(`   kalshi candle history: ${Object.keys(out).length} series available (${refreshed} refreshed)`);
  return out;
}

/** Official MOEX daily settlement history per contract (cached for historyRefreshHours). */
async function refreshMoexHistory(instruments, manifests, degraded) {
  const out = {};
  const cacheHours = KC.history_refresh_hours ?? 12;
  for (const inst of instruments) {
    const file = `${paths.history}/moex/${inst.ticker}.json`;
    const cached = readJson(file, null);
    if (cached?.retrieved_at && (Date.now() - new Date(cached.retrieved_at)) / 3600000 < cacheHours) {
      out[inst.ticker] = cached.rows ?? [];
      continue;
    }
    const from = isoDate(daysAgo(120));
    const hist = await moexHistorySafe(inst.ticker, from);
    if (hist.provenance) manifests.push(hist.provenance);
    if (!hist.rows?.length) {
      degraded.push({ contract: inst.ticker, step: 'moex_history', error: 'no rows returned' });
      out[inst.ticker] = [];
      continue;
    }
    out[inst.ticker] = hist.rows;
    writeJsonIfChanged(file, {
      secid: inst.ticker,
      retrieved_at: hist.provenance?.retrieved_at ?? nowIso(),
      source: {
        endpoint: hist.provenance?.url ?? null,
        http_status: hist.provenance?.http_status ?? null,
        sha256: hist.provenance?.sha256 ?? null,
        note: 'Official MOEX ISS daily settlement history (OPEN/LOW/HIGH/CLOSE/SETTLEPRICE/VOLUME/OPENPOSITION/NUMTRADES).',
      },
      rows: hist.rows,
    });
  }
  return out;
}

async function moexHistorySafe(secid, from) {
  const res = await moexHistory(secid, { from });
  return res.ok ? { rows: res.rows, provenance: res.provenance } : { rows: [], provenance: res.provenance };
}

function appendDailyHistory({ quotes, instrumentById }) {
  const day = isoDate();
  const lines = [];
  for (const [id, q] of Object.entries(quotes)) {
    const inst = instrumentById[id];
    lines.push(
      JSON.stringify({
        d: day,
        id,
        v: inst?.venue ?? null,
        yb: q.best_yes_bid ?? null,
        ya: q.best_yes_ask ?? null,
        b: q.bid ?? null,
        o: q.offer ?? null,
        m: q.mid ?? null,
        s: q.spread ?? null,
        vol: q.volume_today ?? null,
        oi: q.open_interest ?? null,
        src: q.source?.sha256 ?? null,
      }),
    );
  }
  if (!lines.length) return;
  const file = `${paths.history}/quotes-${day}.jsonl`;
  const existing = new Set(readJsonl(file).map((r) => `${r.d}|${r.id}`));
  const fresh = lines.filter((l) => {
    const parsed = JSON.parse(l);
    return !existing.has(`${parsed.d}|${parsed.id}`);
  });
  if (fresh.length) {
    ensureDir(paths.history);
    appendFileSync(file, `${fresh.join('\n')}\n`);
  }
}

function buildVenueCatalog(sourcesConfig, { exchangeStatus, fx, benchmarks }) {
  const catalog = sourcesConfig?.venues ?? [];
  return catalog.map((v) => {
    const out = { ...v };
    if (v.id === 'kalshi') {
      out.exchange_status = exchangeStatus
        ? {
            exchange_active: exchangeStatus.exchange_active,
            trading_active: exchangeStatus.trading_active,
            indices: exchangeStatus.exchange_index_statuses?.length ?? 0,
          }
        : null;
    }
    if (v.id === 'moex_forts') out.usd_rub_reference = fx ? { rate: fx.rate, trade_date: fx.trade_date, source: fx.source, status: fx.status } : null;
    if (v.id === 'eia') out.benchmark_status = Object.fromEntries(Object.entries(benchmarks ?? {}).map(([k, val]) => [k, val?.status ?? 'missing']));
    return out;
  });
}

main().catch((err) => {
  console.error('tick failed:', err);
  process.exit(1);
});
