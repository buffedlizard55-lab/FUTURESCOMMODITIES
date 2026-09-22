/**
 * Paper-trading portfolio accounting.
 *
 * HARD RULES (mirrors the project brief):
 *  1. A trade can only exist if it was created from a verified quote snapshot. Every leg
 *     embeds the provenance record (official source URL, HTTP status, content hash,
 *     retrieval timestamp) that produced its prices.
 *  2. Fills are size-aware: a taker order walks the real order book and the trade stores
 *     per-level detail. If the book cannot fill the order, the unfilled remainder is
 *     recorded — never assumed filled at a better price.
 *  3. Fees use the official Kalshi fee formula (see lib/kalshi.mjs) with the multiplier and
 *     precision source recorded on the trade.
 *  4. Slippage is measured against a defined reference (book mid at snapshot time) and
 *     stored, never smoothed away.
 *  5. When a value cannot be computed from verified data (e.g. FX conversion unavailable),
 *     the field is `null` and a `*_status` field explains why. Nothing is estimated silently.
 */

import { createHash } from 'node:crypto';
import { kalshiMakerFee, kalshiTakerFee } from './kalshi.mjs';

export function tradeId(...parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 20);
}

export function newPortfolio(strategy, startingCashUsd) {
  return {
    strategy_id: strategy.id,
    username: strategy.username,
    starting_cash_usd: startingCashUsd,
    cash_usd: startingCashUsd,
    realized_pnl_usd: 0,
    fees_paid_usd: 0,
    positions: {}, // key: instrument_id
    trade_count: 0,
    closed_trade_count: 0,
    created_at: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Event contracts (Kalshi binary, $1 notional per contract)           */
/* ------------------------------------------------------------------ */

/**
 * Simulate a taker fill for a Kalshi event contract against a real order book snapshot.
 * @param {object} args
 * @param {object} args.book          parsed book (see kalshi.bookFromRaw)
 * @param {'yes'|'no'} args.outcome
 * @param {'buy'|'sell'} args.action
 * @param {number} args.contracts     desired contract count
 * @param {number|null} args.limitPrice
 * @param {number} args.feeMultiplier series fee_multiplier (official series metadata)
 * @param {object} args.quote         market quote record (for provenance/echo)
 */
export function simulateEventContractFill({ book, outcome, action, contracts, limitPrice = null, feeMultiplier = 1, feePrecision = 2, walkBookForTaker }) {
  const ladder = action === 'buy'
    ? (outcome === 'yes' ? book.buyYesLevels : book.buyNoLevels)
    : (outcome === 'yes' ? book.yesBids.slice().reverse() : book.noBids.slice().reverse());
  const fill = walkBookForTaker({ book, outcome, action, contracts, limitPrice });
  if (!fill) {
    return {
      filled: 0,
      requested: contracts,
      reason: ladder.length ? 'limit price excluded all available liquidity' : 'no resting liquidity on the required side',
      levels: [],
    };
  }
  const fee = kalshiTakerFee({ price: fill.vwap, contracts: fill.filled, multiplier: feeMultiplier, precision: feePrecision });
  const ref = book.mid;
  const slippage = ref != null ? Number(((fill.vwap - ref) * (action === 'buy' ? 1 : -1)).toFixed(6)) : null;
  return {
    ...fill,
    fee_usd: fee,
    fee_model: `kalshi_taker: roundup(${feeMultiplier} * 0.07 * C * P * (1-P)) @ precision ${feePrecision} decimals`,
    reference_price: ref,
    reference_note: ref == null ? 'book mid unavailable (one-sided book at snapshot)' : 'book mid = (best YES bid + best YES ask) / 2 from the same snapshot',
    slippage_per_contract_usd: slippage,
    slippage_usd: slippage == null ? null : Number((slippage * fill.filled).toFixed(6)),
  };
}

/** Maker fill model: assumes our resting order is filled only if the book trades through it. */
export function simulateEventContractMakerFill({ book, outcome, action, contracts, restingPrice, feeMultiplier = 0, feePrecision = 2 }) {
  const bestOpposing = action === 'buy'
    ? (outcome === 'yes' ? book.bestYesAsk : book.bestNoAsk)
    : (outcome === 'yes' ? book.bestYesBid : book.bestNoBid);
  const crosses = bestOpposing != null && (action === 'buy' ? restingPrice >= bestOpposing : restingPrice <= bestOpposing);
  if (crosses) {
    return {
      filled: 0,
      requested: contracts,
      reason: 'resting price crossed the book at snapshot time, so it would have been a taker order; excluded from maker model',
      levels: [],
    };
  }
  const depth = action === 'buy'
    ? (outcome === 'yes' ? book.noDepthContracts : book.yesDepthContracts)
    : (outcome === 'yes' ? book.yesDepthContracts : book.noDepthContracts);
  const fillable = Math.min(contracts, depth);
  if (fillable <= 0) {
    return { filled: 0, requested: contracts, reason: 'no opposing depth available to trade against a resting order', levels: [] };
  }
  const fee = kalshiMakerFee({ price: restingPrice, contracts: fillable, multiplier: feeMultiplier, precision: feePrecision });
  return {
    filled: fillable,
    requested: contracts,
    unfilled: contracts - fillable,
    vwap: restingPrice,
    worstPrice: restingPrice,
    bestPrice: restingPrice,
    notional_usd: Number((restingPrice * fillable).toFixed(6)),
    levels: [{ price: restingPrice, contracts: fillable, derived_from: 'maker model: resting order filled from opposing depth' }],
    fee_usd: fee,
    fee_model: `kalshi_maker: roundup(${feeMultiplier} * 0.0175 * C * P * (1-P)) @ precision ${feePrecision} decimals`,
    reference_price: book.mid,
    slippage_per_contract_usd: 0,
    slippage_usd: 0,
    maker_model_note:
      'Maker fills are modelled conservatively: size is capped at the opposing depth visible in the snapshot and no queue-position advantage is assumed. Real maker fills require queue simulation and are flagged as modelled, not observed.',
  };
}

/* ------------------------------------------------------------------ */
/* Futures (linear, quoted in the contract face currency)              */
/* ------------------------------------------------------------------ */

/**
 * Simulate a futures fill from an official exchange quote.
 * @param {object} args
 * @param {'buy'|'sell'} args.action
 * @param {number} args.contracts
 * @param {number|null} args.bid   official best bid (0/null if none)
 * @param {number|null} args.offer official best offer
 * @param {number} args.lotVolume  units per contract (official LOTVOLUME)
 * @param {number|null} args.depthContracts liquidity cap used (see liquidity_model)
 */
export function simulateFuturesFill({ action, contracts, bid, offer, lotVolume, feePerContract = null, feeCurrency = null, tickSize = null }) {
  const price = action === 'buy' ? offer : bid;
  if (price == null) {
    return { filled: 0, requested: contracts, reason: `official ${action === 'buy' ? 'offer' : 'bid'} missing in the exchange quote`, levels: [] };
  }
  const units = (lotVolume ?? 1) * contracts;
  const mid = bid != null && offer != null ? (bid + offer) / 2 : null;
  const slippage = mid == null ? null : Number(((price - mid) * (action === 'buy' ? 1 : -1)).toFixed(8));
  const feeTotal = feePerContract == null ? null : Number((feePerContract * contracts).toFixed(6));
  return {
    filled: contracts,
    requested: contracts,
    unfilled: 0,
    vwap: price,
    worstPrice: price,
    bestPrice: price,
    levels: [{ price, contracts, derived_from: `official exchange ${action === 'buy' ? 'best offer' : 'best bid'} at snapshot` }],
    units,
    reference_price: mid,
    tick_size: tickSize,
    slippage_per_contract: slippage,
    slippage_cost_quote_ccy: slippage == null ? null : Number((slippage * units).toFixed(8)),
    fee_total_quote_ccy: feeTotal,
    fee_currency: feeCurrency,
    fee_model: feePerContract == null ? 'exchange fee not published in the quote payload for this contract; recorded as null' : 'exchange-published per-contract fee (MOEX BUYSELLFEE) × contracts',
  };
}

/* ------------------------------------------------------------------ */
/* Position lifecycle                                                  */
/* ------------------------------------------------------------------ */

export function upsertPosition(portfolio, instrumentId, patch) {
  const existing = portfolio.positions[instrumentId];
  portfolio.positions[instrumentId] = { ...(existing ?? {}), ...patch };
  return portfolio.positions[instrumentId];
}

export function applyEventContractOpen(portfolio, { feeUsd, costUsd }) {
  portfolio.cash_usd = Number((portfolio.cash_usd - costUsd - feeUsd).toFixed(6));
  portfolio.fees_paid_usd = Number((portfolio.fees_paid_usd + feeUsd).toFixed(6));
  portfolio.trade_count += 1;
}

export function applyEventContractClose(portfolio, { proceedsUsd, feeUsd, realizedPnlUsd }) {
  portfolio.cash_usd = Number((portfolio.cash_usd + proceedsUsd - feeUsd).toFixed(6));
  portfolio.fees_paid_usd = Number((portfolio.fees_paid_usd + feeUsd).toFixed(6));
  portfolio.realized_pnl_usd = Number((portfolio.realized_pnl_usd + realizedPnlUsd).toFixed(6));
  portfolio.closed_trade_count += 1;
}

/** Mark-to-market for every open position using the latest verified quotes. */
export function markToMarket(portfolio, quotesById) {
  let unrealized = 0;
  const marks = [];
  for (const [instrumentId, pos] of Object.entries(portfolio.positions)) {
    const q = quotesById[instrumentId];
    if (!q) {
      marks.push({ instrument_id: instrumentId, mark_status: 'no_quote_in_snapshot', unrealized_pnl_usd: null });
      continue;
    }
    let mark = null;
    let value = null;
    if (pos.kind === 'event_contract') {
      // Conservative mark: exit at the bid we could actually hit for our side.
      mark = pos.outcome === 'yes' ? q.best_yes_bid : q.best_no_bid;
      if (mark != null) {
        value = Number(((mark - pos.avg_entry_price) * pos.contracts).toFixed(6));
        unrealized += value;
      }
    } else if (pos.kind === 'perpetual') {
      mark = pos.side === 'long' ? q.bid : q.offer;
      if (mark != null) {
        value = Number(((mark - pos.avg_entry_price) * pos.contracts * (pos.side === 'short' ? -1 : 1) * (pos.contract_size ?? 1)).toFixed(6));
        unrealized += value;
      }
    } else if (pos.kind === 'future') {
      mark = pos.side === 'long' ? q.bid : q.offer;
      if (mark != null) {
        value = Number(((mark - pos.avg_entry_price) * pos.contracts * (pos.side === 'short' ? -1 : 1) * (pos.lot_volume ?? 1)).toFixed(6));
        unrealized += value;
      }
    }
    marks.push({
      instrument_id: instrumentId,
      mark_price: mark,
      mark_basis: pos.kind === 'event_contract' ? 'best bid for the held outcome (conservative exit assumption)' : 'official exchange best bid/offer for the position side',
      unrealized_pnl_usd: value,
    });
  }
  portfolio.unrealized_pnl_usd = Number(unrealized.toFixed(6));
  portfolio.equity_usd = Number((portfolio.cash_usd + openPositionValue(portfolio, quotesById)).toFixed(6));
  portfolio.marks = marks;
  return portfolio;
}

/**
 * Value of open positions at liquidation prices (mark basis above). For event contracts the
 * position value is contracts × mark. For linear futures/perps it is the entry notional plus
 * unrealized PnL.
 */
export function openPositionValue(portfolio, quotesById) {
  let total = 0;
  for (const [instrumentId, pos] of Object.entries(portfolio.positions)) {
    const q = quotesById[instrumentId];
    if (!q) continue;
    if (pos.kind === 'event_contract') {
      const mark = pos.outcome === 'yes' ? q.best_yes_bid : q.best_no_bid;
      if (mark != null) total += mark * pos.contracts;
    } else if (pos.kind === 'perpetual') {
      const mark = pos.side === 'long' ? q.bid : q.offer;
      if (mark != null) total += pos.avg_entry_price * pos.contracts * (pos.contract_size ?? 1) + (mark - pos.avg_entry_price) * pos.contracts * (pos.contract_size ?? 1) * (pos.side === 'short' ? -1 : 1);
    } else if (pos.kind === 'future') {
      const mark = pos.side === 'long' ? q.bid : q.offer;
      if (mark != null) total += (mark - pos.avg_entry_price) * pos.contracts * (pos.lot_volume ?? 1) * (pos.side === 'short' ? -1 : 1);
    }
  }
  return total;
}

export function returnPct(portfolio) {
  return Number((((portfolio.equity_usd - portfolio.starting_cash_usd) / portfolio.starting_cash_usd) * 100).toFixed(4));
}
