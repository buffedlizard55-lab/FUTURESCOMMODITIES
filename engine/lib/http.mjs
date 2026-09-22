/**
 * Minimal HTTP client with full provenance capture.
 *
 * Rules enforced here:
 *  - every request records the absolute URL, HTTP status, response byte size, SHA-256 of the
 *    response body and both the request and retrieval timestamps;
 *  - nothing is retried into a different URL silently: the fallback chain is explicit and each
 *    attempt is logged;
 *  - no response is ever cached across runs in a way that could hide a failure: a failed fetch
 *    is reported as failed so the caller can mark the run "degraded" instead of guessing.
 *
 * Zero dependencies: uses the global fetch available in Node 18+.
 */

import { createHash } from 'node:crypto';

export const USER_AGENT =
  'FUTURESCOMMODITIES-research-bot/1.0 (+https://github.com/buffedlizard55-lab/FUTURESCOMMODITIES; official public APIs only; contact via repository issues)';

export function nowIso() {
  return new Date().toISOString();
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Process-wide provenance log: every completed request appends a compact record, so each run
 * manifest can carry the hash of every response the run actually received. Verification uses it
 * to prove that a ledger trade was priced from a payload fetched in that same run.
 */
export const provenanceLog = [];

function logProvenance(record) {
  if (!record || !record.url) return;
  if (provenanceLog.some((r) => r.url === record.url && r.sha256 === record.sha256)) return;
  provenanceLog.push({
    url: record.url,
    http_status: record.http_status ?? null,
    sha256: record.sha256 ?? null,
    bytes: record.bytes ?? null,
    content_type: record.content_type ?? null,
    retrieved_at: record.retrieved_at ?? null,
    ok: record.ok ?? null,
    note: record.note ?? null,
  });
  if (provenanceLog.length > 4000) provenanceLog.splice(0, provenanceLog.length - 4000);
}

export function provenanceSnapshot() {
  return provenanceLog.slice();
}

/**
 * Fetch a URL and return { ok, status, text, json, buffer, provenance }.
 * provenance = { url, http_status, bytes, sha256, content_type, request_started_at,
 *                retrieved_at, attempts[], note }
 */
export async function get(url, options = {}) {
  const {
    timeoutMs = 30000,
    retries = 2,
    headers = {},
    note = null,
    accept = 'application/json, text/plain, */*',
    expect = 'text',
  } = options;

  const attempts = [];
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const requestStartedAt = new Date().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: accept,
          ...headers,
        },
        signal: controller.signal,
      });
      const buffer = Buffer.from(await res.arrayBuffer());
      const retrievedAt = new Date().toISOString();
      clearTimeout(timer);

      const provenance = {
        url,
        note,
        request_started_at: requestStartedAt,
        retrieved_at: retrievedAt,
        http_status: res.status,
        ok: res.ok,
        bytes: buffer.length,
        content_type: res.headers.get('content-type'),
        sha256: sha256(buffer),
        attempts,
        method: 'GET',
      };

      logProvenance(provenance);

      if (!res.ok) {
        return { ok: false, status: res.status, text: null, json: null, buffer, provenance };
      }

      const text = buffer.toString('utf8');
      let json = null;
      if (expect === 'json' || (expect === 'auto' && /json/i.test(res.headers.get('content-type') || ''))) {
        try {
          json = JSON.parse(text);
        } catch (error) {
          provenance.parse_error = String(error.message ?? error);
          return { ok: false, status: res.status, text, json: null, buffer, provenance };
        }
      }
      return { ok: true, status: res.status, text, json, buffer, provenance };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      attempts.push({
        attempt,
        url,
        error: String(error?.message ?? error),
        request_started_at: requestStartedAt,
        retrieved_at: new Date().toISOString(),
      });
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }

  logProvenance({ url, http_status: null, ok: false, retrieved_at: new Date().toISOString(), note });
  return {
    ok: false,
    status: null,
    text: null,
    json: null,
    buffer: null,
    provenance: {
      url,
      note,
      ok: false,
      http_status: null,
      bytes: 0,
      sha256: null,
      attempts,
      error: String(lastError?.message ?? lastError ?? 'request failed'),
      retrieved_at: new Date().toISOString(),
    },
  };
}

/** Fetch JSON with a status guard. */
export async function getJson(url, options = {}) {
  return get(url, { ...options, expect: 'json' });
}

/**
 * Deterministic JSON stringifier: object keys are sorted so that identical data always
 * produces identical bytes. This keeps every committed artifact diff-stable.
 */
export function stableStringify(value, indent = 2) {
  const normalized = normalize(value);
  return JSON.stringify(normalized, null, indent);
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = normalize(value[key]);
    return out;
  }
  return value;
}
