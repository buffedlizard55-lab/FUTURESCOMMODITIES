/**
 * Data store.
 *
 * Everything the project knows lives in committed JSON/JSONL files under data/ so that the
 * GitHub Pages site can read it without any live API access, and so that the whole history of
 * the competition is auditable from git alone.
 *
 * Rules:
 *  - JSON files are written with sorted keys and only when content actually changed, so the
 *    repository does not accumulate meaningless diffs on every run;
 *  - ledgers are append-only JSONL keyed by a unique id (duplicate ids are ignored, never
 *    overwritten), which keeps the trade history immutable.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stableStringify } from './http.mjs';

export const ROOT = process.cwd();

export const paths = {
  data: 'data',
  universe: 'data/universe',
  snapshots: 'data/snapshots',
  history: 'data/history',
  ledger: 'data/ledger',
  state: 'data/state',
  verification: 'data/verification',
  reports: 'data/reports',
  manifest: 'data/manifest',
  raw: 'data/raw-evidence',
  config: 'config',
};

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readJson(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(path, value) {
  ensureDir(dirname(path));
  const next = `${stableStringify(value)}\n`;
  if (existsSync(path) && readFileSync(path, 'utf8') === next) return false;
  writeFileSync(path, next);
  return true;
}

export function writeText(path, text) {
  ensureDir(dirname(path));
  const next = text.endsWith('\n') ? text : `${text}\n`;
  if (existsSync(path) && readFileSync(path, 'utf8') === next) return false;
  writeFileSync(path, next);
  return true;
}

export function appendJsonl(path, records) {
  if (!records.length) return;
  ensureDir(dirname(path));
  const body = records.map((r) => stableStringify(r, 0)).join('\n');
  appendFileSync(path, `${body}\n`);
}

export function readJsonl(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // A malformed line is skipped but reported by the verifier, which re-reads the same file.
    }
  }
  return out;
}

export function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

export function fileAgeHours(path) {
  if (!existsSync(path)) return null;
  return (Date.now() - statSync(path).mtimeMs) / 3600000;
}

export const joinPath = join;
