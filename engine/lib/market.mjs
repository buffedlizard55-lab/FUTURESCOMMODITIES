/**
 * Market universe construction from official sources.
 *
 * Every instrument carries its own provenance: the exact official endpoint that returned it,
 * HTTP status, response hash, retrieval time, plus the venue-published reference facts
 * (settlement source, contract terms URL, close/expiration time, fee multiplier, ...).
 *
 * Nothing here invents a market. If a venue does not return data, the instrument simply does
 * not appear and the run manifest records the failed call.
 */

import { KalshiClient, bookFromRaw } from './kalshi.mjs';
import { classifyMoexContract, moexContract, moexFortsSecurities, moexSecurityRef } from './moex.mjs';
import { fetchJson, fetchWithProvenance } from './http.mjs';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/* ------------------------------- Kalshi ------------------------------- */

export function resolveKalshiSeries(client, watchlist) {
  return (async () => {
    const matched = new Map();
    const calls = [];
    for (const category of watchlist.kalshi.categories) {
      let res;
      try {
        res = await client.seriesByCategory(category);
      } catch (err) {
        calls.push({ category, error: String(err.message ?? err) });
        continue;
      }
      calls.push({ category, count: res.json?.series?.length ?? 0, provenance: res.provenance });
      for (const s of res.json?.series ?? []) {
        const haystack = `${s.ticker} ${s.title ?? ''}`.toUpperCase();
        if (watchlist.kalshi.exclude_keyword && new RegExp(watchlist.kalshi.exclude_keyword, 'i').test(haystack)) continue;
        for (const rule of watchlist.kalshi.series_rules) {
          if (new RegExp(rule.keyword, 'i').test(haystack)) {
            if (!matched.has(s.ticker)) {
              matched.set(s.ticker, {
                ticker: s.ticker,
                title: s.title,
                category: s.category,
                categories: s.categories,
                frequency: s.frequency,
                group: rule.group,
                rule_id: rule.id,
                fee_multiplier: s.fee_multiplier ?? null,
                fee_type: s.fee_type ?? null,
                tags: s.tags ?? null,
                settlement_sources: s.settlement_sources ?? null,
                contract_terms_url: s.contract_terms_url ?? null,
                product_metadata: s.product_metadata ?? null,
                last_updated_ts: s.last_updated_ts ?? null,
                discovery: { endpoint: `${client.host}/series?category=${category}`, retrieved_at: res.provenance.retrieved_at, sha256: res.provenance.sha256 },
              });
            }
            break;
          }
        }
      }
    }
    const all = [...matched.values()];
    // Prefer series that actually have tradable frequencies and live markets.
    const capped = all.slice(0, watchlist.kalshi.max_series ?? all.length);
    return { series: capped, unresolved_count: all.length - capped.length, calls };
  })();
}

export async function collectKalshiInstruments(client, seriesList) {
  const instruments = [];
  const calls = [];
  const nowIso = new Date().toISOString();
  for (const s of seriesList) {
    let res;
    try {
      res = await client.markets({ status: 'open', seriesTicker: s.ticker, limit: 200 });
    } catch (err) {
      calls.push({ series: s.ticker, error: String(err.message ?? err) });
      continue;
    }
    const markets = res.json?.markets ?? [];
    calls.push({ series: s.ticker, markets: markets.length, provenance: res.provenance });
    for (const m of markets) {
      instruments.push({
        instrument_id: `kalshi:${m.ticker}`,
        venue: 'kalshi',
        venue_name: 'Kalshi (CFTC-regulated event contract exchange)',
        market_type: 'event_contract',
        series_ticker: s.ticker,
        ticker: m.ticker,
        event_ticker: m.event_ticker ?? null,
        title: m.title ?? null,
        yes_sub_title: m.yes_sub_title ?? null,
        group: s.group,
        settlement_source: (s.settlement_sources ?? [])[0] ?? null,
        settlement_sources: s.settlement_sources ?? null,
        contract_terms_url: s.contract_terms_url ?? null,
        fee_multiplier: s.fee_multiplier ?? 1,
        fee_type: s.fee_type ?? null,
        status: m.status ?? null,
        can_close_early: m.can_close_early ?? null,
        open_time: m.open_time ?? null,
        close_time: m.close_time ?? null,
        expiration_time: m.expiration_time ?? null,
        expected_expiration_time: m.expected_expiration_time ?? null,
        latest_expiration_time: m.latest_expiration_time ?? null,
        rules_primary: m.rules_primary ?? null,
        notional_value_dollars: num(m.notional_value_dollars),
        price_level_structure: m.price_level_structure ?? null,
        price_ranges: m.price_ranges ?? null,
        last_price: num(m.last_price_dollars),
        volume: num(m.volume_fp),
        volume_24h: num(m.volume_24h_fp),
        open_interest: num(m.open_interest_fp),
        liquidity_dollars: num(m.liquidity_dollars),
        listed_yes_bid: num(m.yes_bid_dollars),
        listed_yes_ask: num(m.yes_ask_dollars),
        listed_yes_bid_size: num(m.yes_bid_size_fp),
        listed_yes_ask_size: num(m.yes_ask_size_fp),
        listing_provenance: {
          endpoint: `${client.host}/markets?status=open&series_ticker=${s.ticker}`,
          retrieved_at: res.provenance.retrieved_at,
          http_status: res.provenance.http_status,
          sha256: res.provenance.sha256,
        },
        is_tradable_now: m.close_time ? new Date(m.close_time).getTime() > Date.now() : true,
        verified_at: nowIso,
      });
    }
  }
  return { instruments, calls };
}

/** Liquidity score used to decide which markets get an order book call. */
export function liquidityScore(instrument) {
  const vol = instrument.volume_24h ?? instrument.volume ?? 0;
  const oi = instrument.open_interest ?? 0;
  const spread =
    instrument.listed_yes_bid != null && instrument.listed_yes_ask != null
      ? instrument.listed_yes_ask - instrument.listed_yes_bid
      : null;
  const spreadPenalty = spread == null ? 0.5 : Math.min(1, spread / 0.1);
  return vol * 1 + oi * 0.25 + (1 - spreadPenalty) * 50;
}

export async function quoteKalshiInstruments(client, instruments, { maxQuoted }) {
  const now = Date.now();
  const ranked = [...instruments]
    .filter((i) => i.close_time && new Date(i.close_time).getTime() > now)
    .sort((a, b) => liquidityScore(b) - liquidityScore(a));
  const selected = ranked.slice(0, maxQuoted);
  const quotes = {};
  const calls = [];
  for (const inst of selected) {
    let res;
    try {
      res = await client.orderbook(inst.ticker);
    } catch (err) {
      calls.push({ instrument_id: inst.instrument_id, error: String(err.message ?? err) });
      continue;
    }
    const book = bookFromRaw(res.json);
    quotes[inst.instrument_id] = {
      instrument_id: inst.instrument_id,
      venue: 'kalshi',
      kind: 'event_contract',
      best_yes_bid: book.bestYesBid,
      best_yes_ask: book.bestYesAsk,
      best_no_bid: book.bestNoBid,
      best_no_ask: book.bestNoAsk,
      yes_bid_size: book.yesBids.length ? book.yesBids[book.yesBids.length - 1].contracts : null,
      yes_ask_size: book.buyYesLevels.length ? book.buyYesLevels[0].contracts : null,
      mid: book.mid,
      spread: book.spread,
      depth_yes_contracts: book.yesDepthContracts,
      depth_no_contracts: book.noDepthContracts,
      buy_yes_levels: book.buyYesLevels.slice(0, 12),
      buy_no_levels: book.buyNoLevels.slice(0, 12),
      yes_bid_levels: book.yesBids.slice(-12).reverse(),
      no_bid_levels: book.noBids.slice(-12).reverse(),
      source: {
        venue: 'Kalshi',
        endpoint: `${client.host}/markets/${inst.ticker}/orderbook`,
        url: `${client.host}/markets/${inst.ticker}/orderbook`,
        retrieved_at: res.provenance.retrieved_at,
        http_status: res.provenance.http_status,
        sha256: res.provenance.sha256,
        note: 'Official Kalshi public order book (bids only; asks implied by the binary relationship).',
      },
    };
    calls.push({ instrument_id: inst.instrument_id, provenance: res.provenance });
  }
  return { quotes, calls, selected: selected.map((i) => i.instrument_id) };
}

export async function collectKalshiPerps(client, { maxQuoted }, marginNotes) {
  let res;
  try {
    res = await client.marginMarkets({ limit: 200 });
  } catch (err) {
    marginNotes.push({ endpoint: `${client.host}/margin/markets`, error: String(err.message ?? err) });
    return { instruments: [], quotes: {}, calls: [] };
  }
  const markets = res.json?.markets ?? [];
  const instruments = markets.map((m) => ({
    instrument_id: `kalshiperp:${m.ticker}`,
    venue: 'kalshi_margin',
    venue_name: 'Kalshi Perpetual Futures (CFTC-regulated, official Perps API)',
    market_type: 'perpetual',
    ticker: m.ticker,
    title: m.ticker,
    asset_class: m.asset_class ?? null,
    contract_size: num(m.contract_size),
    tick_size: num(m.tick_size),
    underlying_multiplier: num(m.underlying_multiplier),
    bid: num(m.bid),
    offer: num(m.ask),
    reference_price: m.reference_price?.price != null ? num(m.reference_price.price) : null,
    settlement_mark_price: m.settlement_mark_price?.price != null ? num(m.settlement_mark_price.price) : null,
    open_interest: num(m.open_interest),
    open_interest_notional_usd: num(m.open_interest_notional_value_dollars),
    volume: num(m.volume),
    volume_24h: num(m.volume_24h),
    volume_24h_notional_usd: num(m.volume_24h_notional_value_dollars),
    status: m.status ?? null,
    liquidation_mark_price: m.liquidation_mark_price?.price != null ? num(m.liquidation_mark_price.price) : null,
    liquidation_mark_price_ts_ms: m.liquidation_mark_price?.ts_ms ?? null,
    leverage_estimate: num(m.leverage_estimate),
    leverage_estimates: m.leverage_estimates ?? null,
    fractional_trading_enabled: m.fractional_trading_enabled ?? null,
    funding_rate: m.funding_rate ?? null,
    provenance: {
      endpoint: `${client.host}/margin/markets?limit=200`,
      retrieved_at: res.provenance.retrieved_at,
      http_status: res.provenance.http_status,
      sha256: res.provenance.sha256,
    },
    raw: m,
  }));
  const quotes = {};
  for (const inst of instruments) {
    quotes[inst.instrument_id] = {
      instrument_id: inst.instrument_id,
      venue: 'kalshi_margin',
      kind: 'perpetual',
      bid: inst.bid,
      offer: inst.offer,
      mid: inst.bid != null && inst.offer != null ? Number(((inst.bid + inst.offer) / 2).toFixed(8)) : null,
      spread: inst.bid != null && inst.offer != null ? Number((inst.offer - inst.bid).toFixed(8)) : null,
      contract_size: inst.contract_size,
      source: {
        venue: 'Kalshi Perps API',
        url: `${client.host}/margin/markets?limit=200`,
        endpoint: `${client.host}/margin/markets?limit=200`,
        retrieved_at: res.provenance.retrieved_at,
        http_status: res.provenance.http_status,
        sha256: res.provenance.sha256,
        note: 'Official Kalshi Perps API market data (bid/ask and mark prices published by the exchange).',
      },
    };
  }
  return { instruments, quotes, calls: [{ provenance: res.provenance, markets: markets.length }] };
}

/* -------------------------------- MOEX -------------------------------- */

export async function collectMoexInstruments(moexConfig, notes) {
  if (!moexConfig?.enabled) return { instruments: [], quotes: {}, contracts: [] };
  const listing = await moexFortsSecurities();
  if (!listing.ok) {
    notes.push({ endpoint: 'MOEX ISS FORTS securities list', error: 'request failed', provenance: listing.provenance });
    return { instruments: [], quotes: {}, contracts: [] };
  }
  notes.push({ endpoint: 'MOEX ISS FORTS securities list', provenance: listing.provenance, rows: listing.rows.length });
  const wanted = new Set(moexConfig.asset_codes ?? []);
  const byAsset = new Map();
  for (const row of listing.rows) {
    const asset = row.ASSETCODE;
    if (!wanted.has(asset)) continue;
    if (moexConfig.board && row.BOARDID && String(row.SECID).length && !String(row.SECID).match(/^[A-Z0-9]+$/)) continue;
    const list = byAsset.get(asset) ?? [];
    list.push(row);
    byAsset.set(asset, list);
  }
  const picks = [];
  for (const [asset, rows] of byAsset) {
    const sorted = rows
      .filter((r) => r.LASTTRADEDATE)
      .sort((a, b) => String(a.LASTTRADEDATE).localeCompare(String(b.LASTTRADEDATE)));
    for (const row of sorted.slice(0, moexConfig.max_contracts_per_asset ?? 2)) picks.push({ asset, row });
  }

  const instruments = [];
  const quotes = {};
  const contracts = [];
  for (const { asset, row } of picks) {
    const q = await moexContract(row.SECID);
    let ref = { ok: false };
    if (!q.ok || !q.security) {
      notes.push({ endpoint: `MOEX ISS ${row.SECID}`, error: 'quote unavailable', provenance: q.provenance });
      continue;
    }
    if (!q.security.FACEUNIT) {
      ref = await moexSecurityRef(row.SECID);
      notes.push({ endpoint: `MOEX ISS reference ${row.SECID}`, ok: ref.ok, provenance: ref.provenance });
    }
    const klass = classifyMoexContract({ security: q.security, marketdata: q.marketdata, ref: ref.rows?.[0], description: ref.description });
    contracts.push({ asset, secid: row.SECID, ...klass });
    const inst = {
      instrument_id: `moex:${row.SECID}`,
      venue: 'moex_forts',
      venue_name: 'Moscow Exchange FORTS (official ISS market data)',
      market_type: 'future',
      ticker: row.SECID,
      title: klass.shortname,
      asset_code: asset,
      group: moexGroup(asset),
      last_trade_date: klass.last_trade_date,
      faceunit: klass.faceunit,
      lot_volume: klass.lot_volume,
      min_step: klass.min_step,
      pnl_currency_ready: klass.pnl_currency_ready,
      settlement_currency_note: klass.settlement_currency_note,
      fees_reported: klass.fees_reported,
      valuation_inputs: klass.valuation_inputs,
      listing_provenance: {
        endpoint: 'https://iss.moex.com/iss/engines/futures/markets/forts/securities.json',
        retrieved_at: listing.provenance.retrieved_at,
        sha256: listing.provenance.sha256,
      },
      verified_at: new Date().toISOString(),
    };
    instruments.push(inst);
    if (klass.quote && klass.quote.bid != null && klass.quote.offer != null) {
      quotes[inst.instrument_id] = {
        instrument_id: inst.instrument_id,
        venue: 'moex_forts',
        kind: 'future',
        bid: klass.quote.bid,
        offer: klass.quote.offer,
        mid: Number(((klass.quote.bid + klass.quote.offer) / 2).toFixed(6)),
        spread: klass.quote.spread,
        last: klass.quote.last,
        settle_price: klass.quote.settle_price,
        open_interest: klass.quote.open_interest,
        volume_today: klass.quote.volume_today,
        num_trades: klass.quote.num_trades,
        lot_volume: klass.lot_volume,
        min_step: klass.min_step,
        trade_date: klass.quote.trade_date,
        source: {
          venue: 'Moscow Exchange (MOEX) FORTS',
          endpoint: q.provenance.url,
          retrieved_at: q.provenance.retrieved_at,
          http_status: q.provenance.http_status,
          sha256: q.provenance.sha256,
          note: 'Official MOEX ISS quote: BID/OFFER/SPREAD/LAST/SETTLEPRICE/OPENPOSITION/VOLTODAY as published by the exchange.',
        },
      };
    }
  }
  return { instruments, quotes, contracts };
}

function moexGroup(asset) {
  const map = {
    GOLD: 'Precious Metals',
    GOLDM: 'Precious Metals',
    SILV: 'Precious Metals',
    SILVM: 'Precious Metals',
    PLT: 'Precious Metals',
    PLTM: 'Precious Metals',
    COPPER: 'Industrial Metals',
    NICKEL: 'Industrial Metals',
    ALUM: 'Industrial Metals',
    COCOA: 'Soft Commodities',
    COFFEE: 'Soft Commodities',
    SUGAR: 'Soft Commodities',
    WHEAT: 'Grains & Oilseeds',
    AI92: 'Energy',
    AI95: 'Energy',
  };
  return map[asset] ?? 'Other';
}

/* ----------------------------- Benchmarks ----------------------------- */

/**
 * EIA daily spot benchmark pages (official US Energy Information Administration HTML tables).
 * Parsing is strict: we only accept a row when the date and value cells match the published
 * table layout; otherwise the series is reported as parse_failed and no value is used.
 */
export async function collectEiaBenchmarks(cfg, notes) {
  if (!cfg?.enabled) return {};
  const out = {};
  for (const s of cfg.series ?? []) {
    const res = await fetchJson(s.page, {
      accept: 'text/html',
      parse: 'text',
      note: `EIA official daily series page for ${s.id}`,
    });
    if (!res.ok || !res.text) {
      notes.push({ endpoint: s.page, error: 'request failed', provenance: res.provenance });
      out[s.id] = { status: 'unavailable', provenance: res.provenance, name: s.name };
      continue;
    }
    const parsed = parseEiaDailyTable(res.text);
    notes.push({ endpoint: s.page, provenance: res.provenance, rows_parsed: parsed.rows.length });
    out[s.id] = {
      status: parsed.rows.length ? 'ok' : 'parse_failed',
      name: s.name,
      series_id: s.id,
      page: s.page,
      latest: parsed.rows.at(-1) ?? null,
      rows_parsed: parsed.rows.length,
      provenance: res.provenance,
      parse_note: parsed.note,
    };
  }
  return out;
}

/**
 * FRED CSV benchmark adapter (keyless official Fed publication of the EIA spot series).
 * CSV layout: `observation_date,SERIES_ID` with '.' marking "no observation".
 */
export async function collectFredBenchmarks(cfg, notes) {
  if (!cfg?.enabled) return {};
  const out = {};
  for (const s of cfg.series ?? []) {
    const res = await fetchWithProvenance(s.url, { parse: 'text', accept: 'text/csv,text/plain,*/*', note: `FRED official CSV download for ${s.id}` });
    if (!res.ok || !res.text) {
      notes.push({ endpoint: s.url, error: 'request failed', provenance: res.provenance });
      out[s.alias] = { status: 'unavailable', name: s.name, provenance: res.provenance, source: 'FRED (Federal Reserve Bank of St. Louis)' };
      continue;
    }
    const rows = parseFredCsv(res.text);
    notes.push({ endpoint: s.url, provenance: res.provenance, rows_parsed: rows.length });
    out[s.alias] = {
      status: rows.length ? 'ok' : 'parse_failed',
      name: s.name,
      series_id: s.id,
      page: s.url,
      source: 'FRED (Federal Reserve Bank of St. Louis) CSV download; series is the official EIA spot series re-published by FRED',
      latest: rows.at(-1) ?? null,
      rows_parsed: rows.length,
      rows,
      provenance: res.provenance,
      parse_note: rows.length ? 'Parsed date,value pairs from the official CSV header.' : 'No parsable date,value rows were found.',
    };
  }
  return out;
}

/** Parse a FRED CSV download into [{date, value}] ('.' means missing observation). */
export function parseFredCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const rows = [];
  for (const line of lines.slice(1)) {
    const [date, value] = line.split(',');
    if (!date || value === undefined) continue;
    const v = value.trim();
    if (v === '.' || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) continue;
    rows.push({ date: date.trim(), value: n });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

/** Parse the EIA "LeafHandler" daily table: rows of `MM/DD/YYYY</td><td>VALUE` style cells. */
export function parseEiaDailyTable(html) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = rowRe.exec(html))) {
    const cells = [];
    let c;
    cellRe.lastIndex = 0;
    while ((c = cellRe.exec(m[1]))) {
      cells.push(c[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim());
    }
    if (cells.length >= 2) {
      const date = cells[0];
      const value = cells[1];
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(date) && /^-?[\d,.]+$/.test(value.replace(/,/g, ''))) {
        const [mm, dd, yyyy] = date.split('/');
        rows.push({ date: `${yyyy}-${mm}-${dd}`, value: Number(value.replace(/,/g, '')) });
      }
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return {
    rows,
    note: rows.length
      ? 'Parsed from the official EIA daily data table (date/value cell pairs).'
      : 'No date/value rows matched the published EIA table layout; values intentionally left empty.',
  };
}
