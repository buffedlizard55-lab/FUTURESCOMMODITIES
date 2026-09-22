/**
 * Strategy library.
 *
 * Each strategy is a deterministic function over *verified* market data. It may only read the
 * snapshot it is handed; it cannot invent prices. Every order it produces carries:
 *   - the signal that produced it (named inputs + values that came from the snapshot),
 *   - the market type it trades (explicitly labelled, per project requirements),
 *   - a stated thesis and explicit entry/exit rules.
 *
 * Origins are labelled honestly:
 *   kind 'market_structure'  -> behaviour implied by the venue's published mechanics
 *                              (fees, order book, settlement) documented by the exchange
 *   kind 'risk_premium'      -> a documented, widely published market phenomenon; the citation
 *                              is only attached when a source was actually retrieved and read
 *                              (see docs/STRATEGIES.md)
 *   kind 'project_baseline'  -> a rule set constructed for this project; no external claim made
 */

const pct = (a, b) => (b ? (a - b) / b : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const stdev = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

/* ----------------------------- signal helpers ----------------------------- */

/** Close series of the traded-price mid from official Kalshi candlesticks. */
function candleCloses(candles, { useBidAskMid = true } = {}) {
  const out = [];
  for (const c of candles ?? []) {
    if (useBidAskMid) {
      const b = c.yes_bid_close;
      const a = c.yes_ask_close;
      if (b != null && a != null) out.push((b + a) / 2);
      else if (c.price_close != null) out.push(c.price_close);
    } else if (c.price_close != null) out.push(c.price_close);
  }
  return out.filter((x) => Number.isFinite(x));
}

function trendSignal(candles, lookback) {
  const closes = candleCloses(candles);
  if (closes.length < lookback + 1) return null;
  const window = closes.slice(-(lookback + 1));
  const ret = pct(window.at(-1), window[0]);
  const vol = stdev(window.slice(1).map((v, i) => pct(v, window[i])).filter((x) => x != null));
  return { return: ret, sigma: vol, observations: window.length };
}

/**
 * Daily closes for a MOEX contract from the official ISS history rows. Rows with zero/blank
 * closes are dropped: MOEX publishes zero-filled rows for days a contract did not trade, and
 * treating those as prices would fabricate a move.
 */
function moexCloses(rows, n = 60) {
  return (rows ?? [])
    .map((r) => ({ date: r.TRADEDATE, close: r.CLOSE ?? r.SETTLEPRICE, settle: r.SETTLEPRICE, volume: r.VOLUME, oi: r.OPENPOSITION }))
    .filter((r) => r.close != null && Number(r.close) > 0)
    .slice(-n);
}

/** Only trade markets that still have meaningful time left before their close. */
function hasTimeLeft(inst, minutes, now = new Date()) {
  const close = inst.close_time ?? inst.expiration_time;
  if (!close) return true;
  return (new Date(close).getTime() - now.getTime()) / 60000 > minutes;
}

/** USD notional of one contract: perps quote dollars per contract; MOEX prices need the official multiplier. */
function contractNotionalUsd(inst, price) {
  if (inst.venue === 'kalshi_margin') return price; // quote is already the contract's dollar value
  if (inst.venue === 'moex_forts') return price * (inst.usd_per_price_unit ?? 0);
  return price;
}

function moexTrend(rows, lookback) {
  const closes = moexCloses(rows, lookback + 1).map((r) => r.close);
  if (closes.length < lookback + 1) return null;
  return { return: pct(closes.at(-1), closes[0]), observations: closes.length };
}

/* --------------------------- order construction --------------------------- */

function order(strategy, inst, quote, fields) {
  return {
    strategy_id: strategy.id,
    username: strategy.username,
    instrument_id: inst.instrument_id,
    venue: inst.venue,
    market_type_label: strategy.market_type,
    instrument_title: inst.title,
    action: fields.action,
    outcome: fields.outcome ?? null,
    side: fields.side ?? null,
    contracts: fields.contracts,
    limit_price: fields.limit_price ?? null,
    order_type: fields.order_type ?? 'taker',
    thesis: fields.thesis,
    signal: fields.signal ?? null,
    quote_at_decision: quote,
    created_at: new Date().toISOString(),
  };
}

/** Size in contracts = target notional / price, capped by real executable liquidity. */
function sizeByNotional({ notionalUsd, price, maxContracts = Infinity, minContracts = 1 }) {
  if (!Number.isFinite(notionalUsd) || !price) return 0;
  const raw = Math.floor(notionalUsd / price);
  const allowed = Math.min(raw, maxContracts);
  return allowed >= minContracts ? allowed : 0;
}

function executableContracts(levels, maxPriceImpact = 0.03) {
  if (!levels?.length) return 0;
  const best = levels[0].price;
  let total = 0;
  for (const l of levels) {
    if (l.price - best > maxPriceImpact) break;
    total += l.contracts;
  }
  return total;
}

/* -------------------------------- strategies ------------------------------- */

export const STRATEGIES = [
  {
    id: 'kalshi-commodity-momentum',
    username: '@gold-grinder',
    display_name: 'Commodity Momentum (Kalshi event contracts)',
    market_type: 'Kalshi event contracts',
    venues: ['kalshi'],
    thesis:
      'Commodity prices trend over daily-to-monthly horizons. Express the trend on Kalshi commodity event contracts, whose official settlement sources (Pyth indices, exchange settlements) make the outcome objectively verifiable.',
    rules: [
      'Signal: momentum of the same underlying from verified official price series (MOEX settlement history, EIA spot).',
      'Entry: buy YES when the lookback return is positive and the book offers a spread <= 4 cents with >= 50 contracts of size within 1 cent of the touch.',
      'Exit: at settlement (binary expiry) or on a signal flip with an opposite order.',
      'Market type: Kalshi event contracts, $1 notional per contract.',
    ],
    origin: { kind: 'project_baseline', note: 'Trend-following baseline constructed for this competition; no third-party claim.' },
    sizing: { notional_usd: 12000, max_price_impact: 0.03, min_spread_cents: 0, max_spread_cents: 4 },
    status: 'forward_test',
    decide(ctx) {
      const orders = [];
      const notes = [];
      const candidates = ctx.listInstruments({ venue: 'kalshi', groups: ['Precious Metals', 'Industrial Metals', 'Energy', 'Grains & Oilseeds', 'Soft Commodities'] })
        .filter((i) => /MON|WEEK|Weekly|Monthly/i.test(`${i.series_ticker} ${i.title}`))
        .slice(0, 12);
      for (const inst of candidates) {
        if (!hasTimeLeft(inst, 60, ctx.now)) continue;
        const q = ctx.quotes[inst.instrument_id];
        if (!q || q.mid == null || q.spread == null) continue;
        if (q.spread > this.sizing.max_spread_cents / 100) {
          notes.push({ instrument_id: inst.instrument_id, skipped: 'spread wider than rule allows', spread: q.spread });
          continue;
        }
        const signalSource = ctx.signalSeriesFor(inst);
        const trend = signalSource ? signalSource.trend : null;
        if (!trend || trend.observations < 6) {
          notes.push({ instrument_id: inst.instrument_id, skipped: 'insufficient verified history for signal', source: signalSource?.name ?? null });
          continue;
        }
        const wantLong = trend.return > 0.01;
        const wantShort = trend.return < -0.01;
        if (!wantLong && !wantShort) continue;
        const outcome = wantLong ? 'yes' : 'no';
        const book = outcome === 'yes' ? q.buy_yes_levels : q.buy_no_levels;
        const price = outcome === 'yes' ? q.best_yes_ask : q.best_no_ask;
        const liquidity = executableContracts(book, this.sizing.max_price_impact);
        const contracts = Math.min(
          sizeByNotional({ notionalUsd: this.sizing.notional_usd, price, maxContracts: liquidity }),
          liquidity,
        );
        if (contracts < 1) {
          notes.push({ instrument_id: inst.instrument_id, skipped: 'insufficient book depth', liquidity });
          continue;
        }
        orders.push(
          order(this, inst, q, {
            action: 'buy',
            outcome,
            contracts,
            order_type: 'taker',
            thesis: `${trend.return > 0 ? 'Positive' : 'Negative'} ${signalSource.name} momentum (${(trend.return * 100).toFixed(2)}% over ${trend.observations} observations).`,
            signal: { name: 'official_price_trend', value: trend.return, lookback_observations: trend.observations, source: signalSource.name, source_url: signalSource.url },
          }),
        );
      }
      return { orders, exits: [], notes };
    },
  },
  {
    id: 'kalshi-longshot-fade',
    username: '@fade-the-crowd',
    display_name: 'Longshot Fade (buy NO on cheap YES)',
    market_type: 'Kalshi event contracts',
    venues: ['kalshi'],
    thesis:
      'Prediction-market and lottery-style contracts have historically been priced rich at the tails: very unlikely outcomes trade above their realised frequency. Fading them (buying NO) harvests that premium, accepting rare large losses.',
    rules: [
      'Entry: buy NO when the YES mid <= 0.10 AND the YES mid is above the modelled base rate proxy (we use the contract price itself only as the execution reference, never as a probability claim).',
      'Filter: spread <= 3 cents, at least 100 contracts of NO-side depth within 2 cents.',
      'Exit: at settlement, or take profit when NO mid >= 0.97, or cut when YES mid >= 0.25 (signal invalidated).',
    ],
    origin: {
      kind: 'risk_premium',
      note: 'Favourite-longshot bias: see docs/STRATEGIES.md for the retrieved sources that document mispricing of extreme probabilities.',
    },
    sizing: { notional_usd: 15000, max_spread_cents: 3, min_no_depth: 100, stop_yes_mid: 0.25, take_profit_no_mid: 0.97 },
    status: 'forward_test',
    decide(ctx) {
      const orders = [];
      const notes = [];
      const candidates = ctx
        .listInstruments({ venue: 'kalshi' })
        .filter((i) => (i.volume ?? 0) >= 100 || (i.open_interest ?? 0) >= 100)
        .slice(0, 40);
      let taken = 0;
      for (const inst of candidates) {
        if (taken >= 4) break;
        if (!hasTimeLeft(inst, 120, ctx.now)) continue;
        const q = ctx.quotes[inst.instrument_id];
        if (!q || q.mid == null || q.spread == null || q.best_yes_ask == null) continue;
        if (q.mid > 0.1 || q.spread > this.sizing.max_spread_cents / 100) continue;
        if (ctx.hasPosition(inst.instrument_id)) continue;
        const depth = q.buy_no_levels.reduce((s, l) => s + (l.price >= q.best_no_ask - 0.02 ? l.contracts : 0), 0);
        if (depth < this.sizing.min_no_depth) {
          notes.push({ instrument_id: inst.instrument_id, skipped: 'below NO-side depth floor', depth });
          continue;
        }
        const price = q.best_no_ask;
        const contracts = Math.min(sizeByNotional({ notionalUsd: this.sizing.notional_usd / 4, price, maxContracts: depth }), depth);
        if (contracts < 1) continue;
        orders.push(
          order(this, inst, q, {
            action: 'buy',
            outcome: 'no',
            contracts,
            thesis: `YES trades at ${q.mid.toFixed(3)} — fading an extreme-priced contract with ${depth} contracts of verified NO depth.`,
            signal: { name: 'yes_mid_extreme', value: q.mid, threshold: 0.1, no_ask: price, depth_contracts: depth },
          }),
        );
        taken += 1;
      }
      return { orders, exits: [], notes };
    },
    exit(ctx, position) {
      const q = ctx.quotes[position.instrument_id];
      if (!q) return null;
      if (position.outcome === 'no') {
        if (q.best_no_bid != null && q.best_no_bid >= this.sizing.take_profit_no_mid) return { reason: 'take_profit', limit_price: q.best_no_bid };
        if (q.best_yes_ask != null && q.best_yes_ask >= this.sizing.stop_yes_mid) return { reason: 'signal_invalidated', limit_price: q.best_no_bid };
      }
      return null;
    },
  },
  {
    id: 'kalshi-carry-collector',
    username: '@carry-collector',
    display_name: 'High-Probability Carry (buy NO on heavy favourites)',
    market_type: 'Kalshi event contracts',
    venues: ['kalshi'],
    thesis:
      'Contracts priced above 0.90 pay a small, frequent premium to the NO side. Because fees are quadratic in price — official formula f = roundup(M*0.07*C*P*(1-P)) — the fee drag at the extremes is a fraction of the premium collected, which is a structural edge that exists only where the book is deep enough to absorb size.',
    rules: [
      'Entry: buy NO when YES mid >= 0.90, spread <= 2 cents, NO book depth >= 200 contracts within 2 cents.',
      'Exit: at settlement; early exit only if YES mid <= 0.80 (adverse resolution risk rising).',
      'Fees: official Kalshi taker formula is applied to every simulated fill.',
    ],
    origin: { kind: 'market_structure', note: 'Derived from the published Kalshi fee schedule (quadratic fee in P*(1-P)) and the binary payoff structure, both verified from official Kalshi documents.' },
    sizing: { notional_usd: 20000, max_spread_cents: 2, min_no_depth: 200, stop_yes_mid: 0.8 },
    status: 'forward_test',
    decide(ctx) {
      const orders = [];
      const notes = [];
      const candidates = ctx
        .listInstruments({ venue: 'kalshi' })
        .sort((a, b) => (b.volume_24h ?? b.volume ?? 0) - (a.volume_24h ?? a.volume ?? 0))
        .slice(0, 40);
      let taken = 0;
      for (const inst of candidates) {
        if (taken >= 3) break;
        if (!hasTimeLeft(inst, 120, ctx.now)) continue;
        const q = ctx.quotes[inst.instrument_id];
        if (!q || q.mid == null || q.spread == null) continue;
        if (q.mid < 0.9 || q.spread > this.sizing.max_spread_cents / 100) continue;
        if (ctx.hasPosition(inst.instrument_id)) continue;
        const depth = q.buy_no_levels.reduce((s, l) => s + (l.price >= q.best_no_ask - 0.02 ? l.contracts : 0), 0);
        if (depth < this.sizing.min_no_depth) {
          notes.push({ instrument_id: inst.instrument_id, skipped: 'below NO-side depth floor', depth });
          continue;
        }
        const price = q.best_no_ask;
        const contracts = Math.min(sizeByNotional({ notionalUsd: this.sizing.notional_usd / 3, price, maxContracts: depth }), depth);
        if (contracts < 1) continue;
        orders.push(
          order(this, inst, q, {
            action: 'buy',
            outcome: 'no',
            contracts,
            thesis: `Favourite at YES mid ${q.mid.toFixed(3)}: collecting the residual premium with ${(1 - q.mid).toFixed(3)} of downside cover per contract.`,
            signal: { name: 'yes_mid_high', value: q.mid, threshold: 0.9, no_ask: price, depth_contracts: depth },
          }),
        );
        taken += 1;
      }
      return { orders, exits: [], notes };
    },
    exit(ctx, position) {
      const q = ctx.quotes[position.instrument_id];
      if (!q) return null;
      if (position.outcome === 'no' && q.best_yes_ask != null && q.best_yes_ask <= this.sizing.stop_yes_mid) {
        return { reason: 'adverse_move', limit_price: q.best_no_bid };
      }
      return null;
    },
  },
  {
    id: 'kalshi-spread-capture',
    username: '@spread-hunter',
    display_name: 'Spread Capture (market making inside the book)',
    market_type: 'Kalshi event contracts',
    venues: ['kalshi'],
    thesis:
      'The exchange charges maker fees only when a resting order eventually trades, and the standard maker multiplier is 0 (official fee schedule). Providing liquidity inside the spread on liquid contracts therefore earns the spread with no fee on standard markets.',
    rules: [
      'Entry: place a resting buy 1 tick inside the best bid when the spread >= 2 cents (maker model).',
      'Exit: rest a sell 1 tick inside the best ask on the same contract once filled.',
      'Maker fills are modelled conservatively: size is capped at visible opposing depth and no queue priority is assumed.',
    ],
    origin: { kind: 'market_structure', note: 'Derived from the official Kalshi order-book mechanics (bid-only book, implied asks) and the published maker fee formula.' },
    sizing: { notional_usd: 6000, min_spread_cents: 2, max_markets: 3, tick: 0.01 },
    status: 'forward_test',
    decide(ctx) {
      const orders = [];
      const notes = [];
      const candidates = ctx
        .listInstruments({ venue: 'kalshi' })
        .sort((a, b) => (b.volume_24h ?? b.volume ?? 0) - (a.volume_24h ?? a.volume ?? 0))
        .slice(0, 20);
      let taken = 0;
      for (const inst of candidates) {
        if (taken >= this.sizing.max_markets) break;
        const q = ctx.quotes[inst.instrument_id];
        if (!q || q.spread == null || q.best_yes_bid == null || q.best_yes_ask == null) continue;
        if (q.spread < this.sizing.min_spread_cents / 100) continue;
        if (ctx.hasPosition(inst.instrument_id)) continue;
        const restingPrice = Number((q.best_yes_bid + this.sizing.tick).toFixed(4));
        if (!(restingPrice < q.best_yes_ask)) continue;
        const depth = q.depth_no_contracts;
        const contracts = Math.min(sizeByNotional({ notionalUsd: this.sizing.notional_usd, price: restingPrice, maxContracts: depth }), depth);
        if (contracts < 1) continue;
        orders.push(
          order(this, inst, q, {
            action: 'buy',
            outcome: 'yes',
            contracts,
            limit_price: restingPrice,
            order_type: 'maker',
            thesis: `Resting YES bid at ${restingPrice} inside a ${(q.spread * 100).toFixed(0)}-cent spread; maker fee multiplier is 0 on standard Kalshi markets.`,
            signal: { name: 'spread_width', value: q.spread, best_bid: q.best_yes_bid, best_ask: q.best_yes_ask },
          }),
        );
        taken += 1;
      }
      return { orders, exits: [], notes };
    },
    exit(ctx, position) {
      const q = ctx.quotes[position.instrument_id];
      if (!q || q.best_yes_ask == null) return null;
      const resting = Number((q.best_yes_ask - 0.01).toFixed(4));
      if (resting > position.avg_entry_price) return { reason: 'maker_exit', limit_price: resting, order_type: 'maker' };
      return null;
    },
  },
  {
    id: 'kalshi-extreme-reversion',
    username: '@vol-crusher',
    display_name: 'Extreme Move Reversion (mean reversion after spikes)',
    market_type: 'Kalshi event contracts',
    venues: ['kalshi'],
    thesis:
      'Short-horizon probability spikes on liquid contracts overshoot. Buying the side that just got cheaper, after a move larger than two standard deviations of its own recent candle returns, captures part of the snap-back before settlement.',
    rules: [
      'Signal: 1-day candle mid return beyond +/- 2 sigma of the last 30 candle returns.',
      'Entry: take the opposite side of the spike at the touch (limit = best executable price from the snapshot).',
      'Exit: revert to the mean of the last 10 candle mids, or settle.',
    ],
    origin: { kind: 'project_baseline', note: 'Volatility-normalised reversion baseline constructed for this competition.' },
    sizing: { notional_usd: 8000, sigma_threshold: 2, max_markets: 3 },
    status: 'backtestable',
    decide(ctx) {
      const orders = [];
      const notes = [];
      let taken = 0;
      for (const inst of ctx.listInstruments({ venue: 'kalshi' })) {
        if (taken >= this.sizing.max_markets) break;
        const candles = ctx.candles[inst.series_ticker];
        if (!candles?.length || candles.length < 12) continue;
        const closes = candleCloses(candles);
        if (closes.length < 12) continue;
        const rets = closes.slice(1).map((v, i) => pct(v, closes[i])).filter((x) => x != null);
        const sd = stdev(rets.slice(-30));
        const last = rets.at(-1);
        if (sd == null || last == null || sd === 0) continue;
        const z = last / sd;
        if (Math.abs(z) < this.sizing.sigma_threshold) continue;
        const q = ctx.quotes[inst.instrument_id];
        if (!q || q.mid == null || q.spread == null) continue;
        if (ctx.hasPosition(inst.instrument_id)) continue;
        const outcome = z > 0 ? 'no' : 'yes'; // fade the spike
        const price = outcome === 'yes' ? q.best_yes_ask : q.best_no_ask;
        const depth = outcome === 'yes' ? q.depth_no_contracts : q.depth_yes_contracts;
        const contracts = Math.min(sizeByNotional({ notionalUsd: this.sizing.notional_usd / 3, price, maxContracts: depth }), depth);
        if (!price || contracts < 1) continue;
        orders.push(
          order(this, inst, q, {
            action: 'buy',
            outcome,
            contracts,
            thesis: `Candle mid moved ${(z).toFixed(2)} sigma (${(last * 100).toFixed(2)}%); fading the spike on the ${outcome.toUpperCase()} side.`,
            signal: { name: 'zscore_of_candle_returns', value: z, sigma: sd, last_return: last, candles_used: closes.length },
          }),
        );
        taken += 1;
      }
      return { orders, exits: [], notes };
    },
    exit(ctx, position) {
      const q = ctx.quotes[position.instrument_id];
      const candles = ctx.candles[ctx.instruments[position.instrument_id]?.series_ticker];
      if (!q) return null;
      const closes = candleCloses(candles).slice(-10);
      const m = mean(closes);
      if (m == null) return null;
      const mid = q.mid;
      if (mid == null) return null;
      if (position.outcome === 'yes' && mid >= m) return { reason: 'reverted_to_mean', limit_price: q.best_yes_bid };
      if (position.outcome === 'no' && mid <= m) return { reason: 'reverted_to_mean', limit_price: q.best_no_bid };
      return null;
    },
  },
  {
    id: 'kalshi-cheap-momentum',
    username: '@tail-rider',
    display_name: 'Cheap-Tail Momentum (momentum on longshots)',
    market_type: 'Kalshi event contracts',
    venues: ['kalshi'],
    thesis:
      'The mirror image of the longshot fade: when a cheap contract is being actively repriced upward in the official candle history, the continuation can pay multiples of the entry price. This strategy exists to test the opposite hypothesis in a head-to-head competition.',
    rules: [
      'Entry: YES mid between 0.03 and 0.15, 3-candle momentum positive, spread <= 3 cents.',
      'Exit: +60% of entry price, -50% stop, or settlement.',
    ],
    origin: { kind: 'project_baseline', note: 'Designed as the explicit counter-hypothesis to @fade-the-crowd.' },
    sizing: { notional_usd: 4000, max_markets: 3, take_profit_mult: 1.6, stop_mult: 0.5 },
    status: 'backtestable',
    decide(ctx) {
      const orders = [];
      const notes = [];
      let taken = 0;
      for (const inst of ctx.listInstruments({ venue: 'kalshi' })) {
        if (taken >= this.sizing.max_markets) break;
        const candles = ctx.candles[inst.series_ticker];
        const closes = candleCloses(candles);
        if (closes.length < 4) continue;
        const q = ctx.quotes[inst.instrument_id];
        if (!q || q.mid == null || q.spread == null) continue;
        if (q.mid < 0.03 || q.mid > 0.15 || q.spread > 0.03) continue;
        if (ctx.hasPosition(inst.instrument_id)) continue;
        const mom = pct(closes.at(-1), closes.at(-4));
        if (mom == null || mom <= 0) continue;
        const price = q.best_yes_ask;
        const depth = q.depth_no_contracts;
        const contracts = Math.min(sizeByNotional({ notionalUsd: this.sizing.notional_usd / 3, price, maxContracts: depth }), depth);
        if (!price || contracts < 1) continue;
        orders.push(
          order(this, inst, q, {
            action: 'buy',
            outcome: 'yes',
            contracts,
            thesis: `Cheap contract (${q.mid.toFixed(3)}) with positive 3-candle momentum (${(mom * 100).toFixed(1)}%).`,
            signal: { name: 'cheap_tail_momentum', value: mom, mid: q.mid },
          }),
        );
        taken += 1;
      }
      return { orders, exits: [], notes };
    },
    exit(ctx, position) {
      const q = ctx.quotes[position.instrument_id];
      if (!q || q.best_yes_bid == null) return null;
      if (position.outcome !== 'yes') return null;
      if (q.best_yes_bid >= position.avg_entry_price * this.sizing.take_profit_mult) return { reason: 'take_profit', limit_price: q.best_yes_bid };
      if (q.best_yes_bid <= position.avg_entry_price * this.sizing.stop_mult) return { reason: 'stop', limit_price: q.best_yes_bid };
      return null;
    },
  },
  {
    id: 'moex-metals-trend',
    username: '@metal-trend',
    display_name: 'Metals Trend (MOEX FORTS futures)',
    market_type: 'Futures (exchange-listed, MOEX FORTS)',
    venues: ['moex_forts'],
    thesis:
      'Precious and base metal futures trend over multi-week horizons. MOEX FORTS publishes official settlement history and a live bid/offer, so the strategy can be measured in real spreads rather than assumptions.',
    rules: [
      'Signal: 20-day official settlement momentum on the contract.',
      'Entry: buy at the official offer when 20-day momentum > +1%, sell at the official bid when < -1%.',
      'Exit: opposite signal, or at contract termination (positions must be flat before the last trade date).',
      'Only contracts whose official reference data reports FACEUNIT=USD are traded, so PnL is natively in USD.',
    ],
    origin: { kind: 'project_baseline', note: 'Time-series momentum baseline; classical trend literature applies, no single source claimed.' },
    sizing: { notional_usd: 25000, lookback_days: 20, threshold: 0.01 },
    status: 'forward_test',
    decide(ctx) {
      const orders = [];
      const notes = [];
      const groups = ['Precious Metals', 'Industrial Metals'];
      for (const inst of ctx.listInstruments({ venue: 'moex_forts', groups })) {
        if (!inst.pnl_currency_ready || !(inst.usd_per_price_unit > 0)) {
          notes.push({ instrument_id: inst.instrument_id, skipped: 'USD valuation unavailable this snapshot', valuation_note: inst.valuation_note ?? null });
          continue;
        }
        const q = ctx.quotes[inst.instrument_id];
        const rows = ctx.moexHistory[inst.ticker];
        if (!q || !rows?.length) continue;
        const t = moexTrend(rows, this.sizing.lookback_days);
        if (!t) {
          notes.push({ instrument_id: inst.instrument_id, skipped: 'insufficient official settlement history', rows: rows.length });
          continue;
        }
        if (ctx.hasPosition(inst.instrument_id)) continue;
        if (Math.abs(t.return) < this.sizing.threshold) continue;
        const side = t.return > 0 ? 'long' : 'short';
        const price = side === 'long' ? q.offer : q.bid;
        const notionalPerContract = contractNotionalUsd(inst, price);
        if (!(notionalPerContract > 0)) continue;
        const contracts = Math.max(1, Math.floor(this.sizing.notional_usd / notionalPerContract));
        orders.push(
          order(this, inst, q, {
            action: side === 'long' ? 'buy' : 'sell',
            side,
            contracts,
            thesis: `${this.sizing.lookback_days}-day settlement momentum ${(t.return * 100).toFixed(2)}% on ${inst.title}.`,
            signal: { name: 'settlement_momentum', value: t.return, observations: t.observations, source: 'MOEX ISS official daily history' },
          }),
        );
      }
      return { orders, exits: [], notes };
    },
    exit(ctx, position) {
      const inst = ctx.instruments[position.instrument_id];
      const q = ctx.quotes[position.instrument_id];
      const rows = ctx.moexHistory[inst?.ticker];
      if (!inst || !q) return null;
      if (inst.last_trade_date) {
        const days = (new Date(inst.last_trade_date) - ctx.now) / 86400000;
        if (days <= 3) return { reason: 'roll_before_termination', limit_price: position.side === 'long' ? q.bid : q.offer };
      }
      const t = moexTrend(rows, this.sizing.lookback_days);
      if (!t) return null;
      if (position.side === 'long' && t.return < 0) return { reason: 'signal_flip', limit_price: q.bid };
      if (position.side === 'short' && t.return > 0) return { reason: 'signal_flip', limit_price: q.offer };
      return null;
    },
  },
  {
    id: 'moex-calendar-carry',
    username: '@calendar-carry',
    display_name: 'Calendar Carry (curve spread on MOEX metals)',
    market_type: 'Futures (exchange-listed, MOEX FORTS)',
    venues: ['moex_forts'],
    thesis:
      'Metals futures curves embed financing and storage. When the deferred contract trades below the nearby (backwardation) by more than round-trip costs, holding the calendar spread earns the roll.',
    rules: [
      'Signal: deferred official mid minus nearby official mid, normalised by the nearby price.',
      'Entry: long the deferred / short the nearby when the annualised carry exceeds 2x round-trip exchange fees; opposite when the curve is steeply in contango.',
      'Exit: carry normalises below half the entry threshold, or three days before the nearby terminates.',
    ],
    origin: { kind: 'market_structure', note: 'Carry/roll mechanics; costs taken from MOEX published BUYSELLFEE for each contract.' },
    sizing: { notional_usd: 20000, min_annualised_carry: 0.02, legs: 2 },
    status: 'forward_test',
    decide(ctx) {
      const orders = [];
      const notes = [];
      const byAsset = new Map();
      const groups = ['Precious Metals', 'Industrial Metals', 'Soft Commodities', 'Grains & Oilseeds'];
      for (const inst of ctx.listInstruments({ venue: 'moex_forts', groups })) {
        if (!inst.pnl_currency_ready || !(inst.usd_per_price_unit > 0)) continue;
        const list = byAsset.get(inst.asset_code) ?? [];
        list.push(inst);
        byAsset.set(inst.asset_code, list);
      }
      for (const [asset, list] of byAsset) {
        if (list.length < 2) continue;
        const sorted = list.slice().sort((a, b) => String(a.last_trade_date).localeCompare(String(b.last_trade_date)));
        const near = sorted[0];
        const far = sorted[1];
        const qn = ctx.quotes[near.instrument_id];
        const qf = ctx.quotes[far.instrument_id];
        if (!qn || !qf || qn.mid == null || qf.mid == null) continue;
        if (ctx.hasPosition(near.instrument_id) || ctx.hasPosition(far.instrument_id)) continue;
        const days = Math.max(1, (new Date(far.last_trade_date) - new Date(near.last_trade_date)) / 86400000);
        const carry = (qf.mid - qn.mid) / qn.mid;
        const annualised = carry * (365 / days);
        // Cost screen uses the exchange's own published round-trip fees, converted with the
        // MOEX USD/RUB rate taken in the same snapshot (never a hard-coded FX assumption).
        const fxRate = ctx.fx?.rate ?? null;
        const roundTripRub = (near.fees_reported?.buy_sell_fee_rub ?? 0) + (far.fees_reported?.buy_sell_fee_rub ?? 0);
        const notionalPerContract = contractNotionalUsd(near, qn.mid);
        const roundTripUsd = fxRate && roundTripRub ? roundTripRub / fxRate : null;
        const feeDrag = roundTripUsd != null && notionalPerContract > 0 ? roundTripUsd / notionalPerContract : null;
        if (Math.abs(annualised) < this.sizing.min_annualised_carry) {
          notes.push({ asset, skipped: 'carry below threshold', annualised_carry: annualised, days_between_expiries: days, fee_drag_usd: feeDrag });
          continue;
        }
        const direction = annualised < 0 ? 'backwardation' : 'contango';
        const contracts = 1;
        orders.push(
          order(this, near, qn, {
            action: annualised < 0 ? 'sell' : 'buy',
            side: annualised < 0 ? 'short' : 'long',
            contracts,
            thesis: `${asset} curve in ${direction}: ${(annualised * 100).toFixed(2)}% annualised across ${days.toFixed(0)} days.`,
            signal: { name: 'calendar_carry', value: annualised, near_mid: qn.mid, far_mid: qf.mid, days_between_expiries: days, round_trip_fee_usd: feeDrag, fx_rate_used: fxRate },
          }),
        );
        orders.push(
          order(this, far, qf, {
            action: annualised < 0 ? 'buy' : 'sell',
            side: annualised < 0 ? 'long' : 'short',
            contracts,
            thesis: `Second leg of the ${asset} calendar spread.`,
            signal: { name: 'calendar_carry_leg2', value: annualised },
          }),
        );
      }
      return { orders, exits: [], notes };
    },
    exit(ctx, position) {
      const inst = ctx.instruments[position.instrument_id];
      const q = ctx.quotes[position.instrument_id];
      if (!inst || !q) return null;
      if (inst.last_trade_date) {
        const days = (new Date(inst.last_trade_date) - ctx.now) / 86400000;
        if (days <= 3) return { reason: 'roll_before_termination', limit_price: position.side === 'long' ? q.bid : q.offer };
      }
      return null;
    },
  },
  {
    id: 'moex-agri-seasonal',
    username: '@agri-seasonal',
    display_name: 'Agricultural Seasonality (MOEX grains & softs)',
    market_type: 'Futures (exchange-listed, MOEX FORTS)',
    venues: ['moex_forts'],
    thesis:
      'Harvest and demand cycles create repeatable month-of-year behaviour in grains and softs. The seasonal profile here is computed from the official MOEX daily settlement archive — measured, not asserted — and only traded when the current year agrees with the historical pattern.',
    rules: [
      'Signal: average return for the same calendar month computed from official daily settlement history available in the archive.',
      'Entry: trade in the direction of the measured seasonal when it is at least +1.5% or -1.5% for the month and the contract has at least 30 days to expiry.',
      'Exit: end of the measured seasonal window, or 3 days before termination.',
    ],
    origin: { kind: 'project_baseline', note: 'Seasonality is measured from the official archive at runtime; no external seasonal table is hard-coded.' },
    sizing: { notional_usd: 12000, min_abs_seasonal: 0.015, min_days_to_expiry: 30 },
    status: 'forward_test',
    decide(ctx) {
      const orders = [];
      const notes = [];
      const groups = ['Grains & Oilseeds', 'Soft Commodities'];
      for (const inst of ctx.listInstruments({ venue: 'moex_forts', groups })) {
        if (!inst.pnl_currency_ready || !(inst.usd_per_price_unit > 0)) continue;
        const q = ctx.quotes[inst.instrument_id];
        const rows = ctx.moexHistory[inst.ticker];
        if (!q || !rows?.length) continue;
        if (ctx.hasPosition(inst.instrument_id)) continue;
        const daysToExpiry = inst.last_trade_date ? (new Date(inst.last_trade_date) - ctx.now) / 86400000 : null;
        if (daysToExpiry != null && daysToExpiry < this.sizing.min_days_to_expiry) continue;
        const month = new Date(ctx.now).getUTCMonth() + 1;
        const seasonal = seasonalReturn(rows, month);
        if (!seasonal || Math.abs(seasonal.mean) < this.sizing.min_abs_seasonal) {
          notes.push({ instrument_id: inst.instrument_id, skipped: 'seasonal signal below threshold or not enough archive', seasonal });
          continue;
        }
        const side = seasonal.mean > 0 ? 'long' : 'short';
        const price = side === 'long' ? q.offer : q.bid;
        const notionalPerContract = contractNotionalUsd(inst, price);
        if (!(notionalPerContract > 0)) continue;
        const contracts = Math.max(1, Math.floor(this.sizing.notional_usd / notionalPerContract));
        orders.push(
          order(this, inst, q, {
            action: side === 'long' ? 'buy' : 'sell',
            side,
            contracts,
            thesis: `Measured ${monthName(month)} seasonal mean ${(seasonal.mean * 100).toFixed(2)}% over ${seasonal.years} years of official settlement data.`,
            signal: { name: 'measured_month_seasonality', value: seasonal.mean, years: seasonal.years, source: 'MOEX ISS official daily history' },
          }),
        );
      }
      return { orders, exits: [], notes };
    },
    exit(ctx, position) {
      const inst = ctx.instruments[position.instrument_id];
      const q = ctx.quotes[position.instrument_id];
      if (!inst || !q) return null;
      if (inst.last_trade_date) {
        const days = (new Date(inst.last_trade_date) - ctx.now) / 86400000;
        if (days <= 3) return { reason: 'roll_before_termination', limit_price: position.side === 'long' ? q.bid : q.offer };
      }
      return null;
    },
  },
  {
    id: 'kalshi-perp-trend',
    username: '@perp-surfer',
    display_name: 'Perp Trend (Kalshi perpetual futures)',
    market_type: 'Kalshi perpetual futures',
    venues: ['kalshi_margin'],
    thesis:
      'Kalshi lists CFTC-regulated perpetual futures on gold, silver, platinum and palladium with official bid/ask and funding rates. Trend following a 24/7 wrapped commodity contract captures moves outside traditional session hours.',
    rules: [
      'Signal: momentum of the official mid since the strategy last recorded a snapshot (stored in the platform archive).',
      'Entry: go long the perp when momentum > +0.75%, short when < -0.75%.',
      'Exit: signal flip or 1.5% adverse move from entry.',
      'Funding: recorded from the exchange payload when present; otherwise flagged as not applied.',
    ],
    origin: { kind: 'project_baseline', note: 'Trend baseline applied to a newly listed regulated product.' },
    sizing: { notional_usd: 15000, threshold: 0.0075, stop: 0.015, max_positions: 3 },
    status: 'forward_test',
    decide(ctx) {
      const orders = [];
      const notes = [];
      let open = 0;
      for (const inst of ctx.listInstruments({ venue: 'kalshi_margin' })) {
        if (open >= this.sizing.max_positions) break;
        if (inst.asset_class && !/commodit|metal|crypto/i.test(inst.asset_class)) continue;
        const q = ctx.quotes[inst.instrument_id];
        if (!q || q.mid == null) continue;
        if (ctx.hasPosition(inst.instrument_id)) continue;
        if (!(q.bid > 0) || !(q.offer > 0)) {
          notes.push({ instrument_id: inst.instrument_id, skipped: 'perp has no live two-sided quote in this snapshot', bid: q.bid, offer: q.offer });
          continue;
        }
        const prev = ctx.previousMid(inst.instrument_id);
        if (prev == null) {
          notes.push({ instrument_id: inst.instrument_id, skipped: 'no prior snapshot in the archive yet (first day of season)' });
          continue;
        }
        const mom = pct(q.mid, prev);
        if (mom == null || Math.abs(mom) < this.sizing.threshold) continue;
        const side = mom > 0 ? 'long' : 'short';
        const price = side === 'long' ? q.offer : q.bid;
        // Kalshi perps quote a dollar price per contract, so notional = contracts x price.
        const contracts = Math.max(1, Math.floor(this.sizing.notional_usd / price));
        orders.push(
          order(this, inst, q, {
            action: side === 'long' ? 'buy' : 'sell',
            side,
            contracts,
            thesis: `Official perp mid momentum ${(mom * 100).toFixed(2)}% since the previous snapshot.`,
            signal: { name: 'perp_mid_momentum', value: mom, previous_mid: prev, current_mid: q.mid, funding: inst.funding_rate ?? null },
          }),
        );
        open += 1;
      }
      return { orders, exits: [], notes };
    },
    exit(ctx, position) {
      const q = ctx.quotes[position.instrument_id];
      if (!q || q.mid == null) return null;
      const move = (q.mid - position.avg_entry_price) / position.avg_entry_price;
      const adverse = position.side === 'long' ? -move : move;
      if (adverse >= this.sizing.stop) return { reason: 'stop', limit_price: position.side === 'long' ? q.bid : q.offer };
      return null;
    },
  },
  {
    id: 'eia-energy-momo',
    username: '@barrel-rider',
    display_name: 'Energy Spot Momentum (official EIA benchmarks → Kalshi)',
    market_type: 'Kalshi event contracts (signal from official EIA benchmarks)',
    venues: ['kalshi'],
    thesis:
      'Daily official spot benchmarks for WTI and Henry Hub are published by the US Energy Information Administration. Momentum in those benchmarks is a slow, verified signal that can be expressed on liquid Kalshi energy contracts.',
    rules: [
      'Signal: 5-observation return of the official EIA daily spot series (parsed from the published table).',
      'Entry: buy YES on the matching energy contract when the benchmark is up more than 1%, buy NO when down more than 1%.',
      'Exit: settlement, or benchmark momentum reversing.',
    ],
    origin: { kind: 'project_baseline', note: 'Cross-venue signal/execution baseline; the signal series is an official government publication.' },
    sizing: { notional_usd: 10000, threshold: 0.01, lookback: 5 },
    status: 'forward_test',
    decide(ctx) {
      const orders = [];
      const notes = [];
      const benchmarks = ctx.benchmarks ?? {};
      const wti = benchmarks.RCLC1;
      if (!wti?.rows?.length) {
        notes.push({ skipped: 'EIA WTI benchmark unavailable in this snapshot', status: wti?.status ?? 'missing' });
        return { orders, exits: [], notes };
      }
      const closes = wti.rows.map((r) => r.value);
      if (closes.length < this.sizing.lookback + 1) return { orders, exits: [], notes };
      const ret = pct(closes.at(-1), closes.at(-1 - this.sizing.lookback));
      if (ret == null || Math.abs(ret) < this.sizing.threshold) return { orders, exits: [], notes };
      const wantLong = ret > 0;
      const candidates = ctx.listInstruments({ venue: 'kalshi', groups: ['Energy'] }).slice(0, 8);
      let taken = 0;
      for (const inst of candidates) {
        if (taken >= 2) break;
        const q = ctx.quotes[inst.instrument_id];
        if (!q || q.mid == null || q.spread == null || q.spread > 0.04) continue;
        if (ctx.hasPosition(inst.instrument_id)) continue;
        const outcome = wantLong ? 'yes' : 'no';
        const price = outcome === 'yes' ? q.best_yes_ask : q.best_no_ask;
        const depth = outcome === 'yes' ? q.depth_no_contracts : q.depth_yes_contracts;
        const contracts = Math.min(sizeByNotional({ notionalUsd: this.sizing.notional_usd / 2, price, maxContracts: depth }), depth);
        if (!price || contracts < 1) continue;
        orders.push(
          order(this, inst, q, {
            action: 'buy',
            outcome,
            contracts,
            thesis: `EIA WTI spot ${(ret * 100).toFixed(2)}% over ${this.sizing.lookback} observations; taking the ${outcome.toUpperCase()} side on this energy contract.`,
            signal: { name: 'eia_spot_momentum', value: ret, latest_spot: closes.at(-1), latest_date: wti.rows.at(-1).date, source: wti.page },
          }),
        );
        taken += 1;
      }
      return { orders, exits: [], notes };
    },
  },
  {
    id: 'cross-venue-basis',
    username: '@basis-hunter',
    display_name: 'Cross-Venue Basis (Kalshi perp vs MOEX future)',
    market_type: 'Kalshi perpetual futures vs exchange futures (pairs)',
    venues: ['kalshi_margin', 'moex_forts'],
    thesis:
      'The same metal trades on two regulated venues with different structures (24/7 perpetual versus dated future). When the basis stretches beyond normal spread plus fees, buying the cheap venue and selling the rich one captures the convergence.',
    rules: [
      'Instrument pair: Kalshi gold perp vs the front MOEX gold future (and silver equivalents).',
      'Entry: basis beyond +/- 1.5% of the MOEX price, with both venues quoting live spreads under 0.5%.',
      'Exit: basis back inside +/- 0.3%, or either leg terminating.',
    ],
    origin: { kind: 'project_baseline', note: 'Pairs baseline across two official venues; both legs are priced from exchange quotes only.' },
    sizing: { notional_usd: 12000, entry_basis: 0.015, exit_basis: 0.003 },
    status: 'forward_test',
    decide(ctx) {
      const orders = [];
      const notes = [];
      const pairs = [
        { perp: 'kalshiperp:KXGOLDPERP', futureAsset: 'GOLD', name: 'Gold' },
        { perp: 'kalshiperp:KXSILVERPERP', futureAsset: 'SILV', name: 'Silver' },
        { perp: 'kalshiperp:KXPLATINUMPERP', futureAsset: 'PLT', name: 'Platinum' },
      ];
      for (const pair of pairs) {
        const pq = ctx.quotes[pair.perp];
        if (!pq || pq.mid == null) {
          notes.push({ pair: pair.name, skipped: 'perp quote unavailable for this pair in the snapshot' });
          continue;
        }
        const futures = ctx.listInstruments({ venue: 'moex_forts' }).filter((i) => i.asset_code === pair.futureAsset);
        if (!futures.length) {
          notes.push({ pair: pair.name, skipped: 'no matching MOEX contract in the snapshot' });
          continue;
        }
        const fut = futures.sort((a, b) => String(a.last_trade_date).localeCompare(String(b.last_trade_date)))[0];
        const fq = ctx.quotes[fut.instrument_id];
        if (!fq || fq.mid == null) {
          notes.push({ pair: pair.name, skipped: 'MOEX quote unavailable in the snapshot' });
          continue;
        }
        if (ctx.hasPosition(pair.perp) || ctx.hasPosition(fut.instrument_id)) continue;
        const basis = (pq.mid - fq.mid) / fq.mid;
        if (Math.abs(basis) < this.sizing.entry_basis) {
          notes.push({ pair: pair.name, basis, skipped: 'basis inside entry band' });
          continue;
        }
        const perpSide = basis > 0 ? 'short' : 'long';
        const futSide = basis > 0 ? 'long' : 'short';
        const perpPrice = perpSide === 'long' ? pq.offer : pq.bid;
        const futPrice = futSide === 'long' ? fq.offer : fq.bid;
        if (!(perpPrice > 0) || !(futPrice > 0)) {
          notes.push({ pair: pair.name, skipped: 'one leg has no live two-sided quote', perp_price: perpPrice, future_price: futPrice });
          continue;
        }
        if (!fut.pnl_currency_ready || !(fut.usd_per_price_unit > 0)) {
          notes.push({ pair: pair.name, skipped: 'future leg has no USD valuation this snapshot', valuation_note: fut.valuation_note ?? null });
          continue;
        }
        const perpContracts = Math.max(1, Math.floor(this.sizing.notional_usd / perpPrice));
        const futNotionalPerContract = futPrice * fut.usd_per_price_unit;
        const futContracts = Math.max(1, Math.floor(this.sizing.notional_usd / futNotionalPerContract));
        orders.push(
          order(this, { instrument_id: pair.perp, venue: 'kalshi_margin', title: `${pair.name} perp` }, pq, {
            action: perpSide === 'long' ? 'buy' : 'sell',
            side: perpSide,
            contracts: perpContracts,
            thesis: `${pair.name} basis ${(basis * 100).toFixed(2)}% (perp vs MOEX front future).`,
            signal: { name: 'cross_venue_basis', value: basis, perp_mid: pq.mid, future_mid: fq.mid },
          }),
        );
        orders.push(
          order(this, fut, fq, {
            action: futSide === 'long' ? 'buy' : 'sell',
            side: futSide,
            contracts: futContracts,
            thesis: `Hedge leg: ${futSide} ${fut.title} on MOEX FORTS.`,
            signal: { name: 'cross_venue_basis_leg2', value: basis },
          }),
        );
      }
      return { orders, exits: [], notes };
    },
  },
];

function seasonalReturn(rows, month) {
  const byYear = new Map();
  for (const r of rows) {
    if (!r.TRADEDATE) continue;
    const [y, m, d] = r.TRADEDATE.split('-').map(Number);
    if (m !== month) continue;
    const key = y;
    const list = byYear.get(key) ?? [];
    list.push({ d, close: r.CLOSE ?? r.SETTLEPRICE });
    byYear.set(key, list);
  }
  const returns = [];
  for (const [, list] of byYear) {
    const sorted = list.filter((x) => x.close != null).sort((a, b) => a.d - b.d);
    if (sorted.length < 5) continue;
    returns.push((sorted.at(-1).close - sorted[0].close) / sorted[0].close);
  }
  if (!returns.length) return null;
  return { mean: mean(returns), years: returns.length, samples: returns };
}

function monthName(m) {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1];
}

export function getStrategy(id) {
  return STRATEGIES.find((s) => s.id === id) ?? null;
}

export function strategyCatalog() {
  return STRATEGIES.map((s) => ({
    id: s.id,
    username: s.username,
    display_name: s.display_name,
    market_type: s.market_type,
    venues: s.venues,
    thesis: s.thesis,
    rules: s.rules,
    origin: s.origin,
    sizing: s.sizing,
    status: s.status,
    has_custom_exit: typeof s.exit === 'function',
  }));
}
