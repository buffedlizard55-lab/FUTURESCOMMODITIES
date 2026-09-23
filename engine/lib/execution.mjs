/**
 * Order execution and trade-record construction for the paper-trading competition.
 *
 * Extracted verbatim from engine/tick.mjs (2026-09-22) into its own module so that the exact
 * live execution path can be replayed offline against the last committed snapshot
 * (test/live-pipeline.mjs) without a network connection. Behaviour is identical to the inline
 * version: the functions take every input explicitly and mutate only the objects passed to them.
 *
 * Hard rules (unchanged):
 *  - a taker order never consumes more liquidity than the official book/quote publishes;
 *  - an order refused for a missing verified input is recorded as an intent, never silently dropped;
 *  - every trade record carries the source URL, payload hash and timestamps of the payload its
 *    price came from.
 */

import {
  KALSHI_PERP_FEE_SCHEDULE_URL,
  applyFill,
  kalshiPerpTakerFee,
  simulateEventContractMakerFill,
  simulateEventContractTakerFill,
  simulateQuoteFill,
  tradeId,
} from './portfolio.mjs';
import { num } from './universe.mjs';
import { nowIso } from './http.mjs';

/* ------------------------------------------------------------------ */
/* fills                                                              */
/* ------------------------------------------------------------------ */

/**
 * How much cash the simulated account has to set aside for a position. Event contracts are fully
 * funded (the premium is the whole cost). Exchange-listed futures and Kalshi perpetuals are
 * margined, so the collateral is taken from cash and returned when the position closes; the
 * notional is never exchanged. Nothing here is assumed: if the exchange did not publish the input
 * the order is refused rather than given a made-up margin.
 */
export function positionMargin({ inst, contracts, price, fx }) {
  if (inst.kind === 'event_contract') {
    return { margin_usd: 0, margin_model: 'fully_funded_binary_contract_premium_paid_in_full' };
  }
  if (inst.kind === 'future') {
    const perContractRub = inst.contract_specification?.initial_margin_rub ?? null;
    if (!(perContractRub > 0)) {
      return {
        margin_usd: null,
        margin_model: 'exchange_initial_margin_not_published',
        note: 'The exchange payload for this contract did not include an initial margin, so the collateral requirement cannot be stated and the order was not placed.',
      };
    }
    if (!(fx?.rate > 0)) {
      return {
        margin_usd: null,
        margin_model: 'usd_rub_rate_unavailable',
        note: 'MOEX publishes the initial margin in RUB and the official USD/RUB rate was unavailable, so the collateral requirement could not be converted.',
      };
    }
    const marginRub = perContractRub * contracts;
    return {
      margin_usd: Number((marginRub / fx.rate).toFixed(6)),
      margin_rub: Number(marginRub.toFixed(2)),
      margin_per_contract_rub: perContractRub,
      fx_rate: fx.rate,
      margin_model: 'moex_published_initial_margin_rub_converted_at_official_usd_rub',
    };
  }
  if (inst.kind === 'perpetual') {
    const leverage = inst.contract_specification?.leverage_estimate ?? null;
    if (!(leverage > 0)) {
      return {
        margin_usd: null,
        margin_model: 'kalshi_perp_leverage_estimate_unavailable',
        note: 'The exchange payload for this perpetual did not include the inputs needed to state a collateral requirement, so the order was not placed.',
      };
    }
    const notional = price * contracts;
    return {
      margin_usd: Number((notional / leverage).toFixed(6)),
      notional_usd: Number(notional.toFixed(6)),
      leverage_estimate: leverage,
      margin_model: 'kalshi_perp_notional_divided_by_exchange_implied_leverage_estimate',
    };
  }
  return { margin_usd: null, margin_model: 'unknown_instrument_kind', note: 'Unsupported instrument kind.' };
}

export function executeEventContractOrder({ ord, inst, quote, portfolio, runId, newTrades, intents, instrumentById, competition, fx }) {
  if (!inst || !quote) {
    intents.push(intentRecord(ord, runId, 'instrument_not_in_snapshot', 'The instrument was not present in this run snapshot.'));
    return { executed: false, reason: 'instrument_not_in_snapshot' };
  }
  if (!inst.commodity) {
    intents.push(intentRecord(ord, runId, 'instrument_unclassified', 'The instrument could not be mapped to a verified commodity, so no trade is placed.'));
    return { executed: false, reason: 'instrument_unclassified' };
  }
  const closeTime = inst.close_time ?? inst.expiration_time;
  if (closeTime && new Date(closeTime).getTime() <= Date.now()) {
    intents.push(intentRecord(ord, runId, 'market_closed', `Market closed at ${closeTime}; an order at this moment could not have been filled.`));
    return { executed: false, reason: 'market_closed' };
  }

  const isExit = !!ord.is_exit;
  const contractsRequested = Math.floor(ord.contracts);
  if (contractsRequested < 1) {
    intents.push(intentRecord(ord, runId, 'size_below_one_contract', 'The sized order was smaller than one contract.'));
    return { executed: false, reason: 'size_below_one_contract' };
  }

  const heldPosition = portfolio.positions[ord.instrument_id] ?? null;
  if (isExit && (!heldPosition || (ord.outcome && heldPosition.outcome !== ord.outcome))) {
    intents.push(intentRecord(ord, runId, 'no_position_to_exit', 'Exit requested but the portfolio holds no matching position.'));
    return { executed: false, reason: 'no_position_to_exit' };
  }
  if (!isExit && heldPosition) {
    intents.push(intentRecord(ord, runId, 'already_holding', 'The strategy already holds this instrument; the simulator keeps one position per instrument per strategy.'));
    return { executed: false, reason: 'already_holding' };
  }

  const ladder = isExit
    ? ord.outcome === 'yes'
      ? quote.sell_yes_levels
      : quote.sell_no_levels
    : ord.outcome === 'yes'
      ? quote.buy_yes_levels
      : quote.buy_no_levels;
  const bestOffer = isExit
    ? ord.outcome === 'yes'
      ? quote.best_yes_bid
      : quote.best_no_bid
    : ord.outcome === 'yes'
      ? quote.best_yes_ask
      : quote.best_no_ask;

  if (bestOffer == null || !ladder?.length) {
    intents.push(intentRecord(ord, runId, 'no_offer_side_in_book', 'No resting size was published on the side this order needs, so no fill could occur.'));
    return { executed: false, reason: 'no_offer_side_in_book' };
  }

  const tolerance = isExit ? 0 : competition.event_contract_price_tolerance ?? 0.02;
  const participation = competition.taker_participation_of_visible_depth ?? 0.25;
  const maxPrice = isExit ? null : bestOffer + tolerance;
  let allowed = contractsRequested;
  let capacity = null;
  if (!isExit) {
    const usable = ladder.filter((l) => l.price <= maxPrice + 1e-9);
    const visible = usable.reduce((sum, l) => sum + l.contracts, 0);
    capacity = {
      best_offer: bestOffer,
      price_tolerance: tolerance,
      max_acceptable_price: Number(maxPrice.toFixed(6)),
      visible_contracts_within_tolerance: Number(visible.toFixed(2)),
      participation_rate: participation,
      total_visible_contracts_this_side: Number(ladder.reduce((sum, l) => sum + l.contracts, 0).toFixed(2)),
    };
    allowed = Math.min(contractsRequested, Math.floor(visible * participation));
    if (allowed < 1) {
      intents.push(intentRecord(ord, runId, 'insufficient_depth_within_price_tolerance', `Only ${visible.toFixed(2)} contracts rested within ${tolerance} of the best offer (${bestOffer}); at ${(participation * 100).toFixed(0)}% participation no fill was possible.`));
      return { executed: false, reason: 'insufficient_depth_within_price_tolerance', capacity };
    }
  }
  if (isExit && allowed > heldPosition.contracts) allowed = heldPosition.contracts;

  const feeMultiplier = inst.contract_specification?.fee_multiplier ?? 1;
  const makerMultiplier = /maker/i.test(inst.contract_specification?.fee_type ?? '') ? feeMultiplier : 0;
  const fill = simulateEventContractTakerFill({
    ladder,
    contracts: allowed,
    limitPrice: isExit ? null : Number(maxPrice.toFixed(6)),
    feeMultiplier: isExit ? feeMultiplier : feeMultiplier,
    feePrecision: 2,
    referencePrice: ord.outcome === 'yes' ? quote.mid : quote.mid != null ? Number((1 - quote.mid).toFixed(6)) : null,
  });
  if (fill.filled < 1) {
    intents.push(intentRecord(ord, runId, 'unfilled', 'No contracts could be filled inside the recorded price limit.'));
    return { executed: false, reason: 'unfilled' };
  }

  const trade = buildTrade({
    ord,
    inst,
    quote,
    fill,
    contracts: fill.filled,
    runId,
    capacity,
    fx,
    isExit,
    position: heldPosition,
    makerMultiplier,
    margin: { margin_usd: 0, margin_model: 'fully_funded_binary_contract_premium_paid_in_full' },
  });
  newTrades.push(trade);
  applyFill(portfolio, trade);
  return { executed: true, trade };
}

export function executeQuoteOrder({ ord, inst, quote, portfolio, runId, newTrades, intents, instrumentById, competition, fx }) {
  if (!inst || !quote) {
    intents.push(intentRecord(ord, runId, 'instrument_not_in_snapshot', 'The instrument was not present in this run snapshot.'));
    return { executed: false, reason: 'instrument_not_in_snapshot' };
  }
  const isExit = !!ord.is_exit;
  const heldPosition = portfolio.positions[ord.instrument_id] ?? null;
  if (isExit && !heldPosition) {
    intents.push(intentRecord(ord, runId, 'no_position_to_exit', 'Exit requested but no position is held.'));
    return { executed: false, reason: 'no_position_to_exit' };
  }
  if (!isExit && heldPosition) {
    intents.push(intentRecord(ord, runId, 'already_holding', 'The strategy already holds this instrument.'));
    return { executed: false, reason: 'already_holding' };
  }

  const price = ord.action === 'buy' ? quote.offer : quote.bid;
  if (price == null || !(price > 0)) {
    intents.push(intentRecord(ord, runId, 'no_verified_quote', 'The exchange published no two-sided quote for this instrument in this run.'));
    return { executed: false, reason: 'no_verified_quote' };
  }

  let contracts = Math.floor(ord.contracts);
  if (isExit && heldPosition) contracts = heldPosition.contracts;
  let capInfo = null;
  if (inst.kind === 'future') {
    const volumeToday = quote.volume_today ?? 0;
    const openInterest = quote.open_interest ?? 0;
    const maxByVolume = Math.max(1, Math.floor(volumeToday * (competition.moex_max_volume_share ?? 0.02)));
    const maxByOi = openInterest ? Math.max(1, Math.floor(openInterest * (competition.moex_max_oi_share ?? 0.05))) : Infinity;
    contracts = Math.min(contracts, maxByVolume, maxByOi);
    capInfo = { max_by_volume: maxByVolume, max_by_open_interest: Number.isFinite(maxByOi) ? maxByOi : null, volume_today: volumeToday, open_interest: openInterest };
  } else if (inst.kind === 'perpetual') {
    const notional = quote.volume_24h_notional_usd ?? quote.open_interest_notional_usd ?? null;
    const participation = competition.perp_participation_rate ?? 0.001;
    if (notional && price > 0) {
      const cap = Math.max(1, Math.floor((notional * participation) / price));
      contracts = Math.min(contracts, cap);
      capInfo = { participation_rate: participation, volume_24h_notional_usd: notional, cap };
    }
  }
  if (contracts < 1) {
    intents.push(intentRecord(ord, runId, 'size_below_liquidity_cap', 'The exchange-published liquidity for this instrument is smaller than one contract at the configured participation rate.', capInfo));
    return { executed: false, reason: 'size_below_liquidity_cap' };
  }

  const usdPerPriceUnit = inst.kind === 'future' ? inst.usd_valuation?.usd_per_price_unit ?? null : 1;
  if (inst.kind === 'future' && !(usdPerPriceUnit > 0)) {
    intents.push(intentRecord(ord, runId, 'valuation_inputs_missing', inst.usd_valuation?.note ?? 'USD valuation inputs (exchange STEPPRICE/MINSTEP plus USD/RUB) were unavailable, so PnL could not be computed and the order was not placed.'));
    return { executed: false, reason: 'valuation_inputs_missing' };
  }

  const feePerContractUsd = inst.kind === 'future' ? feeInUsd({ inst, fx }) : null;
  const fill = simulateQuoteFill({
    action: ord.action,
    side: ord.side ?? (ord.action === 'buy' ? 'long' : 'short'),
    contracts,
    bid: quote.bid,
    offer: quote.offer,
    tickSize: inst.contract_specification?.min_step ?? inst.contract_specification?.tick_size ?? null,
    feeUsd: feePerContractUsd != null ? Number((feePerContractUsd * contracts).toFixed(6)) : null,
    feeModel: inst.kind === 'future' ? 'MOEX BUYSELLFEE (exchange-published per-contract fee in RUB) converted at the official MOEX USD/RUB rate' : null,
    availableLiquidity: capInfo,
  });
  // Rate-quoted MOEX contracts carry the exchange-published lot notional (LOTVOLUME in RUB);
  // price x usd_per_price_unit is not their notional (the price is a rate).
  const usdNotionalPerLot = inst.kind === 'future' ? inst.usd_valuation?.usd_notional_per_lot ?? null : null;
  fill.notional_usd =
    usdNotionalPerLot != null
      ? Number((usdNotionalPerLot * contracts).toFixed(6))
      : Number((fill.vwap * contracts * (usdPerPriceUnit ?? 1)).toFixed(6));

  if (inst.kind === 'perpetual') {
    // Official perp fee: a percentage of notional, charged on both open and close. Tier 0 is
    // the rate for an account without volume, which is exactly what this competition is.
    fill.fee_usd = kalshiPerpTakerFee({ notionalUsd: fill.notional_usd ?? 0 });
    fill.fee_model = `Official Kalshi perpetual futures fee schedule (${KALSHI_PERP_FEE_SCHEDULE_URL}, effective 2026-07-07): exchange taker fee, tier 0 = 12.0 bps of notional, charged on open and close; this competition account has no volume tier, so tier 0 is the verified rate.`;
  }

  const margin = isExit && heldPosition ? { margin_usd: heldPosition.margin_usd ?? 0, margin_model: heldPosition.margin_model ?? null } : positionMargin({ inst, contracts, price: fill.vwap ?? price, fx });
  if (margin.margin_usd == null) {
    intents.push(intentRecord(ord, runId, 'margin_inputs_missing', margin.note ?? 'Collateral requirement could not be derived from exchange-published inputs.'));
    return { executed: false, reason: 'margin_inputs_missing' };
  }
  if (margin.margin_usd > portfolio.cash_usd) {
    intents.push(intentRecord(ord, runId, 'insufficient_margin', `Order requires about $${margin.margin_usd.toFixed(2)} of collateral (${margin.margin_model}) but the portfolio holds $${portfolio.cash_usd.toFixed(2)}.`));
    return { executed: false, reason: 'insufficient_margin' };
  }

  const trade = buildTrade({ ord, inst, quote, fill, contracts, runId, capacity: capInfo, fx, isExit, position: heldPosition, makerMultiplier: 0, margin });
  newTrades.push(trade);
  applyFill(portfolio, trade);
  return { executed: true, trade };
}

/* ------------------------------------------------------------------ */
/* working orders                                                     */
/* ------------------------------------------------------------------ */

export function registerWorkingOrder({ ord, instrumentById, quotes, workingOrders, intents, runId, competition }) {
  const inst = instrumentById[ord.instrument_id];
  const quote = quotes[ord.instrument_id];
  if (!inst || !quote) {
    intents.push(intentRecord(ord, runId, 'instrument_not_in_snapshot', 'Maker order skipped: instrument not in this run snapshot.'));
    return null;
  }
  const resting = Number(ord.limit_price);
  if (!Number.isFinite(resting) || resting <= 0 || resting >= 1) {
    intents.push(intentRecord(ord, runId, 'invalid_maker_price', 'Maker order rejected: resting price must be strictly between 0 and 1.'));
    return null;
  }
  const opposingBest = ord.outcome === 'yes' ? quote.best_yes_ask : quote.best_no_ask;
  if (opposingBest != null && resting >= opposingBest) {
    intents.push(intentRecord(ord, runId, 'maker_price_crosses_book', `Resting bid ${resting} is at or above the best offer ${opposingBest}; such an order would execute as a taker and is not recorded as a maker fill.`));
    return null;
  }
  const openForStrategy = workingOrders.orders.filter((o) => o.strategy_id === ord.strategy_id && o.status === 'resting');
  if (openForStrategy.length >= 6) {
    intents.push(intentRecord(ord, runId, 'working_order_limit', 'Strategy already has the maximum number of resting orders.'));
    return null;
  }
  const ttlHours = competition?.maker_order_ttl_hours ?? 6;
  const entry = {
    id: tradeId('working', runId, ord.strategy_id, ord.instrument_id, ord.outcome, String(resting), String(ord.contracts)),
    strategy_id: ord.strategy_id,
    username: ord.username,
    market_type_label: ord.market_type_label,
    instrument_id: ord.instrument_id,
    ticker: inst.ticker,
    outcome: ord.outcome,
    resting_price: resting,
    contracts: Math.floor(ord.contracts),
    remaining: Math.floor(ord.contracts),
    status: 'resting',
    placed_at: nowIso(),
    expires_at: new Date(Date.now() + ttlHours * 3600000).toISOString(),
    thesis: ord.thesis,
    signal: ord.signal ?? null,
    quote_at_placement: {
      best_yes_bid: quote.best_yes_bid,
      best_yes_ask: quote.best_yes_ask,
      best_no_bid: quote.best_no_bid,
      best_no_ask: quote.best_no_ask,
      mid: quote.mid,
      spread: quote.spread,
      source_url: quote.source?.url ?? null,
      sha256: quote.source?.sha256 ?? null,
      retrieved_at: quote.source?.retrieved_at ?? null,
    },
  };
  workingOrders.orders.push(entry);
  intents.push({ ...intentRecord(ord, runId, 'resting_order_registered', `Resting maker order registered at ${resting}. It can only fill if a later snapshot shows the market trading through that price.`), working_order_id: entry.id, resting_price: resting });
  return entry;
}

export function processWorkingOrders({ workingOrders, ctxBase, portfolios, runId, newTrades, intents, competition }) {
  const fills = [];
  for (const wo of workingOrders.orders) {
    if (wo.status !== 'resting') continue;
    const inst = ctxBase.instrument(wo.instrument_id);
    const quote = ctxBase.quote(wo.instrument_id);
    const portfolio = portfolios[wo.strategy_id];
    if (!inst || !quote || !portfolio) {
      wo.status = 'cancelled';
      wo.cancelled_reason = 'instrument or quote absent from this snapshot';
      continue;
    }
    if (inst.close_time && new Date(inst.close_time).getTime() <= Date.now()) {
      wo.status = 'expired';
      wo.expired_reason = `market closed at ${inst.close_time}`;
      continue;
    }
    if (wo.expires_at && new Date(wo.expires_at).getTime() <= Date.now()) {
      wo.status = 'expired';
      wo.expired_reason = `resting TTL of ${competition.maker_order_ttl_hours ?? 6}h elapsed without the market trading through the resting price`;
      continue;
    }
    const opposingBest = wo.outcome === 'yes' ? quote.best_yes_ask : quote.best_no_ask;
    const ladder = wo.outcome === 'yes' ? quote.buy_yes_levels : quote.buy_no_levels;
    const availableAtPrice = (ladder ?? []).filter((l) => l.price <= wo.resting_price + 1e-9).reduce((sum, l) => sum + l.contracts, 0);
    // Conservative fill condition: the market must have traded THROUGH the resting price, which is
    // observed as the best offer moving below it, with resting size available at or better.
    if (opposingBest == null || opposingBest >= wo.resting_price || availableAtPrice < 1) continue;
    const contracts = Math.min(Math.floor(wo.remaining), Math.floor(availableAtPrice));
    if (contracts < 1) continue;
    const fill = simulateEventContractMakerFill({
      contracts,
      restingPrice: wo.resting_price,
      availableAtPrice,
      feeMultiplier: 0,
      feePrecision: 2,
      referencePrice: wo.outcome === 'yes' ? quote.mid : quote.mid != null ? 1 - quote.mid : null,
      tradeThroughEvidence: { best_offer_now: opposingBest, resting_price: wo.resting_price, size_at_or_better: availableAtPrice, observed_at: quote.source?.retrieved_at ?? null },
    });
    const ord = {
      strategy_id: wo.strategy_id,
      username: wo.username,
      market_type_label: wo.market_type_label,
      instrument_id: wo.instrument_id,
      action: 'buy',
      outcome: wo.outcome,
      contracts: fill.filled,
      limit_price: wo.resting_price,
      order_type: 'maker',
      thesis: wo.thesis,
      signal: wo.signal,
      prefill: true,
    };
    const trade = buildTrade({ ord, inst, quote, fill, contracts: fill.filled, runId, capacity: { maker_fill: true, available_at_price: availableAtPrice }, fx: ctxBase.fx, isExit: false, position: null, makerMultiplier: 0, margin: { margin_usd: 0, margin_model: 'fully_funded_binary_contract_premium_paid_in_full' } });
    newTrades.push(trade);
    applyFill(portfolio, trade);
    wo.remaining -= fill.filled;
    wo.status = wo.remaining <= 0 ? 'filled' : 'partially_filled';
    wo.filled_at = nowIso();
    wo.filled_trade_ids = [...(wo.filled_trade_ids ?? []), trade.id];
    fills.push({ working_order_id: wo.id, instrument_id: wo.instrument_id, contracts: fill.filled, price: wo.resting_price });
  }
  return fills;
}

/* ------------------------------------------------------------------ */
/* trade record                                                       */
/* ------------------------------------------------------------------ */

export function buildTrade({ ord, inst, quote, fill, contracts, runId, capacity, fx, isExit, position, makerMultiplier, margin = null }) {
  const isEventContract = inst.kind === 'event_contract';
  const price = fill.vwap;
  const usdPerPriceUnit = isEventContract ? 1 : inst.kind === 'perpetual' ? 1 : inst.usd_valuation?.usd_per_price_unit ?? null;
  // Rate-quoted contracts (RUONIA, 1MFR): price x usd_per_price_unit is NOT the notional — the
  // price is a rate. The exchange publishes the lot's RUB notional (LOTVOLUME), which the
  // valuation exposes as usd_notional_per_lot; use it for the recorded notional.
  const usdNotionalPerLot = inst.usd_valuation?.usd_notional_per_lot ?? null;
  const notional =
    usdNotionalPerLot != null && contracts > 0
      ? Number((usdNotionalPerLot * contracts).toFixed(6))
      : price != null && usdPerPriceUnit != null
        ? Number((price * contracts * usdPerPriceUnit).toFixed(6))
        : null;

  let pnl = { realized_pnl_usd: null, status: 'open_position_cost_recorded' };
  if (isExit && position) {
    const multiplier = position.usd_per_price_unit ?? usdPerPriceUnit ?? 1;
    const sign = isEventContract || position.side === 'long' || position.outcome === 'no' ? 1 : -1;
    const gross = (price - position.avg_entry_price) * contracts * multiplier * (position.side === 'short' && !isEventContract ? 1 : sign);
    const gross2 = isEventContract ? (price - position.avg_entry_price) * contracts : (position.side === 'long' ? price - position.avg_entry_price : position.avg_entry_price - price) * contracts * multiplier;
    const exitFee = fill.fee_usd ?? 0;
    const entryFee = position.entry_fee_usd ?? 0;
    const realized = Number((gross2 - exitFee - entryFee).toFixed(6));
    pnl = {
      realized_pnl_usd: realized,
      status: 'closed',
      entry_price: position.avg_entry_price,
      exit_price: price,
      entry_fee_usd: Number(entryFee.toFixed(6)),
      exit_fee_usd: Number(exitFee.toFixed(6)),
      entry_trade_id: position.entry_trade_id,
      formula: isEventContract
        ? '(exit_price - entry_price) x contracts - entry_fee - exit_fee'
        : `(exit_price - entry_price) x contracts x ${multiplier} x direction - entry_fee - exit_fee`,
    };
    void gross;
  }

  return {
    id: tradeId(runId, ord.strategy_id, inst.instrument_id, ord.action, ord.outcome ?? ord.side ?? '', String(contracts), String(price), isExit ? 'exit' : 'entry'),
    run_id: runId,
    strategy_id: ord.strategy_id,
    username: ord.username,
    market_type: ord.market_type_label ?? inst.market_type_label,
    instrument_kind: inst.kind,
    venue: inst.venue_name,
    venue_id: inst.venue,
    exchange: inst.venue === 'kalshi' || inst.venue === 'kalshi_margin' ? 'Kalshi (CFTC-regulated designated contract market)' : inst.venue_name,
    official_source: quote.source?.url ?? null,
    official_source_sha256: quote.source?.sha256 ?? null,
    retrieved_at: quote.source?.retrieved_at ?? null,
    verification_timestamp: nowIso(),
    ticker: inst.ticker,
    instrument_id: inst.instrument_id,
    instrument_title: inst.title ?? null,
    series_ticker: inst.series_ticker ?? null,
    commodity: inst.commodity ?? null,
    group: inst.group ?? null,
    contract_specification: inst.contract_specification ?? null,
    market_dates: {
      open_time: inst.open_time ?? null,
      close_time: inst.close_time ?? null,
      expiration_time: inst.expiration_time ?? null,
      last_trade_date: inst.last_trade_date ?? null,
      trade_date: quote.trade_date ?? null,
    },
    action: ord.action,
    outcome: isEventContract ? ord.outcome : null,
    side: isEventContract ? null : ord.side ?? (ord.action === 'buy' ? 'long' : 'short'),
    contracts,
    price,
    usd_per_price_unit: usdPerPriceUnit,
    notional_usd: notional,
    position_notional_usd: notional,
    margin_usd: margin?.margin_usd ?? null,
    margin_model: margin?.margin_model ?? null,
    margin_detail: margin ?? null,
    fill,
    market_at_decision: {
      best_yes_bid: quote.best_yes_bid ?? null,
      best_yes_ask: quote.best_yes_ask ?? null,
      best_no_bid: quote.best_no_bid ?? null,
      best_no_ask: quote.best_no_ask ?? null,
      bid: quote.bid ?? null,
      offer: quote.offer ?? null,
      mid: quote.mid ?? null,
      spread: quote.spread ?? null,
      settle_price: quote.settle_price ?? null,
      volume_today: quote.volume_today ?? null,
      open_interest: quote.open_interest ?? null,
      source_url: quote.source?.url ?? null,
      source_sha256: quote.source?.sha256 ?? null,
      retrieved_at: quote.source?.retrieved_at ?? null,
    },
    liquidity_consumed: {
      contracts,
      requested_contracts: Math.floor(fill.requested ?? contracts),
      unfilled_contracts: fill.unfilled ?? 0,
      depth_yes_contracts: quote.depth_yes_contracts ?? null,
      depth_no_contracts: quote.depth_no_contracts ?? null,
      capacity_check: capacity ?? null,
      note: isEventContract
        ? 'Kalshi publishes resting bids only; the ladder this order consumed is derived from the opposite side and the fill is capped at 25% of the size resting within 2 cents of the offer.'
        : inst.kind === 'future'
          ? 'MOEX publishes aggregate volume and open interest, not per-level depth; the fill is at the quoted price and size is capped by a share of the published volume and open interest.'
          : 'Kalshi perps publish a best bid/offer and 24h notional volume; per-level depth is not published.',
    },
    slippage: {
      reference_price: fill.reference_price ?? null,
      per_contract_usd: fill.slippage_per_contract_usd ?? null,
      total_usd: fill.slippage_usd ?? null,
      note: isEventContract
        ? 'Reference is the implied mid of the same outcome (1 - YES mid for a NO leg) taken from the same snapshot.'
        : 'Reference is the exchange midpoint of the published bid/offer in the same payload.',
    },
    fees: {
      fee_usd: fill.fee_usd ?? null,
      fee_model: fill.fee_model ?? null,
      maker_fee_multiplier_used: makerMultiplier ?? null,
      fx_rate_used: fx?.rate ?? null,
      fx_source: fx?.source_url ?? null,
      status: fill.fee_usd == null ? 'not_applied_fee_schedule_unverified' : 'applied',
    },
    pnl,
    is_exit: !!isExit,
    exit_reason: ord.exit_reason ?? null,
    thesis: ord.thesis ?? null,
    signal: ord.signal ?? null,
    created_at: nowIso(),
  };
}

export function intentRecord(ord, runId, reason, detail, extra = null) {
  return {
    id: tradeId('intent', runId, ord.strategy_id, ord.instrument_id ?? '', ord.action, reason, String(Math.random()).slice(2, 8)),
    run_id: runId,
    strategy_id: ord.strategy_id,
    username: ord.username ?? null,
    instrument_id: ord.instrument_id ?? null,
    action: ord.action ?? null,
    status: 'not_executed',
    reason,
    detail,
    extra: extra ?? null,
    created_at: nowIso(),
  };
}

/* ------------------------------------------------------------------ */

export function feeInUsd({ inst, fx }) {
  const feeRub = inst.contract_specification?.buy_sell_fee_rub ?? null;
  const rate = fx?.rate ?? null;
  if (feeRub == null || !rate) return null;
  return Number((feeRub / rate).toFixed(6));
}

