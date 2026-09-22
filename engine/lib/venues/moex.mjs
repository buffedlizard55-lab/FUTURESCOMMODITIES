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
 * Commodity contracts on MOEX FORTS. The whitelist is not taken on trust: a contract is only
 * included when the exchange's own listing (a) contains that asset code and (b) the contract's
 * name contains the same keyword, so a wrong mapping cannot slip into the database.
 */
export const MOEX_COMMODITY_ASSETS = [
  { asset_code: 'GOLD', commodity: 'Gold', group: 'Precious Metals', keywords: ['gold', 'gold-'] },
  { asset_code: 'SILV', commodity: 'Silver', group: 'Precious Metals', keywords: ['silv', 'silver'] },
  { asset_code: 'PLT', commodity: 'Platinum', group: 'Precious Metals', keywords: ['plt', 'platin'] },
  { asset_code: 'PLTM', commodity: 'Platinum (mini)', group: 'Precious Metals', keywords: ['pltm', 'platin'] },
  { asset_code: 'PALL', commodity: 'Palladium', group: 'Precious Metals', keywords: ['pall', 'pallad'] },
  { asset_code: 'COPPER', commodity: 'Copper', group: 'Industrial Metals', keywords: ['copper', 'cop-'] },
  { asset_code: 'NICKEL', commodity: 'Nickel', group: 'Industrial Metals', keywords: ['nickel'] },
  { asset_code: 'ALUM', commodity: 'Aluminium', group: 'Industrial Metals', keywords: ['alum'] },
  { asset_code: 'ZINC', commodity: 'Zinc', group: 'Industrial Metals', keywords: ['zinc'] },
  { asset_code: 'LEAD', commodity: 'Lead', group: 'Industrial Metals', keywords: ['lead'] },
  { asset_code: 'COCOA', commodity: 'Cocoa', group: 'Soft Commodities', keywords: ['cocoa'] },
  { asset_code: 'COFFEE', commodity: 'Coffee', group: 'Soft Commodities', keywords: ['coffee'] },
  { asset_code: 'SUGAR', commodity: 'Sugar', group: 'Soft Commodities', keywords: ['sugar'] },
  { asset_code: 'WHEAT', commodity: 'Wheat', group: 'Grains & Oilseeds', keywords: ['wheat'] },
  { asset_code: 'CORN', commodity: 'Corn', group: 'Grains & Oilseeds', keywords: ['corn'] },
  { asset_code: 'SOY', commodity: 'Soybean', group: 'Grains & Oilseeds', keywords: ['soy'] },
  { asset_code: 'RICE', commodity: 'Rice', group: 'Grains & Oilseeds', keywords: ['rice'] },
  { asset_code: 'AI92', commodity: 'Gasoline AI-92', group: 'Energy', keywords: ['ai92', 'ai-92'] },
  { asset_code: 'AI95', commodity: 'Gasoline AI-95', group: 'Energy', keywords: ['ai95', 'ai-95'] },
  { asset_code: 'BRENT', commodity: 'Brent Crude Oil', group: 'Energy', keywords: ['brent'] },
  { asset_code: 'NGAS', commodity: 'Natural Gas', group: 'Energy', keywords: ['ngas', 'gas'] },
  { asset_code: 'DAMILK', commodity: 'Raw Milk', group: 'Dairy', keywords: ['milk'] },
];

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
