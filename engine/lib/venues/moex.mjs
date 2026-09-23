/**
 * Moscow Exchange (MOEX) ISS adapter - official, keyless, public market data.
 *
 * Verified live on 2026-09-22:
 *   /iss/engines/futures/markets/forts/securities.json                 -> 200, 503 contracts
 *   /iss/engines/futures/markets/forts/securities.json?assetcode=GOLD -> 200 commodity contracts
 *   /iss/engines/futures/markets/forts/securities/{SECID}.json         -> 200 bid/offer/last/settle/volume/open interest
 *   /iss/history/engines/futures/markets/forts/securities/{SECID}.json -> 200 daily OPEN/LOW/HIGH/CLOSE/SETTLEPRICE/VOLUME
 *   /iss/engines/currency/markets/selt/securities/USD000UTSTOM.json    -> 200 USD/RUB (used only to convert fees already charged in RUB)
 *
 * MOEX ISS publishes a best bid/offer and aggregate volume/open interest, but no per-level depth.
 * The simulation therefore fills at the quoted price and caps size with an explicit share of the
 * exchange-published volume, and it records that limitation on every trade it produces.
 *
 * Terms: MOEX ISS is a free public interface; the project attributes MOEX as the source and links
 * the exact endpoint on every record. Commercial reuse must be checked against MOEX's own terms.
 */

import { get } from '../http.mjs';

export const MOEX_ISS = 'https://iss.moex.com/iss';
export const MOEX_TERMS = 'https://www.moex.com/en/terms';

function table(json, name) {
  const block = json?.[name];
  if (!block?.data) return [];
  return block.data.map((row) => Object.fromEntries(block.columns.map((c, i) => [c, row[i]])));
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** All FORTS contracts, optionally filtered by asset code. */
export async function fetchFortsSecurities({ limit = 100 } = {}) {
  const rows = [];
  const provenance = [];
  let start = 0;
  for (let page = 0; page < 12; page += 1) {
    const qs = new URLSearchParams({ 'iss.meta': 'off', 'iss.only': 'securities', limit: String(limit), start: String(start) });
    const url = `${MOEX_ISS}/engines/futures/markets/forts/securities.json?${qs.toString()}`;
    const res = await get(url, { note: 'MOEX ISS FORTS contract list (official exchange listing)', expect: 'json' });
    if (!res.ok || !res.json) return { ok: false, rows, provenance: [...provenance, res.provenance] };
    provenance.push(res.provenance);
    const page_rows = table(res.json, 'securities');
    rows.push(...page_rows);
    if (page_rows.length < limit) break;
    start += limit;
  }
  // The FORTS listing contains several rows per contract (one per board) and rows for options
  // and other instrument types. Only RFUD futures rows are kept, de-duplicated by SECID, so the
  // universe cannot contain the same contract twice or a non-futures instrument.
  const futures = rows.filter((r) => {
    const type = String(r.SECTYPE ?? '').toUpperCase();
    const board = String(r.BOARDID ?? '').toUpperCase();
    if (type) return ['RFUD', 'FU', 'FUTURES'].includes(type) || board === 'RFUD';
    return board === 'RFUD';
  });
  const bySecid = new Map();
  for (const row of futures) {
    const existing = bySecid.get(row.SECID);
    if (!existing) bySecid.set(row.SECID, row);
    else if (row.BOARDID === 'RFUD' && existing.BOARDID !== 'RFUD') bySecid.set(row.SECID, row);
  }
  const instrumentTypes = {};
  for (const row of rows) {
    const key = `${row.SECTYPE ?? 'none'}/${row.BOARDID ?? 'none'}`;
    instrumentTypes[key] = (instrumentTypes[key] ?? 0) + 1;
  }
  return { ok: true, rows: [...bySecid.values()], provenance, duplicates_removed: rows.length - bySecid.size, instrument_types: instrumentTypes };
}

/** Current quote + reference data for one contract. */
export async function fetchSecurity(secid) {
  const url = `${MOEX_ISS}/engines/futures/markets/forts/securities/${encodeURIComponent(secid)}.json?iss.meta=off`;
  const res = await get(url, { note: `MOEX ISS quote for ${secid}`, expect: 'json' });
  if (!res.ok || !res.json) return { ok: false, provenance: res.provenance };
  return {
    ok: true,
    securities: table(res.json, 'securities')[0] ?? null,
    marketdata: table(res.json, 'marketdata')[0] ?? null,
    provenance: res.provenance,
  };
}

/** Daily history for one contract (used to derive momentum/seasonality from real settlements only). */
export async function fetchHistory(secid, { from } = {}) {
  const qs = new URLSearchParams({ 'iss.meta': 'off', 'iss.only': 'history', limit: '100' });
  if (from) qs.set('from', from);
  const url = `${MOEX_ISS}/history/engines/futures/markets/forts/securities/${encodeURIComponent(secid)}.json?${qs.toString()}`;
  const res = await get(url, { note: `MOEX ISS daily history for ${secid}`, expect: 'json' });
  if (!res.ok || !res.json) return { ok: false, rows: [], provenance: res.provenance };
  return { ok: true, rows: table(res.json, 'history'), provenance: res.provenance };
}

/** Official USD/RUB from the MOEX currency market (used for fee conversion only). */
export async function fetchUsdRub() {
  const url = `${MOEX_ISS}/engines/currency/markets/selt/securities/USD000UTSTOM.json?iss.meta=off&iss.only=securities,marketdata`;
  const res = await get(url, { note: 'MOEX ISS USD/RUB fixing (official exchange data)', expect: 'json' });
  if (!res.ok || !res.json) return { ok: false, rate: null, provenance: res.provenance };
  const md = table(res.json, 'marketdata')[0] ?? {};
  const sec = table(res.json, 'securities')[0] ?? {};
  const rate = num(md.LAST) ?? num(md.MARKETPRICE) ?? num(sec.PREVPRICE) ?? null;
  return { ok: rate != null, rate, marketdata: md, securities: sec, provenance: res.provenance, url };
}

/**
 * Reference description for one security: the authoritative machine-readable place where MOEX
 * publishes the contract's LOTSIZE (units per lot), UNIT (quotation currency), FACEUNIT
 * (settlement/execution currency) and EXECTYPE (settlement type).
 *
 * Verified live on 2026-09-22 for GDZ6 (GOLD-12.26): LOTSIZE=1, UNIT="USD", FACEUNIT="USD",
 * EXECTYPE="Расчетный" (cash-settled); for SVZ6 (SILV-12.26): LOTSIZE=10, UNIT="USD",
 * FACEUNIT="USD"; for PTZ6 (PLT-12.26): LOTSIZE=1, UNIT="USD", FACEUNIT="USD".
 * This is the field set that makes a like-for-like comparison with another venue's contract
 * possible (it is what the cross-venue basis strategy was missing before 2026-09-22).
 */
export async function moexSecurityDescription(secid) {
  const url = `${MOEX_ISS}/securities/${encodeURIComponent(secid)}.json?iss.meta=off&iss.only=description`;
  const res = await get(url, { note: `MOEX ISS security description (LOT SIZE, quotation UNIT, FACEUNIT) for ${secid}`, expect: 'json' });
  if (!res.ok || !res.json) return { ok: false, secid, provenance: res.provenance };
  const rows = table(res.json, 'description');
  const fields = {};
  for (const r of rows) {
    if (r.name != null) fields[r.name] = r.value;
  }
  return { ok: true, secid, fields, provenance: res.provenance };
}

/**
 * Contracts on MOEX FORTS that this competition may trade. The whitelist is not taken on
 * trust: a contract is only included when the exchange's own listing (a) contains that asset
 * code and (b) the contract's name contains the same keyword, so a wrong mapping cannot slip
 * into the database.
 *
 * `sector` separates commodity futures (the original competition scope) from the non-commodity
 * sectors that the project brief requires the universe to cover: equity-index, interest-rate,
 * FX and crypto futures. Those asset codes were verified to exist in the official FORTS listing
 * on 2026-09-22 and are recorded `listed_only` in engine/universe/futures-registry.json; the
 * same name-keyword gate re-verifies them against the live listing on every tick, so a code
 * that the exchange removes simply trades nothing.
 */
export const MOEX_COMMODITY_ASSETS = [
  { asset_code: 'GOLD', commodity: 'Gold', group: 'Precious Metals', sector: 'commodity', keywords: ['gold', 'gold-'] },
  { asset_code: 'SILV', commodity: 'Silver', group: 'Precious Metals', sector: 'commodity', keywords: ['silv', 'silver'] },
  { asset_code: 'PLT', commodity: 'Platinum', group: 'Precious Metals', sector: 'commodity', keywords: ['plt', 'platin'] },
  { asset_code: 'PLTM', commodity: 'Platinum (mini)', group: 'Precious Metals', sector: 'commodity', keywords: ['pltm', 'platin'] },
  { asset_code: 'PALL', commodity: 'Palladium', group: 'Precious Metals', sector: 'commodity', keywords: ['pall', 'pallad'] },
  { asset_code: 'COPPER', commodity: 'Copper', group: 'Industrial Metals', sector: 'commodity', keywords: ['copper', 'cop-'] },
  { asset_code: 'NICKEL', commodity: 'Nickel', group: 'Industrial Metals', sector: 'commodity', keywords: ['nickel'] },
  { asset_code: 'ALUM', commodity: 'Aluminium', group: 'Industrial Metals', sector: 'commodity', keywords: ['alum'] },
  { asset_code: 'ZINC', commodity: 'Zinc', group: 'Industrial Metals', sector: 'commodity', keywords: ['zinc'] },
  { asset_code: 'LEAD', commodity: 'Lead', group: 'Industrial Metals', sector: 'commodity', keywords: ['lead'] },
  { asset_code: 'COCOA', commodity: 'Cocoa', group: 'Soft Commodities', sector: 'commodity', keywords: ['cocoa'] },
  { asset_code: 'COFFEE', commodity: 'Coffee', group: 'Soft Commodities', sector: 'commodity', keywords: ['coffee'] },
  { asset_code: 'SUGAR', commodity: 'Sugar', group: 'Soft Commodities', sector: 'commodity', keywords: ['sugar'] },
  { asset_code: 'WHEAT', commodity: 'Wheat', group: 'Grains & Oilseeds', sector: 'commodity', keywords: ['wheat'] },
  { asset_code: 'CORN', commodity: 'Corn', group: 'Grains & Oilseeds', sector: 'commodity', keywords: ['corn'] },
  { asset_code: 'SOY', commodity: 'Soybean', group: 'Grains & Oilseeds', sector: 'commodity', keywords: ['soy'] },
  { asset_code: 'RICE', commodity: 'Rice', group: 'Grains & Oilseeds', sector: 'commodity', keywords: ['rice'] },
  { asset_code: 'AI92', commodity: 'Gasoline AI-92', group: 'Energy', sector: 'commodity', keywords: ['ai92', 'ai-92'] },
  { asset_code: 'AI95', commodity: 'Gasoline AI-95', group: 'Energy', sector: 'commodity', keywords: ['ai95', 'ai-95'] },
  { asset_code: 'WTI', commodity: 'WTI Crude Oil', group: 'Energy', sector: 'commodity', keywords: ['wti'] },
  { asset_code: 'BR', commodity: 'Brent Crude Oil', group: 'Energy', sector: 'commodity', keywords: ['br-'] },
  { asset_code: 'NG', commodity: 'Natural Gas (NG)', group: 'Energy', sector: 'commodity', keywords: ['ng-'] },
  { asset_code: 'NGM', commodity: 'Natural Gas (NGM)', group: 'Energy', sector: 'commodity', keywords: ['ngm-'] },
  { asset_code: 'TTF', commodity: 'Natural Gas (TTF)', group: 'Energy', sector: 'commodity', keywords: ['ttf'] },
  { asset_code: 'DTL', commodity: 'Diesel (DTL)', group: 'Energy', sector: 'commodity', keywords: ['dtl'] },
  { asset_code: 'BRENT', commodity: 'Brent Crude Oil', group: 'Energy', sector: 'commodity', keywords: ['brent'] },
  { asset_code: 'NGAS', commodity: 'Natural Gas', group: 'Energy', sector: 'commodity', keywords: ['ngas', 'gas'] },
  { asset_code: 'DAMILK', commodity: 'Raw Milk', group: 'Dairy', sector: 'commodity', keywords: ['milk'] },
  { asset_code: 'SUGR', commodity: 'Raw Sugar (SUGR)', group: 'Soft Commodities', sector: 'commodity', keywords: ['sugr'] },
  { asset_code: 'ORANGE', commodity: 'Orange Juice (ORANGE)', group: 'Soft Commodities', sector: 'commodity', keywords: ['orange'] },
  // ---- Non-commodity sectors verified in the official FORTS listing on 2026-09-22 (registry: listed_only) ----
  { asset_code: 'MIX', commodity: 'IMOEX Index', group: 'Equity Index Futures', sector: 'index', keywords: ['mix-'] },
  { asset_code: 'RTS', commodity: 'RTS Index', group: 'Equity Index Futures', sector: 'index', keywords: ['rts-'] },
  { asset_code: 'NASD', commodity: 'Nasdaq-100 Index', group: 'Equity Index Futures', sector: 'index', keywords: ['nasd'] },
  { asset_code: 'SPYF', commodity: 'S&P 500 Index', group: 'Equity Index Futures', sector: 'index', keywords: ['spy'] },
  { asset_code: 'RUONIA', commodity: 'RUONIA Rate', group: 'Interest Rate Futures', sector: 'rate', keywords: ['ruonia'] },
  { asset_code: '1MFR', commodity: '1-Month RUONIA Rate', group: 'Interest Rate Futures', sector: 'rate', keywords: ['1mfr'] },
  { asset_code: 'Si', commodity: 'USD/RUB', group: 'FX Futures', sector: 'fx', keywords: ['si-'] },
  { asset_code: 'CNY', commodity: 'CNY/RUB', group: 'FX Futures', sector: 'fx', keywords: ['cny'] },
  // Ether is covered by the ETHA Trust ETF future (ASSETCODE ETHA, verified in the exchange
  // listing 2026-09-22: ETZ6 "ETHA-12.26", UNIT=USD, one contract = one ETHA share). NOTE: the
  // ETHA share is NOT one ETH (2026-09-23: share 21.05 USD vs MOEX Ethereum Index 2,761 USD),
  // so the share/ETH ratio is not available from the fields this engine uses and the ETHA
  // future must not be used in a cross-venue ETH basis until the ratio is verified; the
  // strategy's unit-reconciliation gate blocks that automatically. If MOEX lists the
  // MOEX-Ether-Index futures (spec code ETH), they will need their own verified entry before
  // they may trade.
  { asset_code: 'BTC', commodity: 'Bitcoin', group: 'Crypto Futures', sector: 'crypto', keywords: ['btc'] },
  { asset_code: 'ETHA', commodity: 'Ether (ETHA Trust ETF)', group: 'Crypto Futures', sector: 'crypto', keywords: ['etha', 'eth'] },];

/** Classify a listing row against the commodity whitelist (asset code AND name must agree). */
export function classifyMoexContract(row) {
  const assetCode = row.ASSETCODE ?? null;
  const name = String(row.SHORTNAME ?? '').toLowerCase();
  if (!assetCode) return null;
  const entry = MOEX_COMMODITY_ASSETS.find((a) => a.asset_code === assetCode);
  if (!entry) return null;
  // The contract name must agree with the asset code. The exchange's own naming is the second
  // check that prevents a mis-mapped asset code from entering the universe.
  const nameMatches = entry.keywords.some((k) => name.includes(k));
  if (!nameMatches) return null;
  return entry;
}

export { num as toNumber, table as jsonTable };
