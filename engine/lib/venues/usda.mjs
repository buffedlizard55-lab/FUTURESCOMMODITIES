/**
 * USDA AMS Market News adapter (official U.S. Department of Agriculture data).
 *
 * Verified 2026-09-22:
 *   https://mpr.datamart.ams.usda.gov/services/v1.1/reports?q=livestock -> 200 with the report
 *   catalogue (e.g. slug 2453 "National Daily Boxed Beef Cutout & Boxed Beef Cuts - Negotiated",
 *   slug 2466 "5 Area Daily Weighted Average Direct Slaughter Cattle - Negotiated").
 *
 * Report payloads have report-specific schemas. This project stores the report rows exactly as
 * published, with provenance, and does NOT translate them into a price unless an explicit,
 * verified field mapping for that report has been written. Anything else would be a guess dressed
 * up as data.
 */

import { get } from '../http.mjs';

export const USDA_AMS_BASE = 'https://mpr.datamart.ams.usda.gov/services/v1.1';
export const USDA_AMS_DOCS = 'https://mpr.datamart.ams.usda.gov/';

export async function searchReports(query) {
  const url = `${USDA_AMS_BASE}/reports?q=${encodeURIComponent(query)}`;
  const res = await get(url, { note: `USDA AMS report search (${query})`, expect: 'json' });
  if (!res.ok || !res.json) return { ok: false, reports: [], provenance: res.provenance };
  const reports = Array.isArray(res.json) ? res.json : res.json.results ?? [];
  return {
    ok: true,
    reports: reports.map((r) => ({
      slug_id: r.slug_id ?? null,
      report_title: r.report_title ?? null,
      published_date: r.published_date ?? null,
      report_begin_date: r.report_begin_date ?? null,
      office_name: r.office_name ?? null,
      market_types: r.market_types ?? null,
      detail_url: r.slug_id ? `${USDA_AMS_BASE}/reports/${r.slug_id}` : null,
    })),
    provenance: res.provenance,
  };
}

export async function fetchReport(slugId, { section = null } = {}) {
  const url = `${USDA_AMS_BASE}/reports/${slugId}${section ? `/${section}` : ''}`;
  const res = await get(url, { note: `USDA AMS report ${slugId}`, expect: 'json' });
  if (!res.ok || !res.json) return { ok: false, rows: [], provenance: res.provenance };
  const payload = Array.isArray(res.json) ? res.json[0] ?? {} : res.json;
  return {
    ok: true,
    slug_id: slugId,
    report_title: payload.report_title ?? null,
    published_date: payload.published_date ?? null,
    sections: payload.sections ?? null,
    rows: payload.results ?? [],
    provenance: res.provenance,
    url,
  };
}

/** ASCII table for the site, built strictly from the stored rows (no recalculation). */
export function reportPreview(report, { maxRows = 12 } = {}) {
  const rows = report.rows ?? [];
  return {
    rows_stored: rows.length,
    preview: rows.slice(0, maxRows),
    note: 'Rows are stored exactly as published by USDA AMS; column meanings are report-specific.',
  };
}
