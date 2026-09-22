#!/usr/bin/env node
/**
 * Research backtests over committed OFFICIAL price history only.
 *
 * What this deliberately is:
 *   - a re-run of documented strategy rules against price histories the engine already fetched
 *     from the exchanges' own APIs (Kalshi candlesticks, MOEX ISS daily history) and committed
 *     under data/history/ with each file's endpoint, HTTP status, SHA-256 and retrieval time;
 *   - every simulated fill is at a published daily price (candle close / official CLOSE or
 *     settlement), and every trade row carries the date and both prices so a human can check it
 *     against the cited payload.
 *
 * What this deliberately is NOT:
 *   - not a liquidity simulation. Historical order books are not published by any venue used
 *     here, so there is no depth, no slippage and no participation cap in a backtest. The
 *     forward-tested competition ledger is where liquidity exists;
 *   - not part of the scored season. Backtest results never touch data/ledger.
 *
 * Usage: node engine/backtest.mjs [--offline]
 */

import { readdirSync } from 'node:fs';
import { nowIso } from './lib/http.mjs';
import { kalshiTakerFee } from './lib/portfolio.mjs';
import { classifySeries } from './lib/universe.mjs';
import { readJson, writeJson } from './lib/store.mjs';

const caveats = [
  'Fills are at published daily prices (official candle close / exchange CLOSE or settlement), not at order-book prices: no venue used here publishes historical order books.',
  'No depth, no slippage, no participation cap and no queue position exist in a backtest. Liquidity is only observable live, which is what the forward-tested competition ledger is for.',
  'Kalshi fees use the official taker formula at multiplier 1 (the per-series multiplier is not part of the candle payload; where a series has a non-1 multiplier the backtest slightly overstates fees, which is the conservative direction).',
  'MOEX fees use the exchange-published per-contract BUYSELLFEE in RUB, converted at the official USD/RUB rate recorded in the latest competition snapshot; intra-period FX variation is not modelled (fee effect < 0.1% of notional).',
  'A backtest measures rule expectancy on official price history. It is never a track record and never a season trade.',
];

function stdev(values) {
  if (!values || values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function summarise(trades) {
  const wins = trades.filter((t) => t.pnl_usd > 0);
  const losses = trades.filter((t) => t.pnl_usd <= 0);
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    equity += t.pnl_usd;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const total = trades.reduce((a, t) => a + t.pnl_usd, 0);
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: trades.length ? Number((wins.length / trades.length).toFixed(4)) : null,
    total_pnl_usd: Number(total.toFixed(4)),
    avg_trade_pnl_usd: trades.length ? Number((total / trades.length).toFixed(4)) : null,
    max_drawdown_usd: Number(maxDrawdown.toFixed(4)),
    return_on_10000_usd_pct: Number(((total / 10000) * 100).toFixed(4)),
    fees_paid_usd: Number(trades.reduce((a, t) => a + (t.fees_usd ?? 0), 0).toFixed(4)),
  };
}

/* ------------------------------------------------------------ Kalshi backtests */

function kalshiCandleFiles(rules) {
  const out = [];
  let dir;
  try {
    dir = readdirSync('data/history/kalshi').filter((f) => f.endsWith('.json'));
  } catch {
    return out;
  }
  for (const file of dir) {
    const parsed = readJson(`data/history/kalshi/${file}`, null);
    if (!parsed || !Array.isArray(parsed.candles) || !parsed.candles.length) continue;
    const classification = classifySeries({ ticker: parsed.series_ticker, title: parsed.series_ticker }, rules);
    out.push({ ...parsed, file: `data/history/kalshi/${file}`, commodity: classification.commodity, group: classification.group });
  }
  return out;
}

/**
 * Shared Kalshi daily-close backtest. entryAt/exitAt map a candle to {enter, exit} prices for a
 * YES-leg; a NO leg is the complement. Fills happen at the published close of day i-1 and unwind
 * at the published close of day i.
 */
function backtestKalshiDaily(files, { id, name, entryRule, legFor, minRows, energyOnly = false, softOnly = false }) {
  const perSeries = [];
  const trades = [];
  for (const f of files) {
    if (energyOnly && f.group !== 'Energy') continue;
    if (softOnly && f.group !== 'Soft Commodities') continue;
    if (!f.commodity) continue;
    const candles = f.candles
      .filter((c) => c && c.close != null && c.close > 0 && c.close < 1)
      .map((c) => ({ end: c.end_period_ts, close: c.close, bid: c.yes_bid_close, ask: c.yes_ask_close }));
    if (candles.length < minRows) {
      perSeries.push({ series_ticker: f.series_ticker, commodity: f.commodity, rows: candles.length, status: 'skipped_insufficient_official_history' });
      continue;
    }
    const source = { series_ticker: f.series_ticker, commodity: f.commodity, endpoint: f.endpoint, http_status: f.http_status, sha256: f.sha256, retrieved_at: f.retrieved_at, candles_used: candles.length };
    let seriesTrades = 0;
    for (let i = 1; i < candles.length; i += 1) {
      const prev = candles[i - 1];
      const cur = candles[i];
      const leg = legFor(prev, candles);
      if (!leg) continue;
      // buy the chosen outcome at its published ask at day i-1 close; sell at its published bid at day i close
      const entry = leg === 'yes' ? prev.ask : prev.bid != null ? Number((1 - prev.bid).toFixed(6)) : null;
      const exit = leg === 'yes' ? cur.bid : cur.ask != null ? Number((1 - cur.ask).toFixed(6)) : null;
      if (entry == null || exit == null) continue;
      const contracts = Math.floor(100 / Math.max(entry, 0.01)); // fixed ~$100 notional per trade
      if (contracts < 1) continue;
      const entryFee = kalshiTakerFee({ contracts, price: entry, multiplier: 1, precision: 2 });
      const exitFee = kalshiTakerFee({ contracts, price: exit, multiplier: 1, precision: 2 });
      const pnl = Number(((exit - entry) * contracts - entryFee - exitFee).toFixed(4));
      trades.push({
        backtest: id,
        series_ticker: f.series_ticker,
        commodity: f.commodity,
        entry_date: new Date(prev.end * 1000).toISOString().slice(0, 10),
        exit_date: new Date(cur.end * 1000).toISOString().slice(0, 10),
        outcome_bought: leg,
        entry_price: entry,
        exit_price: exit,
        contracts,
        entry_rule_inputs: entryRule(prev),
        fees_usd: Number((entryFee + exitFee).toFixed(4)),
        pnl_usd: pnl,
      });
      seriesTrades += 1;
    }
    perSeries.push({ ...source, status: seriesTrades ? 'backtested' : 'no_signal_in_history' });
  }
  return {
    id,
    name,
    market_type: 'Kalshi event contract (daily candle closes)',
    classification: 'backtest_on_official_daily_prices',
    rules: entryRule.toString(),
    series: perSeries,
    stats: summarise(trades),
    trades_sample: trades.slice(-120),
    total_trades_recorded: trades.length,
  };
}

/* ------------------------------------------------------------ MOEX backtests */

function moexHistoryFiles() {
  const out = [];
  let dir;
  try {
    dir = readdirSync('data/history/moex').filter((f) => f.endsWith('.json'));
  } catch {
    return out;
  }
  for (const file of dir) {
    const parsed = readJson(`data/history/moex/${file}`, null);
    if (!parsed || !Array.isArray(parsed.rows) || !parsed.rows.length) continue;
    out.push({ ...parsed, file: `data/history/moex/${file}` });
  }
  return out;
}

function backtestMoex(files, universeInstruments, fxRate, { id, name, assetGroups, legFor, minRows }) {
  const universeByTicker = new Map((universeInstruments ?? []).filter((i) => i.venue === 'moex_forts').map((i) => [i.ticker, i]));
  const trades = [];
  const perContract = [];
  for (const f of files) {
    const ticker = (f.instrument_id ?? '').replace('moex:', '');
    const inst = universeByTicker.get(ticker) ?? null;
    // A contract is only backtested when its commodity group is known from the verified universe.
    // An unknown group (contract no longer listed) is skipped and reported, never guessed.
    const group = inst?.group ?? null;
    if (!group || !assetGroups.includes(group)) {
      perContract.push({ ticker, status: 'skipped_group_not_in_verified_universe', group });
      continue;
    }
    const rows = f.rows
      .map((r) => ({ date: r.TRADEDATE ?? r.SECURITYTRADEDATE ?? null, close: Number(r.CLOSE ?? r.SETTLEPRICE) }))
      .filter((r) => r.close > 0 && r.date);
    if (rows.length < minRows) {
      perContract.push({ ticker, rows: rows.length, status: 'skipped_insufficient_official_history' });
      continue;
    }
    const feeRub = inst?.contract_specification?.buy_sell_fee_rub ?? null;
    // The engine never assumes a fee is zero: without the exchange-published fee the contract is
    // excluded from the backtest rather than shown with understated costs.
    if (feeRub == null || !fxRate) {
      perContract.push({ ticker, commodity: inst?.commodity ?? null, status: 'skipped_exchange_fee_unverified', fee_rub_per_side: feeRub, fx_rate: fxRate ?? null });
      continue;
    }
    const source = { ticker, commodity: inst?.commodity ?? null, endpoint: f.endpoint, http_status: f.http_status, sha256: f.sha256, retrieved_at: f.retrieved_at, rows_used: rows.length };
    let contractTrades = 0;
    const feeUsdPerSide = Number((feeRub / fxRate).toFixed(4));
    for (let i = 1; i < rows.length; i += 1) {
      const leg = legFor(rows.slice(0, i));
      if (!leg) continue;
      const entry = rows[i - 1].close;
      const exit = rows[i].close;
      // 1 lot; PnL per 1.0 of price = the contract's USD value per price unit when known
      const usdPerUnit = inst?.usd_valuation?.usd_per_price_unit ?? null;
      if (usdPerUnit == null) break; // cannot state USD PnL from verified inputs: skip contract
      const feesUsd = feeUsdPerSide != null ? feeUsdPerSide * 2 : 0;
      const pnl = Number(((leg === 'long' ? exit - entry : entry - exit) * usdPerUnit - feesUsd).toFixed(4));
      trades.push({
        backtest: id,
        ticker: source.ticker,
        commodity: source.commodity,
        entry_date: rows[i - 1].date,
        exit_date: rows[i].date,
        direction: leg,
        entry_price: entry,
        exit_price: exit,
        usd_per_price_unit: usdPerUnit,
        fees_usd: Number(feesUsd.toFixed(4)),
        pnl_usd: pnl,
      });
      contractTrades += 1;
    }
    perContract.push({ ...source, fee_rub_per_side: feeRub, status: contractTrades ? 'backtested' : 'no_signal_in_history' });
  }
  return {
    id,
    name,
    market_type: 'Exchange-listed commodity future (daily official CLOSE)',
    classification: 'backtest_on_official_daily_prices',
    series: perContract,
    stats: summarise(trades),
    trades_sample: trades.slice(-120),
    total_trades_recorded: trades.length,
  };
}

/* ------------------------------------------------------------ main */

function main() {
  const watchlist = readJson('config/watchlist.json', { kalshi: { classification_rules: [] } });
  const rules = watchlist.kalshi?.classification_rules ?? [];
  const snapshot = readJson('data/snapshots/latest.json', null);
  const fxRate = snapshot?.fx?.rate ?? null;
  const universe = readJson('data/universe/instruments.json', { instruments: [] });

  const kalshiFiles = kalshiCandleFiles(rules);
  const moexFiles = moexHistoryFiles();

  const backtests = [];
  const unavailable = [];

  // 1. Longshot fade proxy: buy NO when the previous close was <= 0.10.
  backtests.push(
    backtestKalshiDaily(kalshiFiles, {
      id: 'kalshi-longshot-fade-1d',
      name: 'Longshot Fade (daily-close proxy)',
      minRows: 6,
      entryRule: (prev) => ({ rule: 'close <= 0.10 -> buy NO', close: prev.close }),
      legFor: (prev) => (prev.close <= 0.1 ? 'no' : null),
    }),
  );

  // 2. Favourite carry proxy: buy NO when the previous close was >= 0.90.
  backtests.push(
    backtestKalshiDaily(kalshiFiles, {
      id: 'kalshi-favourite-carry-1d',
      name: 'Favourite Carry (daily-close proxy)',
      minRows: 6,
      entryRule: (prev) => ({ rule: 'close >= 0.90 -> buy NO', close: prev.close }),
      legFor: (prev) => (prev.close >= 0.9 ? 'no' : null),
    }),
  );

  // 3. Cheap momentum proxy: buy YES on cheap contracts whose 5-day momentum is up.
  backtests.push(
    backtestKalshiDaily(kalshiFiles, {
      id: 'kalshi-cheap-momentum-1d',
      name: 'Cheap Momentum (daily-close proxy)',
      minRows: 8,
      entryRule: (prev) => ({ rule: 'close <= 0.10 and 5-day momentum > 0 -> buy YES', close: prev.close }),
      legFor: (prev, candles) => {
        const window = candles.slice(-6);
        if (window.length < 6) return null;
        return prev.close <= 0.1 && window[5].close > window[0].close ? 'yes' : null;
      },
    }),
  );

  // 4. Energy trend proxy on Kalshi energy series.
  backtests.push(
    backtestKalshiDaily(kalshiFiles, {
      id: 'kalshi-energy-trend-1d',
      name: 'Energy Trend (daily-close proxy)',
      minRows: 8,
      energyOnly: true,
      entryRule: (prev) => ({ rule: '|5-day momentum| >= 2% -> follow it', close: prev.close }),
      legFor: (prev, candles) => {
        const window = candles.slice(-6);
        if (window.length < 6 || window[0].close <= 0) return null;
        const momentum = (window[5].close - window[0].close) / window[0].close;
        if (Math.abs(momentum) < 0.02) return null;
        return momentum > 0 ? 'yes' : 'no';
      },
    }),
  );

  // 5. MOEX metals trend (10-day settlement momentum, +/-1%).
  backtests.push(
    backtestMoex(moexFiles, universe.instruments, fxRate, {
      id: 'moex-metals-trend-10d',
      name: 'Metals Settlement Trend (daily-close proxy)',
      assetGroups: ['Precious Metals', 'Industrial Metals'],
      minRows: 12,
      legFor: (rows) => {
        const window = rows.slice(-11);
        if (window.length < 11 || window[0].close <= 0) return null;
        const momentum = (window[10].close - window[0].close) / window[0].close;
        if (Math.abs(momentum) < 0.01) return null;
        return momentum > 0 ? 'long' : 'short';
      },
    }),
  );

  // 6. MOEX channel breakout (20/10 Turtle rule) on metals.
  backtests.push(
    backtestMoex(moexFiles, universe.instruments, fxRate, {
      id: 'moex-metal-breakout-20-10',
      name: 'Channel Breakout 20/10 on MOEX metals (daily-close proxy)',
      assetGroups: ['Precious Metals', 'Industrial Metals'],
      minRows: 22,
      legFor: (rows) => {
        if (rows.length < 21) return null;
        const prior = rows.slice(-21, -1).map((r) => r.close);
        const last = rows[rows.length - 1].close;
        if (last >= Math.max(...prior)) return 'long';
        if (last <= Math.min(...prior)) return 'short';
        return null;
      },
    }),
  );

  // Strategies that cannot be backtested at all, with the reason on the record.
  unavailable.push(
    {
      strategy_id: 'kalshi-spread-capture',
      username: '@spread-hunter',
      status: 'unavailable_for_backtesting',
      reason: 'Needs historical order books. No venue used in this project publishes historical depth, so maker fills cannot be reconstructed. Forward-tested in the live competition instead.',
    },
    {
      strategy_id: 'kalshi-ladder-arbitrage',
      username: '@ladder-arb',
      status: 'unavailable_for_backtesting',
      reason: 'Needs simultaneous historical books across several strikes of one series. Only the front market per series is in the candle history, and no historical depth exists. Forward-tested instead.',
    },
    {
      strategy_id: 'cross-venue-basis',
      username: '@basis-hunter',
      status: 'unavailable_for_backtesting',
      reason: 'Needs concurrent historical prices from two venues (Kalshi perp book + MOEX quote). Kalshi candle history covers event-contract series, not the margin/perp books. Forward-tested instead.',
    },
    {
      strategy_id: 'kalshi-jump-reversal',
      username: '@snap-fader',
      status: 'unavailable_for_backtesting',
      reason: 'Needs tick-level snapshot history of the book mid. The engine only stores the most recent snapshots, and no exchange publishes historical intraday books. Forward-tested instead.',
    },
  );

  const out = {
    generated_at: nowIso(),
    engine: 'engine/backtest.mjs',
    classification_legend: {
      backtest_on_official_daily_prices: 'Rule re-run on committed official daily price history; fills at published daily prices; no liquidity model (see caveats).',
      unavailable_for_backtesting: 'No official historical data exists to run the rule on; the strategy is forward-tested in the live competition instead.',
    },
    fx_rate_used_for_moex_fees: fxRate,
    fx_source: snapshot?.fx?.source_url ?? null,
    source_files: {
      kalshi_history: kalshiFiles.map((f) => ({ file: f.file, series_ticker: f.series_ticker, endpoint: f.endpoint, sha256: f.sha256, retrieved_at: f.retrieved_at, candles: (f.candles ?? []).length })),
      moex_history: moexFiles.map((f) => ({ file: f.file, instrument_id: f.instrument_id, endpoint: f.endpoint, sha256: f.sha256, retrieved_at: f.retrieved_at, rows: (f.rows ?? []).length })),
    },
    caveats,
    backtests: backtests.map((b) => ({ ...b, caveats })),
    unavailable,
  };

  writeJson('data/reports/backtests.json', out);
  const totalTrades = backtests.reduce((n, b) => n + b.stats.trades, 0);
  console.log(`backtests: ${backtests.length} rule sets, ${totalTrades} simulated daily-close trades, ${unavailable.length} strategies marked unavailable for backtesting`);
  for (const b of backtests) console.log(`  - ${b.id}: ${b.stats.trades} trades, win rate ${b.stats.win_rate ?? 'n/a'}, total PnL $${b.stats.total_pnl_usd}`);
}

main();
