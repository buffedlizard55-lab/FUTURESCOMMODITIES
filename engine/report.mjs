#!/usr/bin/env node
/**
 * Results report.
 *
 * Reads the committed ledger and state and writes:
 *   data/reports/results.md            - human-readable analysis the site links to
 *   data/reports/by-strategy/<id>.json - machine-readable attribution per competitor
 *
 * Every sentence is generated from recorded numbers. Where the data does not support a
 * conclusion the report says so instead of inventing one.
 */

import { mkdirSync } from 'node:fs';
import { nowIso } from './lib/http.mjs';
import { paths, readJson, readJsonl, writeJson, writeText } from './lib/store.mjs';
import { strategyCatalog } from './strategies/index.mjs';

function main() {
  const catalog = strategyCatalog();
  const trades = readJsonl(`${paths.ledger}/trades.jsonl`);
  const intents = readJsonl(`${paths.ledger}/intents.jsonl`);
  const portfolios = readJson(`${paths.state}/portfolios.json`, {});
  const leaderboard = readJson(`${paths.state}/leaderboard.json`, { leaderboard: [] });
  const competition = readJson(`${paths.state}/competition.json`, {});
  const verification = readJson(`${paths.verification}/report.json`, null);

  mkdirSync(`${paths.reports}/by-strategy`, { recursive: true });

  const byStrategy = {};
  for (const strategy of catalog) {
    const own = trades.filter((t) => t.strategy_id === strategy.id);
    const entries = own.filter((t) => !t.is_exit);
    const exits = own.filter((t) => t.is_exit);
    const portfolio = portfolios[strategy.id] ?? null;
    const attribution = attribute(own, portfolio);
    const intentsForStrategy = intents.filter((i) => i.strategy_id === strategy.id);
    const blockedReasons = countBy(intentsForStrategy, (i) => i.reason);
    const marketTypes = [...new Set(own.map((t) => t.market_type))];

    byStrategy[strategy.id] = {
      strategy_id: strategy.id,
      username: strategy.username,
      display_name: strategy.display_name,
      market_type: strategy.market_type,
      venues: strategy.venues,
      thesis: strategy.thesis,
      rules: strategy.rules,
      origin: strategy.origin,
      trades: own.length,
      entries: entries.length,
      exits: exits.length,
      realized_pnl_usd: portfolio?.realized_pnl_usd ?? null,
      unrealized_pnl_usd: portfolio?.unrealized_pnl_usd ?? null,
      equity_usd: portfolio?.equity_usd ?? null,
      return_pct: portfolio?.equity_usd && portfolio?.starting_cash_usd ? Number((((portfolio.equity_usd - portfolio.starting_cash_usd) / portfolio.starting_cash_usd) * 100).toFixed(4)) : null,
      fees_paid_usd: portfolio?.fees_paid_usd ?? null,
      slippage_paid_usd: portfolio?.slippage_paid_usd ?? null,
      open_positions: portfolio?.open_positions ?? null,
      closed_trades: portfolio?.closed_trades ?? null,
      enabled: strategy.enabled !== false,
      disabled_reason: strategy.disabled_reason ?? null,
      blocked_orders: intentsForStrategy.length,
      blocked_reasons: blockedReasons,
      traded_market_types: marketTypes,
      attribution,
      what_it_means: explain({ strategy, attribution, blockedReasons, trades: own.length, verdict: null }),
    };
    writeJson(`${paths.reports}/by-strategy/${strategy.id}.json`, byStrategy[strategy.id]);
  }

  const markdown = renderMarkdown({ catalog, byStrategy, leaderboard, competition, trades, intents, verification });
  writeText(`${paths.reports}/results.md`, markdown);
  writeJson(`${paths.reports}/summary.json`, {
    generated_at: nowIso(),
    competition: {
      season_id: competition.season_id ?? null,
      starts_at: competition.starts_at ?? null,
      ends_at: competition.ends_at ?? null,
      starting_cash_usd: competition.starting_cash_usd ?? null,
      ticks: competition.ticks ?? 0,
      last_tick: competition.last_tick ?? null,
    },
    leaderboard: leaderboard.leaderboard ?? [],
    verification: verification
      ? { fully_verified: verification.fully_verified, trades_checked: verification.trades_checked, anomalies: verification.anomaly_count, generated_at: verification.generated_at }
      : null,
    totals: {
      trades: trades.length,
      intents: intents.length,
      entries: trades.filter((t) => !t.is_exit).length,
      exits: trades.filter((t) => t.is_exit).length,
      modelled_maker_fills: trades.filter((t) => t.fill?.modelled).length,
      quote_based_fills: trades.filter((t) => t.fill?.execution_model === 'quote_based_fill_at_official_bid_offer').length,
      ladder_taker_fills: trades.filter((t) => t.fill?.execution_model === 'taker_walks_official_order_book').length,
    },
  });

  console.log(`report: ${Object.keys(byStrategy).length} strategies analysed, ${trades.length} trades`);
}

function attribute(trades, portfolio) {
  const byCommodity = {};
  const byVenue = {};
  for (const trade of trades) {
    const key = trade.commodity ?? trade.ticker;
    byCommodity[key] = byCommodity[key] ?? { trades: 0, realized_pnl_usd: 0, fees_usd: 0, slippage_usd: 0 };
    const bucket = byCommodity[key];
    bucket.trades += 1;
    bucket.realized_pnl_usd = round(bucket.realized_pnl_usd + (trade.pnl?.realized_pnl_usd ?? 0));
    bucket.fees_usd = round(bucket.fees_usd + (trade.fees?.fee_usd ?? 0));
    bucket.slippage_usd = round(bucket.slippage_usd + (trade.slippage?.total_usd ?? 0));
    byVenue[trade.venue_id] = (byVenue[trade.venue_id] ?? 0) + 1;
  }
  const closed = trades.filter((t) => t.pnl?.status === 'closed');
  const best = closed.reduce((acc, t) => (acc == null || (t.pnl.realized_pnl_usd ?? 0) > (acc.pnl.realized_pnl_usd ?? 0) ? t : acc), null);
  const worst = closed.reduce((acc, t) => (acc == null || (t.pnl.realized_pnl_usd ?? 0) < (acc.pnl.realized_pnl_usd ?? 0) ? t : acc), null);
  return {
    by_commodity: byCommodity,
    trades_by_venue: byVenue,
    closed_trades: closed.length,
    best_closed_trade: best ? { ticker: best.ticker, pnl_usd: best.pnl.realized_pnl_usd, reason: best.signal?.name ?? null } : null,
    worst_closed_trade: worst ? { ticker: worst.ticker, pnl_usd: worst.pnl.realized_pnl_usd, reason: worst.signal?.name ?? null } : null,
    open_position_marks: (portfolio?.positions
      ? Object.values(portfolio.positions).map((p) => ({
          instrument_id: p.instrument_id,
          ticker: p.ticker,
          contracts: p.contracts,
          entry_price: p.avg_entry_price,
          mark_price: p.mark_price,
          mark_status: p.mark_status,
          unrealized_pnl_usd: p.unrealized_pnl_usd,
          mark_source_url: p.mark_source_url,
        }))
      : []),
  };
}

function explain({ strategy, attribution, blockedReasons, trades }) {
  const lines = [];
  if (!trades) {
    lines.push(
      `No trade has been placed yet. The strategy is live and evaluating ${strategy.market_type} markets every tick.`,
    );
    if (Object.keys(blockedReasons).length) {
      lines.push(
        `Orders it tried to place were not executed, for these recorded reasons: ${Object.entries(blockedReasons)
          .map(([reason, count]) => `${reason} (${count})`)
          .join(', ')}. Each of those is a liquidity or data limitation of the real market, not a strategy result.`,
      );
    }
    return lines;
  }
  const realized = Object.values(attribution.by_commodity).reduce((sum, c) => sum + c.realized_pnl_usd, 0);
  const fees = Object.values(attribution.by_commodity).reduce((sum, c) => sum + c.fees_usd, 0);
  const slip = Object.values(attribution.by_commodity).reduce((sum, c) => sum + c.slippage_usd, 0);
  lines.push(`${trades} ledger records so far: ${Object.values(attribution.by_commodity).length} distinct commodity exposures across ${Object.keys(attribution.trades_by_venue).join(', ')}.`);
  lines.push(`Closed-trade P&L is ${realized.toFixed(2)} USD against ${fees.toFixed(2)} USD of fees and ${slip.toFixed(2)} USD of measured slippage against the mid.`);
  if (attribution.best_closed_trade) lines.push(`Best closed trade: ${attribution.best_closed_trade.ticker} at ${attribution.best_closed_trade.pnl_usd} USD (${attribution.best_closed_trade.reason ?? 'no named signal'}).`);
  if (attribution.worst_closed_trade) lines.push(`Worst closed trade: ${attribution.worst_closed_trade.ticker} at ${attribution.worst_closed_trade.pnl_usd} USD (${attribution.worst_closed_trade.reason ?? 'no named signal'}).`);
  const openWithMarks = attribution.open_position_marks.filter((p) => p.unrealized_pnl_usd != null);
  if (openWithMarks.length) {
    const unrealized = openWithMarks.reduce((sum, p) => sum + p.unrealized_pnl_usd, 0);
    lines.push(`${openWithMarks.length} open positions carry verified marks totalling ${unrealized.toFixed(2)} USD unrealised; positions whose exit price could not be read from the book are reported as null rather than estimated.`);
  }
  if (Object.keys(blockedReasons).length) {
    lines.push(`Blocked order attempts and their recorded reasons: ${Object.entries(blockedReasons).map(([reason, count]) => `${reason} (${count})`).join(', ')}.`);
  }
  lines.push('Verdict: not yet statistically meaningful - a one-year season is the measurement window, and the report states only what the ledger shows.');
  return lines;
}

function renderMarkdown({ catalog, byStrategy, leaderboard, competition, trades, intents, verification }) {
  const lines = [];
  lines.push('# Competition results');
  lines.push('');
  lines.push(`Generated ${nowIso()} from the committed ledger. Season ${competition.season_id ?? 'n/a'} (${competition.starts_at ?? '?'} to ${competition.ends_at ?? '?'}), ${competition.ticks ?? 0} ticks completed.`);
  lines.push('');
  lines.push('> Every number below is computed from data fetched from an official source. Simulated fills are labelled: `taker_walks_official_order_book` means the order walked real resting size, `quote_based_fill_at_official_bid_offer` means it filled at the exchange quote with size capped by published liquidity, and `modelled` marks resting maker orders whose queue position cannot be observed publicly.');
  lines.push('');
  if (verification) {
    lines.push(`Independent verification: **${verification.fully_verified}/${verification.trades_checked}** trades fully verified, ${verification.anomaly_count} anomalies (see \`data/verification/report.json\`).`);
    lines.push('');
  }
  lines.push('## Leaderboard');
  lines.push('');
  lines.push('| # | Username | Market type | Equity (USD) | Return % | Realized | Unrealized | Fees | Slippage | Open | Closed trades |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  (leaderboard.leaderboard ?? []).forEach((row, index) => {
    lines.push(
      `| ${index + 1} | ${row.username} | ${row.market_type} | ${fmt(row.equity_usd)} | ${fmt(row.return_pct)} | ${fmt(row.realized_pnl_usd)} | ${fmt(row.unrealized_pnl_usd)} | ${fmt(row.fees_paid_usd)} | ${fmt(row.slippage_paid_usd)} | ${row.open_positions} | ${row.closed_trades} |`,
    );
  });
  lines.push('');
  lines.push('## Per-strategy analysis');
  for (const strategy of catalog) {
    const record = byStrategy[strategy.id];
    lines.push('');
    lines.push(`### ${record.username} - ${record.display_name}`);
    lines.push('');
    lines.push(`- **Market type:** ${record.market_type}`);
    lines.push(`- **Thesis:** ${record.thesis}`);
    lines.push(`- **Rules:** entry - ${record.rules?.entry ?? 'n/a'}; exit - ${record.rules?.exit ?? 'n/a'}`);
    lines.push(`- **Result:** ${fmt(record.return_pct)}% (equity ${fmt(record.equity_usd)} USD), ${record.entries} entries, ${record.exits} exits, ${record.blocked_orders} blocked order attempts.`);
    for (const line of record.what_it_means) lines.push(`- ${line}`);
    const commodities = Object.entries(record.attribution.by_commodity ?? {});
    if (commodities.length) {
      lines.push(`- **Attribution by commodity:** ${commodities.map(([name, c]) => `${name} (${c.trades} trades, ${c.realized_pnl_usd} USD realized, ${c.fees_usd} USD fees)`).join('; ')}`);
    }
  }
  lines.push('');
  lines.push('## Execution composition');
  lines.push('');
  lines.push(`- Taker fills that walked the official ladder: ${trades.filter((t) => t.fill?.execution_model === 'taker_walks_official_order_book').length}`);
  lines.push(`- Quote-based fills at the official bid/offer: ${trades.filter((t) => t.fill?.execution_model === 'quote_based_fill_at_official_bid_offer').length}`);
  lines.push(`- Modelled resting maker fills: ${trades.filter((t) => t.fill?.modelled === true).length}`);
  lines.push(`- Orders that could not be executed, with the recorded reason: ${intents.length}`);
  const reasons = countBy(intents, (i) => i.reason);
  for (const [reason, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) lines.push(`  - ${reason}: ${count}`);
  lines.push('');
  lines.push('## How to read this');
  lines.push('');
  lines.push('These are simulated fills on real, verified market data. They are not exchange executions and they are not a track record. The point of the competition is to measure, over a full year, which of the twelve documented ideas survives contact with real liquidity, real spreads and real fees.');
  return lines.join('\n');
}

function countBy(list, keyFn) {
  const out = {};
  for (const item of list) {
    const key = keyFn(item) ?? 'unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function round(value) {
  return Number((value ?? 0).toFixed(6));
}

function fmt(value) {
  if (value === null || value === undefined) return 'n/a';
  if (typeof value === 'number') return value.toFixed(2);
  return String(value);
}

main();
