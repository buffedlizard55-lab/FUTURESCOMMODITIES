/**
 * Moscow Exchange (MOEX) official ISS API client — keyless, public, official exchange data.
 *
 * Why MOEX is used for the automated futures leg (verified 2026-09-22):
 *  - ISS is an official MOEX data service, documented at https://iss.moex.com/iss/reference/
 *  - No API key, no registration, no paid tier.
 *  - It exposes the real FORTS derivatives book and daily history:
 *      /iss/engines/futures/markets/forts/securities/{SECID}.json  -> BID, OFFER, SPREAD,
 *          OPEN, HIGH, LOW, LAST, SETTLEPRICE, OPENPOSITION, VOLTODAY, NUMTRADES,
 *          MINSTEP, STEPPRICE, LOTVOLUME, INITIALMARGIN, BUYSELLFEE, EXERCISEFEE, ...
 *      /iss/history/engines/futures/markets/forts/securities/{SECID}.json -> daily
 *          OPEN/LOW/HIGH/CLOSE/SETTLEPRICE/VOLUME/OPENPOSITION/WAPRICE/NUMTRADES
 *      /iss/securities/{SECID}.json -> reference data incl. FACEUNIT, LOTSIZE
 *
 * We deliberately do NOT scrape exchanges whose data terms forbid automated access
 * (CME Group returned HTTP 403 "suspected web scraping" to our runner on 2026-09-22 and
 * their Data Terms of Use prohibit automated collection). See docs/LIMITATIONS.md.
 */

import { fetchJson } from './http.mjs';

export const MOEX_ISS = 'https://iss.moex.com/iss';

function table(payload, name) {
  const block = payload?.[name];
  if (!block) return [];
  const cols = block.columns ?? [];
  return (block.data ?? []).map((row) => {
    const obj = {};
    cols.forEach((c, i) => {
      obj[c] = row[i];
    });
    return obj;
  });
}

/** Current quote + contract reference data for a MOEX FORTS contract. */
export async function moexContract(secid) {
  const url = `${MOEX_ISS}/engines/futures/markets/forts/securities/${encodeURIComponent(secid)}.json?iss.meta=off&iss.only=securities,marketdata`;
  const res = await fetchJson(url, { note: `MOEX ISS FORTS quote+reference for ${secid} (official exchange data)` });
  if (!res.ok) return { ok: false, secid, provenance: res.provenance };
  return {
    ok: true,
    secid,
    security: table(res.json, 'securities')[0] ?? null,
    marketdata: table(res.json, 'marketdata')[0] ?? null,
    provenance: res.provenance,
  };
}

/** Daily history rows for a MOEX FORTS contract (real exchange settlements). */
export async function moexHistory(secid, { from, till } = {}) {
  const q = new URLSearchParams({ 'iss.meta': 'off' });
  if (from) q.set('from', from);
  if (till) q.set('till', till);
  const url = `${MOEX_ISS}/history/engines/futures/markets/forts/securities/${encodeURIComponent(secid)}.json?${q}`;
  const res = await fetchJson(url, { note: `MOEX ISS FORTS daily history for ${secid} (official exchange settlements)` });
  if (!res.ok) return { ok: false, secid, rows: [], provenance: res.provenance };
  return { ok: true, secid, rows: table(res.json, 'history'), provenance: res.provenance };
}

/**
 * Reference data for a security. The `description` table is the authoritative place where
 * MOEX publishes FACEUNIT (the contract's face currency) and other contract facts; the
 * `securities` table alone does not carry FACEUNIT for FORTS contracts.
 */
export async function moexSecurityRef(secid) {
  const url = `${MOEX_ISS}/securities/${encodeURIComponent(secid)}.json?iss.meta=off`;
  const res = await fetchJson(url, { note: `MOEX ISS security reference data (incl. FACEUNIT) for ${secid}` });
  if (!res.ok) return { ok: false, secid, provenance: res.provenance };
  const descriptionRows = table(res.json, 'description');
  const description = {};
  for (const r of descriptionRows) {
    if (r.name != null) description[r.name] = r.value;
  }
  return { ok: true, secid, rows: table(res.json, 'securities'), description, provenance: res.provenance };
}

/** All FORTS contracts currently listed (used to discover the commodity universe). */
export async function moexFortsSecurities() {
  const url = `${MOEX_ISS}/engines/futures/markets/forts/securities.json?iss.meta=off&iss.only=securities&securities.columns=SECID,SHORTNAME,ASSETCODE,LASTTRADEDATE,SECTYPE`;
  const res = await fetchJson(url, { note: 'MOEX ISS full FORTS contract list (official exchange listing)' });
  if (!res.ok) return { ok: false, rows: [], provenance: res.provenance };
  return { ok: true, rows: table(res.json, 'securities'), provenance: res.provenance };
}

/**
 * Map a MOEX contract to a tradable instrument record.
 * PnL valuation: MOEX FORTS quotes futures in the contract's face currency (FACEUNIT).
 * STEPPRICE on the securities block is expressed in RUB per minimum step, so to value P&L
 * in the contract's own currency we use (price change per unit) * LOTVOLUME, and we only
 * treat a contract as USD-denominated when the official reference data says FACEUNIT=USD.
 * Contracts quoted in RUB (e.g. RUB-denominated WHEAT/SUGAR) are flagged for FX conversion
 * rather than silently converted.
 */
export function classifyMoexContract({ security, marketdata, ref, description }) {
  const faceunit = (description?.FACEUNIT || ref?.FACEUNIT || security?.FACEUNIT || '').toUpperCase() || null;
  const lotvolume = Number(security?.LOTVOLUME ?? ref?.LOTSIZE ?? NaN);
  const minstep = Number(security?.MINSTEP ?? NaN);
  const minstepOk = Number.isFinite(minstep) && minstep > 0 ? minstep : null;
  return {
    secid: security?.SECID,
    shortname: security?.SHORTNAME,
    assetcode: security?.ASSETCODE ?? ref?.ASSETCODE ?? null,
    last_trade_date: security?.LASTTRADEDATE ?? null,
    faceunit,
    lot_volume: Number.isFinite(lotvolume) ? lotvolume : null,
    min_step: Number.isFinite(minstep) ? minstep : null,
    currency_quoted: faceunit,
    pnl_currency_ready: null, // decided in the tick, once the official FX rate is available
    settlement_currency_note:
      faceunit == null
        ? 'Face currency not published in the retrieved MOEX reference data; USD valuation will be derived from the official STEPPRICE/MINSTEP fields plus the MOEX USD/RUB rate, or the instrument is skipped.'
        : `Face currency reported by MOEX as ${faceunit}; USD valuation derived from the official STEPPRICE/MINSTEP fields plus the MOEX USD/RUB rate.`,
    quote: marketdata
      ? {
          bid: num(marketdata.BID),
          offer: num(marketdata.OFFER),
          spread: num(marketdata.SPREAD),
          last: num(marketdata.LAST),
          open: num(marketdata.OPEN),
          high: num(marketdata.HIGH),
          low: num(marketdata.LOW),
          settle_price: num(marketdata.SETTLEPRICE),
          prev_settle: num(security?.PREVSETTLEPRICE),
          open_interest: num(marketdata.OPENPOSITION),
          volume_today: num(marketdata.VOLTODAY),
          num_trades: num(marketdata.NUMTRADES),
          value_today_rub: num(marketdata.VALTODAY),
          value_today_usd: num(marketdata.VALTODAY_USD),
          update_time: marketdata.UPDATETIME ?? null,
          trade_date: marketdata.TRADEDATE ?? null,
        }
      : null,
    fees_reported: {
      buy_sell_fee_rub: num(security?.BUYSELLFEE),
      scalper_fee_rub: num(security?.SCALPERFEE),
      exercise_fee_rub: num(security?.EXERCISEFEE),
      initial_margin_rub: num(security?.INITIALMARGIN),
      step_price_rub: num(security?.STEPPRICE),
    },
    // Official valuation inputs: STEPPRICE is the RUB value of one MINSTEP move, so the USD
    // value of a one-unit price move is (STEPPRICE / MINSTEP) / USD_RUB. No assumption needed
    // about lot sizes or quote currency - it comes straight from the exchange's own fields.
    valuation_inputs: {
      min_step: minstepOk,
      step_price_rub: num(security?.STEPPRICE),
      faceunit,
      description_fields: description ?? null,
    },
  };
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
