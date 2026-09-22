#!/usr/bin/env node
/**
 * Builds the public competition page.
 *
 * The page is a single self-contained index.html at the repository root, so the existing GitHub
 * Pages site serves it directly from the default branch with no build step and no JavaScript
 * dependencies. Every number on the page is copied out of the committed JSON artifacts that the
 * tick produced; nothing is computed from scratch here and nothing is invented. If a value was not
 * published by an exchange or could not be derived from published values, the page prints the
 * status string instead of a number.
 *
 * Usage: node engine/build-site.mjs
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { nowIso } from './lib/http.mjs';
import { readJson, readJsonl } from './lib/store.mjs';

const OUT = 'index.html';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadStrategies() {
  const dir = 'data/reports/by-strategy';
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(`${dir}/${f}`, null))
    .filter(Boolean)
    .sort((a, b) => (b.return_pct ?? -Infinity) - (a.return_pct ?? -Infinity));
}

const data = {
  generated_at: nowIso(),
  competition: readJson('data/state/competition.json', null) ?? readJson('data/reports/summary.json', null)?.competition ?? null,
  summary: readJson('data/reports/summary.json', null),
  leaderboard: readJson('data/state/leaderboard.json', null)?.leaderboard ?? readJson('data/reports/summary.json', null)?.leaderboard ?? [],
  strategies: loadStrategies(),
  portfolios: readJson('data/state/portfolios.json', null) ?? {},
  trades: readJsonl('data/ledger/trades.jsonl'),
  intents: readJsonl('data/ledger/intents.jsonl').slice(-120).reverse(),
  working_orders: readJson('data/state/working_orders.json', { orders: [] }),
  verification: readJson('data/verification/report.json', null),
  coverage: readJson('data/universe/coverage.json', null),
  universe_registry: readJson('data/universe/registry.json', null),
  futures_registry: readJson('engine/universe/futures-registry.json', null),
  sources: readJson('config/sources.json', null),
  manifest: readJson('data/manifest/latest.json', null),
  last_run: readJson('data/reports/last-run.json', null),
};

const verifiedIds = new Set(
  (data.verification?.results ?? [])
    .filter((r) => r && (r.fully_verified === true || (Array.isArray(r.failed_checks) && r.failed_checks.length === 0)))
    .map((r) => r.trade_id ?? r.id)
    .filter(Boolean),
);
const anomalyByTrade = new Map();
for (const anomaly of data.verification?.anomalies ?? []) {
  const key = anomaly.trade_id ?? anomaly.ticker;
  if (!key) continue;
  if (!anomalyByTrade.has(key)) anomalyByTrade.set(key, []);
  anomalyByTrade.get(key).push(anomaly.check);
}

const counts = {
  trades: data.trades.length,
  intents: data.intents.length,
  strategies: data.strategies.length,
  openPositions: Object.values(data.portfolios).reduce((n, p) => n + Object.keys(p.positions ?? {}).length, 0),
  restingOrders: (data.working_orders.orders ?? []).filter((o) => o.status === 'resting').length,
  verified: data.verification?.fully_verified ?? null,
  anomalies: data.verification?.anomaly_count ?? null,
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FUTURESCOMMODITIES — verified paper-trading competition</title>
<style>
  :root { color-scheme: light dark; --fg:#14181f; --muted:#5b6472; --bg:#f7f8fa; --card:#fff; --line:#e3e6ec; --accent:#1c6dd0; --good:#0d8a4f; --bad:#b3261e; --warn:#8a6100; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8eaee; --muted:#a2aab8; --bg:#111418; --card:#181d24; --line:#28303b; --accent:#66a6ff; --good:#4ec98a; --bad:#ff8a80; --warn:#e2b93b; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  header { padding:28px 20px 20px; border-bottom:1px solid var(--line); background:var(--card); }
  main { max-width:1180px; margin:0 auto; padding:20px 16px 80px; }
  h1 { margin:0 0 6px; font-size:26px; letter-spacing:-0.2px; }
  h2 { margin:34px 0 6px; font-size:19px; }
  h3 { margin:18px 0 4px; font-size:15px; }
  p.lead { margin:0; color:var(--muted); max-width:900px; }
  .wrap { max-width:1180px; margin:0 auto; padding:0 16px; }
  .grid { display:grid; gap:14px; }
  .grid.k4 { grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); }
  .grid.k3 { grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); }
  .grid.k2 { grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .stat { font-size:22px; font-weight:600; }
  .muted { color:var(--muted); }
  .small { font-size:13px; }
  .tiny { font-size:12px; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; font-size:13.5px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { background:rgba(127,127,127,.07); font-weight:600; white-space:nowrap; }
  tr:last-child td { border-bottom:none; }
  .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .pos { color:var(--good); } .neg { color:var(--bad); } .warn { color:var(--warn); }
  code { background:rgba(127,127,127,.14); padding:1px 4px; border-radius:4px; font-size:12.5px; }
  a { color:var(--accent); }
  .badge { display:inline-block; padding:1px 7px; border-radius:999px; font-size:11.5px; border:1px solid var(--line); }
  .badge.ok { color:var(--good); border-color:currentColor; }
  .badge.no { color:var(--bad); border-color:currentColor; }
  .badge.warn { color:var(--warn); border-color:currentColor; }
  details { border:1px solid var(--line); border-radius:8px; background:var(--card); margin:8px 0; padding:8px 12px; }
  summary { cursor:pointer; }
  dl.fields { display:grid; grid-template-columns:minmax(200px,300px) 1fr; gap:2px 14px; margin:10px 0 0; font-size:13px; }
  dl.fields dt { color:var(--muted); }
  dl.fields dd { margin:0; overflow-wrap:anywhere; }
  .note { border-left:3px solid var(--accent); padding:8px 12px; background:var(--card); border-radius:0 8px 8px 0; margin:12px 0; }
  .warnbox { border-left:3px solid var(--warn); }
  ul.tight { margin:6px 0 0 18px; padding:0; }
  ul.tight li { margin:2px 0; }
  nav.toc a { margin-right:12px; white-space:nowrap; }
  footer { border-top:1px solid var(--line); padding:18px 16px 40px; color:var(--muted); font-size:13px; }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>FUTURESCOMMODITIES — verified paper-trading competition</h1>
    <p class="lead">
      Twelve strategies trade <strong>Kalshi event contracts</strong>, <strong>Kalshi perpetual futures</strong> and
      <strong>exchange-listed commodity futures</strong> (MOEX FORTS) against prices taken from the exchanges'
      own public APIs. Every fill, fee and mark on this page carries the official source it was derived from.
      All executions shown here are <strong>simulated paper fills</strong> — they are not exchange executions —
      and each trade records exactly how it was simulated.
    </p>
    <p class="small muted" style="margin-top:10px">
      Season <span id="season"></span> · last tick <span id="lasttick"></span> · page generated <span id="generated"></span>
    </p>
    <p class="small" style="margin-top:10px">
      Official sources:
      <a href="https://docs.kalshi.com/" target="_blank" rel="noopener">Kalshi API documentation</a> ·
      <a href="https://kalshi.com/docs/kalshi-fee-schedule.pdf" target="_blank" rel="noopener">Kalshi fee schedule (PDF)</a> ·
      <a href="https://www.kalshi.com/" target="_blank" rel="noopener">kalshi.com</a> ·
      <a href="https://iss.moex.com/iss/reference/" target="_blank" rel="noopener">MOEX ISS reference</a> ·
      <a href="https://www.moex.com/en/" target="_blank" rel="noopener">moex.com</a> ·
      <a href="https://www.cmegroup.com/markets.html" target="_blank" rel="noopener">CME Group markets</a> ·
      <a href="https://www.eia.gov/" target="_blank" rel="noopener">EIA</a> ·
      <a href="https://mpr.datamart.ams.usda.gov/" target="_blank" rel="noopener">USDA AMS</a> ·
      <a href="https://github.com/buffedlizard55-lab/FUTURESCOMMODITIES" target="_blank" rel="noopener">source repository</a>
    </p>
    <nav class="toc small" style="margin-top:12px">
      <a href="#leaderboard">Leaderboard</a><a href="#strategies">Strategies</a><a href="#positions">Open positions</a>
      <a href="#trades">Trades</a><a href="#upcoming">Upcoming &amp; resting orders</a><a href="#universe">Market universe</a>
      <a href="#verification">Verification</a><a href="#methods">Method &amp; limitations</a>
    </nav>
  </div>
</header>
<main>
  <section class="grid k4" id="overline"></section>

  <h2 id="leaderboard">Leaderboard</h2>
  <p class="lead small">Ranked by return on the $100,000 starting balance. Risk-adjusted measures are deliberately absent: this
  competition is scored on returns only. <span class="muted">Equity is marked conservatively — longs at the published bid,
  shorts at the published offer — and a portfolio is only marked complete when every position has a live exchange price.</span></p>
  <div id="leaderboard_table"></div>

  <h2 id="strategies">Strategies</h2>
  <p class="lead small">Each username runs one strategy. The catalogue below states which market type the strategy trades, the
  claim it came from, its entry and exit rules, and — once it has traded — what the results actually show.</p>
  <div class="grid k2" id="strategy_cards"></div>

  <h2 id="positions">Open positions</h2>
  <p class="lead small">Collateral model: event contracts are fully funded (the premium is the whole cost); futures and perpetuals are
  margined, so only the exchange-published collateral is set aside and the notional is never exchanged.</p>
  <div id="positions_table"></div>

  <h2 id="trades">Trades</h2>
  <p class="lead small">Every trade the competition has placed, with the mandatory verification fields. Open a row for the full record,
  including the exact ladder levels the fill consumed and the SHA-256 of the response the prices came from.</p>
  <div id="trades_list"></div>

  <h2 id="upcoming">Upcoming intended trades and resting orders</h2>
  <p class="lead small">Intents are what a strategy wanted to do but could not execute, with the reason. Resting orders are maker quotes
  that can only fill if a later snapshot shows the market trading through the resting price; those fills are flagged as modelled.</p>
  <div id="intents_table"></div>
  <h3>Resting maker orders</h3>
  <div id="working_orders"></div>

  <h2 id="universe">Market universe</h2>
  <p class="lead small">Every market in this list was read from the exchange's own API in the run that is displayed. Listed markets that
  never produced a quote are counted here but are not traded.</p>
  <div id="universe_summary"></div>
  <h3>Kalshi series covered</h3>
  <div id="series_table"></div>
  <h3>Exchange access</h3>
  <div id="exchange_table"></div>

  <h2 id="verification">Verification</h2>
  <p class="lead small">A separate pass re-reads the append-only ledger and audits each trade against the provenance log of the run that
  created it. Anomalies are reported, never silently corrected.</p>
  <div id="verification_box"></div>

  <h2 id="methods">Method and limitations</h2>
  <div id="methods_box"></div>
</main>
<footer><div class="wrap">
  <p>Simulated competition. Prices, liquidity, fees and settlement results are taken from official exchange APIs; fills are simulated
  against the published order books. Nothing on this page is investment advice and no live orders are placed. Source repository:
  <a href="https://github.com/buffedlizard55-lab/FUTURESCOMMODITIES" target="_blank" rel="noopener">buffedlizard55-lab/FUTURESCOMMODITIES</a>.</p>
</div></footer>
<script id="payload" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>
(function () {
  var D = JSON.parse(document.getElementById('payload').textContent);
  var V = D.verification || {};
  var verifiedIds = ${JSON.stringify([...verifiedIds])};
  var anomaliesByTrade = ${JSON.stringify(Object.fromEntries([...anomalyByTrade.entries()].map(([k, v]) => [k, [...new Set(v)]])))};

  function money(v, digits) { if (v === null || v === undefined || v === '') return '<span class="muted">—</span>'; var n = Number(v); if (!isFinite(n)) return '<span class="muted">—</span>'; return n.toLocaleString(undefined, { minimumFractionDigits: digits === undefined ? 2 : digits, maximumFractionDigits: digits === undefined ? 2 : digits }); }
  function usd(v, digits) { var s = money(v, digits); return s.indexOf('muted') >= 0 ? s : '$' + s; }
  function pct(v) { if (v === null || v === undefined) return '<span class="muted">—</span>'; var n = Number(v); if (!isFinite(n)) return '<span class="muted">—</span>'; var c = n > 0 ? 'pos' : n < 0 ? 'neg' : ''; return '<span class="' + c + '">' + (n > 0 ? '+' : '') + n.toFixed(3) + '%</span>'; }
  function cls(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
  function esc0(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function link(url, text) { return url ? '<a href="' + esc0(url) + '" target="_blank" rel="noopener">' + esc0(text || url) + '</a>' : '<span class="muted">—</span>'; }
  function badge(text, kind) { return '<span class="badge ' + (kind || '') + '">' + esc0(text) + '</span>'; }
  function byId(id, table) { var el = document.getElementById(id); if (el) el.innerHTML = table; }

  document.getElementById('season').textContent = (D.competition && D.competition.season_id) || 'not started';
  document.getElementById('lasttick').textContent = (D.competition && D.competition.last_tick && D.competition.last_tick.at) || ((D.competition && D.competition.updated_at) || '—');
  document.getElementById('generated').textContent = D.generated_at;

  var totalEquity = D.leaderboard.reduce(function (n, r) { return n + (r.equity_usd || 0); }, 0);
  var startCash = (D.competition && D.competition.starting_cash_usd) || 100000;
  var scale = D.leaderboard.length || 1;
  byId('overline', [
    ['Strategies trading', String(D.strategies.length || (D.leaderboard || []).length)],
    ['Trades recorded', String((D.trades || []).length)],
    ['Open positions', String(D.leaderboard.reduce(function (n, r) { return n + (r.open_positions || 0); }, 0))],
    ['Fully verified trades', V.fully_verified === undefined || V.fully_verified === null ? '<span class="muted">—</span>' : (V.fully_verified + ' / ' + V.trades_checked)],
    ['Average equity', usd(totalEquity / scale) + ' <span class="small muted">vs ' + usd(startCash, 0) + ' start</span>']
  ].map(function (row) { return '<div class="card"><div class="muted small">' + row[0] + '</div><div class="stat">' + row[1] + '</div></div>'; }).join(''));

  var lb = (D.leaderboard || []).slice().sort(function (a, b) { return (b.return_pct || 0) - (a.return_pct || 0); });
  byId('leaderboard_table', lb.length ? '<table><thead><tr><th>#</th><th>Trading as</th><th>Strategy</th><th>Market type</th><th class="num">Equity</th><th class="num">Return</th><th class="num">Realised</th><th class="num">Unrealised</th><th class="num">Open</th><th class="num">Closed</th><th class="num">Fees</th><th class="num">Slippage</th></tr></thead><tbody>' +
    lb.map(function (r, i) { return '<tr><td>' + (i + 1) + '</td><td><strong>' + esc0(r.username) + '</strong></td><td><code>' + esc0(r.strategy_id) + '</code></td><td class="small">' + esc0(r.market_type || '—') + '</td><td class="num">' + usd(r.equity_usd) + (r.equity_complete === false ? ' <span class="badge warn">mark incomplete</span>' : '') + '</td><td class="num">' + pct(r.return_pct) + '</td><td class="num ' + cls(r.realized_pnl_usd) + '">' + usd(r.realized_pnl_usd) + '</td><td class="num ' + cls(r.unrealized_pnl_usd) + '">' + usd(r.unrealized_pnl_usd) + '</td><td class="num">' + (r.open_positions || 0) + '</td><td class="num">' + (r.closed_trades || 0) + '</td><td class="num">' + usd(r.fees_paid_usd) + '</td><td class="num">' + usd(r.slippage_paid_usd) + '</td></tr>'; }).join('') + '</tbody></table>'
    : '<div class="card muted">No portfolio state yet. The next tick will write it.</div>');

  byId('strategy_cards', (D.strategies || []).length ? D.strategies.map(function (s) {
    var attr = s.attribution || {};
    var byCommodity = Object.keys(attr.by_commodity || {}).map(function (k) { return '<li><strong>' + esc0(k) + '</strong>: ' + (attr.by_commodity[k].trades || 0) + ' trades, realised ' + usd(attr.by_commodity[k].realized_pnl_usd) + ', fees ' + usd(attr.by_commodity[k].fees_usd) + '</li>'; }).join('');
    var marks = (attr.open_position_marks || []).map(function (m) { return '<li><code>' + esc0(m.ticker) + '</code> ' + m.contracts + ' @ ' + m.entry_price + ' → mark ' + money(m.mark_price, 4) + ' <span class="muted tiny">(' + esc0(m.mark_status) + ')</span>: <span class="' + cls(m.unrealized_pnl_usd) + '">' + usd(m.unrealized_pnl_usd) + '</span> ' + link(m.mark_source_url, 'source') + '</li>'; }).join('');
    var blocked = Object.keys(s.blocked_reasons || {}).map(function (k) { return '<li><code>' + esc0(k) + '</code> × ' + s.blocked_reasons[k] + '</li>'; }).join('');
    var disabled = s.enabled === false;
    return '<div class="card">' + (disabled ? '<div class="badge warn" style="margin-bottom:6px">not trading</div>' : '') + '<h3>' + esc0(s.display_name || s.strategy_id) + ' <span class="muted small">' + esc0(s.username) + '</span></h3>' +
      '<div class="small muted">' + esc0(s.market_type || '') + ' · <code>' + esc0(s.strategy_id) + '</code></div>' +
      '<p class="small" style="margin:8px 0 0">' + esc0(s.thesis || '') + '</p>' +
      '<p class="small muted" style="margin:6px 0 0">Origin: ' + esc0((s.origin && (s.origin.claim || s.origin.kind)) || '—') + '</p>' +
      '<div class="small" style="margin-top:8px"><strong>Return</strong> ' + pct(s.return_pct) + ' · equity ' + usd(s.equity_usd) + ' · realised ' + usd(s.realized_pnl_usd) + ' · unrealised ' + usd(s.unrealized_pnl_usd) + ' · ' + (s.trades || 0) + ' trades</div>' +
      (disabled
        ? '<p class="small warn" style="margin:8px 0 0">' + esc0(s.disabled_reason || 'Disabled in this build.') + '</p>'
        : (s.what_it_means ? '<p class="small" style="margin:8px 0 0">' + esc0(s.what_it_means) + '</p>' : '<p class="small muted" style="margin:8px 0 0">No closed trades yet, so no result analysis is claimed for this strategy.</p>')) +
      (byCommodity ? '<div class="small"><strong>Where the result came from</strong><ul class="tight">' + byCommodity + '</ul></div>' : '') +
      (marks ? '<div class="small"><strong>Open marks</strong><ul class="tight">' + marks + '</ul></div>' : '') +
      (blocked ? '<details><summary class="small">Orders blocked by liquidity or data checks</summary><ul class="tight small">' + blocked + '</ul></details>' : '') +
      '</div>';
  }).join('') : '<div class="card muted">Strategy reports are written on the first tick.</div>');

  var positions = [];
  Object.keys(D.portfolios || {}).forEach(function (sid) {
    var p = D.portfolios[sid];
    Object.keys(p.positions || {}).forEach(function (id) {
      var pos = p.positions[id];
      positions.push({ strategy: sid, username: p.username, id: id, pos: pos });
    });
  });
  byId('positions_table', positions.length ? '<table><thead><tr><th>Trading as</th><th>Instrument</th><th>Kind</th><th>Side</th><th class="num">Contracts</th><th class="num">Entry</th><th class="num">Mark</th><th class="num">Unrealised</th><th class="num">Collateral</th><th>Mark basis</th></tr></thead><tbody>' +
    positions.map(function (r) { return '<tr><td>' + esc0(r.username) + '</td><td><code>' + esc0(r.pos.ticker || r.id) + '</code><div class="tiny muted">' + esc0(r.id) + '</div></td><td class="small">' + esc0(r.pos.kind) + '</td><td class="small">' + esc0(r.pos.side || r.pos.outcome) + '</td><td class="num">' + r.pos.contracts + '</td><td class="num">' + money(r.pos.avg_entry_price, 4) + '</td><td class="num">' + money(r.pos.mark_price, 4) + '</td><td class="num ' + cls(r.pos.unrealized_pnl_usd) + '">' + usd(r.pos.unrealized_pnl_usd) + '</td><td class="num">' + usd(r.pos.margin_usd) + '</td><td class="small">' + esc0(r.pos.mark_status || '—') + ' ' + link(r.pos.mark_source_url, 'source') + '</td></tr>'; }).join('') + '</tbody></table>'
    : '<div class="card muted">No open positions.</div>');

  var trades = (D.trades || []).slice().reverse();
  byId('trades_list', trades.length ? trades.map(function (t, i) {
    var verified = verifiedIds.indexOf(t.id) >= 0;
    var anomalies = anomaliesByTrade[t.id] || [];
    var levels = ((t.fill || {}).levels || t.fill?.levels_consumed || []);
    var levelRows = (levels || []).map(function (l) { return '<li>' + l.contracts + ' @ ' + l.price + ' <span class="muted tiny">' + esc0(l.source || '') + '</span></li>'; }).join('');
    var md = t.market_dates || {};
    var fill = t.fill || {};
    return '<details><summary><strong>' + esc0(t.username) + '</strong> ' + esc0(t.action) + ' ' + (t.contracts) + ' × <code>' + esc0(t.ticker) + '</code> ' +
      (t.outcome ? '(' + esc0(t.outcome) + ')' : '') + ' @ ' + money(t.price, 4) + ' — ' + usd(t.notional_usd) + ' notional ' +
      '<span class="muted tiny">' + esc0(t.created_at) + '</span> ' + (verified ? badge('verified', 'ok') : badge('anomaly: ' + (anomalies.length || 1), 'no')) + '</summary>' +
      '<dl class="fields">' +
      '<dt>Strategy</dt><dd>' + esc0(t.strategy_id) + ' <span class="muted">(' + esc0(t.market_type) + ')</span></dd>' +
      '<dt>Official source</dt><dd>' + link(t.official_source) + '<div class="tiny muted">SHA-256 ' + esc0(t.official_source_sha256 || '—') + '</div></dd>' +
      '<dt>Exchange / venue</dt><dd>' + esc0(t.exchange) + '</dd>' +
      '<dt>Contract or event ticker</dt><dd><code>' + esc0(t.ticker) + '</code> · ' + esc0(t.instrument_id) + '</dd>' +
      '<dt>Contract specification</dt><dd>' + esc0(JSON.stringify(t.contract_specification || null)) + '</dd>' +
      '<dt>Market / expiry dates</dt><dd>open ' + esc0(md.open_time || '—') + ' · close ' + esc0(md.close_time || '—') + ' · expiry ' + esc0(md.expiration_time || '—') + ' · last trade date ' + esc0(md.last_trade_date || '—') + '</dd>' +
      '<dt>Execution price</dt><dd>' + money(t.price, 4) + ' (simulated ' + esc0(fill.execution_model || 'n/a') + ' fill)</dd>' +
      '<dt>Published market at decision</dt><dd>bid ' + money((t.market_at_decision || {}).bid, 4) + ' / offer ' + money((t.market_at_decision || {}).offer, 4) + ' / mid ' + money((t.market_at_decision || {}).mid, 4) + '</dd>' +
      '<dt>Liquidity available</dt><dd>' + esc0(JSON.stringify(t.liquidity_consumed || null)) + '</dd>' +
      '<dt>Slippage</dt><dd>' + usd(t.slippage) + '</dd>' +
      '<dt>Fees</dt><dd>' + esc0(JSON.stringify(t.fees || null)) + '</dd>' +
      '<dt>Position size / collateral</dt><dd>' + t.contracts + ' contracts · notional ' + usd(t.position_notional_usd) + ' · collateral ' + usd(t.margin_usd) + ' <span class="muted tiny">' + esc0(t.margin_model || '') + '</span></dd>' +
      '<dt>PnL</dt><dd>' + esc0(JSON.stringify(t.pnl || null)) + '</dd>' +
      '<dt>Simulated fill levels</dt><dd>' + (levelRows ? '<ul class="tight">' + levelRows + '</ul>' : '<span class="muted">quote-based fill at the published ' + esc0(t.action === 'buy' ? 'offer' : 'bid') + '</span>') + '</dd>' +
      '<dt>Retrieved / verified</dt><dd>retrieved ' + esc0(t.retrieved_at || '—') + ' · recorded ' + esc0(t.verification_timestamp || '—') + '</dd>' +
      '<dt>Verification</dt><dd>' + (verified ? badge('fully verified', 'ok') + ' <span class="small muted">payload hash found in that run\\'s provenance log, fill detail reproduces the recorded VWAP, fee matches the official formula, instrument still published with its own provenance</span>' : badge('anomaly', 'no') + ' <span class="small muted">' + esc0(anomalies.join(', ')) + '</span>') + '</dd>' +
      '<dt>Thesis at entry</dt><dd>' + esc0(t.thesis || t.signal || '—') + '</dd>' +
      '</dl></details>';
  }).join('') : '<div class="card muted">No trades placed yet.</div>');

  byId('intents_table', (D.intents || []).length ? '<table><thead><tr><th>When</th><th>Trading as</th><th>Instrument</th><th>Wanted to</th><th>Outcome</th><th>Why</th></tr></thead><tbody>' +
    D.intents.map(function (x) { return '<tr><td class="small">' + esc0(x.created_at) + '</td><td>' + esc0(x.username) + '</td><td><code>' + esc0(x.instrument_id) + '</code></td><td class="small">' + esc0(x.action) + (x.resting_price !== undefined ? ' @ ' + x.resting_price : '') + '</td><td class="small">' + badge(x.status === 'executed' ? 'executed' : 'not executed', x.status === 'executed' ? 'ok' : 'warn') + ' <span class="muted tiny">' + esc0(x.reason) + '</span></td><td class="small">' + esc0(x.detail || '') + '</td></tr>'; }).join('') + '</tbody></table>'
    : '<div class="card muted">No recorded intents yet.</div>');

  var wo = (D.working_orders && D.working_orders.orders) || [];
  byId('working_orders', wo.length ? '<table><thead><tr><th>Placed</th><th>Strategy</th><th>Instrument</th><th>Side</th><th class="num">Contracts</th><th class="num">Resting price</th><th>Status</th><th>Expires</th></tr></thead><tbody>' +
    wo.map(function (o) { return '<tr><td class="small">' + esc0(o.placed_at) + '</td><td>' + esc0(o.username) + '</td><td><code>' + esc0(o.instrument_id) + '</code></td><td class="small">' + esc0(o.outcome || o.side) + '</td><td class="num">' + o.contracts + '</td><td class="num">' + money(o.resting_price, 4) + '</td><td class="small">' + badge(o.status, o.status === 'resting' ? 'warn' : '') + '</td><td class="small">' + esc0(o.expires_at || '—') + '</td></tr>'; }).join('') + '</tbody></table>'
    : '<div class="card muted">No resting maker orders.</div>');

  var cov = D.coverage || {};
  var t = cov.totals || {};
  byId('universe_summary', '<div class="grid k4">' + [
    ['Kalshi series matched', t.kalshi_series_matched],
    ['Kalshi open markets read', t.kalshi_listed_open_markets],
    ['Kalshi markets quoted', t.kalshi_quoted_markets],
    ['Kalshi perpetuals', t.kalshi_perps],
    ['MOEX commodity contracts listed', t.moex_listed_commodity_contracts],
    ['MOEX contracts tracked', t.moex_tracked_contracts]
  ].map(function (row) { return '<div class="card"><div class="muted small">' + row[0] + '</div><div class="stat">' + (row[1] === undefined || row[1] === null ? '—' : row[1]) + '</div></div>'; }).join('') + '</div>');

  var series = (cov.kalshi_series || []).slice().sort(function (a, b) { return (b.quoted_markets || 0) - (a.quoted_markets || 0) || (b.listed_open_markets || 0) - (a.listed_open_markets || 0); });
  byId('series_table', series.length ? '<table><thead><tr><th>Series</th><th>Title</th><th>Group</th><th>Commodity</th><th class="num">Listed open markets</th><th class="num">Quoted</th><th>Contract terms</th><th>Settlement source</th></tr></thead><tbody>' +
    series.map(function (s) { return '<tr><td><code>' + esc0(s.series_ticker) + '</code></td><td class="small">' + esc0(s.series_ticker) + '</td><td class="small">' + esc0(s.group) + '</td><td class="small">' + esc0(s.commodity) + '</td><td class="num">' + s.listed_open_markets + '</td><td class="num">' + s.quoted_markets + '</td><td class="tiny">' + link(s.contract_terms_url, 'terms') + '</td><td class="tiny">' + ((s.settlement_sources || []).map(function (x) { return link(x.url, x.name); }).join('<br>') || '—') + '</td></tr>'; }).join('') + '</tbody></table>'
    : '<div class="card muted">Coverage is written on the next tick.</div>');

  var exchanges = (D.futures_registry && D.futures_registry.exchanges) || {};
  var exRows = Object.keys(exchanges).map(function (k) { var e = exchanges[k]; return '<tr><td><strong>' + esc0(e.name || k) + '</strong></td><td class="small">' + esc0(e.country || '') + '</td><td class="small">' + badge(e.automated_access || 'unknown', e.automated_access === 'open' ? 'ok' : e.automated_access === 'restricted' ? 'warn' : 'no') + '</td><td class="small">' + esc0(e.access_evidence || e.notes || '') + '</td><td class="tiny">' + link(e.docs_url || e.url, 'official') + '</td></tr>'; }).join('');
  byId('exchange_table', exRows ? '<table><thead><tr><th>Exchange</th><th>Region</th><th>Automated access</th><th>Evidence</th><th>Link</th></tr></thead><tbody>' + exRows + '</tbody></table><p class="small muted">Only exchanges whose public data could be retrieved without credentials are traded. Where an exchange blocks scripted access, its contract specifications are cited from the public product page and no price is invented.</p>' : '<div class="card muted">Exchange registry unavailable.</div>');

  byId('verification_box', (V.methodology ? '<div class="note"><strong>What the verifier checks</strong><ul class="tight small">' + V.methodology.map(function (m) { return '<li>' + esc0(m) + '</li>'; }).join('') + '</ul></div>' : '') +
    '<div class="grid k4">' + [
      ['Trades checked', V.trades_checked],
      ['Fully verified', V.fully_verified],
      ['Trades with anomalies', V.with_anomalies],
      ['Anomaly count', V.anomaly_count]
    ].map(function (r) { return '<div class="card"><div class="muted small">' + r[0] + '</div><div class="stat">' + (r[1] === undefined || r[1] === null ? '—' : r[1]) + '</div></div>'; }).join('') + '</div>' +
    ((V.anomalies || []).length ? '<details><summary class="small">Open anomalies (' + V.anomalies.length + ')</summary><table><thead><tr><th>Trade</th><th>Ticker</th><th>Check</th><th>Detail</th></tr></thead><tbody>' + V.anomalies.map(function (a) { return '<tr><td class="tiny">' + esc0(a.trade_id) + '</td><td><code>' + esc0(a.ticker) + '</code></td><td class="small">' + esc0(a.check) + '</td><td class="tiny">' + esc0(JSON.stringify(a.detail)) + '</td></tr>'; }).join('') + '</tbody></table></details>' : '<div class="note small">No anomalies in the current report.</div>'));

  byId('methods_box', '<div class="grid k2">' +
    '<div class="card"><h3>How fills are simulated</h3><ul class="tight small">' +
    '<li><strong>Event contracts (taker):</strong> the order walks the exchange\\'s published ladder, level by level; the fill records every level consumed. Kalshi publishes resting bids only, so an offer is the complement of the opposing bid (yes ask = 1 − best no bid) and the derivation is stated on each quote.</li>' +
    '<li><strong>Futures and perpetuals:</strong> filled at the published bid (sell) or offer (buy), capped at a small share of the exchange-published volume or open interest.</li>' +
    '<li><strong>Maker orders:</strong> a resting quote is recorded as a working order and can only fill when a later snapshot shows the market trading through the resting price; such fills are marked as modelled, never as observed executions.</li>' +
    '<li><strong>Fees:</strong> Kalshi taker and maker fees use the official published formula; MOEX uses the exchange-published per-contract fee converted at the official USD/RUB rate. Where a fee schedule has not been verified, the fee is recorded as unknown rather than assumed to be zero.</li>' +
    '<li><strong>Settlement:</strong> positions settle only from the result the exchange itself publishes, and only after it exists.</li>' +
    '</ul></div>' +
    '<div class="card"><h3>What this page does not claim</h3><ul class="tight small">' +
    '<li>Simulated fills are not exchange executions and no order is ever sent to an exchange.</li>' +
    '<li>Depth is what the exchange published at snapshot time; real resting size can disappear before an order would arrive.</li>' +
    '<li>CME Group, ICE, LME, Eurex, JPX, SGX, B3 and several other venues either block scripted access or require accounts, so their contract specifications are cited from official pages while live pricing is not simulated for them. Strategies are labelled unavailable for backtesting where historical official prices do not exist.</li>' +
    '<li>EIA stopped publishing NYMEX futures prices after 5 April 2024; those series are archived for historical analysis only and never used to price a live trade.</li>' +
    '<li>Risk management is intentionally out of scope: this is a returns-only simulator.</li>' +
    '</ul></div></div>');
})();
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
const bytes = Buffer.byteLength(html);
console.log(`site: wrote ${OUT} (${(bytes / 1024).toFixed(1)} KiB) from ${data.trades.length} trades, ${data.strategies.length} strategy reports, ${counts.openPositions} open positions`);
if (!data.trades.length) console.log('site: note — no trades in the ledger yet, the page will show empty states');
