/**
 * Universe builder: turns verified venue payloads into the instrument + quote records that the
 * whole platform (strategies, simulator, site) works from.
 *
 * Principles:
 *  - an instrument only exists here if a venue response in this run listed it;
 *  - every instrument and every quote carries the URL, HTTP status, SHA-256 and retrieval
 *    timestamp of the exact response it came from;
 *  - anything that cannot be classified or priced is kept out of the tradable set and reported
 *    (never silently dropped, never guessed).
 */

import { buildEventContractLadders } from './portfolio.mjs';

/* ------------------------------------------------- Kalshi event contracts */

/**
 * Commodity classification for a Kalshi series. Rules are matched in order against
 * "<ticker> <title>". A series that matches nothing is recorded with group "Unclassified" and
 * is never traded: the platform does not guess what a market is about.
 */
export function classifySeries({ ticker = '', title = '' }, rules = []) {
  const haystack = `${ticker} ${title}`;
  for (const rule of rules) {
    const re = new RegExp(rule.pattern, 'i');
    if (re.test(haystack)) {
      return { commodity: rule.commodity, group: rule.group, matched_pattern: rule.pattern, classification: 'matched_rule' };
    }
  }
  return { commodity: null, group: 'Unclassified', matched_pattern: null, classification: 'no_rule_matched' };
}

export function buildKalshiInstruments({ series, marketsBySeries, rules, feeScheduleUrl, retrievedAt }) {
  const instruments = [];
  const unclassifiedSeries = [];
  for (const s of series) {
    const ticker = s.ticker ?? s.series_ticker;
    const classification = classifySeries({ ticker, title: s.title ?? '' }, rules);
    if (!classification.commodity) {
      unclassifiedSeries.push({ series_ticker: ticker, title: s.title ?? null, reason: classification.classification });
    }
    const markets = marketsBySeries[ticker] ?? [];
    for (const m of markets) {
      if (m.status && m.status !== 'open' && m.status !== 'active') continue;
      const closeTime = m.close_time ?? null;
      const tradableNow = closeTime ? new Date(closeTime).getTime() > Date.now() : true;
      instruments.push({
        instrument_id: `kalshi:${m.ticker}`,
        venue: 'kalshi',
        venue_name: 'Kalshi',
        kind: 'event_contract',
        market_type_label: 'Kalshi event contract',
        ticker: m.ticker,
        series_ticker: ticker,
        title: m.title ?? s.title ?? null,
        subtitle: m.subtitle ?? null,
        commodity: classification.commodity,
        group: classification.group,
        classification: classification.classification,
        strike_type: m.strike_type ?? null,
        floor_strike: m.floor_strike ?? null,
        cap_strike: m.cap_strike ?? null,
        open_time: m.open_time ?? null,
        close_time: closeTime,
        expiration_time: m.expiration_time ?? null,
        is_tradable_now: tradableNow,
        exchange_listed_status: m.status ?? null,
        liquidity_hint: {
          volume_24h: num(m.volume_24h ?? m.volume),
          open_interest: num(m.open_interest),
          liquidity: num(m.liquidity),
        },
        // Contract facts. Kalshi event contracts are binary cash-settled $1 contracts; the fee
        // schedule and the series metadata are the official references for that.
        contract_specification: {
          type: 'binary_event_contract',
          settlement: 'cash',
          payoff_per_contract_usd: 1.0,
          price_range_usd: [0, 1],
          tick_size_usd: 0.01,
          fee_type: s.fee_type ?? null,
          fee_multiplier: s.fee_multiplier ?? 1,
          fee_schedule_url: feeScheduleUrl,
          terms_url: s.contract_terms_url ?? null,
          settlement_sources: s.settlement_sources ?? null,
        },
        listing_provenance: {
          series_endpoint: s.__source_url ?? null,
          markets_endpoint: m.__source_url ?? null,
          retrieved_at: retrievedAt,
          sha256: m.__sha256 ?? null,
        },
        verified_at: new Date().toISOString(),
      });
    }
  }
  return { instruments, unclassifiedSeries };
}

/** Quote a Kalshi event contract from its official order book. */
export function kalshiQuoteFromOrderbook({ ticker, orderbookResponse, provenance }) {
  const payload = orderbookResponse?.orderbook_fp ?? orderbookResponse?.orderbook ?? null;
  if (!payload) return null;
  const parseSide = (levels) =>
    (levels ?? [])
      .map((level) => {
        const price = Number(Array.isArray(level) ? level[0] : level.price);
        const contracts = Number(Array.isArray(level) ? level[1] : level.count ?? level.contracts);
        return Number.isFinite(price) && Number.isFinite(contracts) ? { price, contracts } : null;
      })
      .filter(Boolean);
  const yes = parseSide(payload.yes_dollars ?? payload.yes);
  const no = parseSide(payload.no_dollars ?? payload.no);
  const ladders = buildEventContractLadders({ yes, no });
  return {
    instrument_id: `kalshi:${ticker}`,
    venue: 'kalshi',
    kind: 'event_contract',
    ...ladders,
    source: {
      url: provenance?.url ?? null,
      http_status: provenance?.http_status ?? null,
      sha256: provenance?.sha256 ?? null,
      retrieved_at: provenance?.retrieved_at ?? null,
      note: 'Official Kalshi public order book. The exchange publishes resting bids only; ask prices are the exact complement of the opposing side bid (YES bid x == NO offer 1-x), as documented by Kalshi.',
    },
    verified_at: new Date().toISOString(),
  };
}

/* ------------------------------------------------------- Kalshi perps */

export function buildKalshiPerpInstruments({ marginMarkets, provenance }) {
  const instruments = [];
  const quotes = {};
  for (const m of marginMarkets) {
    const instrumentId = `kalshiperp:${m.ticker}`;
    instruments.push({
      instrument_id: instrumentId,
      venue: 'kalshi_margin',
      venue_name: 'Kalshi Perpetual Futures',
      kind: 'perpetual',
      market_type_label: 'Kalshi perpetual future',
      ticker: m.ticker,
      title: m.title ?? null,
      commodity: m.title ?? m.ticker,
      group: m.asset_class ?? 'Perpetuals',
      asset_class: m.asset_class ?? null,
      status: m.status ?? null,
      contract_specification: {
        type: 'perpetual_future',
        contract_size: num(m.contract_size),
        quote_unit: 'USD per contract',
        tick_size: num(m.tick_size),
        underlying_multiplier: num(m.underlying_multiplier),
        leverage_estimate: num(m.leverage_estimate),
        funding_rate: num(m.funding_rate),
        docs_url: 'https://docs.kalshi.com/margin',
      },
      exchange_metrics: {
        open_interest: num(m.open_interest),
        open_interest_notional_usd: num(m.open_interest_notional_value_dollars),
        volume: num(m.volume),
        volume_24h: num(m.volume_24h),
        volume_24h_notional_usd: num(m.volume_24h_notional_value_dollars),
      },
      listing_provenance: { url: provenance?.url ?? null, sha256: provenance?.sha256 ?? null, retrieved_at: provenance?.retrieved_at ?? null },
      verified_at: new Date().toISOString(),
    });
    quotes[instrumentId] = {
      instrument_id: instrumentId,
      venue: 'kalshi_margin',
      kind: 'perpetual',
      bid: num(m.bid),
      offer: num(m.ask),
      mid: num(m.bid) != null && num(m.ask) != null ? Number(((num(m.bid) + num(m.ask)) / 2).toFixed(8)) : null,
      spread: num(m.bid) != null && num(m.ask) != null ? Number((num(m.ask) - num(m.bid)).toFixed(8)) : null,
      contract_size: num(m.contract_size),
      reference_price: m.reference_price?.price != null ? num(m.reference_price.price) : null,
      settlement_mark_price: m.settlement_mark_price?.price != null ? num(m.settlement_mark_price.price) : null,
      volume_24h_notional_usd: num(m.volume_24h_notional_value_dollars),
      open_interest_notional_usd: num(m.open_interest_notional_value_dollars),
      source: {
        url: provenance?.url ?? null,
        http_status: provenance?.http_status ?? null,
        sha256: provenance?.sha256 ?? null,
        retrieved_at: provenance?.retrieved_at ?? null,
        note: 'Official Kalshi Perps API (/margin namespace). Bid, ask, contract size, mark prices and volume come from the exchange payload.',
      },
      verified_at: new Date().toISOString(),
    };
  }
  return { instruments, quotes };
}

/* ------------------------------------------------------------ MOEX */

export function buildMoexInstrument({ row, classification, quote, valuation, provenance, listing }) {
  const instrumentId = `moex:${row.SECID}`;
  return {
    instrument_id: instrumentId,
    venue: 'moex_forts',
    venue_name: 'Moscow Exchange (MOEX) FORTS',
    kind: 'future',
    market_type_label: 'Exchange-listed commodity future',
    ticker: row.SECID,
    title: row.SHORTNAME ?? null,
    commodity: classification.commodity,
    group: classification.group,
    asset_code: row.ASSETCODE ?? null,
    last_trade_date: row.LASTTRADEDATE ?? null,
    contract_specification: {
      type: 'deliverable_or_cash_settled_future',
      lot_volume: num(row.LOTVOLUME),
      min_step: num(row.MINSTEP),
      step_price_rub: num(row.STEPPRICE),
      face_unit: row.FACEUNIT ?? null,
      initial_margin_rub: num(row.INITIALMARGIN),
      buy_sell_fee_rub: num(row.BUYSELLFEE),
      fees_as_published: {
        buy_sell_fee_rub: num(row.BUYSELLFEE),
        scalper_fee_rub: num(row.SCALPERFEE),
        exercise_fee_rub: num(row.EXERCISEFEE),
      },
      spec_source_url: provenance?.url ?? null,
      spec_source_sha256: provenance?.sha256 ?? null,
      docs_url: 'https://iss.moex.com/iss/reference/',
    },
    usd_valuation: valuation,
    listing_provenance: { url: listing?.url ?? null, sha256: listing?.sha256 ?? null, retrieved_at: listing?.retrieved_at ?? null },
    verified_at: new Date().toISOString(),
  };
}

export function moexQuoteFromPayload({ secid, marketdata, securities, provenance, valuation }) {
  const instrumentId = `moex:${secid}`;
  const bid = num(marketdata?.BID);
  const offer = num(marketdata?.OFFER);
  return {
    instrument_id: instrumentId,
    venue: 'moex_forts',
    kind: 'future',
    bid,
    offer,
    mid: bid != null && offer != null ? Number(((bid + offer) / 2).toFixed(8)) : num(marketdata?.LAST),
    spread: num(marketdata?.SPREAD) ?? (bid != null && offer != null ? Number((offer - bid).toFixed(8)) : null),
    last_price: num(marketdata?.LAST),
    settle_price: num(marketdata?.SETTLEPRICE),
    open_price: num(marketdata?.OPEN),
    high_price: num(marketdata?.HIGH),
    low_price: num(marketdata?.LOW),
    volume_today: num(marketdata?.VOLTODAY),
    value_today_rub: num(marketdata?.VALTODAY),
    num_trades: num(marketdata?.NUMTRADES),
    open_interest: num(marketdata?.OPENPOSITION),
    wap_price: num(marketdata?.WAPRICE),
    trade_date: securities?.TRADEDATE ?? null,
    usd_per_price_unit: valuation?.usd_per_price_unit ?? null,
    usd_per_price_unit_basis: valuation?.basis ?? null,
    source: {
      url: provenance?.url ?? null,
      http_status: provenance?.http_status ?? null,
      sha256: provenance?.sha256 ?? null,
      retrieved_at: provenance?.retrieved_at ?? null,
      note: 'Official MOEX ISS quote. The exchange publishes a best bid/offer, last price, settlement price, traded volume and open interest - but no per-level depth, which is why MOEX fills are quote-based and size-capped by published volume.',
    },
    verified_at: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------ helpers */

export function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Rank instruments so that scarce request budget is spent on the most tradable markets. */
export function liquidityScore(instrument) {
  const hint = instrument.liquidity_hint ?? {};
  const volume = hint.volume_24h ?? 0;
  const oi = hint.open_interest ?? 0;
  const liquidity = hint.liquidity ?? 0;
  return Number(volume) + Number(oi) * 0.25 + Number(liquidity) * 0.1;
}

export function selectTopByLiquidity(instruments, limit, { tradableOnly = true } = {}) {
  return [...instruments]
    .filter((i) => (tradableOnly ? i.is_tradable_now !== false : true))
    .sort((a, b) => liquidityScore(b) - liquidityScore(a))
    .slice(0, limit);
}
