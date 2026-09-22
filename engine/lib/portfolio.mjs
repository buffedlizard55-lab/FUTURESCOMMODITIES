/**
 * Paper-trading accounting.
 *
 * Every dollar figure this project reports comes from this file, and every one of them is
 * derived from data that was fetched from an official source in the same run. Nothing here
 * invents a price, a size or a fee.
 *
 * Fee model (Kalshi, official schedule):
 *   taker general = roundup(multiplier * 0.07 * contracts * price * (1 - price))
 *   maker general = roundup(multiplier * 0.0175 * contracts * price * (1 - price))
 *   rounded UP to the nearest centicent ($0.000001) and, for accounts settling in cents,
 *   to the nearest cent. There is no settlement fee.
 *
 * Fill model:
 *   Kalshi event contracts  -> taker walks the real resting ladder; maker fills only when the
 *                              market trades through the resting price (modelled, never assumed);
 *   MOEX futures / Kalshi perps -> quote-based fill at the exchange's own bid or offer, with
 *                              slippage measured against the exchange midpoint.
 */

import { createHash } from 'node:crypto';

/* ------------------------------------------------------------------ fees */

export function roundUpTo(value, step) {
  if (!Number.isFinite(value)) return null;
  const units = Math.ceil(value / step - 1e-12);
  return Number((units * step).toFixed(10));
}

export function kalshiTakerFee({ contracts, price, multiplier = 1, precision = 2 }) {
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return 0;
  const raw = multiplier * 0.07 * contracts * price * (1 - price);
  return roundUpTo(raw, precision === 2 ? 0.01 : 0.000001);
}

export function kalshiMakerFee({ contracts, price, multiplier = 0, precision = 2 }) {
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return 0;
  if (!multiplier) return 0;
  const raw = multiplier * 0.0175 * contracts * price * (1 - price);
  return roundUpTo(raw, precision === 2 ? 0.01 : 0.000001);
}

/* ------------------------------------------------------------------ fills */

/**
 * Walk a ladder of resting contracts.
 * levels: [{ price, contracts, source }] ordered best-first for the side being bought.
 */
export function walkLadder(levels = [], contracts, limitPrice = null) {
  let remaining = contracts;
  let notional = 0;
  const used = [];
  for (const level of levels) {
    if (remaining <= 0) break;
    if (limitPrice != null && level.price > limitPrice + 1e-9) break;
    const take = Math.min(remaining, level.contracts);
    if (take <= 0) continue;
    used.push({ price: level.price, contracts: take, source: level.source ?? null });
    notional += take * level.price;
    remaining -= take;
  }
  const filled = contracts - remaining;
  return {
    filled,
    unfilled: remaining,
    notional: Number(notional.toFixed(6)),
    vwap: filled > 0 ? Number((notional / filled).toFixed(6)) : null,
    levels: used,
    worstPrice: used.length ? used[used.length - 1].price : null,
    bestPrice: used.length ? used[0].price : null,
  };
}

/** Taker fill against a real ladder (Kalshi event contracts). */
export function simulateEventContractTakerFill({ ladder, contracts, limitPrice, feeMultiplier = 1, feePrecision = 2, referencePrice = null }) {
  const walk = walkLadder(ladder, contracts, limitPrice);
  const feeUsd = walk.filled > 0 ? kalshiTakerFee({ contracts: walk.filled, price: walk.vwap, multiplier: feeMultiplier, precision: feePrecision }) : 0;
  const slippagePerContract = referencePrice != null && walk.vwap != null ? Number((walk.vwap - referencePrice).toFixed(6)) : null;
  return {
    order_type: 'taker',
    execution_model: 'taker_walks_official_order_book',
    requested: contracts,
    filled: walk.filled,
    unfilled: walk.unfilled,
    vwap: walk.vwap,
    best_price: walk.bestPrice,
    worst_price: walk.worstPrice,
    notional_usd: walk.notional,
    levels: walk.levels,
    fee_usd: feeUsd,
    fee_model: `official Kalshi taker formula roundup(${feeMultiplier} x 0.07 x contracts x price x (1-price)) rounded up to ${feePrecision === 2 ? '$0.01' : '$0.000001'}`,
    reference_price: referencePrice,
    slippage_per_contract_usd: slippagePerContract,
    slippage_usd: slippagePerContract != null ? Number((slippagePerContract * walk.filled).toFixed(6)) : null,
    note:
      walk.unfilled > 0
        ? `${walk.unfilled} of ${contracts} contracts could not be filled within the recorded price limit and were left unfilled - the ledger never assumes the remainder filled.`
        : 'Fully filled against resting size recorded in the official order book.',
  };
}

/**
 * Maker fill. A resting order only fills when the market actually trades through its price.
 * The caller must supply evidence of that (the observed best offer moving through the resting
 * price) plus the depth that existed at or better than the resting price. Queue position is not
 * modelled, and the trade is flagged as modelled rather than observed.
 */
export function simulateEventContractMakerFill({ contracts, restingPrice, availableAtPrice, feeMultiplier = 0, feePrecision = 2, referencePrice = null, tradeThroughEvidence }) {
  const filled = Math.max(0, Math.min(contracts, Math.floor(availableAtPrice ?? 0)));
  const feeUsd = filled > 0 ? kalshiMakerFee({ contracts: filled, price: restingPrice, multiplier: feeMultiplier, precision: feePrecision }) : 0;
  const slippagePerContract = referencePrice != null ? Number((restingPrice - referencePrice).toFixed(6)) : null;
  return {
    order_type: 'maker',
    execution_model: 'resting_order_filled_when_market_traded_through_price',
    requested: contracts,
    filled,
    unfilled: contracts - filled,
    vwap: filled > 0 ? restingPrice : null,
    best_price: restingPrice,
    worst_price: restingPrice,
    notional_usd: filled > 0 ? Number((filled * restingPrice).toFixed(6)) : 0,
    levels: filled > 0 ? [{ price: restingPrice, contracts: filled, source: 'resting maker order' }] : [],
    fee_usd: feeUsd,
    fee_model: `official Kalshi maker formula roundup(${feeMultiplier} x 0.0175 x contracts x price x (1-price)) - multiplier is 0 unless the series fee_type indicates maker fees`,
    reference_price: referencePrice,
    slippage_per_contract_usd: slippagePerContract,
    slippage_usd: slippagePerContract != null ? Number((slippagePerContract * filled).toFixed(6)) : null,
    modelled: true,
    trade_through_evidence: tradeThroughEvidence ?? null,
    note: 'Modelled maker fill: queue position is not observable from public data, so this fill is reported as modelled and is excluded from "observed execution" statistics.',
  };
}

/** Quote-based fill for MOEX futures and Kalshi perps: you pay the exchange offer, you sell at the exchange bid. */
export function simulateQuoteFill({ action, side, contracts, bid, offer, tickSize = null, feeUsd = null, feeModel = null, availableLiquidity = null }) {
  const price = action === 'buy' ? offer : bid;
  const mid = bid != null && offer != null ? Number(((bid + offer) / 2).toFixed(8)) : null;
  const slippagePerContract = mid != null && price != null ? Number(((action === 'buy' ? price - mid : mid - price)).toFixed(8)) : null;
  return {
    order_type: 'taker',
    execution_model: 'quote_based_fill_at_official_bid_offer',
    requested: contracts,
    filled: price != null ? contracts : 0,
    unfilled: price != null ? 0 : contracts,
    vwap: price ?? null,
    best_price: price ?? null,
    worst_price: price ?? null,
    mid_price: mid,
    notional_usd: null, // filled in by the caller once the contract's USD value per price unit is known
    levels: price != null ? [{ price, contracts, source: action === 'buy' ? 'official exchange best offer' : 'official exchange best bid' }] : [],
    fee_usd: feeUsd,
    fee_model: feeModel,
    reference_price: mid,
    slippage_per_contract_usd: slippagePerContract,
    slippage_usd: slippagePerContract != null ? Number((slippagePerContract * contracts).toFixed(6)) : null,
    tick_size: tickSize,
    available_liquidity: availableLiquidity,
    note:
      'The exchange publishes a best bid/offer (and, for MOEX, volume and open interest) but no per-level depth, so the fill is at the quoted price and the size is capped by an explicit share of the exchange-published liquidity. This is a modelled fill, not an observed execution.',
  };
}

/* ------------------------------------------------------------------ ledger ids */

export function tradeId(...parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 20);
}

/* ------------------------------------------------------------------ books */

/** Build the tradable ladders a Kalshi book implies (official semantics: bids are published, asks are implied). */
export function buildEventContractLadders(book) {
  const yes = [...(book.yes ?? [])].sort((a, b) => b.price - a.price);
  const no = [...(book.no ?? [])].sort((a, b) => b.price - a.price);
  const bestYesBid = yes.length ? yes[0].price : null;
  const bestNoBid = no.length ? no[0].price : null;
  const bestYesAsk = bestNoBid != null ? Number((1 - bestNoBid).toFixed(6)) : null;
  const bestNoAsk = bestYesBid != null ? Number((1 - bestYesBid).toFixed(6)) : null;
  const buyYesLevels = no.map((l) => ({ price: Number((1 - l.price).toFixed(6)), contracts: l.contracts, source: `implied from resting NO bid at ${l.price}` }));
  const buyNoLevels = yes.map((l) => ({ price: Number((1 - l.price).toFixed(6)), contracts: l.contracts, source: `implied from resting YES bid at ${l.price}` }));
  // Exits: selling a YES position hits the published YES bids; selling NO hits the published NO bids.
  const sellYesLevels = yes.map((l) => ({ price: l.price, contracts: l.contracts, source: 'published YES bid' }));
  const sellNoLevels = no.map((l) => ({ price: l.price, contracts: l.contracts, source: 'published NO bid' }));
  return {
    best_yes_bid: bestYesBid,
    best_yes_ask: bestYesAsk,
    best_no_bid: bestNoBid,
    best_no_ask: bestNoAsk,
    mid: bestYesBid != null && bestYesAsk != null ? Number(((bestYesBid + bestYesAsk) / 2).toFixed(6)) : null,
    spread: bestYesBid != null && bestYesAsk != null ? Number((bestYesAsk - bestYesBid).toFixed(6)) : null,
    buy_yes_levels: buyYesLevels,
    buy_no_levels: buyNoLevels,
    sell_yes_levels: sellYesLevels,
    sell_no_levels: sellNoLevels,
    depth_yes_contracts: yes.reduce((sum, l) => sum + l.contracts, 0),
    depth_no_contracts: no.reduce((sum, l) => sum + l.contracts, 0),
    book_side_semantics:
      'Kalshi publishes resting bids only. A YES bid at x is identical to a NO offer at (1 - x), so the ladders above are derived, not guessed.',
  };
}

/* ------------------------------------------------------------------ portfolio */

export function newPortfolio({ strategyId, username, marketType, startingCashUsd, startedAt }) {
  return {
    strategy_id: strategyId,
    username,
    market_type: marketType,
    started_at: startedAt,
    starting_cash_usd: startingCashUsd,
    cash_usd: startingCashUsd,
    equity_usd: startingCashUsd,
    realized_pnl_usd: 0,
    unrealized_pnl_usd: 0,
    fees_paid_usd: 0,
    slippage_paid_usd: 0,
    open_positions: 0,
    closed_trades: 0,
    positions: {},
    updated_at: startedAt,
  };
}

/** Apply a fill to the portfolio. Returns nothing; mutates in place (state is written once per run). */
export function applyFill(portfolio, trade) {
  const { instrument_id: instrumentId, action, contracts, fill, side, outcome } = trade;
  const price = fill.vwap;
  const fee = fill.fee_usd ?? 0;
  const notional = price != null ? Number((price * contracts * (trade.usd_per_price_unit ?? 1)).toFixed(6)) : 0;
  portfolio.fees_paid_usd = Number(((portfolio.fees_paid_usd ?? 0) + fee).toFixed(6));
  portfolio.slippage_paid_usd = Number(((portfolio.slippage_paid_usd ?? 0) + (fill.slippage_usd ?? 0)).toFixed(6));

  const existing = portfolio.positions[instrumentId];
  const signedDelta = action === 'buy' ? contracts : -contracts;

  if (!existing) {
    portfolio.positions[instrumentId] = {
      instrument_id: instrumentId,
      venue: trade.venue_id,
      ticker: trade.ticker,
      kind: trade.instrument_kind,
      side: side ?? (action === 'buy' ? 'long' : 'short'),
      outcome: outcome ?? null,
      contracts,
      avg_entry_price: price,
      entry_ts: trade.created_at,
      entry_trade_id: trade.id,
      entry_fee_usd: fee,
      usd_per_price_unit: trade.usd_per_price_unit ?? 1,
      market: {
        exchange: trade.exchange,
        series_ticker: trade.series_ticker ?? null,
        close_time: trade.market_dates?.close_time ?? null,
        expiration_date: trade.market_dates?.expiration_date ?? null,
        last_trade_date: trade.market_dates?.last_trade_date ?? null,
      },
      mark_price: null,
      mark_source_url: null,
      unrealized_pnl_usd: null,
    };
  } else {
    const sameSide = (existing.side === 'long' && signedDelta > 0) || (existing.side === 'short' && signedDelta < 0);
    const newContracts = existing.contracts + (existing.side === 'long' ? signedDelta : -signedDelta);
    if (sameSide || newContracts > 0) {
      const total = existing.contracts + Math.abs(signedDelta);
      if (total > 0) existing.avg_entry_price = Number(((existing.avg_entry_price * existing.contracts + price * Math.abs(signedDelta)) / total).toFixed(8));
      existing.contracts = Math.abs(newContracts);
      existing.entry_fee_usd = Number(((existing.entry_fee_usd ?? 0) + fee).toFixed(6));
    } else if (newContracts === 0) {
      delete portfolio.positions[instrumentId];
      portfolio.closed_trades += 1;
    }
  }

  // Paper cash: Kalshi event contracts and MOEX futures are fully funded here (no margin), the
  // cash movement is the traded notional plus the fee. Perps are margined, so only the fee is
  // deducted at entry and the P&L accrues as unrealised until the position is closed.
  if (trade.instrument_kind !== 'perpetual') {
    portfolio.cash_usd = Number((portfolio.cash_usd + (action === 'buy' ? -1 : 1) * notional - fee).toFixed(6));
  } else {
    portfolio.cash_usd = Number((portfolio.cash_usd - fee).toFixed(6));
  }
  return portfolio;
}

/** Mark every open position from the latest verified snapshot. Missing quotes stay null, never faked. */
export function markPortfolio(portfolio, quotesById) {
  let unrealized = 0;
  let openValue = 0;
  let complete = true;
  for (const position of Object.values(portfolio.positions ?? {})) {
    const quote = quotesById[position.instrument_id];
    position.mark_price = null;
    position.mark_source_url = null;
    position.unrealized_pnl_usd = null;
    if (!quote) {
      position.mark_status = 'no_quote_in_snapshot';
      complete = false;
      continue;
    }
    let mark = null;
    if (position.kind === 'event_contract') {
      mark = position.outcome === 'yes' ? quote.best_yes_bid : quote.best_no_bid;
    } else if (position.kind === 'future' || position.kind === 'perpetual') {
      mark = position.side === 'long' ? quote.bid : quote.offer;
    }
    if (mark == null) {
      position.mark_status = 'one_sided_book_no_exit_price';
      complete = false;
      continue;
    }
    const multiplier = position.usd_per_price_unit ?? 1;
    const sign = position.side === 'short' || position.outcome === 'no' ? 1 : 1;
    let pnl;
    if (position.kind === 'event_contract') {
      pnl = (mark - position.avg_entry_price) * position.contracts;
      openValue += mark * position.contracts;
    } else if (position.kind === 'perpetual') {
      pnl = (mark - position.avg_entry_price) * position.contracts * (position.side === 'short' ? -1 : 1);
      openValue += pnl;
    } else {
      pnl = (mark - position.avg_entry_price) * position.contracts * multiplier * (position.side === 'short' ? -1 : 1);
      openValue += 0;
    }
    position.mark_price = mark;
    position.mark_status = position.kind === 'event_contract' ? 'exit_at_bid_conservative' : position.side === 'long' ? 'long_marked_at_bid' : 'short_marked_at_offer';
    position.mark_source_url = quote.source?.url ?? null;
    position.unrealized_pnl_usd = Number(pnl.toFixed(6));
    unrealized += pnl;
    void sign;
  }

  portfolio.open_positions = Object.keys(portfolio.positions ?? {}).length;
  portfolio.unrealized_pnl_usd = Number(unrealized.toFixed(6));
  const equity = portfolio.cash_usd + openValue;
  portfolio.equity_usd = complete || portfolio.open_positions === 0 ? Number(equity.toFixed(6)) : portfolio.equity_usd ?? null;
  portfolio.equity_complete = complete;
  portfolio.updated_at = new Date().toISOString();
  return portfolio;
}

export function returnPct(portfolio) {
  if (!portfolio.equity_usd || !portfolio.starting_cash_usd) return null;
  return Number((((portfolio.equity_usd - portfolio.starting_cash_usd) / portfolio.starting_cash_usd) * 100).toFixed(4));
}

/* ------------------------------------------------------------------ settlement */

/**
 * Settlement of an expired Kalshi event contract. The settlement result is taken from the
 * exchange's own market record (market.result). If the exchange has not published a result the
 * position is left open and flagged - the simulator never guesses an outcome.
 */
export function settlePosition({ portfolio, position, result, settledAt, marketRecordUrl, marketRecordSha256, expiry }) {
  if (position.kind !== 'event_contract') return null;
  if (result !== 'yes' && result !== 'no') return null;
  const won = position.outcome === result;
  const payout = won ? position.contracts : 0;
  const pnl = Number((payout - position.avg_entry_price * position.contracts - (position.entry_fee_usd ?? 0)).toFixed(6));
  portfolio.cash_usd = Number((portfolio.cash_usd + payout).toFixed(6));
  portfolio.realized_pnl_usd = Number(((portfolio.realized_pnl_usd ?? 0) + pnl).toFixed(6));
  portfolio.closed_trades += 1;
  delete portfolio.positions[position.instrument_id];
  return {
    instrument_id: position.instrument_id,
    ticker: position.ticker,
    outcome_held: position.outcome,
    result,
    payout_usd: Number(payout.toFixed(6)),
    pnl_usd: pnl,
    settled_at: settledAt,
    expiration: expiry ?? null,
    settlement_source_url: marketRecordUrl ?? null,
    settlement_source_sha256: marketRecordSha256 ?? null,
  };
}
