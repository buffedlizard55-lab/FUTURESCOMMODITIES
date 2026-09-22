/**
 * EIA adapter (U.S. Energy Information Administration - official U.S. government data).
 *
 * Verified 2026-09-22:
 *   https://www.eia.gov/dnav/pet/hist_xls/RCLC1d.xls    -> 200, 494,592 bytes
 *   https://www.eia.gov/dnav/ng/hist_xls/RNGWHHDd.xls   -> 200, 294,400 bytes
 *   https://www.eia.gov/dnav/pet/pet_pri_fut_s1_d.htm   -> NYMEX futures table, title reads
 *        "NYMEX Futures Prices (Futures prices after April 5, 2024, are not available)"
 *        with series RCLC1-RCLC4 (WTI contracts 1-4), EER_EPMRR_PE1-PE4_Y35NY_DPG (RBOB),
 *        EER_EPD2F_PE1-PE4_Y35NY_DPG (No.2 heating oil), EER_EPLLPA_PE1-PE4_Y44MB_DPG (propane).
 *
 * Consequence for this project, stated plainly: EIA's NYMEX futures series are HISTORICAL ONLY
 * (they stop on 2024-04-05). They are therefore never used to price a live trade. They are
 * archived with their provenance and can be used for historical analysis, clearly labelled.
 *
 * The .xls files are archived byte-for-byte with their SHA-256. This project does not attempt to
 * decode the binary Excel container: a value that was not parsed from the publisher's own bytes
 * is not reported as data.
 */

import { get } from '../http.mjs';

export const EIA_FUTURES_PAGE = 'https://www.eia.gov/dnav/pet/pet_pri_fut_s1_d.htm';
export const EIA_FUTURES_LAST_DATE = '2024-04-05';
export const EIA_HISTORICAL_FUTURES_SERIES = [
  { product: 'Crude Oil, Light-Sweet (Cushing, OK)', contract: 1, series_id: 'RCLC1', units: 'dollars per barrel' },
  { product: 'Crude Oil, Light-Sweet (Cushing, OK)', contract: 2, series_id: 'RCLC2', units: 'dollars per barrel' },
  { product: 'Crude Oil, Light-Sweet (Cushing, OK)', contract: 3, series_id: 'RCLC3', units: 'dollars per barrel' },
  { product: 'Crude Oil, Light-Sweet (Cushing, OK)', contract: 4, series_id: 'RCLC4', units: 'dollars per barrel' },
  { product: 'RBOB Regular Gasoline (New York Harbor)', contract: 1, series_id: 'EER_EPMRR_PE1_Y35NY_DPG', units: 'dollars per gallon' },
  { product: 'RBOB Regular Gasoline (New York Harbor)', contract: 2, series_id: 'EER_EPMRR_PE2_Y35NY_DPG', units: 'dollars per gallon' },
  { product: 'RBOB Regular Gasoline (New York Harbor)', contract: 3, series_id: 'EER_EPMRR_PE3_Y35NY_DPG', units: 'dollars per gallon' },
  { product: 'RBOB Regular Gasoline (New York Harbor)', contract: 4, series_id: 'EER_EPMRR_PE4_Y35NY_DPG', units: 'dollars per gallon' },
  { product: 'No. 2 Heating Oil (New York Harbor)', contract: 1, series_id: 'EER_EPD2F_PE1_Y35NY_DPG', units: 'dollars per gallon' },
  { product: 'No. 2 Heating Oil (New York Harbor)', contract: 2, series_id: 'EER_EPD2F_PE2_Y35NY_DPG', units: 'dollars per gallon' },
  { product: 'No. 2 Heating Oil (New York Harbor)', contract: 3, series_id: 'EER_EPD2F_PE3_Y35NY_DPG', units: 'dollars per gallon' },
  { product: 'No. 2 Heating Oil (New York Harbor)', contract: 4, series_id: 'EER_EPD2F_PE4_Y35NY_DPG', units: 'dollars per gallon' },
];

/**
 * Archive an official EIA series file: bytes, hash, URL, timestamp. No values are extracted
 * unless the publisher served a text/CSV payload (in which case a strict parser is used).
 */
export async function archiveSeries({ id, url, note }) {
  const res = await get(url, { note: note ?? `EIA official series file ${id}`, expect: 'none', accept: '*/*' });
  const isText = /text|csv/i.test(res.provenance?.content_type ?? '');
  const parsed = isText ? parseEiaCsv(res.text ?? '') : [];
  return {
    series_id: id,
    url,
    ok: res.ok,
    http_status: res.provenance?.http_status ?? null,
    bytes: res.provenance?.bytes ?? 0,
    sha256: res.provenance?.sha256 ?? null,
    content_type: res.provenance?.content_type ?? null,
    retrieved_at: res.provenance?.retrieved_at ?? null,
    format: isText ? 'text' : 'binary (archived byte-for-byte; values not decoded by this project)',
    parsed_rows: parsed.length,
    parsed_values: parsed.slice(-60),
    parse_status: isText ? (parsed.length ? 'parsed_from_publisher_text' : 'text_but_no_rows_matched_strict_parser') : 'binary_format_archived_only',
  };
}

/** Strict parser for text EIA downloads: only accepts `YYYY-MM-DD,value` or `MM/DD/YYYY<TAB>value` rows. */
export function parseEiaCsv(text) {
  const rows = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2})[,"\t;]+(-?\d+(?:\.\d+)?)$/);
    if (isoMatch) {
      rows.push({ date: isoMatch[1], value: Number(isoMatch[2]) });
      continue;
    }
    const usMatch = line.match(/^(\d{2}\/\d{2}\/\d{4})[,"\t;]+(-?\d+(?:\.\d+)?)$/);
    if (usMatch) {
      const [m, d, y] = usMatch[1].split('/');
      rows.push({ date: `${y}-${m}-${d}`, value: Number(usMatch[2]) });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}
