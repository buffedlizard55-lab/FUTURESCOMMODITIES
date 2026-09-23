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
  constructor({ host = KALSHI_HOSTS[0], maxRequests = 400, spacingMs = 220, notes = [] } = {}) {
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
      // A budget overrun degrades the venue instead of crashing the whole tick: every caller
      // already handles res.ok === false by recording the step as degraded.
      return {
        ok: false,
        status: null,
        json: null,
        text: null,
        provenance: {
          url: `${this.host}${path}`,
          http_status: null,
          ok: false,
          error: `request budget exhausted (${this.maxRequests}) before ${path}`,
          retrieved_at: new Date().toISOString(),
        },
      };
    }
    const wait = this.spacingMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
    this.requests += 1;

    const url = `${this.host}${path}`;
    let res = await get(url, { note, expect });
    // The public API documents rate limiting. When it answers 429, wait and retry once rather
    // than treating the market as unavailable - but never invent a value.
    if (res.provenance?.http_status === 429) {
      const retryAfter = Number(res.provenance?.retry_after ?? 0);
      const waitMs = Math.max(1000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      res = await get(url, { note: `${note ?? path} (retry after 429)`, expect });
      if (res.ok) this.notes.push({ endpoint: url, ok: true, http_status: res.provenance.http_status, note: 'succeeded on retry after 429' });
    }
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
    let provenance = null;
    for (let page = 0; page < 20; page += 1) {
      const qs = new URLSearchParams({ category, include_product_metadata: 'true' });
      if (cursor) qs.set('cursor', cursor);
      const res = await this.request(`/series?${qs.toString()}`, { note: `Kalshi series list for category ${category}` });
      if (!res.ok || !res.json) return { ok: false, series: out, provenance: res.provenance };
      provenance = res.provenance;
      out.push(...(res.json.series ?? []));
      cursor = res.json.cursor ?? null;
      if (!cursor) break;
    }
    return { ok: true, series: out, provenance };
  }

  /** Open markets for a series (markets endpoint supports series_ticker + cursor). */
  async markets({ seriesTicker = null, status = 'open', tickers = null, limit = 200, maxPages = 5 } = {}) {
    const out = [];
    let cursor = null;
    let provenance = null;
    for (let page = 0; page < maxPages; page += 1) {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (status) qs.set('status', status);
      if (seriesTicker) qs.set('series_ticker', seriesTicker);
      if (tickers?.length) qs.set('tickers', tickers.join(','));
      if (cursor) qs.set('cursor', cursor);
      const res = await this.request(`/markets?${qs.toString()}`, { note: `Kalshi markets (series=${seriesTicker ?? 'all'}, status=${status})` });
      if (!res.ok || !res.json) return { ok: false, markets: out, provenance: res.provenance };
      provenance = res.provenance;
      out.push(...(res.json.markets ?? []));
      cursor = res.json.cursor ?? null;
      if (!cursor) break;
    }
    return { ok: true, markets: out, provenance, pages: Math.min(maxPages, out.length ? 1 : 0) };
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

  /**
   * Finalised funding events for a perpetual market. Official, keyless endpoint
   * `GET /margin/funding_rates/historical` (docs.kalshi.com "Get Historical Funding Rates",
   * perps REST API, `security: []` in the published OpenAPI spec). Each entry is
   * exchange-published: `funding_time` (RFC3333), `funding_rate` (decimal fraction for the
   * 8-hour period), `mark_price` (fixed-point dollars). Funding is applied at 12:00 AM /
   * 8:00 AM / 4:00 PM ET per the official contract specifications.
   */
  async fundingRatesHistorical(ticker, { startTs = null, endTs = null } = {}) {
    const qs = new URLSearchParams();
    if (ticker) qs.set('ticker', ticker);
    if (startTs != null) qs.set('start_ts', String(startTs));
    if (endTs != null) qs.set('end_ts', String(endTs));
    const res = await this.request(`/margin/funding_rates/historical?${qs.toString()}`, { note: `Kalshi perps historical funding rates for ${ticker}` });
    if (!res.ok || !res.json) return { ok: false, rates: [], provenance: res.provenance };
    return { ok: true, rates: res.json.funding_rates ?? [], provenance: res.provenance };
  }

  /**
   * Estimated funding rate for the in-progress 8-hour period. Official, keyless endpoint
   * `GET /margin/funding_rates/estimate` (docs.kalshi.com "Get Funding Rate Estimate",
   * `security: []`). Informational: the simulation settles funding from the *finalised*
   * historical events, not from estimates.
   */
  async fundingRateEstimate(ticker) {
    const res = await this.request(`/margin/funding_rates/estimate?ticker=${encodeURIComponent(ticker)}`, { note: `Kalshi perps funding rate estimate for ${ticker}` });
    if (!res.ok || !res.json) return { ok: false, estimate: null, provenance: res.provenance };
    return { ok: true, estimate: res.json, provenance: res.provenance };
  }

  /**
   * Daily candlesticks for many markets in one request (official endpoint
   * `GET /markets/candlesticks`, "Batch Get Market Candlesticks", docs.kalshi.com,
   * Trade API Manual Endpoints v3.30.0, no authentication).
   *
   * Verified against the official OpenAPI definition on 2026-09-22:
   *   - up to 100 market tickers per request (comma-separated `market_tickers`);
   *   - up to 10,000 candlesticks returned per response across all markets, so a
   *     90-day daily window (<= 90 candles per market) stays under the cap at 100 markets;
   *   - the response groups candlesticks by `market_ticker`; a market that is absent from
   *     the response is reported as missing rather than assumed empty.
   */
  async candlesticksBatch({ marketTickers, startTs, endTs, periodInterval = 1440, batchSize = 100 }) {
    const byMarket = {};
    let provenance = null;
    const tickers = [...new Set(marketTickers)];
    for (let i = 0; i < tickers.length; i += batchSize) {
      const chunk = tickers.slice(i, i + batchSize);
      const qs = new URLSearchParams({
        market_tickers: chunk.join(','),
        start_ts: String(startTs),
        end_ts: String(endTs),
        period_interval: String(periodInterval),
      });
      const res = await this.request(`/markets/candlesticks?${qs.toString()}`, { note: `Kalshi batch candlesticks for ${chunk.length} markets` });
      if (!res.ok || !res.json) return { ok: false, byMarket, provenance: res.provenance, missing: tickers.slice(i) };
      provenance = res.provenance;
      for (const entry of res.json.markets ?? []) {
        byMarket[entry.market_ticker] = entry.candlesticks ?? [];
      }
    }
    return { ok: true, byMarket, provenance, missing: [] };
  }

  /** Perpetual futures (official /margin namespace). */
  async marginMarkets({ limit = 200, maxPages = 3 } = {}) {
    const out = [];
    let cursor = null;
    let provenance = null;
    for (let page = 0; page < maxPages; page += 1) {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (cursor) qs.set('cursor', cursor);
      const res = await this.request(`/margin/markets?${qs.toString()}`, { note: 'Kalshi perpetual futures market list (/margin namespace)' });
      if (!res.ok || !res.json) return { ok: false, markets: out, provenance: res.provenance };
      provenance = res.provenance;
      out.push(...(res.json.markets ?? []));
      cursor = res.json.cursor ?? null;
      if (!cursor) break;
    }
    return { ok: true, markets: out, provenance, pages: Math.min(maxPages, out.length ? 1 : 0) };
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
