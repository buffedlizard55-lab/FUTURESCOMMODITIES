/**
 * Kalshi venue adapter.
 *
 * Verified against the live public Trade API v2 (no key required) on 2026-09-22:
 *   GET /exchange/status                       -> 200 {"exchange_active":true,"trading_active":true}
 *   GET /markets?limit=5&status=open           -> 200 live markets
 *   GET /markets/{ticker}/orderbook            -> 200 orderbook_fp with real resting sizes
 *   GET /series?category=Commodities           -> 200, 150 series
 *   GET /margin/markets                        -> 200 (perpetual futures, /margin namespace)
 *
 * Order book semantics (official docs): the book publishes BIDS ONLY.
 *   yes_dollars: [[price_dollars, count_fp], ...] ascending, best (highest) bid last
 *   no_dollars : same layout for the NO side
 *   A YES bid at x is the same contract as a NO offer at (1 - x), and vice versa.
 *
 * Nothing in this module invents a market: if a series or market is not returned by the
 * exchange it simply does not exist for this project.
 */

import { get } from '../http.mjs';

export const KALSHI_HOSTS = ['https://api.elections.kalshi.com/trade-api/v2', 'https://external-api.kalshi.com/trade-api/v2'];
export const KALSHI_DOCS = 'https://docs.kalshi.com/';
export const KALSHI_TERMS = 'https://kalshi.com/terms';

export class KalshiClient {
  constructor({ host = KALSHI_HOSTS[0], maxRequests = 400, spacingMs = 120, notes = [] } = {}) {
    this.host = host;
    this.maxRequests = maxRequests;
    this.spacingMs = spacingMs;
    this.requests = 0;
    this.notes = notes;
    this.lastRequestAt = 0;
    this.hostFallbackUsed = false;
  }

  async request(path, { note = null, expect = 'json', allowFallback = true } = {}) {
    if (this.requests >= this.maxRequests) {
      throw new Error(`request budget exhausted (${this.maxRequests}) before ${path}`);
    }
    const wait = this.spacingMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
    this.requests += 1;

    const url = `${this.host}${path}`;
    let res = await get(url, { note, expect });
    if (!res.ok && allowFallback && this.host !== KALSHI_HOSTS[1] && (res.status === null || res.status >= 500)) {
      const fallbackHost = KALSHI_HOSTS[1];
      const fallbackUrl = `${fallbackHost}${path}`;
      const retry = await get(fallbackUrl, { note: `${note ?? path} (fallback host)`, expect });
      if (retry.ok) {
        this.host = fallbackHost;
        this.hostFallbackUsed = true;
        res = retry;
      }
    }
    this.notes.push({ endpoint: res.provenance.url, ok: res.ok, http_status: res.provenance.http_status, sha256: res.provenance.sha256 });
    return res;
  }

  async exchangeStatus() {
    return this.request('/exchange/status', { note: 'Kalshi exchange status' });
  }

  /** All series in a category, following cursors. */
  async seriesByCategory(category) {
    const out = [];
    let cursor = null;
    for (let page = 0; page < 20; page += 1) {
      const qs = new URLSearchParams({ category, include_product_metadata: 'true' });
      if (cursor) qs.set('cursor', cursor);
      const res = await this.request(`/series?${qs.toString()}`, { note: `Kalshi series list for category ${category}` });
      if (!res.ok || !res.json) return { ok: false, series: out, provenance: res.provenance };
      out.push(...(res.json.series ?? []));
      cursor = res.json.cursor ?? null;
      if (!cursor) break;
    }
    return { ok: true, series: out };
  }

  /** Open markets for a series (markets endpoint supports series_ticker + cursor). */
  async markets({ seriesTicker = null, status = 'open', tickers = null, limit = 200, maxPages = 5 } = {}) {
    const out = [];
    let cursor = null;
    for (let page = 0; page < maxPages; page += 1) {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (status) qs.set('status', status);
      if (seriesTicker) qs.set('series_ticker', seriesTicker);
      if (tickers?.length) qs.set('tickers', tickers.join(','));
      if (cursor) qs.set('cursor', cursor);
      const res = await this.request(`/markets?${qs.toString()}`, { note: `Kalshi markets (series=${seriesTicker ?? 'all'}, status=${status})` });
      if (!res.ok || !res.json) return { ok: false, markets: out, provenance: res.provenance };
      out.push(...(res.json.markets ?? []));
      cursor = res.json.cursor ?? null;
      if (!cursor) break;
    }
    return { ok: true, markets: out };
  }

  async market(ticker) {
    return this.request(`/markets/${encodeURIComponent(ticker)}`, { note: `Kalshi market record for ${ticker} (used for settlement results)` });
  }

  async orderbook(ticker, { depth = 20 } = {}) {
    return this.request(`/markets/${encodeURIComponent(ticker)}/orderbook?depth=${depth}`, {
      note: `Kalshi order book (bids only, official semantics) for ${ticker}`,
    });
  }

  /**
   * Daily candlesticks for a market. The exact path has changed over time, so the documented
   * candidates are tried in order and the one that answered is recorded on the data.
   */
  async candlesticks({ seriesTicker, marketTicker, startTs, endTs, periodInterval = 1440 }) {
    const qs = new URLSearchParams({ start_ts: String(startTs), end_ts: String(endTs), period_interval: String(periodInterval) });
    const candidates = [
      `/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(marketTicker)}/candlesticks?${qs.toString()}`,
      `/markets/${encodeURIComponent(marketTicker)}/candlesticks?${qs.toString()}`,
      `/historical/markets/${encodeURIComponent(marketTicker)}/candlesticks?${qs.toString()}`,
    ];
    const tried = [];
    for (const path of candidates) {
      const res = await this.request(path, { note: `Kalshi candlesticks for ${marketTicker}` });
      tried.push({ path, ok: res.ok, status: res.provenance.http_status });
      if (res.ok && res.json) {
        return { ok: true, path, tried, candles: res.json.candlesticks ?? [], provenance: res.provenance };
      }
    }
    return { ok: false, path: null, tried, candles: [], provenance: null };
  }

  /** Perpetual futures (official /margin namespace). */
  async marginMarkets({ limit = 200, maxPages = 3 } = {}) {
    const out = [];
    let cursor = null;
    for (let page = 0; page < maxPages; page += 1) {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (cursor) qs.set('cursor', cursor);
      const res = await this.request(`/margin/markets?${qs.toString()}`, { note: 'Kalshi perpetual futures market list (/margin namespace)' });
      if (!res.ok || !res.json) return { ok: false, markets: out, provenance: res.provenance };
      out.push(...(res.json.markets ?? []));
      cursor = res.json.cursor ?? null;
      if (!cursor) break;
    }
    return { ok: true, markets: out };
  }

  async marginMarket(ticker) {
    return this.request(`/margin/markets/${encodeURIComponent(ticker)}`, { note: `Kalshi perp market record for ${ticker}` });
  }
}

export function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
