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

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

export { stableStringify } from './http.mjs';

/** Sorted, human-readable JSON. */
export function writeJson(path, value) {
  return writeJsonIfChanged(path, value);
}

/**
 * Writes only when the content actually changed: a tick that reproduces the same facts leaves the
 * repository untouched instead of committing a meaningless diff.
 */
export function writeJsonIfChanged(path, value) {
  ensureDir(dirname(path));
  const body = stableStringify(value);
  if (existsSync(path)) {
    try {
      if (stableStringify(JSON.parse(readFileSync(path, 'utf8'))) === body) return false;
    } catch {
      // A file that cannot be parsed is rewritten rather than trusted.
    }
  }
  writeFileSync(path, `${body}\n`);
  return true;
}

/** Keeps the newest `keep` files in a directory (name order) and removes the rest. */
export function pruneDirectory(dir, keep, filter = () => true) {
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir).filter(filter).sort();
  let removed = 0;
  for (const file of files.slice(0, Math.max(0, files.length - keep))) {
    rmSync(join(dir, file), { force: true });
    removed += 1;
  }
  return removed;
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
  // One compact JSON object per line: the ledger is append-only and read back line by line.
  const body = records.map((r) => JSON.stringify(r)).join('\n');
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
