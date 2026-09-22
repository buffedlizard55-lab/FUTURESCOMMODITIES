/**
 * Storage helpers. Everything the platform knows lives in committed JSON/JSONL under data/,
 * so the GitHub Pages site can read it same-origin and every number stays auditable in git.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stableStringify } from './http.mjs';

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Corrupt JSON at ${path}: ${err.message}`);
  }
}

/** Write only when content changed — keeps git diffs meaningful. */
export function writeJsonIfChanged(path, value, { indent = 2 } = {}) {
  ensureDir(dirname(path));
  const next = typeof value === 'string' ? value : stableStringify(value, indent);
  if (existsSync(path)) {
    const prev = readFileSync(path, 'utf8');
    if (prev === next) return false;
  }
  writeFileSync(path, next.endsWith('\n') ? next : `${next}\n`);
  return true;
}

export function readJsonl(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // keep going: one corrupt line must not invalidate the archive
    }
  }
  return out;
}

/** Append unique records by `id` field; returns number appended. */
export function appendJsonlUnique(path, records, idField = 'id') {
  ensureDir(dirname(path));
  const existing = new Set(readJsonl(path).map((r) => r[idField]));
  let appended = 0;
  const lines = [];
  for (const rec of records) {
    if (existing.has(rec[idField])) continue;
    existing.add(rec[idField]);
    lines.push(JSON.stringify(rec));
    appended += 1;
  }
  if (lines.length) appendFileSync(path, `${lines.join('\n')}\n`);
  return appended;
}

export function listFiles(path, filter = () => true) {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter(filter)
    .map((f) => ({ name: f, path: join(path, f), size: statSync(join(path, f)).size }));
}

export const paths = {
  root: process.cwd(),
  data: 'data',
  registry: 'data/registry',
  snapshots: 'data/snapshots',
  history: 'data/history',
  manifests: 'data/manifests',
  evidence: 'data/evidence',
  ledger: 'data/ledger',
  state: 'data/state',
  verification: 'data/verification',
  config: 'config',
};
