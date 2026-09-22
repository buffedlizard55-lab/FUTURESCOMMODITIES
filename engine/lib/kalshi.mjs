/**
 * Kalshi official public API client + market-microstructure helpers.
 *
 * Verified facts (2026-09-22, see docs/VERIFICATION.md for raw evidence):
 *  - Base URL: https://api.elections.kalshi.com/trade-api/v2  (HTTP 200 on /exchange/status)
 *    Alternative production host: https://external-api.kalshi.com/trade-api/v2 (from official docs)
 *  - Public market-data endpoints require no API key (official docs: "No authentication is
 *    required for this endpoint" for /markets/{ticker}/orderbook).
 *  - Order books return *bids only*, wrapped in `orderbook_fp`, arrays sorted ascending:
 *      yes_dollars: [[price, count], ...]   no_dollars: [[price, count], ...]
 *    In a binary market a NO bid at price y is equivalent to a YES ask at (1 - y), and a
 *    YES bid at price x is equivalent to a NO ask at (1 - x). (Official docs, verbatim.)
 *  - Fees (official Kalshi fee schedule, "Fee Schedule for July 2026 - 7.7.26 Update"):
 *      taker: roundup(M * 0.07  * C * P * (1-P))
 *      maker: roundup(M * 0.0175 * C * P * (1-P))   M defaults to 0 => maker fee 0
 *    "round up = rounds up such that the fee + positionCost is rounded to a centicent".
 *    Worked cross-check from the official table: 100 contracts @ $0.50 -> $1.75
 *    (= 100 * 0.07 * 0.5 * 0.5), 100 contracts @ $0.01 -> $0.07 (0.0693 rounded up to cent).
 *  - Perpetual futures ("perps") live under /margin/*  (official "Perps API" docs).
 *    Verified live tickers include KXGOLDPERP, KXSILVERPERP, KXPLATINUMPERP, KXPALLADIUMPERP.
 */

import { fetchJson, sleep } from './http.mjs';

export const KALSHI_HOSTS = [
  'https://api.elections.kalshi.com/trade-api/v2',
  'https://external-api.kalshi.com/trade-api/v2',
];

/** Round up to a decimal grid, avoiding binary floating point surprises. */
export function roundUpTo(value, decimals) {
  const f = 10 ** decimals;
  const scaled = value * f;
  const rounded = Math.ceil(Number((scaled - 1e-9).toFixed(6)));
  return Number((rounded / f).toFixed(decimals));
}

/**
 * Official Kalshi taker fee for an immediately-matched order.
 * @param {object} p
 * @param {number} p.price      contract price in dollars (0..1)
 * @param {number} p.contracts  number of contracts (may be fractional)
 * @param {number} [p.multiplier=1]  series fee multiplier M (default 1)
 * @param {number} [p.precision=2]   balance precision in decimals:
 *                                   2 => round up to the cent (~$0.01, published table,
 *                                   used for FCM / non-direct members)
 *                                   4 => round up to centicent ($0.0001, direct members)
 */
export function kalshiTakerFee({ price, contracts, multiplier = 1, precision = 2 }) {
  const raw = multiplier * 0.07 * contracts * price * (1 - price);
  return roundUpTo(raw, precision);
}

/** Official Kalshi maker fee: multiplier M defaults to 0 for standard markets. */
export function kalshiMakerFee({ price, contracts, multiplier = 0, precision = 2 }) {
  const raw = multiplier * 0.0175 * contracts * price * (1 - price);
  return roundUpTo(raw, precision);
}

export class KalshiClient {
  constructor({ host = KALSHI_HOSTS[0], requestSpacingMs = 120, maxRequests = Infinity, log = () => {} } = {}) {
    this.host = host;
    this.requestSpacingMs = requestSpacingMs;
    this.maxRequests = maxRequests;
    this.requests = 0;
    this.log = log;
    this.provenance = [];
  }

  async #get(path, { note, retries = 2 } = {}) {
    if (this.requests >= this.maxRequests) {
      const err = new Error(`request budget exhausted (${this.maxRequests})`);
      err.code = 'BUDGET';
      throw err;
    }
    if (this.requests > 0 && this.requestSpacingMs > 0) await sleep(this.requestSpacingMs);
    const url = `${this.host}${path}`;
    const res = await fetchJson(url, { note, retries });
    this.requests += 1;
    this.provenance.push(res.provenance);
    if (!res.ok) {
      const err = new Error(`GET ${url} failed: status=${res.status} ${JSON.stringify(res.provenance).slice(0, 200)}`);
      err.status = res.status;
      err.provenance = res.provenance;
      throw err;
    }
    return { json: res.json, provenance: res.provenance };
  }

  exchangeStatus() {
    return this.#get('/exchange/status', { note: 'Kalshi exchange status (official public endpoint)' });
  }

  exchangeSchedule() {
    return this.#get('/exchange/schedule', { note: 'Kalshi exchange schedule (official public endpoint)' });
  }

  /** All series for a category. `includeProductMetadata` adds per-series product metadata. */
  seriesByCategory(category, { includeProductMetadata = false } = {}) {
    const q = new URLSearchParams({ category });
    if (includeProductMetadata) q.set('include_product_metadata', 'true');
    return this.#get(`/series?${q}`, {
      note: `Kalshi series list for category=${category} (official public endpoint)`,
    });
  }

  series(ticker) {
    return this.#get(`/series/${encodeURIComponent(ticker)}`, {
      note: `Kalshi series metadata for ${ticker} (official public endpoint)`,
    });
  }

  markets({ status = 'open', seriesTicker = null, eventTicker = null, limit = 200, cursor = null, minCloseTs = null, maxCloseTs = null } = {}) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (status) q.set('status', status);
    if (seriesTicker) q.set('series_ticker', seriesTicker);
    if (eventTicker) q.set('event_ticker', eventTicker);
    if (cursor) q.set('cursor', cursor);
    if (minCloseTs) q.set('min_close_ts', String(minCloseTs));
    if (maxCloseTs) q.set('max_close_ts', String(maxCloseTs));
    return this.#get(`/markets?${q}`, { note: `Kalshi markets (${q}) (official public endpoint)` });
  }

  market(ticker) {
    return this.#get(`/markets/${encodeURIComponent(ticker)}`, {
      note: `Kalshi market metadata for ${ticker} (official public endpoint)`,
    });
  }

  orderbook(ticker) {
    return this.#get(`/markets/${encodeURIComponent(ticker)}/orderbook`, {
      note: `Kalshi live order book snapshot for ${ticker} (official public endpoint)`,
    });
  }

  /**
   * Candlesticks: GET /series/{series_ticker}/markets/{ticker}/candlesticks
   * Official doc "Get Market Candlesticks": period_interval in minutes, valid 1 | 60 | 1440;
   * returns yes_bid/yes_ask OHLC + traded price OHLC + volume + open interest.
   */
  candlesticks(seriesTicker, ticker, { startTs, endTs, periodInterval = 1440 }) {
    const q = new URLSearchParams({
      start_ts: String(startTs),
      end_ts: String(endTs),
      period_interval: String(periodInterval),
    });
    return this.#get(`/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(ticker)}/candlesticks?${q}`, {
      note: `Kalshi candlesticks ${ticker} interval=${periodInterval}min (official public endpoint)`,
    });
  }

  trades({ limit = 200, ticker = null, cursor = null } = {}) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (ticker) q.set('ticker', ticker);
    if (cursor) q.set('cursor', cursor);
    return this.#get(`/markets/trades?${q}`, { note: 'Kalshi public trade tape (official public endpoint)' });
  }

  historicalCutoff() {
    return this.#get('/historical/cutoff', { note: 'Kalshi live/historical data cutoff (official public endpoint)' });
  }

  historicalMarkets({ limit = 200, cursor = null, seriesTicker = null } = {}) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set('cursor', cursor);
    if (seriesTicker) q.set('series_ticker', seriesTicker);
    return this.#get(`/historical/markets?${q}`, { note: `Kalshi settled markets via historical API (${q})` });
  }

  historicalCandlesticks(ticker, { startTs, endTs, periodInterval = 1440 }) {
    const q = new URLSearchParams({
      start_ts: String(startTs),
      end_ts: String(endTs),
      period_interval: String(periodInterval),
    });
    return this.#get(`/historical/markets/${encodeURIComponent(ticker)}/candlesticks?${q}`, {
      note: `Kalshi historical candlesticks ${ticker} interval=${periodInterval}min`,
    });
  }

  /** Perpetual futures (official "Perps API", /margin namespace). */
  marginMarkets({ limit = 200, cursor = null } = {}) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set('cursor', cursor);
    return this.#get(`/margin/markets?${q}`, { note: 'Kalshi perpetual futures markets (official Perps API)' });
  }

  marginMarket(ticker) {
    return this.#get(`/margin/markets/${encodeURIComponent(ticker)}`, {
      note: `Kalshi perpetual futures market ${ticker} (official Perps API)`,
    });
  }

  marginCandlesticks(ticker, { startTs, endTs, periodInterval = 60 } = {}) {
    const q = new URLSearchParams({
      start_ts: String(startTs),
      end_ts: String(endTs),
      period_interval: String(periodInterval),
    });
    return this.#get(`/margin/markets/${encodeURIComponent(ticker)}/candlesticks?${q}`, {
      note: `Kalshi perpetual candlesticks ${ticker} interval=${periodInterval}min`,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Order book mechanics (binary contract, bids-only book)              */
/* ------------------------------------------------------------------ */

export function parseLevels(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(([price, count]) => ({ price: Number(price), contracts: Number(count) }))
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.contracts) && l.contracts > 0)
    .sort((a, b) => a.price - b.price); // ascending, per official docs
}

/**
 * Convert a raw Kalshi order book into explicit YES-side and NO-side ladders.
 * `buyYesLevels` are the executable offers for buying YES (from NO bids, descending NO price
 * => ascending YES ask). `buyNoLevels` are the executable offers for buying NO.
 */
export function bookFromRaw(raw) {
  const fp = raw?.orderbook_fp ?? raw?.orderbook ?? {};
  const yesBids = parseLevels(fp.yes_dollars ?? fp.yes ?? []);
  const noBids = parseLevels(fp.no_dollars ?? fp.no ?? []);
  const bestYesBid = yesBids.length ? yesBids[yesBids.length - 1].price : null;
  const bestNoBid = noBids.length ? noBids[noBids.length - 1].price : null;
  const buyYesLevels = noBids
    .slice()
    .reverse()
    .map((l) => ({ price: Number((1 - l.price).toFixed(4)), contracts: l.contracts, derived_from: `NO bid at ${l.price}` }));
  const buyNoLevels = yesBids
    .slice()
    .reverse()
    .map((l) => ({ price: Number((1 - l.price).toFixed(4)), contracts: l.contracts, derived_from: `YES bid at ${l.price}` }));
  const bestYesAsk = buyYesLevels.length ? buyYesLevels[0].price : null;
  const bestNoAsk = buyNoLevels.length ? buyNoLevels[0].price : null;
  const mid = bestYesBid != null && bestYesAsk != null ? (bestYesBid + bestYesAsk) / 2 : null;
  return {
    yesBids,
    noBids,
    buyYesLevels,
    buyNoLevels,
    bestYesBid,
    bestNoBid,
    bestYesAsk,
    bestNoAsk,
    spread: bestYesBid != null && bestYesAsk != null ? Number((bestYesAsk - bestYesBid).toFixed(4)) : null,
    mid,
    yesDepthContracts: yesBids.reduce((s, l) => s + l.contracts, 0),
    noDepthContracts: noBids.reduce((s, l) => s + l.contracts, 0),
  };
}

/**
 * Walk a ladder for a taker order. Returns the size-aware fill including per-level detail.
 * `side`: 'yes' or 'no' (the outcome being bought or sold).
 * `action`: 'buy' (take offers) or 'sell' (hit bids).
 * For sells we use the opposite side's bids: selling YES hits YES bids.
 * Returns null if there is no executable liquidity.
 */
export function walkBookForTaker({ book, outcome, action, contracts, limitPrice = null }) {
  let ladder;
  if (action === 'buy' && outcome === 'yes') ladder = book.buyYesLevels;
  else if (action === 'buy' && outcome === 'no') ladder = book.buyNoLevels;
  else if (action === 'sell' && outcome === 'yes') ladder = book.yesBids.slice().reverse();
  else if (action === 'sell' && outcome === 'no') ladder = book.noBids.slice().reverse();
  else throw new Error(`unsupported order: ${action} ${outcome}`);

  if (!ladder.length) return null;

  let remaining = contracts;
  const levels = [];
  let notional = 0;
  for (const level of ladder) {
    if (remaining <= 0) break;
    if (limitPrice != null) {
      const acceptable = action === 'buy' ? level.price <= limitPrice + 1e-9 : level.price >= limitPrice - 1e-9;
      if (!acceptable) break;
    }
    const take = Math.min(remaining, level.contracts);
    if (take <= 0) continue;
    notional += take * level.price;
    levels.push({ price: level.price, contracts: take, ...(level.derived_from ? { derived_from: level.derived_from } : {}) });
    remaining -= take;
  }
  const filled = contracts - remaining;
  if (filled <= 0) return null;
  return {
    filled,
    requested: contracts,
    unfilled: remaining,
    vwap: Number((notional / filled).toFixed(6)),
    levels,
    worstPrice: levels[levels.length - 1].price,
    bestPrice: levels[0].price,
    notional_usd: Number(notional.toFixed(6)),
  };
}
