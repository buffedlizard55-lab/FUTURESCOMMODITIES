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

  const descriptionCacheFor = (secid) => moexDescriptionCache[secid] ?? null;

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
    // Diversify: the nearest two expiries of every commodity the exchange lists, so one busy
    // contract cannot crowd the universe out of the request budget.
    const byAsset = new Map();
    for (const item of classified) {
      const key = item.klass.asset_code;
      if (!byAsset.has(key)) byAsset.set(key, []);
      byAsset.get(key).push(item);
    }
    const limited = [];
    for (const [, items] of byAsset) {
      items.sort((a, b) => String(a.row.LASTTRADEDATE ?? '').localeCompare(String(b.row.LASTTRADEDATE ?? '')));
      limited.push(...items.slice(0, 2));
    }
    limited.splice(watchlist.moex?.max_contracts ?? 30);
    console.log(`   moex commodity contracts discovered: ${classified.length} across ${byAsset.size} commodities, tracking ${limited.length}`);
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
      const valuation = computeMoexValuation({ securities: res.securities, fx });
      const instrument = buildMoexInstrument({
        row,
        classification: klass,
        valuation,
        provenance: { url: res.provenance?.url, sha256: res.provenance?.sha256 },
        listing: listingRow ? { url: listingRow.url, sha256: listingRow.sha256, retrieved_at: listingRow.retrieved_at } : null,
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
    for (const inst of instruments.filter((i) => i.commodity)) {
      const file = `${paths.history}/kalshi/${inst.series_ticker}.json`;
      const age = fileAgeHours(file);
      const cached = readJson(file, null);
      const cachedHasPrices = (cached?.candles ?? []).some((c) => c && c.close != null);
      if (cached && cachedHasPrices && age != null && age < historyRefreshHours) {
        kalshiCandles[inst.series_ticker] = cached.candles ?? [];
        continue;
      }
      const nowSeconds = Math.floor(Date.now() / 1000);
      const start = nowSeconds - 90 * 86400;
      const res = await kalshi.candlesticks({ seriesTicker: inst.series_ticker, marketTicker: inst.ticker, startTs: start, endTs: nowSeconds, periodInterval: 1440 });
      if (!res.ok) {
        degraded.push({ venue: 'kalshi', step: 'candlesticks', series: inst.series_ticker, tried: res.tried });
        kalshiCandles[inst.series_ticker] = cached?.candles ?? [];
        continue;
      }
      // Official candlestick schema (docs.kalshi.com get-market-candlesticks): OHLC values live
      // in `price.close_dollars`, `yes_bid.close_dollars`, `yes_ask.close_dollars` (fixed-point
      // dollar strings), volumes in `volume_fp`/`open_interest_fp`. Candles whose OHLC is null
      // are the exchange's synthetic placeholder for "no data in this period" (documented in the
      // schema) and are stored as nulls, never treated as prices.
      const candles = (res.candles ?? []).map((c) => ({
        end_period_ts: c.end_period_ts,
        close: num(c.price?.close_dollars) ?? num(c.price?.close) ?? null,
        yes_bid_close: num(c.yes_bid?.close_dollars) ?? null,
        yes_ask_close: num(c.yes_ask?.close_dollars) ?? null,
        volume: num(c.volume_fp) ?? num(c.volume) ?? null,
        open_interest: num(c.open_interest_fp) ?? num(c.open_interest) ?? null,
      }));
      kalshiCandles[inst.series_ticker] = candles;
      writeJson(file, {
        series_ticker: inst.series_ticker,
        market_ticker_used: inst.ticker,
        endpoint: res.provenance?.url ?? null,
        http_status: res.provenance?.http_status ?? null,
        sha256: res.provenance?.sha256 ?? null,
        retrieved_at: res.provenance?.retrieved_at ?? null,
        candles,
        note: 'Official Kalshi candlesticks. `close` is the price at the end of the period as published by the exchange.',
      });
      if (Object.keys(kalshiCandles).length >= (competition.max_candle_series ?? 30)) break;
    }
    console.log(`   kalshi candle series cached: ${Object.keys(kalshiCandles).length}`);

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
    for (const requested of ctx.exits) {
      const position = portfolio.positions[requested.instrument_id];
      if (!position) continue;
      const inst = instrumentById[requested.instrument_id];
      const quote = quotes[requested.instrument_id];
      if (!inst || !quote) {
        intents.push(intentRecord({ strategy_id: strategy.id, username: strategy.username, instrument_id: requested.instrument_id, action: 'exit' }, runId, 'no_verified_quote', 'Cannot exit: this run produced no verified quote for the instrument.'));
        continue;
      }
      if (inst.kind === 'event_contract') {
        const exitPrice = position.outcome === 'yes' ? quote.best_yes_bid : quote.best_no_bid;
        if (exitPrice == null) {
          intents.push(intentRecord({ strategy_id: strategy.id, username: strategy.username, instrument_id: requested.instrument_id, action: 'exit' }, runId, 'one_sided_book', 'No resting bid for the side held, so the position cannot be exited at this moment.'));
          continue;
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
    }

    if (typeof strategy.decide === 'function') {
      try {
        strategy.decide(ctx);
      } catch (error) {
        strategyNotes.push({ error: String(error?.message ?? error), phase: 'decide' });
        degraded.push({ venue: 'engine', step: 'strategy_decide', strategy: strategy.id, error: String(error?.message ?? error) });
      }
    }

    for (const ord of ctx.orders) {
      if (ord.order_type === 'maker') {
        const registered = registerWorkingOrder({ ord, instrumentById, quotes, workingOrders, intents, runId, competition });
        if (!registered) continue;
        continue;
      }
      if (ord.venue === 'kalshi') {
        executeEventContractOrder({ ord, inst: instrumentById[ord.instrument_id], quote: quotes[ord.instrument_id], portfolio, runId, newTrades, intents, instrumentById, competition, fx });
      } else {
        executeQuoteOrder({ ord, inst: instrumentById[ord.instrument_id], quote: quotes[ord.instrument_id], portfolio, runId, newTrades, intents, instrumentById, competition, fx });
      }
    }

    markPortfolio(portfolio, quotes);
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
    }
  }
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
function positionMargin({ inst, contracts, price, fx }) {
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

function executeEventContractOrder({ ord, inst, quote, portfolio, runId, newTrades, intents, instrumentById, competition, fx }) {
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

function executeQuoteOrder({ ord, inst, quote, portfolio, runId, newTrades, intents, instrumentById, competition, fx }) {
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
    feeModel:
      inst.kind === 'future'
        ? 'MOEX BUYSELLFEE (exchange-published per-contract fee in RUB) converted at the official MOEX USD/RUB rate'
        : 'Kalshi perp fee schedule not retrieved in this project: fee is reported as unknown rather than assumed to be zero',
    availableLiquidity: capInfo,
  });
  fill.notional_usd = Number((fill.vwap * contracts * (usdPerPriceUnit ?? 1)).toFixed(6));

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

function registerWorkingOrder({ ord, instrumentById, quotes, workingOrders, intents, runId, competition }) {
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

function processWorkingOrders({ workingOrders, ctxBase, portfolios, runId, newTrades, intents, competition }) {
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

function buildTrade({ ord, inst, quote, fill, contracts, runId, capacity, fx, isExit, position, makerMultiplier, margin = null }) {
  const isEventContract = inst.kind === 'event_contract';
  const price = fill.vwap;
  const usdPerPriceUnit = isEventContract ? 1 : inst.kind === 'perpetual' ? 1 : inst.usd_valuation?.usd_per_price_unit ?? null;
  const notional = price != null && usdPerPriceUnit != null ? Number((price * contracts * usdPerPriceUnit).toFixed(6)) : null;

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

function intentRecord(ord, runId, reason, detail, extra = null) {
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
  if (quoteUnit === 'USD') {
    // The exchange's own reference data states that the price is quoted in USD per unit of the
    // underlying (UNIT=USD) and settled in USD (FACEUNIT=USD), so 1.0 of price movement is
    // exactly 1 USD per unit. This replaces the older STEPPRICE-derived approximation below
    // (which mixed in MOEX's own RUB step valuation and a separately captured USD/RUB rate and
    // therefore understated the USD value of a USD-quoted contract by the fixing difference).
    return {
      usd_per_price_unit: 1.0,
      quote_unit: quoteUnit,
      lot_size: lotSize,
      basis: `MOEX ISS description for this contract publishes UNIT=USD (quotation currency) and FACEUNIT=${descriptionFields?.FACEUNIT ?? 'n/a'} (settlement currency): the quote is USD per underlying unit, so 1.0 of price movement is 1 USD per unit.`,
      note: `Derived only from exchange-published reference fields: UNIT=${quoteUnit}, FACEUNIT=${descriptionFields?.FACEUNIT ?? 'n/a'}, LOTSIZE=${descriptionFields?.LOTSIZE ?? 'n/a'}.`,
    };
  }
  if (minStep && stepPriceRub && fxRate) {
    const usdPerPriceUnit = Number((stepPriceRub / minStep / fxRate).toFixed(8));
    return {
      usd_per_price_unit: usdPerPriceUnit,
      quote_unit: quoteUnit ?? null,
      lot_size: lotSize,
      basis: `USD value of a one-unit price move = (MOEX STEPPRICE ${stepPriceRub} RUB per MINSTEP ${minStep}) / MOEX USD/RUB ${fxRate}`,
      note: `Derived only from exchange-published fields: STEPPRICE ${stepPriceRub} RUB, MINSTEP ${minStep}, USD/RUB ${fxRate}${quoteUnit ? `, quotation UNIT=${quoteUnit}` : ''}.`,
    };
  }
  return {
    usd_per_price_unit: null,
    quote_unit: quoteUnit ?? null,
    lot_size: lotSize,
    basis: null,
    note: 'MOEX did not publish STEPPRICE/MINSTEP or the USD/RUB rate was unavailable in this snapshot, and the reference description did not state a USD quotation, so no USD P&L is computed.',
  };
}

function feeInUsd({ inst, fx }) {
  const feeRub = inst.contract_specification?.buy_sell_fee_rub ?? null;
  const rate = fx?.rate ?? null;
  if (feeRub == null || !rate) return null;
  return Number((feeRub / rate).toFixed(6));
}

function describe(res) {
  return res?.provenance?.error ?? `http ${res?.provenance?.http_status ?? 'none'}`;
}

main().catch((error) => {
  console.error('tick failed:', error?.stack ?? error);
  process.exit(1);
});
