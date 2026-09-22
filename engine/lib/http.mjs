/**
 * Zero-dependency HTTP client with full provenance capture.
 *
 * Design rules (see docs/VERIFICATION.md):
 *  - Every network call produces a provenance record: url, http status, byte length,
 *    sha256 of the response body, content-type, request/response timestamps, and
 *    a plain-language note describing what the response is.
 *  - Nothing is ever invented. If a call fails, the caller records the failure and
 *    marks downstream data as "unavailable" rather than filling in a guess.
 *  - We never send an `Origin` header. Observed behaviour (verified 2026-09-22):
 *    Kalshi's public API returns HTTP 403 to requests carrying a foreign `Origin`
 *    header (see docs/VERIFICATION.md, "CORS"). Sending none keeps calls working.
 */

import { createHash } from 'node:crypto';

export const USER_AGENT =
  'futurescommodities-research/1.0 (+https://github.com/buffedlizard55-lab/FUTURESCOMMODITIES; paper-trading research; contact via repo issues)';

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a URL, capturing a provenance record regardless of success.
 * @returns {Promise<{ok:boolean, status:number|null, body:Buffer|null, text:string|null,
 *   json:any|null, provenance:object}>}
 */
export async function fetchWithProvenance(url, opts = {}) {
  const {
    headers = {},
    timeoutMs = 30000,
    retries = 2,
    accept = 'application/json, text/plain, */*',
    method = 'GET',
    note = null,
    parse = 'auto', // 'auto' | 'json' | 'text' | 'none'
  } = opts;

  const attempts = [];
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const startedAt = nowIso();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'user-agent': USER_AGENT,
          accept,
          ...headers,
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      const buf = Buffer.from(await res.arrayBuffer());
      clearTimeout(timer);
      const record = {
        url,
        method,
        note,
        http_status: res.status,
        ok: res.ok,
        content_type: res.headers.get('content-type'),
        bytes: buf.length,
        sha256: sha256(buf),
        request_started_at: startedAt,
        retrieved_at: nowIso(),
        attempt,
      };
      if (!res.ok) {
        attempts.push(record);
        // 4xx (except 429) will not improve by retrying.
        if (res.status < 500 && res.status !== 429) {
          return { ok: false, status: res.status, body: buf, text: null, json: null, provenance: { ...record, attempts } };
        }
        if (attempt <= retries) {
          await sleep(400 * attempt);
          continue;
        }
        return { ok: false, status: res.status, body: buf, text: null, json: null, provenance: { ...record, attempts } };
      }
      let text = null;
      let json = null;
      if (parse !== 'none') {
        text = buf.toString('utf8');
        if (parse === 'json' || (parse === 'auto' && /json/i.test(record.content_type || ''))) {
          try {
            json = JSON.parse(text);
          } catch (err) {
            json = null;
            record.parse_error = String(err);
          }
        }
      }
      return { ok: true, status: res.status, body: buf, text, json, provenance: { ...record, attempts } };
    } catch (err) {
      clearTimeout(timer);
      attempts.push({
        url,
        method,
        note,
        error: String(err && err.message ? err.message : err),
        request_started_at: startedAt,
        retrieved_at: nowIso(),
        attempt,
      });
      if (attempt <= retries) await sleep(500 * attempt);
    }
  }
  return {
    ok: false,
    status: null,
    body: null,
    text: null,
    json: null,
    provenance: { url, method, note, error: 'all attempts failed', attempts, retrieved_at: nowIso() },
  };
}

/** Convenience: fetch JSON or return {ok:false}. */
export async function fetchJson(url, opts = {}) {
  const r = await fetchWithProvenance(url, { parse: 'json', ...opts });
  return r;
}

/**
 * Deterministic JSON writer: stable key order and no timestamps added implicitly,
 * so committed files only change when the underlying data changes.
 */
export function stableStringify(value, indent = 2) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
    return out;
  };
  return JSON.stringify(walk(value), null, indent);
}
