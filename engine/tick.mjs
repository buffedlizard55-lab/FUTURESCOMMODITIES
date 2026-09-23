#!/usr/bin/env node
/**
 * One competition tick.
 *
 *   fetch official data -> build the verified universe -> let every strategy decide ->
 *   simulate fills -> mark positions -> settle expired markets -> publish state and ledger.
 *
 * Usage:
 *   node engine/tick.mjs [--dry-run] [--max-requests=N] [--offline]
 *
 * Hard rules implemented here:
 *  1. No price, size, date, fee or contract fact is invented. Every value written to the ledger
 *     is copied from a payload fetched during this run, and the payload hash is recorded.
 *  2. A strategy that lacks verified data for an instrument does not trade that instrument; the
 *     reason is recorded as an intent.
 *  3. Fills consume real liquidity: Kalshi taker orders walk the published ladder and are capped
 *     at 25% of the size resting within 2 cents of the offer; MOEX orders are capped at a share
 *     of the exchange-published volume and open interest; perp orders are capped by published
 *     24h notional volume.
 *  4. Nothing is traded on a market the exchange has already closed.
 *  5. If a venue is unreachable the run is marked degraded and the state is left untouched rather
 *     than filled with guesses.
 */

import { readdirSync as readdirSyncSafe, rmSync } from 'node:fs';
import { get as httpGet, nowIso, provenanceSnapshot } from './lib/http.mjs';
import { KalshiClient } from './lib/venues/kalshi.mjs';
import { fetchFortsSecurities, fetchHistory, fetchSecurity, fetchUsdRub, moexSecurityDescription, classifyMoexContract } from './lib/venues/moex.mjs';
import { archiveSeries, EIA_HISTORICAL_FUTURES_SERIES, EIA_FUTURES_PAGE, EIA_FUTURES_LAST_DATE } from './lib/venues/eia.mjs';
import {
  applyFill,
  markPortfolio,
  newPortfolio,
  returnPct,
  simulateEventContractMakerFill,
  simulateEventContractTakerFill,
  simulateQuoteFill,
  settlePosition,
  tradeId,
  walkLadder,
} from './lib/portfolio.mjs';
import {
  buildTrade,
  executeEventContractOrder,
  executeQuoteOrder,
  feeInUsd,
  intentRecord,
  positionMargin,
  processWorkingOrders,
  registerWorkingOrder,
} from './lib/execution.mjs';

import {
  buildKalshiInstruments,
  buildKalshiPerpInstruments,
  buildMoexInstrument,
  kalshiQuoteFromOrderbook,
  liquidityScore,
  moexQuoteFromPayload,
  num,
} from './lib/universe.mjs';
import { STRATEGIES, strategyCatalog } from './strategies/index.mjs';
import { appendJsonl, ensureDir, fileAgeHours, paths, pruneDirectory, readJson, readJsonl, writeJson, writeJsonIfChanged } from './lib/store.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const OFFLINE = args.includes('--offline');
const MAX_REQUESTS = Number((args.find((a) => a.startsWith('--max-requests=')) ?? '--max-requests=400').split('=')[1]);

// Pick which of the classified MOEX contracts to track: the nearest two expiries of every asset
// the exchange lists, with a dedicated slot for the non-commodity sectors (max_sector_contracts)
// and a total budget of max_contracts. Commodity assets keep the remainder of the budget.
function selectMoexFutures(classified, watchlist) {
  const byAsset = new Map();
  for (const item of classified) {
    const key = item.klass.asset_code;
    if (!byAsset.has(key)) byAsset.set(key, []);
    byAsset.get(key).push(item);
  }
  const nearestTwo = (items) => {
    items.sort((a, b) => String(a.row.LASTTRADEDATE ?? '').localeCompare(String(b.row.LASTTRADEDATE ?? '')));
    return items.slice(0, 2);
  };
  const commodityLimited = [];
  const sectorLimited = [];
  for (const [, items] of byAsset) {
    if (items[0].klass.sector === 'commodity') commodityLimited.push(...nearestTwo(items));
    else sectorLimited.push(...nearestTwo(items));
  }
  // The sector block is placed first so that, even under a tight total budget, the non-commodity
  // sectors (which the brief explicitly requires) keep their dedicated slot before commodities
  // fill the remainder.
  const limited = [...sectorLimited.slice(0, watchlist.moex?.max_sector_contracts ?? 12), ...commodityLimited];
  limited.splice(watchlist.moex?.max_contracts ?? 56);
  return { limited, assetCount: byAsset.size, sectorCount: sectorLimited.length };
}

// Pure core of the perps-funding settlement (official semantics, Kalshi help centre
// "How Funding Works"): for each open position on an instrument, settle every finalised
// exchange funding event strictly after the position's last settled funding time (or its
// entry time) and at or before now. Events with |rate| < 0.01% are treated as zero (no
// payment, official rule). payment = contracts x mark_price x funding_rate x direction,
// long = +1. Returns the payments in settlement order and advances each position's
// last_funding_time in place.
function settleFundingForPositions({ positions, eventsByInstrument, nowMs }) {
  const payments = [];
  for (const [instrumentId, position] of Object.entries(positions ?? {})) {
    if (!position || position.status === 'closed' || !(Number(position.contracts) > 0)) continue;
    const events = eventsByInstrument.get(instrumentId);
    if (!events) continue;
    const sinceMs = new Date(position.last_funding_time ?? position.entry_ts).getTime();
    if (!Number.isFinite(sinceMs)) continue;
    const rates = [...(events.rates ?? [])].sort(
      (a, b) => Date.parse(a.funding_time) - Date.parse(b.funding_time),
    );
    for (const ev of rates) {
      const tMs = Date.parse(ev.funding_time);
      if (!Number.isFinite(tMs) || tMs <= sinceMs || tMs > nowMs) continue;
      const rate = Number(ev.funding_rate);
      if (!Number.isFinite(rate) || Math.abs(rate) < 0.0001) continue; // official zero threshold
      const mark = Number(ev.mark_price);
      if (!(mark > 0)) continue;
      const direction = position.side === 'long' ? 1 : -1;
      const paymentUsd = Number((Number(position.contracts) * mark * rate * direction).toFixed(6));
      payments.push({
        instrument_id: instrumentId,
        funding_time: ev.funding_time,
        mark,
        rate,
        contracts: Number(position.contracts),
        side: position.side,
        entryTs: position.entry_ts ?? null,
        paymentUsd,
      });
      position.last_funding_time = ev.funding_time;
    }
  }
  return payments;
}

async function main() {
  const startedAt = nowIso();
  const runId = `run-${startedAt.replace(/[:.]/g, '-')}`;
  const competition = readJson(`${paths.config}/competition.json`, null);
  const watchlist = readJson(`${paths.config}/watchlist.json`, null);
  const registry = readJson('engine/universe/futures-registry.json', { products: [], exchanges: {} });
  if (!competition || !watchlist) {
    console.error('missing config/competition.json or config/watchlist.json');
    process.exit(2);
  }

  const notes = [];
  const degraded = [];
  const kalshi = new KalshiClient({ maxRequests: MAX_REQUESTS, spacingMs: competition.request_spacing_ms ?? 120, notes });
  const provenanceNotes = [];

  console.log(`== FUTURESCOMMODITIES tick ${runId}`);

  /* ---------------------------------------------------------- 1. Kalshi */

  let kalshiStatus = null;
  let series = [];
  let marketsBySeries = {};
  let instruments = [];
  let unclassified = [];
  let kalshiQuotes = {};
  let perpInstruments = [];
  let perpQuotes = {};
  let quotedSeriesCount = 0;

  if (!OFFLINE) {
    const status = await kalshi.exchangeStatus();
    kalshiStatus = { ok: status.ok, payload: status.json, provenance: status.provenance };
    if (!status.ok) degraded.push({ venue: 'kalshi', step: 'exchange_status', error: describe(status) });

    const seriesList = await kalshi.seriesByCategory(watchlist.kalshi?.category ?? 'Commodities');
    if (!seriesList.ok) degraded.push({ venue: 'kalshi', step: 'series', error: 'series listing failed' });
    const allSeries = seriesList.series ?? [];
    const rules = watchlist.kalshi?.classification_rules ?? [];
    // Classify first, then keep the matched series: slicing before classification would drop
    // commodities that happen to sit later in the exchange's listing order.
    const matchedSeries = allSeries.filter((series) =>
      rules.some((rule) => new RegExp(rule.pattern, 'i').test(`${series.ticker ?? series.series_ticker} ${series.title ?? ''}`)),
    );
    series = matchedSeries;
    for (const s of series) {
      s.__source_url = `${kalshi.host}/series?category=${encodeURIComponent(watchlist.kalshi?.category ?? 'Commodities')}`;
    }
    console.log(`   kalshi series fetched: ${allSeries.length} total, ${series.length} commodity series matched`);

    // Open markets are pulled per matched series: a global sweep would spend the whole request
    // budget on the exchange's non-commodity markets before reaching these.
    for (const s of series) {
      const ticker = s.ticker ?? s.series_ticker;
      const res = await kalshi.markets({ seriesTicker: ticker, status: 'open', limit: 100, maxPages: 1 });
      if (!res.ok) {
        degraded.push({ venue: 'kalshi', step: 'markets', series: ticker, error: describe(res) });
        continue;
      }
      for (const m of res.markets) {
        m.__source_url = `${kalshi.host}/markets?status=open&series_ticker=${ticker}`;
        m.__sha256 = res.provenance?.sha256 ?? null;
        m.series_ticker = m.series_ticker ?? ticker;
      }
      marketsBySeries[ticker] = res.markets;
    }
    console.log(`   kalshi open markets kept: ${Object.values(marketsBySeries).reduce((n, list) => n + list.length, 0)} across ${Object.keys(marketsBySeries).length} series`);

    const built = buildKalshiInstruments({
      series,
      marketsBySeries,
      rules: watchlist.kalshi?.classification_rules ?? [],
      feeScheduleUrl: competition.fee_schedule_url,
      retrievedAt: nowIso(),
    });
    instruments = built.instruments;
    unclassified = built.unclassifiedSeries;

    // Quote only the most tradable markets, and only ones that are still open.
    const quoted = instruments
      .filter((i) => i.commodity && i.is_tradable_now)
      .sort((a, b) => liquidityScore(b) - liquidityScore(a))
      .slice(0, watchlist.kalshi?.max_quoted_markets ?? 45);
    for (const inst of quoted) {
      const res = await kalshi.orderbook(inst.ticker, { depth: 20 });
      if (!res.ok) {
        degraded.push({ venue: 'kalshi', step: 'orderbook', ticker: inst.ticker, error: describe(res) });
        continue;
      }
      const quote = kalshiQuoteFromOrderbook({ ticker: inst.ticker, orderbookResponse: res.json, provenance: res.provenance });
      if (quote) {
        kalshiQuotes[inst.instrument_id] = quote;
        inst.quote = {
          best_yes_bid: quote.best_yes_bid,
          best_yes_ask: quote.best_yes_ask,
          best_no_bid: quote.best_no_bid,
          best_no_ask: quote.best_no_ask,
          spread: quote.spread,
          mid: quote.mid,
          source_url: quote.source.url,
          sha256: quote.source.sha256,
          retrieved_at: quote.source.retrieved_at,
        };
      }
    }
    quotedSeriesCount = new Set(quoted.map((q) => q.series_ticker)).size;
    console.log(`   kalshi markets: ${instruments.length} listed, ${Object.keys(kalshiQuotes).length} quoted`);

    const perps = await kalshi.marginMarkets({ limit: 200 });
    if (perps.ok) {
      const builtPerps = buildKalshiPerpInstruments({ marginMarkets: perps.markets, provenance: { ...perps.provenance, url: `${kalshi.host}/margin/markets?limit=200` } });
      const allowedClasses = watchlist.kalshi?.perp_asset_classes ?? ['Metals'];
      const keep = (i) => allowedClasses.some((c) => String(i.asset_class ?? '').toLowerCase().includes(String(c).toLowerCase()));
      const selected = builtPerps.instruments.filter(keep).slice(0, watchlist.kalshi?.max_perps ?? 12);
      const selectedIds = new Set(selected.map((i) => i.instrument_id));
      perpInstruments = selected;
      perpQuotes = Object.fromEntries(Object.entries(builtPerps.quotes).filter(([k]) => selectedIds.has(k)));
      // In-progress funding estimate (official, keyless /margin/funding_rates/estimate):
      // informational for the live desk. Actual funding is settled from finalised events.
      for (const inst of selected) {
        const q = perpQuotes[inst.instrument_id];
        if (!q) continue;
        const est = await kalshi.fundingRateEstimate(inst.ticker);
        if (est.ok && est.estimate) {
          q.funding_estimate = {
            funding_rate: est.estimate.funding_rate ?? null,
            next_funding_time: est.estimate.next_funding_time ?? null,
            computed_time: est.estimate.computed_time ?? null,
            note: 'Estimated funding rate for the in-progress 8h period (official /margin/funding_rates/estimate). Funding itself is settled from finalised events.',
            source_url: est.provenance?.url ?? null,
            sha256: est.provenance?.sha256 ?? null,
            retrieved_at: est.provenance?.retrieved_at ?? null,
          };
        } else {
          degraded.push({ venue: 'kalshi_margin', step: 'funding_estimate', ticker: inst.ticker, error: describe(est) });
        }
      }
    } else {
      degraded.push({ venue: 'kalshi_margin', step: 'markets', error: describe(perps) });
    }
    console.log(`   kalshi perps: ${perpInstruments.length} tracked`);
  }

  /* ----------------------------------------------------------- 2. MOEX */

  let moexInstruments = [];
  let moexQuotes = {};
  let fx = null;
  let moexHistoryCache = {};
  let moexDescriptionCache = {};
  let kalshiCandles = {};
  let moexDiscoveryCount = 0;

  /**
   * Per-contract reference description (LOT SIZE / quotation UNIT / FACEUNIT / EXECTYPE) from the
   * MOEX ISS description table. Reference data changes rarely, so it is cached on disk for the
   * configured refresh window (12h default) and the cache itself is committed for auditability.
   * A failed fetch degrades the run, never crashes it: the instrument is still built from the
   * quote payload, just without the description fields (and anything that needs them, e.g. the
   * cross-venue basis normalisation, refuses to trade instead of guessing).
   */
  const getMoexDescription = async (secid) => {
    if (moexDescriptionCache[secid] !== undefined) return moexDescriptionCache[secid];
    const file = `data/history/moex-descriptions/${secid}.json`;
    const cached = readJson(file, null);
    const age = fileAgeHours(file);
    if (cached?.fields && Object.keys(cached.fields).length > 0 && age != null && age < (competition.history_refresh_hours ?? 12)) {
      moexDescriptionCache[secid] = cached;
      return cached;
    }
    const res = await moexSecurityDescription(secid);
    if (res.ok && res.fields && Object.keys(res.fields).length > 0) {
      const rec = {
        secid,
        fields: res.fields,
        provenance: {
          url: res.provenance?.url ?? null,
          sha256: res.provenance?.sha256 ?? null,
          http_status: res.provenance?.http_status ?? null,
          retrieved_at: res.provenance?.retrieved_at ?? null,
        },
        retrieved_at: res.provenance?.retrieved_at ?? null,
        note: 'Official MOEX ISS security description (LOT SIZE / quotation UNIT / FACEUNIT / EXECTYPE). Reference data; cached for the configured refresh window.',
      };
      writeJson(file, rec);
      moexDescriptionCache[secid] = rec;
      return rec;
    }
    degraded.push({ venue: 'moex_forts', step: 'description', ticker: secid, error: describe(res) });
    moexDescriptionCache[secid] = null;
    return cached ?? null;
  };

  if (!OFFLINE) {
    const listing = await fetchFortsSecurities({ assetCodes: (watchlist.moex?.asset_codes ?? []).map((a) => a.asset_code ?? a) });
    const listingRow = listing.provenance?.[listing.provenance.length - 1] ?? null;
    if (!listing.ok) degraded.push({ venue: 'moex_forts', step: 'listing', error: 'contract listing failed' });
    const rows = (listing.rows ?? []).filter((r) => r.SECTYPE === 'RFUD' || r.SECTYPE === 'FU' || true);
    const classified = [];
    for (const row of rows) {
      const klass = classifyMoexContract(row);
      if (klass) classified.push({ row, klass });
    }
    moexDiscoveryCount = classified.length;
    // Diversify: the nearest two expiries of every asset the exchange lists, so one busy
    // contract cannot crowd the universe out of the request budget. Non-commodity sectors
    // (equity index, interest rate, FX, crypto - required by the project brief) get a dedicated
    // slot of their own (max_sector_contracts, default 12) so they cannot be crowded out by
    // the commodity universe, and commodities keep the remainder of the budget.
    const { limited, assetCount, sectorCount } = selectMoexFutures(classified, watchlist);
    console.log(`   moex contracts discovered: ${classified.length} across ${assetCount} assets (${sectorCount} sector contracts), tracking ${limited.length}`);
    notes.push({ moex_listing_instrument_types: listing.instrument_types ?? null, duplicates_removed: listing.duplicates_removed ?? null });

    const usdRub = await fetchUsdRub();
    if (usdRub.ok) {
      fx = {
        pair: 'USD/RUB',
        rate: usdRub.rate,
        source_url: usdRub.url,
        sha256: usdRub.provenance?.sha256 ?? null,
        retrieved_at: usdRub.provenance?.retrieved_at ?? null,
        http_status: usdRub.provenance?.http_status ?? null,
        note: 'Official MOEX ISS USD/RUB quote. Used only to convert fees and contract values that the exchange publishes in RUB.',
      };
    } else {
      degraded.push({ venue: 'moex_forts', step: 'usd_rub', error: 'USD/RUB unavailable' });
    }

    for (const { row, klass } of limited) {
      const res = await fetchSecurity(row.SECID);
      if (!res.ok) {
        degraded.push({ venue: 'moex_forts', step: 'quote', ticker: row.SECID, error: describe(res) });
        continue;
      }
      const marketdata = res.marketdata;
      if (!marketdata) continue;
      const liquidity = { volume_today: num(marketdata.VOLTODAY), open_interest: num(marketdata.OPENPOSITION) };
      if ((liquidity.volume_today ?? 0) < (watchlist.moex?.min_volume_today ?? 10)) {
        notes.push({ instrument_id: `moex:${row.SECID}`, skipped: 'below minimum exchange-published volume for a tradable quote', ...liquidity });
        continue;
      }
      const description = await getMoexDescription(row.SECID);
      const valuation = computeMoexValuation({ securities: res.securities, fx, descriptionFields: description?.fields ?? null });
      const instrument = buildMoexInstrument({
        row,
        classification: klass,
        valuation,
        provenance: { url: res.provenance?.url, sha256: res.provenance?.sha256 },
        listing: listingRow ? { url: listingRow.url, sha256: listingRow.sha256, retrieved_at: listingRow.retrieved_at } : null,
        description,
      });
      const quote = moexQuoteFromPayload({ secid: row.SECID, marketdata, securities: res.securities, provenance: res.provenance, valuation });
      if (quote.bid == null || quote.offer == null) {
        notes.push({ instrument_id: instrument.instrument_id, skipped: 'exchange published a one-sided quote', bid: quote.bid, offer: quote.offer });
        continue;
      }
      moexInstruments.push(instrument);
      moexQuotes[instrument.instrument_id] = quote;
    }
    console.log(`   moex instruments tradable this tick: ${moexInstruments.length}`);
  }

  /* ------------------------------------------------- 3. History caches */

  const historyRefreshHours = competition.history_refresh_hours ?? 12;
  if (!OFFLINE) {
    /*
     * Kalshi candle history via the official BATCH endpoint (GET /markets/candlesticks,
     * docs.kalshi.com "Batch Get Market Candlesticks": up to 100 tickers per request, candle
     * schema identical to the single-market endpoint). This replaces the per-series single
     * requests so the whole matched commodity universe (not just 30 series) is covered in one
     * or two calls. One market per series: the last commodity market of each series in
     * instrument order (the same market the per-series loop used to keep).
     *
     * Official candlestick schema (docs.kalshi.com get-market-candlesticks): OHLC values live
     * in `price.close_dollars`, `yes_bid.close_dollars`, `yes_ask.close_dollars` (fixed-point
     * dollar strings), volumes in `volume_fp`/`open_interest_fp`. Candles whose OHLC is null
     * are the exchange's synthetic placeholder for "no data in this period" (documented in the
     * schema) and are stored as nulls, never treated as prices.
     */
    const seriesOrder = [];
    const tickerForSeries = {};
    for (const inst of instruments.filter((i) => i.commodity)) {
      if (!tickerForSeries[inst.series_ticker]) seriesOrder.push(inst.series_ticker);
      tickerForSeries[inst.series_ticker] = inst.ticker;
    }
    const planned = seriesOrder.slice(0, competition.max_candle_series ?? 100);
    const due = [];
    for (const seriesTicker of planned) {
      const file = `${paths.history}/kalshi/${seriesTicker}.json`;
      const age = fileAgeHours(file);
      const cached = readJson(file, null);
      const cachedHasPrices = (cached?.candles ?? []).some((c) => c && c.close != null);
      if (cached && cachedHasPrices && age != null && age < historyRefreshHours) {
        kalshiCandles[seriesTicker] = cached.candles ?? [];
      } else {
        due.push({ series_ticker: seriesTicker, ticker: tickerForSeries[seriesTicker], file, cached });
      }
    }
    if (due.length) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const start = nowSeconds - 90 * 86400;
      const batch = await kalshi.candlesticksBatch({ marketTickers: due.map((d) => d.ticker), startTs: start, endTs: nowSeconds, periodInterval: 1440 });
      for (const entry of due) {
        let raw = batch.byMarket?.[entry.ticker] ?? null;
        let endpoint = batch.provenance?.url ?? null;
        let sha256 = batch.provenance?.sha256 ?? null;
        let status = batch.provenance?.http_status ?? null;
        let retrievedAt = batch.provenance?.retrieved_at ?? null;
        if (raw == null) {
          // The market was absent from the batch response (unknown ticker or endpoint failure):
          // fall back to the single-market endpoint for this one market before giving up.
          const single = await kalshi.candlesticks({ seriesTicker: entry.series_ticker, marketTicker: entry.ticker, startTs: start, endTs: nowSeconds, periodInterval: 1440 });
          if (single.ok) {
            raw = single.candles;
            endpoint = single.provenance?.url ?? null;
            sha256 = single.provenance?.sha256 ?? null;
            status = single.provenance?.http_status ?? null;
            retrievedAt = single.provenance?.retrieved_at ?? null;
          } else {
            degraded.push({ venue: 'kalshi', step: 'candlesticks', series: entry.series_ticker, batch_status: status, tried: single.tried });
            kalshiCandles[entry.series_ticker] = entry.cached?.candles ?? [];
            continue;
          }
        }
        const candles = (raw ?? []).map((c) => ({
          end_period_ts: c.end_period_ts,
          close: num(c.price?.close_dollars) ?? num(c.price?.close) ?? null,
          yes_bid_close: num(c.yes_bid?.close_dollars) ?? null,
          yes_ask_close: num(c.yes_ask?.close_dollars) ?? null,
          volume: num(c.volume_fp) ?? num(c.volume) ?? null,
          open_interest: num(c.open_interest_fp) ?? num(c.open_interest) ?? null,
        }));
        kalshiCandles[entry.series_ticker] = candles;
        writeJson(entry.file, {
          series_ticker: entry.series_ticker,
          market_ticker_used: entry.ticker,
          endpoint,
          http_status: status,
          sha256,
          retrieved_at: retrievedAt,
          candles,
          note: 'Official Kalshi candlesticks. `close` is the price at the end of the period as published by the exchange.',
        });
      }
    }
    console.log(`   kalshi candle series cached: ${Object.keys(kalshiCandles).length} (${due.length} re-fetched this run)`);

    for (const inst of moexInstruments) {
      const file = `${paths.history}/moex/${inst.ticker}.json`;
      const age = fileAgeHours(file);
      const cached = readJson(file, null);
      if (cached && age != null && age < historyRefreshHours && (cached.rows ?? []).length) {
        moexHistoryCache[inst.ticker] = cached.rows;
        continue;
      }
      const from = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
      const res = await fetchHistory(inst.ticker, { from });
      if (!res.ok) {
        degraded.push({ venue: 'moex_forts', step: 'history', ticker: inst.ticker, error: 'history request failed' });
        moexHistoryCache[inst.ticker] = cached?.rows ?? [];
        continue;
      }
      const rows = (res.rows ?? []).filter((r) => num(r.CLOSE ?? r.SETTLEPRICE) != null);
      moexHistoryCache[inst.ticker] = rows;
      writeJson(file, {
        instrument_id: inst.instrument_id,
        endpoint: res.provenance?.url ?? null,
        http_status: res.provenance?.http_status ?? null,
        sha256: res.provenance?.sha256 ?? null,
        retrieved_at: res.provenance?.retrieved_at ?? null,
        rows_parsed: rows.length,
        rows,
        note: 'Official MOEX ISS daily history. Zero-filled non-trading days are dropped, never treated as prices.',
      });
    }
    console.log(`   moex history series cached: ${Object.keys(moexHistoryCache).length}`);

    // EIA historical authority files: archived with hashes; never used for live pricing.
    const eiaSamples = (watchlist.benchmarks?.eia_archive ?? []).slice(0, 2);
    const eiaArchive = [];
    for (const entry of eiaSamples) {
      const archived = await archiveSeries({ id: entry.series_id, url: entry.url, note: `EIA official series file ${entry.series_id}` });
      eiaArchive.push(archived);
    }
    if (eiaArchive.length) {
      writeJson(`data/raw-evidence/eia-series-archive.json`, {
        generated_at: nowIso(),
        authority: EIA_FUTURES_PAGE,
        futures_last_date_published: EIA_FUTURES_LAST_DATE,
        series_catalog: EIA_HISTORICAL_FUTURES_SERIES,
        archived: eiaArchive,
        note: 'EIA stopped publishing NYMEX futures prices after 2024-04-05. These files are stored for historical analysis only and are never used to price a live trade.',
      });
    }
  }

  /* --------------------------------------------- 4. Universe + snapshot */

  const allInstruments = [...instruments, ...perpInstruments, ...moexInstruments];
  const quotes = { ...kalshiQuotes, ...perpQuotes, ...moexQuotes };
  const previousSnapshot = readJson(`${paths.snapshots}/latest.json`, null);
  const snapshot = {
    taken_at: nowIso(),
    run_id: runId,
    venues: {
      kalshi: { status: kalshiStatus?.ok ? 'ok' : 'unreachable', exchange_active: kalshiStatus?.payload?.exchange_active ?? null, trading_active: kalshiStatus?.payload?.trading_active ?? null, provenance: kalshiStatus?.provenance ?? null },
      moex_forts: { status: moexInstruments.length ? 'ok' : 'unavailable' },
      kalshi_margin: { status: perpInstruments.length ? 'ok' : 'unavailable' },
    },
    fx,
    quotes,
    degraded,
  };
  // Only instruments that carry a verified quote in this run are published in full. Every other
  // listed market was still read from the exchange in this run and is summarised, with its
  // listing provenance, in data/universe/coverage.json - it is simply not duplicated into the
  // repository on every tick.
  const publishedInstruments = allInstruments.filter((i) => Boolean(quotes[i.instrument_id]));
  snapshot.published_instruments = publishedInstruments.length;
  snapshot.coverage_file = `${paths.universe}/coverage.json`;
  snapshot.universe_file = `${paths.universe}/instruments.json`;
  snapshot.published = allInstruments.length > 0 && Object.keys(quotes).length > 0;
  if (!snapshot.published) {
    // A run that reached no venue (for example an --offline dry run) must never erase the last
    // verified snapshot: the published files keep the previous, real data and the run is noted.
    notes.push({ publish_skipped: 'This run produced no instruments or no quotes, so the previously published universe and snapshot were left untouched.' });
    degraded.push({ venue: 'all', step: 'publish', error: 'no instruments or quotes in this run; publication skipped' });
  } else {
    writeJsonIfChanged(`${paths.snapshots}/latest.json`, snapshot);
    writeJsonIfChanged(`${paths.snapshots}/by-run/${runId}.json`, { ...snapshot, snapshot_of: runId });
    pruneDirectory(`${paths.snapshots}/by-run`, 8, (f) => f.startsWith('run-') && f.endsWith('.json'));
  }

  if (snapshot.published) writeJson(`${paths.universe}/instruments.json`, {
    generated_at: nowIso(),
    counts: {
      kalshi_event_contracts: instruments.length,
      kalshi_event_contracts_quoted: Object.keys(kalshiQuotes).length,
      kalshi_perps: perpInstruments.length,
      moex_futures: moexInstruments.length,
      series_matched: new Set(instruments.map((i) => i.series_ticker)).size,
      series_quoted: quotedSeriesCount,
    },
    unclassified_series: unclassified.slice(0, 200),
    note: 'Detailed records are published for every instrument that carried a verified quote in this run. coverage.json records, per series, how many listed markets were read from the exchange and how many were quoted.',
    instruments: publishedInstruments,
  });

  const seriesCoverage = (() => {
    const bySeries = new Map();
    for (const i of instruments) {
      const key = i.series_ticker ?? 'unknown';
      if (!bySeries.has(key)) bySeries.set(key, []);
      bySeries.get(key).push(i);
    }
    return [...bySeries.entries()].map(([seriesTicker, list]) => ({
      venue: 'kalshi',
      series_ticker: seriesTicker,
      group: list[0]?.group ?? null,
      commodity: list[0]?.commodity ?? null,
      listed_open_markets: list.length,
      quoted_markets: list.filter((i) => quotes[i.instrument_id]).length,
      contract_terms_url: list[0]?.contract_specification?.terms_url ?? null,
      settlement_sources: list[0]?.contract_specification?.settlement_sources ?? null,
      listing_provenance: list[0]?.listing_provenance ?? null,
    }));
  })();
  const moexSkips = notes.filter((n) => typeof n.instrument_id === 'string' && n.instrument_id.startsWith('moex:'));
  if (snapshot.published) writeJsonIfChanged(`${paths.universe}/coverage.json`, {
    generated_at: nowIso(),
    run_id: runId,
    note: 'Every market counted here was read from the official exchange API in this run; the request URL and response hash for each series are recorded in the run manifest.',
    totals: {
      kalshi_series_matched: seriesCoverage.length,
      kalshi_listed_open_markets: instruments.length,
      kalshi_quoted_markets: Object.keys(kalshiQuotes).length,
      kalshi_perps: perpInstruments.length,
      moex_listed_commodity_contracts: moexDiscoveryCount,
      moex_tracked_contracts: moexInstruments.length,
    },
    kalshi_series: seriesCoverage.sort((a, b) => a.series_ticker.localeCompare(b.series_ticker)),
    moex: {
      listed_commodity_contracts: moexDiscoveryCount,
      tracked: moexInstruments.map((i) => ({
        instrument_id: i.instrument_id,
        ticker: i.ticker,
        commodity: i.commodity,
        last_trade_date: i.last_trade_date ?? null,
        listing_provenance: i.listing_provenance ?? null,
      })),
      skipped: moexSkips.slice(0, 60),
    },
    kalshi_perps: perpInstruments.map((i) => ({
      instrument_id: i.instrument_id,
      ticker: i.ticker,
      commodity: i.commodity,
      exchange_metrics: i.exchange_metrics ?? null,
      listing_provenance: i.listing_provenance ?? null,
    })),
    unclassified_series: unclassified.slice(0, 200),
  });

  if (snapshot.published) writeJson(`${paths.universe}/registry.json`, {
    generated_at: nowIso(),
    source: 'engine/universe/futures-registry.json',
    exchanges: registry.exchanges ?? {},
    products: (registry.products ?? []).map((p) => ({
      ...p,
      live_in_this_competition: p.exchange === 'moex' ? moexInstruments.some((i) => i.asset_code) : false,
    })),
    live_venues: {
      kalshi_event_contracts: { status: 'automated', instruments: instruments.length, quoted: Object.keys(kalshiQuotes).length },
      kalshi_perps: { status: 'automated', instruments: perpInstruments.length, quoted: Object.keys(perpQuotes).length },
      moex_futures: { status: 'automated', instruments: moexInstruments.length },
      eia: { status: 'historical_only', note: 'NYMEX futures series discontinued after 2024-04-05; spot benchmarks verified separately.' },
    },
  });

  /* ------------------------------------------------ 5. Strategy engine */

  if (OFFLINE) {
    // An offline run is a cache rebuild / code check, not a market moment: no venue was reached,
    // so no strategy may decide, no intent or trade may be recorded, and the season state must
    // not gain a phantom tick. Published artifacts are left exactly as the last live run wrote them.
    console.log('   offline: strategy engine, ledger and season state untouched (run a live tick to trade)');
    return;
  }

  const stateCompetition = readJson(`${paths.state}/competition.json`, null) ?? {
    season_id: competition.season_id,
    starts_at: competition.starts_at,
    ends_at: competition.ends_at,
    starting_cash_usd: competition.starting_cash_usd,
    created_at: nowIso(),
    ticks: 0,
  };
  const portfolios = readJson(`${paths.state}/portfolios.json`, null) ?? {};
  const workingOrders = readJson(`${paths.state}/working_orders.json`, { orders: [] });

  const instrumentById = Object.fromEntries(allInstruments.map((i) => [i.instrument_id, i]));
  const ctxBase = {
    now: new Date(),
    runId,
    competition,
    fx,
    portfolios,
    instrument: (id) => instrumentById[id] ?? null,
    quote: (id) => quotes[id] ?? null,
    listInstruments: ({ venue, groups } = {}) =>
      allInstruments.filter((i) => (!venue || i.venue === venue) && (!groups || groups.includes(i.group))),
    kalshiCandles: (seriesTicker) => kalshiCandles[seriesTicker] ?? [],
    moexHistory: (ticker) => moexHistoryCache[ticker] ?? [],
    previousMid: (instrumentId) => {
      const prev = previousSnapshot?.quotes?.[instrumentId];
      if (!prev) return null;
      if (prev.kind === 'event_contract') return prev.mid ?? null;
      return prev.mid ?? null;
    },
    note: (record) => notes.push(record),
  };

  const newTrades = [];
  const intents = [];
  const settlements = [];
  const activity = [];

  // 5a. Resting maker orders are resolved first (they can only fill when the market trades through).
  const makerFills = processWorkingOrders({ workingOrders, ctxBase, portfolios, runId, newTrades, intents, competition });
  if (makerFills.length) activity.push({ step: 'working_orders', fills: makerFills });

  // 5b. Exits, then entries.
  for (const strategy of STRATEGIES) {
    const portfolio = portfolios[strategy.id] ?? newPortfolio({
      strategyId: strategy.id,
      username: strategy.username,
      marketType: strategy.market_type,
      startingCashUsd: competition.starting_cash_usd,
      startedAt: competition.starts_at,
    });
    portfolios[strategy.id] = portfolio;
    if (strategy.enabled === false) {
      // The strategy is published with its reason and keeps its untouched starting balance.
      strategyNotesOf(activity, strategy, portfolio);
      continue;
    }
    const strategyNotes = [];
    const ctx = {
      ...ctxBase,
      portfolio,
      notes: strategyNotes,
      orders: [],
      exits: [],
      order: (order) => ctx.orders.push({ ...order, username: strategy.username, market_type_label: strategy.market_type, strategy_id: strategy.id }),
      exit: (instrumentId, reason, signal) => ctx.exits.push({ instrument_id: instrumentId, reason, signal }),
      note: (record) => strategyNotes.push(record),
    };

    // exits first so capital is freed in the same tick
    for (const position of Object.values(portfolio.positions)) {
      let decision = null;
      if (typeof strategy.exit === 'function') {
        try {
          decision = strategy.exit(ctx, position);
        } catch (error) {
          strategyNotes.push({ instrument_id: position.instrument_id, exit_error: String(error?.message ?? error) });
        }
      }
      if (decision) ctx.exits.push({ instrument_id: position.instrument_id, reason: decision.reason, signal: decision.signal ?? null });
    }
    const runExit = (requested) => {
      const position = portfolio.positions[requested.instrument_id];
      if (!position) return;
      const inst = instrumentById[requested.instrument_id];
      const quote = quotes[requested.instrument_id];
      if (!inst || !quote) {
        intents.push(intentRecord({ strategy_id: strategy.id, username: strategy.username, instrument_id: requested.instrument_id, action: 'exit' }, runId, 'no_verified_quote', 'Cannot exit: this run produced no verified quote for the instrument.'));
        return;
      }
      if (inst.kind === 'event_contract') {
        const exitPrice = position.outcome === 'yes' ? quote.best_yes_bid : quote.best_no_bid;
        if (exitPrice == null) {
          intents.push(intentRecord({ strategy_id: strategy.id, username: strategy.username, instrument_id: requested.instrument_id, action: 'exit' }, runId, 'one_sided_book', 'No resting bid for the side held, so the position cannot be exited at this moment.'));
          return;
        }
        executeEventContractOrder({
          ord: {
            strategy_id: strategy.id,
            username: strategy.username,
            market_type_label: strategy.market_type,
            instrument_id: inst.instrument_id,
            action: 'sell',
            outcome: position.outcome,
            contracts: position.contracts,
            limit_price: exitPrice,
            order_type: 'taker',
            is_exit: true,
            exit_reason: requested.reason,
            thesis: requested.reason,
            signal: requested.signal,
          },
          inst,
          quote,
          portfolio,
          runId,
          newTrades,
          intents,
          instrumentById,
          competition,
          fx,
        });
      } else {
        executeQuoteOrder({
          ord: {
            strategy_id: strategy.id,
            username: strategy.username,
            market_type_label: strategy.market_type,
            instrument_id: inst.instrument_id,
            action: position.side === 'long' ? 'sell' : 'buy',
            side: position.side,
            contracts: position.contracts,
            order_type: 'taker',
            is_exit: true,
            exit_reason: requested.reason,
            thesis: requested.reason,
            signal: requested.signal,
          },
          inst,
          quote,
          portfolio,
          runId,
          newTrades,
          intents,
          instrumentById,
          competition,
          fx,
        });
      }
    };
    for (const requested of ctx.exits) {
      try {
        runExit(requested);
      } catch (error) {
        // One strategy's faulty order must never take down the whole competition tick: the
        // failure is recorded as degraded and the strategy's remaining orders are dropped.
        strategyNotes.push({ instrument_id: requested.instrument_id, exit_execution_error: String(error?.message ?? error) });
        degraded.push({ venue: 'engine', step: 'exit_execution', strategy: strategy.id, error: String(error?.message ?? error) });
      }
    }

    if (typeof strategy.decide === 'function') {
      try {
        strategy.decide(ctx);
      } catch (error) {
        strategyNotes.push({ error: String(error?.message ?? error), phase: 'decide' });
        degraded.push({ venue: 'engine', step: 'strategy_decide', strategy: strategy.id, error: String(error?.message ?? error) });
      }
    }

    const runEntry = (ord) => {
      if (ord.order_type === 'maker') {
        const registered = registerWorkingOrder({ ord, instrumentById, quotes, workingOrders, intents, runId, competition });
        if (!registered) return;
        return;
      }
      if (ord.venue === 'kalshi') {
        executeEventContractOrder({ ord, inst: instrumentById[ord.instrument_id], quote: quotes[ord.instrument_id], portfolio, runId, newTrades, intents, instrumentById, competition, fx });
      } else {
        executeQuoteOrder({ ord, inst: instrumentById[ord.instrument_id], quote: quotes[ord.instrument_id], portfolio, runId, newTrades, intents, instrumentById, competition, fx });
      }
    };
    for (const ord of ctx.orders) {
      try {
        runEntry(ord);
      } catch (error) {
        // Same rule as for exits: record, degrade, keep the competition alive.
        strategyNotes.push({ instrument_id: ord.instrument_id, entry_execution_error: String(error?.message ?? error) });
        degraded.push({ venue: 'engine', step: 'entry_execution', strategy: strategy.id, error: String(error?.message ?? error) });
      }
    }

    try {
      markPortfolio(portfolio, quotes);
    } catch (error) {
      strategyNotes.push({ mark_error: String(error?.message ?? error) });
      degraded.push({ venue: 'engine', step: 'mark', strategy: strategy.id, error: String(error?.message ?? error) });
    }
    activity.push({
      strategy_id: strategy.id,
      username: strategy.username,
      market_type: strategy.market_type,
      orders_produced: ctx.orders.length,
      exits_produced: ctx.exits.length,
      equity_usd: portfolio.equity_usd,
      return_pct: returnPct(portfolio),
      positions: Object.keys(portfolio.positions).length,
      notes: strategyNotes.slice(0, 40),
    });
  }

  /* --------------------------------------------------- 6. Settlements */

  for (const portfolio of Object.values(portfolios)) {
    for (const position of Object.values(portfolio.positions)) {
      try {
        if (position.kind !== 'event_contract') continue;
        const inst = instrumentById[position.instrument_id];
        const closeTime = position.market?.close_time ?? inst?.close_time ?? null;
        if (!closeTime || new Date(closeTime).getTime() > Date.now()) continue;
        const res = await kalshi.market(position.ticker);
        const market = res.json?.market ?? null;
        const result = market?.result ?? null;
        if (!result) {
          intents.push(intentRecord({ strategy_id: portfolio.strategy_id, username: portfolio.username, instrument_id: position.instrument_id, action: 'settle' }, runId, 'settlement_result_not_published', `Market closed at ${closeTime} but the exchange has not published a result yet; the position is left open rather than assumed.`));
          continue;
        }
        const settled = settlePosition({
          portfolio,
          position,
          result,
          settledAt: nowIso(),
          marketRecordUrl: res.provenance?.url ?? null,
          marketRecordSha256: res.provenance?.sha256 ?? null,
          expiry: market.expiration_time ?? closeTime,
        });
        if (settled) settlements.push({ ...settled, strategy_id: portfolio.strategy_id, username: portfolio.username });
      } catch (error) {
        // A failed settlement fetch must not kill the run: the position stays open and the
        // failure is reported as degraded (the next tick retries).
        degraded.push({ venue: 'engine', step: 'settlement', strategy: portfolio.strategy_id, instrument_id: position.instrument_id, error: String(error?.message ?? error) });
      }
    }
  }
  /* ------------------------------------------- 6b. Perps funding */
  /*
   * Kalshi applies funding to perpetual futures every 8 hours (12:00 AM / 8:00 AM / 4:00 PM ET,
   * official contract specifications). The simulation settles funding ONLY from the exchange's
   * own finalised funding events (official keyless endpoint GET /margin/funding_rates/historical,
   * docs.kalshi.com "Get Historical Funding Rates"): each event carries funding_time,
   * funding_rate and the mark_price at the funding moment, all exchange-published.
   *
   * Payment semantics (Kalshi help centre "How Funding Works", official):
   *   - rate > 0: longs pay shorts; rate < 0: shorts pay longs;
   *   - |rate| < 0.01%: the rate is treated as zero and no payment is made;
   *   - payment = contracts x mark_price x funding_rate x direction (long = +1 pays when
   *     rate > 0), i.e. a percentage of the position's notional at the exchange mark.
   * A position only participates in funding events at or after it was opened. Every payment is
   * written to data/ledger/funding.jsonl with the provenance of the funding-rate payload.
   */
  const fundingEntries = [];
  if (!OFFLINE && perpInstruments.length) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const seasonStartSeconds = Math.floor(new Date(competition.starts_at).getTime() / 1000);
    const eventsByInstrument = new Map(); // instrument_id -> { rates, provenance }
    for (const perp of perpInstruments) {
      const res = await kalshi.fundingRatesHistorical(perp.ticker, { startTs: seasonStartSeconds, endTs: nowSeconds });
      if (!res.ok) {
        degraded.push({ venue: 'kalshi_margin', step: 'funding_rates', ticker: perp.ticker, error: describe(res) });
        continue;
      }
      eventsByInstrument.set(perp.instrument_id, { ticker: perp.ticker, rates: res.rates, provenance: res.provenance });
    }
    for (const p of Object.values(portfolios)) {
      const payments = settleFundingForPositions({ positions: p.positions, eventsByInstrument, nowMs: Date.now() });
      for (const pay of payments) {
        const perp = eventsByInstrument.get(pay.instrument_id);
        p.cash_usd = Number((p.cash_usd - pay.paymentUsd).toFixed(6));
        fundingEntries.push({
          // entry_ts is part of the id so that two lifecycles of a position on the same
          // instrument (closed and reopened between ticks) can never collide on a funding id.
          id: tradeId('funding', runId, p.strategy_id, pay.instrument_id, pay.funding_time, pay.entryTs ?? 'entry', pay.side),
          run_id: runId,
          strategy_id: p.strategy_id,
          username: p.username,
          market_type: p.market_type,
          venue_id: 'kalshi_margin',
          exchange: 'Kalshi (CFTC-regulated designated contract market)',
          ticker: perp.ticker,
          instrument_id: pay.instrument_id,
          funding_time: pay.funding_time,
          mark_price: pay.mark,
          funding_rate: pay.rate,
          contracts: pay.contracts,
          side: pay.side,
          payment_usd: pay.paymentUsd,
          formula: 'payment = contracts x exchange mark_price x exchange funding_rate x direction (long pays when the rate is positive); official zero threshold |rate| < 0.01% skipped',
          official_source: perp.provenance?.url ?? null,
          official_source_sha256: perp.provenance?.sha256 ?? null,
          retrieved_at: perp.provenance?.retrieved_at ?? null,
          verification_timestamp: nowIso(),
          documentation: {
            historical_funding_rates: 'https://docs.kalshi.com/margin-rest/funding/get-historical-funding-rates.md',
            how_funding_works: 'https://help.kalshi.com/en/articles/15357613-how-funding-works',
            contract_specifications: 'https://help.kalshi.com/en/articles/15357587-btc-perpetual-futures-contract-specifications',
          },
          created_at: nowIso(),
        });
      }
    }
  }
  if (fundingEntries.length) appendJsonl(`${paths.ledger}/funding.jsonl`, fundingEntries);

  for (const portfolio of Object.values(portfolios)) markPortfolio(portfolio, quotes);

  /* ------------------------------------------------- 7. Publish state */

  const leaderboard = Object.values(portfolios)
    .map((p) => ({
      strategy_id: p.strategy_id,
      username: p.username,
      market_type: p.market_type,
      equity_usd: p.equity_usd,
      return_pct: returnPct(p),
      realized_pnl_usd: p.realized_pnl_usd,
      unrealized_pnl_usd: p.unrealized_pnl_usd,
      fees_paid_usd: p.fees_paid_usd,
      slippage_paid_usd: p.slippage_paid_usd,
      open_positions: p.open_positions,
      closed_trades: p.closed_trades,
      equity_complete: p.equity_complete,
    }))
    .sort((a, b) => (b.return_pct ?? -Infinity) - (a.return_pct ?? -Infinity));

  const competitionState = {
    ...stateCompetition,
    season_id: competition.season_id,
    starts_at: competition.starts_at,
    ends_at: competition.ends_at,
    starting_cash_usd: competition.starting_cash_usd,
    ticks: (stateCompetition.ticks ?? 0) + 1,
    last_tick: {
      run_id: runId,
      at: nowIso(),
      instruments: allInstruments.length,
      quotes: Object.keys(quotes).length,
      trades: newTrades.length,
      intents: intents.length,
      settlements: settlements.length,
      degraded: degraded.length,
      requests_used: kalshi.requests,
    },
  };

  writeJson(`${paths.registry ?? 'data/registry'}/strategies.json`, { generated_at: nowIso(), strategies: strategyCatalog() });
  writeJson(`${paths.state}/portfolios.json`, portfolios);
  writeJson(`${paths.state}/working_orders.json`, {
    generated_at: nowIso(),
    orders: workingOrders.orders.slice(-300),
    note: 'Resting maker orders. A fill is recorded only when a later snapshot shows the market trading through the resting price, and the fill is flagged as modelled.',
  });
  writeJson(`${paths.state}/competition.json`, competitionState);
  writeJson(`${paths.state}/leaderboard.json`, { generated_at: nowIso(), season_id: competition.season_id, leaderboard, ranking: 'return on starting capital, highest first (no risk adjustment, per the competition brief)' });
  writeJson(`${paths.state}/activity.json`, { generated_at: nowIso(), activity, settlements });
  appendJsonl(`${paths.ledger}/trades.jsonl`, newTrades);
  appendJsonl(`${paths.ledger}/intents.jsonl`, intents);
  writeJson(`${paths.reports}/last-run.json`, {
    run_id: runId,
    started_at: startedAt,
    finished_at: nowIso(),
    venues: snapshot.venues,
    counts: competitionState.last_tick,
    degraded,
    notes: notes.slice(0, 200),
    provenance_entries: provenanceNotes.length,
  });

  const provenance = provenanceSnapshot();
  // The per-run manifest carries the URL, status, hash and retrieval time of every response this
  // run received. Verification uses it to prove that each ledger trade was priced from a payload
  // that was actually fetched in that same run.
  const provenanceRecord = provenance.map((p) => ({
    url: p.url,
    http_status: p.http_status ?? null,
    sha256: p.sha256 ?? null,
    retrieved_at: p.retrieved_at ?? null,
    bytes: p.bytes ?? null,
  }));
  writeJson(`${paths.manifest}/${runId}.json`, {
    run_id: runId,
    started_at: startedAt,
    finished_at: nowIso(),
    request_count: provenance.length,
    hashes: provenance.map((p) => p.sha256).filter(Boolean),
    endpoints: [...new Set(provenance.map((p) => p.url))].slice(0, 400),
    provenance: provenanceRecord,
    degraded,
    counts: competitionState.last_tick,
  });
  pruneManifests(24);
  writeJson('data/manifest/latest.json', {
    run_id: runId,
    started_at: startedAt,
    finished_at: nowIso(),
    competition: { season_id: competition.season_id, starts_at: competition.starts_at, ends_at: competition.ends_at, starting_cash_usd: competition.starting_cash_usd },
    files_written: [
      'data/universe/instruments.json',
      'data/universe/registry.json',
      'data/snapshots/latest.json',
      `data/snapshots/by-run/${runId}.json`,
      'data/state/portfolios.json',
      'data/state/leaderboard.json',
      'data/state/competition.json',
      'data/state/working_orders.json',
      'data/state/activity.json',
      'data/ledger/trades.jsonl (append-only)',
      'data/ledger/intents.jsonl (append-only)',
    ],
    counts: competitionState.last_tick,
    degraded,
    provenance_log: `${paths.manifest}/${runId}.json`,
  });

  console.log(`   trades this tick: ${newTrades.length}, intents: ${intents.length}, settlements: ${settlements.length}`);
  console.log(`   degraded venues: ${degraded.length}, requests used: ${kalshi.requests}`);
  if (DRY_RUN) console.log('   dry-run: artifacts written, ledger appended (use --dry-run only when you accept that)');
}

/** Records that a strategy is disabled in this build, with the reason it states. */
function strategyNotesOf(activity, strategy, portfolio) {
  activity.push({
    step: 'strategy_disabled',
    strategy_id: strategy.id,
    username: strategy.username,
    reason: strategy.disabled_reason ?? 'disabled',
    equity_usd: portfolio.equity_usd,
  });
}

/** Keep only the most recent run manifests so the repository stays small but auditable. */
function pruneManifests(keep) {
  try {
    const dir = readdirSyncSafe(paths.manifest).filter((f) => f.startsWith('run-') && f.endsWith('.json')).sort();
    for (const file of dir.slice(0, Math.max(0, dir.length - keep))) {
      rmSync(`${paths.manifest}/${file}`, { force: true });
    }
  } catch {
    // pruning is best-effort: losing it only makes the repository slightly larger
  }
}

function computeMoexValuation({ securities, fx, descriptionFields = null }) {
  const minStep = num(securities?.MINSTEP);
  const stepPriceRub = num(securities?.STEPPRICE);
  const fxRate = fx?.rate ?? null;
  const quoteUnit = descriptionFields?.UNIT ?? null;
  const lotSize = descriptionFields?.LOTSIZE != null ? num(descriptionFields.LOTSIZE) : null;
  // Rate contracts (RUONIA, 1MFR) are quoted as a per-cent rate, not a currency-per-unit price
  // (official ISS description: UNIT = "% (Процентная ставка)"; official contract specification:
  // notional value RUB 1,000,000). For them, price x usd_per_price_unit is NOT the contract
  // notional. The exchange publishes the lot's RUB notional in LOTVOLUME (verified 2026-09-22:
  // RRU6/MFU6 LOTVOLUME = 1,000,000, matching the official specification's "Nominal value
  // 1 mln RUB"), so the USD notional per lot is derived from that published field.
  const isRateContract = !!quoteUnit && quoteUnit.includes('%');
  const lotNotionalRub = isRateContract ? num(securities?.LOTVOLUME) : null;
  const usdNotionalPerLot = lotNotionalRub && fxRate ? Number((lotNotionalRub / fxRate).toFixed(4)) : null;
  if (quoteUnit === 'USD') {
    // The exchange's own reference data states that the price is quoted in USD per unit of the
    // underlying (UNIT=USD) and settled in USD (FACEUNIT=USD). For such a contract the exchange
    // publishes the tick value in RUB (STEPPRICE, spec: "calculated in rubles at the USD rate"),
    // so STEPPRICE / MINSTEP is the exchange's own RUB-per-USD. If that converts to ~1 USD per
    // 1.0 of price at the published USD/RUB rate, one lot equals one price-denominator unit and
    // 1.0 of price movement is exactly 1 USD per contract (verified 2026-09-22: GOLD-12.26
    // 8.40954/0.1 = 84.0954 RUB/USD; ETHA-12.26 0.84095/0.01 = 84.095 RUB/USD). If it does not,
    // the lot is a fraction of the price unit — e.g. the MOEX Bitcoin Index futures, where the
    // official specification (Appendix 1, order MB-P-2026-1883, in force 14.05.2026) fixes the
    // value of the 1 USD price step at 0.001 USD per contract (lot = 0.001 BTC; verified against
    // the exchange's own volume statistics on 2026-09-22: 1,501,894,597.1 RUB / 207,750
    // contracts = 7,229 RUB/contract) — and the exchange's own tick value is then the verified
    // USD value of a 1.0 price move per lot.
    const tickRubPerUsd = minStep && stepPriceRub ? stepPriceRub / minStep : null;
    const tickUsdPerPriceUnit = tickRubPerUsd && fxRate ? tickRubPerUsd / fxRate : null;
    const lotIsOnePriceUnit = tickUsdPerPriceUnit == null || Math.abs(tickUsdPerPriceUnit - 1) < 0.05;
    const usdPerPriceUnit = lotIsOnePriceUnit ? 1.0 : Number(tickUsdPerPriceUnit.toFixed(8));
    return {
      usd_per_price_unit: usdPerPriceUnit,
      quote_unit: quoteUnit,
      lot_size: lotSize,
      usd_notional_per_lot: null,
      basis: lotIsOnePriceUnit
        ? `MOEX ISS description for this contract publishes UNIT=USD (quotation currency) and FACEUNIT=${descriptionFields?.FACEUNIT ?? 'n/a'} (settlement currency); the exchange-published tick value (STEPPRICE ${stepPriceRub ?? 'n/a'} RUB per MINSTEP ${minStep ?? 'n/a'} = ${tickRubPerUsd ? Number(tickRubPerUsd.toFixed(4)) : 'n/a'} RUB/USD) converts to ~1 USD per 1.0 of price, so one lot is one underlying unit and 1.0 of price movement is exactly 1 USD per contract.`
        : `MOEX ISS description publishes UNIT=USD, but the exchange-published tick value (STEPPRICE ${stepPriceRub ?? 'n/a'} RUB per MINSTEP ${minStep ?? 'n/a'} = ${tickRubPerUsd ? Number(tickRubPerUsd.toFixed(4)) : 'n/a'} RUB/USD at USD/RUB ${fxRate}) shows the lot is a fraction of the price unit: 1.0 of price movement is ${Number(tickUsdPerPriceUnit.toFixed(8))} USD per contract (exchange tick value per contract, per the official specification's variation-margin formula VM = dPrice x W/R).`,
      note: `Derived only from exchange-published fields: UNIT=${quoteUnit}, FACEUNIT=${descriptionFields?.FACEUNIT ?? 'n/a'}, LOTSIZE=${descriptionFields?.LOTSIZE ?? 'n/a'}, STEPPRICE=${stepPriceRub ?? 'n/a'} RUB, MINSTEP=${minStep ?? 'n/a'}, USD/RUB=${fxRate ?? 'n/a'}.`,
    };
  }
  if (minStep && stepPriceRub && fxRate) {
    const usdPerPriceUnit = Number((stepPriceRub / minStep / fxRate).toFixed(8));
    return {
      usd_per_price_unit: usdPerPriceUnit,
      quote_unit: quoteUnit ?? null,
      lot_size: lotSize,
      usd_notional_per_lot: usdNotionalPerLot,
      basis: `USD value of a one-unit price move = (MOEX STEPPRICE ${stepPriceRub} RUB per MINSTEP ${minStep}) / MOEX USD/RUB ${fxRate}${
        isRateContract
          ? `. For this rate-quoted contract, one price unit is the published tick value per lot (RUB ${Number((stepPriceRub / minStep).toFixed(4))} per 1.0 of rate on the exchange-published lot notional); usd_notional_per_lot = exchange-published LOTVOLUME (RUB notional) / USD-RUB`
          : ''
      }`,
      note: `Derived only from exchange-published fields: STEPPRICE ${stepPriceRub} RUB, MINSTEP ${minStep}, USD/RUB ${fxRate}${quoteUnit ? `, quotation UNIT=${quoteUnit}` : ''}${lotNotionalRub ? `, LOTVOLUME ${lotNotionalRub} RUB notional per lot` : ''}.`,
    };
  }
  return {
    usd_per_price_unit: null,
    quote_unit: quoteUnit ?? null,
    lot_size: lotSize,
    usd_notional_per_lot: null,
    basis: null,
    note: 'MOEX did not publish STEPPRICE/MINSTEP or the USD/RUB rate was unavailable in this snapshot, and the reference description did not state a USD quotation, so no USD P&L is computed.',
  };
}

function describe(res) {
  return res?.provenance?.error ?? `http ${res?.provenance?.http_status ?? 'none'}`;
}

main().catch((error) => {
  console.error('tick failed:', error?.stack ?? error);
  process.exit(1);
});
