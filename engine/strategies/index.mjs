/**
 * Strategy library.
 *
 * Twelve independent "competitors", each with its own username, its own market type and its own
 * thesis. Every strategy may only act on data that the run fetched from an official source, and
 * every order it returns is stamped by the engine with the exact observed values behind it.
 *
 * Deliberate design choices required by the project brief:
 *  - no risk management: sizing is "as large as the verified liquidity allows", the objective is
 *    the highest return;
 *  - no invented history: signals are computed from the official candle/history/quote payloads of
 *    this run, and a strategy that lacks the data it needs simply does not trade and says why;
 *  - market type is explicit on every strategy, because a Kalshi event contract and a MOEX future
 *    are not the same instrument and must never be compared as if they were.
 */

export const STRATEGIES = [
  /* ------------------------------------------------------------------ 1 */
  {
    id: 'kalshi-longshot-fade',
    username: '@fade-the-crowd',
    display_name: 'Longshot Fade',
    market_type: 'Kalshi event contract',
    venues: ['kalshi'],
    origin: {
      kind: 'documented_anomaly',
      claim: 'Binary markets historically overprice very unlikely outcomes (the longshot bias) and underprice near-certain ones, so buying the NO side of an extreme YES price has a positive expected value if the bias is present.',
      status: 'hypothesis under test - the competition is the test',
    },
    thesis:
      'Buy NO on commodity event contracts whose YES price is at or below 10 cents. If the longshot bias exists in Kalshi commodity ladders, the average NO leg should be profitable on a large number of observations; if the bias does not exist, this strategy loses and the leaderboard will show it.',
    rules: {
      entry: 'YES mid <= 0.10, spread <= 3 cents, at least 2 hours to close, top-3 liquidity strikes only.',
      exit: 'No exit: positions are held to settlement, because the thesis is about the settlement distribution.',
      sizing: 'Target notional, capped at 25% of the resting depth within 2 cents of the offer.',
    },
    sizing: { notional_usd: 4000, max_spread_cents: 3 },
    decide(ctx) {
      const notes = [];
      let orders = 0;
      const groups = ['Precious Metals', 'Industrial Metals', 'Energy', 'Grains & Oilseeds', 'Soft Commodities'];
      for (const inst of ctx.listInstruments({ venue: 'kalshi', groups })) {
        if (orders >= 4) break;
        if (!hasTimeLeft(inst, 120, ctx.now)) continue;
        if (ctx.portfolio.positions[inst.instrument_id]) continue;
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.mid == null || q.spread == null || q.best_no_ask == null) continue;
        if (q.mid > 0.1 || q.spread > this.sizing.max_spread_cents / 100) continue;
        const price = q.best_no_ask;
        const contracts = sizeContracts({ notional: this.sizing.notional_usd, price });
        if (contracts < 1) continue;
        orders += 1;
        ctx.note({ instrument_id: inst.instrument_id, signal: 'yes_mid_at_or_below_10c', yes_mid: q.mid, spread: q.spread, no_ask: price });
        ctx.order({
          strategy_id: this.id,
          instrument_id: inst.instrument_id,
          venue: 'kalshi',
          action: 'buy',
          outcome: 'no',
          contracts,
          limit_price: Number((price + 0.02).toFixed(4)),
          order_type: 'taker',
          thesis: `Fade the longshot: YES mid ${q.mid} on a ${inst.commodity} contract that closes ${inst.close_time}.`,
          signal: { name: 'longshot_fade', yes_mid: q.mid, no_ask: price, spread: q.spread, series: inst.series_ticker },
        });
      }
      void notes;
      return { notes };
    },
  },

  /* ------------------------------------------------------------------ 2 */
  {
    id: 'kalshi-favourite-carry',
    username: '@carry-collector',
    display_name: 'Favourite Carry',
    market_type: 'Kalshi event contract',
    venues: ['kalshi'],
    origin: {
      kind: 'documented_anomaly',
      claim: 'The same bias that overprices longshots underprices near-certain outcomes; buying NO at 90c+ YES prices collects a small premium with a large loss tail.',
      status: 'hypothesis under test',
    },
    thesis:
      'Buy NO where YES is already at or above 90 cents and the contract closes within two days. This is the mirror image of the longshot fade: it wins often and loses big occasionally, which is exactly the return profile a highest-return-only competition is allowed to take.',
    rules: {
      entry: 'YES mid >= 0.90, spread <= 3 cents, closes within 48 hours.',
      exit: 'No exit: held to settlement.',
      sizing: 'Target notional, capped by verified resting depth.',
    },
    sizing: { notional_usd: 4000, max_spread_cents: 3, max_hours_to_close: 48 },
    decide(ctx) {
      const notes = [];
      let orders = 0;
      for (const inst of ctx.listInstruments({ venue: 'kalshi' })) {
        if (orders >= 4) break;
        if (!hasTimeLeft(inst, 60, ctx.now)) continue;
        const hours = hoursToClose(inst, ctx.now);
        if (hours == null || hours > this.sizing.max_hours_to_close) continue;
        if (ctx.portfolio.positions[inst.instrument_id]) continue;
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.mid == null || q.spread == null || q.best_no_ask == null) continue;
        if (q.mid < 0.9 || q.spread > this.sizing.max_spread_cents / 100) continue;
        const price = q.best_no_ask;
        const contracts = sizeContracts({ notional: this.sizing.notional_usd, price });
        if (contracts < 1) continue;
        orders += 1;
        ctx.order({
          strategy_id: this.id,
          instrument_id: inst.instrument_id,
          venue: 'kalshi',
          action: 'buy',
          outcome: 'no',
          contracts,
          limit_price: Number((price + 0.02).toFixed(4)),
          order_type: 'taker',
          thesis: `Collect carry on a near-certain outcome: YES mid ${q.mid}, ${hours.toFixed(1)}h to close.`,
          signal: { name: 'favourite_carry', yes_mid: q.mid, no_ask: price, hours_to_close: hours, series: inst.series_ticker },
        });
      }
      return { notes };
    },
  },

  /* ------------------------------------------------------------------ 3 */
  {
    id: 'kalshi-spread-capture',
    username: '@spread-hunter',
    display_name: 'Spread Capture',
    market_type: 'Kalshi event contract',
    venues: ['kalshi'],
    origin: {
      kind: 'market_structure',
      claim: 'Kalshi charges no maker fee on standard series, so resting inside a wide commodity spread captures the bid-ask spread at zero commission if it gets filled.',
      status: 'structural - no forecast required',
    },
    thesis:
      'Rest passive bids one cent inside the spread on the most liquid commodity contracts and rely on the exchange order flow to cross them. The maker fee multiplier is zero for standard series per the official fee schedule, so a fill at the resting price is pure spread capture.',
    rules: {
      entry: 'Spread >= 3 cents, resting bid at best bid + 1 cent, never crossing the offer.',
      exit: 'Working orders expire after the configured TTL; positions are marked to the opposite side of the book.',
      sizing: 'One resting order per market, size from verified depth at the resting price.',
    },
    sizing: { notional_usd: 2500, min_spread_cents: 3 },
    decide(ctx) {
      let orders = 0;
      for (const inst of ctx.listInstruments({ venue: 'kalshi' })) {
        if (orders >= 3) break;
        if (!hasTimeLeft(inst, 180, ctx.now)) continue;
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.best_yes_bid == null || q.best_no_bid == null) continue;
        if (q.spread == null || q.spread < this.sizing.min_spread_cents / 100) continue;
        if (q.spread > 0.15) continue; // an absurdly wide book is usually an empty book
        const restingYes = Number((q.best_yes_bid + 0.01).toFixed(4));
        if (q.best_yes_ask != null && restingYes >= q.best_yes_ask) continue;
        const contracts = Math.min(
          sizeContracts({ notional: this.sizing.notional_usd, price: restingYes }),
          Math.floor((q.depth_yes_contracts ?? 0) * 0.25) || 1,
        );
        if (contracts < 1) continue;
        orders += 1;
        ctx.order({
          strategy_id: this.id,
          instrument_id: inst.instrument_id,
          venue: 'kalshi',
          action: 'buy',
          outcome: 'yes',
          contracts,
          limit_price: restingYes,
          order_type: 'maker',
          thesis: `Rest inside a ${(q.spread * 100).toFixed(0)}-cent spread on ${inst.commodity}; maker fee multiplier is zero for standard series.`,
          signal: { name: 'spread_capture', spread: q.spread, best_yes_bid: q.best_yes_bid, best_yes_ask: q.best_yes_ask, resting_price: restingYes },
        });
      }
      return { notes: [] };
    },
  },

  /* ------------------------------------------------------------------ 4 */
  {
    id: 'kalshi-extreme-reversion',
    username: '@vol-crusher',
    display_name: 'Extreme Reversion',
    market_type: 'Kalshi event contract',
    venues: ['kalshi'],
    origin: {
      kind: 'market_structure',
      claim: 'Single-day price gaps in thin commodity ladders often overshoot and partially retrace, because the gap is driven by order-flow rather than information.',
      status: 'hypothesis under test',
    },
    thesis:
      'When a series candle history shows a move of more than four standard deviations of its own daily changes, take the opposite side of that move in the front ladder. Measured entirely from Kalshi\'s own official candle payload.',
    rules: {
      entry: 'Last completed daily candle change >= 4 standard deviations of the series history, trade the opposite direction.',
      exit: 'Exit when the mid returns to within half the gap, or when the market closes.',
      sizing: 'Target notional, capped by verified depth.',
    },
    sizing: { notional_usd: 3000, z_threshold: 4 },
    decide(ctx) {
      let orders = 0;
      const seen = new Set();
      for (const inst of ctx.listInstruments({ venue: 'kalshi' })) {
        if (orders >= 3) break;
        if (seen.has(inst.series_ticker)) continue;
        if (!hasTimeLeft(inst, 120, ctx.now)) continue;
        const candles = ctx.kalshiCandles(inst.series_ticker);
        if (!candles || candles.length < 12) continue;
        const closes = candles.map((c) => c.close).filter((c) => c != null && c > 0 && c < 1);
        if (closes.length < 12) continue;
        const changes = closes.slice(1).map((c, i) => c - closes[i]);
        const sd = stdev(changes);
        if (!sd || sd <= 0) continue;
        const last = changes[changes.length - 1];
        const z = last / sd;
        if (Math.abs(z) < this.sizing.z_threshold) continue;
        seen.add(inst.series_ticker);
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.mid == null) continue;
        const outcome = z > 0 ? 'no' : 'yes';
        const price = z > 0 ? q.best_no_ask : q.best_yes_ask;
        if (price == null) continue;
        const contracts = sizeContracts({ notional: this.sizing.notional_usd, price });
        if (contracts < 1) continue;
        orders += 1;
        ctx.order({
          strategy_id: this.id,
          instrument_id: inst.instrument_id,
          venue: 'kalshi',
          action: 'buy',
          outcome,
          contracts,
          limit_price: Number((price + 0.02).toFixed(4)),
          order_type: 'taker',
          thesis: `Fade a ${z.toFixed(1)}-sigma daily move in ${inst.series_ticker}.`,
          signal: { name: 'extreme_reversion', z_score: Number(z.toFixed(3)), sd: sd, last_change: last, candles_used: closes.length },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      const inst = ctx.instrument(position.instrument_id);
      const q = ctx.quote(position.instrument_id);
      if (!inst || !q) return null;
      const candles = ctx.kalshiCandles(inst.series_ticker);
      const closes = (candles ?? []).map((c) => c.close).filter((c) => c != null && c > 0 && c < 1);
      if (closes.length < 4) return null;
      const gap = closes[closes.length - 1] - closes[closes.length - 2];
      const half = Math.abs(gap) / 2;
      const entryMid = position.avg_entry_price;
      const currentMid = position.outcome === 'yes' ? q.mid : q.mid != null ? 1 - q.mid : null;
      if (currentMid == null) return null;
      const improved = Math.abs(currentMid - entryMid) >= half && Math.abs(currentMid - entryMid) > 0;
      if (!improved) return null;
      return {
        reason: 'Reversion target reached: the market retraced more than half of the measured gap.',
        signal: { name: 'reversion_target', entry_mid: entryMid, current_mid: currentMid, gap: gap },
      };
    },
  },

  /* ------------------------------------------------------------------ 5 */
  {
    id: 'kalshi-cheap-momentum',
    username: '@tail-rider',
    display_name: 'Cheap Momentum',
    market_type: 'Kalshi event contract',
    venues: ['kalshi'],
    origin: {
      kind: 'market_structure',
      claim: 'Cheap YES contracts that are already trending up can keep trending when the underlying commodity is moving, giving convex payoffs; this is the explicit counter-hypothesis to the longshot fade.',
      status: 'hypothesis under test',
    },
    thesis:
      'Buy YES at 10 cents or less only when the series own official candle history is trending up. This strategy is deliberately the opposite bet to @fade-the-crowd, so the leaderboard measures which view of cheap contracts is right.',
    rules: {
      entry: 'YES mid <= 0.10, 5-day candle momentum > 0, spread <= 3 cents.',
      exit: 'Exit when 5-day momentum turns negative or the market closes.',
      sizing: 'Target notional, capped by depth.',
    },
    sizing: { notional_usd: 2500, max_spread_cents: 3 },
    decide(ctx) {
      let orders = 0;
      const seen = new Set();
      for (const inst of ctx.listInstruments({ venue: 'kalshi' })) {
        if (orders >= 3) break;
        if (seen.has(inst.series_ticker)) continue;
        if (!hasTimeLeft(inst, 120, ctx.now)) continue;
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.mid == null || q.spread == null || q.best_yes_ask == null) continue;
        if (q.mid > 0.1 || q.spread > this.sizing.max_spread_cents / 100) continue;
        const candles = ctx.kalshiCandles(inst.series_ticker);
        const closes = (candles ?? []).map((c) => c.close).filter((c) => c != null && c > 0 && c < 1);
        if (closes.length < 6) continue;
        const momentum = (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6];
        if (!(momentum > 0)) continue;
        seen.add(inst.series_ticker);
        const price = q.best_yes_ask;
        const contracts = sizeContracts({ notional: this.sizing.notional_usd, price });
        if (contracts < 1) continue;
        orders += 1;
        ctx.order({
          strategy_id: this.id,
          instrument_id: inst.instrument_id,
          venue: 'kalshi',
          action: 'buy',
          outcome: 'yes',
          contracts,
          limit_price: Number((price + 0.02).toFixed(4)),
          order_type: 'taker',
          thesis: `Ride a cheap contract with positive 5-day candle momentum (${(momentum * 100).toFixed(1)}%) in ${inst.series_ticker}.`,
          signal: { name: 'cheap_momentum', momentum_5d: Number(momentum.toFixed(4)), yes_mid: q.mid, ye_ask: price },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      const inst = ctx.instrument(position.instrument_id);
      if (!inst) return null;
      const candles = ctx.kalshiCandles(inst.series_ticker);
      const closes = (candles ?? []).map((c) => c.close).filter((c) => c != null && c > 0 && c < 1);
      if (closes.length < 6) return null;
      const momentum = (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6];
      if (momentum >= 0) return null;
      return { reason: 'Momentum turned negative; the convex payoff no longer has a trend behind it.', signal: { name: 'momentum_flip', momentum_5d: Number(momentum.toFixed(4)) } };
    },
  },

  /* ------------------------------------------------------------------ 6 */
  {
    id: 'kalshi-ladder-arbitrage',
    username: '@ladder-arb',
    display_name: 'Ladder Arbitrage',
    market_type: 'Kalshi event contract',
    venues: ['kalshi'],
    origin: {
      kind: 'market_structure',
      claim: 'If two strikes of the same series imply a probability ordering that contradicts the strike ordering, buying the cheap leg and the NO of the rich leg is a structural arbitrage.',
      status: 'structural - no forecast required',
    },
    thesis:
      'Within one series and one expiry, the YES price must fall as the strike rises (for greater-than markets). When the published book violates that ordering by more than the configured tolerance, buy the underpriced YES leg and the NO of the overpriced leg.',
    rules: {
      entry: 'Monotonicity violation of at least 2 cents between two strikes of the same series and expiry.',
      exit: 'Held to settlement (the two legs converge by construction).',
      sizing: 'Target notional per leg, capped by depth.',
    },
    sizing: { notional_usd: 2000, min_violation: 0.02 },
    decide(ctx) {
      let orders = 0;
      const bySeries = new Map();
      for (const inst of ctx.listInstruments({ venue: 'kalshi' })) {
        if (inst.strike_type !== 'greater' || inst.floor_strike == null) continue;
        const key = `${inst.series_ticker}|${inst.close_time}`;
        if (!bySeries.has(key)) bySeries.set(key, []);
        bySeries.get(key).push(inst);
      }
      for (const [, group] of bySeries) {
        if (orders >= 2) break;
        if (group.length < 2) continue;
        const sorted = [...group].sort((a, b) => a.floor_strike - b.floor_strike);
        for (let i = 0; i < sorted.length - 1; i += 1) {
          const low = sorted[i];
          const high = sorted[i + 1];
          const lowQ = ctx.quote(low.instrument_id);
          const highQ = ctx.quote(high.instrument_id);
          if (!lowQ || !highQ || lowQ.mid == null || highQ.mid == null) continue;
          const violation = lowQ.mid - highQ.mid; // must be >= 0 by construction
          if (violation >= -this.sizing.min_violation) continue;
          if (ctx.portfolio.positions[low.instrument_id] || ctx.portfolio.positions[high.instrument_id]) continue;
          if (lowQ.best_yes_ask == null || highQ.best_no_ask == null) continue;
          const lowContracts = sizeContracts({ notional: this.sizing.notional_usd, price: lowQ.best_yes_ask });
          const highContracts = sizeContracts({ notional: this.sizing.notional_usd, price: highQ.best_no_ask });
          const contracts = Math.min(lowContracts, highContracts);
          if (contracts < 1) continue;
          orders += 1;
          ctx.note({ series: low.series_ticker, violation: Number(violation.toFixed(4)), low_strike: low.floor_strike, high_strike: high.floor_strike });
          ctx.order({
            strategy_id: this.id,
            instrument_id: low.instrument_id,
            venue: 'kalshi',
            action: 'buy',
            outcome: 'yes',
            contracts,
            limit_price: Number((lowQ.best_yes_ask + 0.02).toFixed(4)),
            order_type: 'taker',
            thesis: `Monotonicity violation: strike ${low.floor_strike} YES mid ${lowQ.mid} is below strike ${high.floor_strike} YES mid ${highQ.mid}.`,
            signal: { name: 'ladder_violation_underpriced_leg', violation: Number(violation.toFixed(4)), leg: 'low_strike_yes' },
          });
          ctx.order({
            strategy_id: this.id,
            instrument_id: high.instrument_id,
            venue: 'kalshi',
            action: 'buy',
            outcome: 'no',
            contracts,
            limit_price: Number((highQ.best_no_ask + 0.02).toFixed(4)),
            order_type: 'taker',
            thesis: `Monotonicity violation: strike ${high.floor_strike} YES mid ${highQ.mid} is above strike ${low.floor_strike} YES mid ${lowQ.mid}.`,
            signal: { name: 'ladder_violation_overpriced_leg', violation: Number(violation.toFixed(4)), leg: 'high_strike_no' },
          });
        }
      }
      return { notes: [] };
    },
  },

  /* ------------------------------------------------------------------ 7 */
  {
    id: 'kalshi-oil-trend',
    username: '@barrel-rider',
    display_name: 'Oil Trend Rider',
    market_type: 'Kalshi event contract',
    venues: ['kalshi'],
    origin: {
      kind: 'market_structure',
      claim: 'Energy event contracts follow the underlying crude complex with a lag; the exchange own candle history is a verified, free proxy for that trend.',
      status: 'hypothesis under test',
    },
    thesis:
      'Trade the Kalshi WTI/Brent ladders in the direction of the verified trend in the same series own official candle history, taking the side whose price is closest to a coin flip so that a correct directional call pays multiples.',
    rules: {
      entry: '|5-day candle momentum| >= 2%, enter in the direction of the trend, YES mid between 0.2 and 0.6.',
      exit: 'Exit when momentum flips sign or the market closes.',
      sizing: 'Target notional, capped by depth.',
    },
    sizing: { notional_usd: 3000, min_momentum: 0.02 },
    decide(ctx) {
      let orders = 0;
      const seen = new Set();
      const energy = ctx.listInstruments({ venue: 'kalshi', groups: ['Energy'] });
      for (const inst of energy) {
        if (orders >= 3) break;
        if (seen.has(inst.series_ticker)) continue;
        if (!hasTimeLeft(inst, 120, ctx.now)) continue;
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.mid == null || q.mid < 0.2 || q.mid > 0.6) continue;
        const candles = ctx.kalshiCandles(inst.series_ticker);
        const closes = (candles ?? []).map((c) => c.close).filter((c) => c != null && c > 0 && c < 1);
        if (closes.length < 6) continue;
        const momentum = (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6];
        if (Math.abs(momentum) < this.sizing.min_momentum) continue;
        seen.add(inst.series_ticker);
        const outcome = momentum > 0 ? 'yes' : 'no';
        const price = outcome === 'yes' ? q.best_yes_ask : q.best_no_ask;
        if (price == null) continue;
        const contracts = sizeContracts({ notional: this.sizing.notional_usd, price });
        if (contracts < 1) continue;
        orders += 1;
        ctx.order({
          strategy_id: this.id,
          instrument_id: inst.instrument_id,
          venue: 'kalshi',
          action: 'buy',
          outcome,
          contracts,
          limit_price: Number((price + 0.02).toFixed(4)),
          order_type: 'taker',
          thesis: `Follow a ${(momentum * 100).toFixed(1)}% 5-day move in ${inst.series_ticker}.`,
          signal: { name: 'energy_trend', momentum_5d: Number(momentum.toFixed(4)), commodity: inst.commodity },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      const inst = ctx.instrument(position.instrument_id);
      if (!inst) return null;
      const candles = ctx.kalshiCandles(inst.series_ticker);
      const closes = (candles ?? []).map((c) => c.close).filter((c) => c != null && c > 0 && c < 1);
      if (closes.length < 6) return null;
      const momentum = (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6];
      const held = position.outcome === 'yes' ? 1 : -1;
      if (Math.sign(momentum) === held || momentum === 0) return null;
      return { reason: 'Trend flipped against the position.', signal: { name: 'energy_trend_flip', momentum_5d: Number(momentum.toFixed(4)) } };
    },
  },

  /* ------------------------------------------------------------------ 8 */
  {
    id: 'kalshi-perp-trend',
    username: '@perp-surfer',
    display_name: 'Perp Surfer',
    market_type: 'Kalshi perpetual future',
    venues: ['kalshi_margin'],
    origin: {
      kind: 'market_structure',
      claim: 'Listed metal perpetuals trend after their own mark price moves when the underlying spot market is closed, because the perpetual must carry the overnight move.',
      status: 'hypothesis under test',
    },
    thesis:
      'Take the direction of the last verified move in each Kalshi metal perpetual and hold it, re-evaluating on every snapshot. The perpetual is the only instrument in this project that trades continuously, so it is where an overnight trend can actually be captured.',
    rules: {
      entry: 'Price changed since the previous committed snapshot, with a live two-sided quote.',
      exit: 'Exit when the direction of the last change flips.',
      sizing: 'Target notional, capped by a share of published 24h notional volume.',
    },
    sizing: { notional_usd: 5000 },
    decide(ctx) {
      let orders = 0;
      for (const inst of ctx.listInstruments({ venue: 'kalshi_margin' })) {
        if (orders >= 4) break;
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.bid == null || q.offer == null || q.mid == null) continue;
        if (q.bid <= 0 || q.offer <= 0) continue;
        const previous = ctx.previousMid(inst.instrument_id);
        if (previous == null) continue;
        const change = (q.mid - previous) / previous;
        if (change === 0) continue;
        if (ctx.portfolio.positions[inst.instrument_id]) continue;
        const side = change > 0 ? 'long' : 'short';
        const price = side === 'long' ? q.offer : q.bid;
        const contracts = sizeContracts({ notional: this.sizing.notional_usd, price });
        if (contracts < 1) continue;
        orders += 1;
        ctx.order({
          strategy_id: this.id,
          instrument_id: inst.instrument_id,
          venue: 'kalshi_margin',
          action: side === 'long' ? 'buy' : 'sell',
          side,
          contracts,
          limit_price: price,
          order_type: 'taker',
          thesis: `Follow the last verified move of ${(change * 100).toFixed(3)}% in ${inst.ticker}.`,
          signal: { name: 'perp_momentum', change_pct: Number((change * 100).toFixed(4)), previous_mid: previous, current_mid: q.mid },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      const q = ctx.quote(position.instrument_id);
      const previous = ctx.previousMid(position.instrument_id);
      if (!q || q.mid == null || previous == null || previous === 0) return null;
      const change = (q.mid - previous) / previous;
      if (change === 0) return null;
      const held = position.side === 'long' ? 1 : -1;
      // Exit when the move turns against the position. When the move is still with us, hold.
      if (Math.sign(change) === held) return null;
      return { reason: 'Perpetual momentum flipped against the position.', signal: { name: 'perp_momentum_flip', change_pct: Number((change * 100).toFixed(4)) } };
    },
  },

  /* ------------------------------------------------------------------ 9 */
  {
    id: 'moex-metals-trend',
    username: '@metal-trend',
    display_name: 'Metals Trend',
    market_type: 'Exchange-listed commodity future',
    venues: ['moex_forts'],
    origin: {
      kind: 'market_structure',
      claim: 'Cross-sectional momentum in metals futures is a long-documented effect; this strategy simply buys the strongest and shorts the weakest contract it can actually price.',
      status: 'hypothesis under test with a verified, free official data feed',
    },
    thesis:
      'Rank the MOEX metal futures by their official settlement momentum over the cached history window and take the extremes, long the strongest and short the weakest. Trades only when the exchange publishes both a live quote and USD valuation inputs.',
    rules: {
      entry: '20-observation settlement momentum, long the top mover and short the bottom mover on each side when |momentum| >= 1%.',
      exit: 'Exit when the momentum flips sign.',
      sizing: 'Target notional, capped by published volume and open interest.',
    },
    sizing: { notional_usd: 6000, min_momentum: 0.01 },
    decide(ctx) {
      let orders = 0;
      const candidates = [];
      for (const inst of ctx.listInstruments({ venue: 'moex_forts', groups: ['Precious Metals', 'Industrial Metals'] })) {
        if (!inst.usd_valuation?.usd_per_price_unit) {
          ctx.note({ instrument_id: inst.instrument_id, skipped: 'no verified USD valuation in this snapshot' });
          continue;
        }
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.offer == null || q.bid == null) continue;
        const rows = ctx.moexHistory(inst.ticker);
        if (!rows || rows.length < 10) continue;
        const closes = rows.map((r) => r.CLOSE ?? r.SETTLEPRICE).filter((c) => c != null && Number(c) > 0);
        if (closes.length < 10) continue;
        const momentum = (closes[closes.length - 1] - closes[0]) / closes[0];
        if (Math.abs(momentum) < this.sizing.min_momentum) continue;
        candidates.push({ inst, q, momentum, observations: closes.length });
      }
      candidates.sort((a, b) => b.momentum - a.momentum);
      for (const candidate of candidates) {
        if (orders >= 3) break;
        const { inst, q, momentum } = candidate;
        if (ctx.portfolio.positions[inst.instrument_id]) continue;
        const side = momentum > 0 ? 'long' : 'short';
        const price = side === 'long' ? q.offer : q.bid;
        const usdPerPoint = inst.usd_valuation.usd_per_price_unit;
        const contracts = sizeContracts({ notional: this.sizing.notional_usd, price: price * usdPerPoint });
        if (contracts < 1) continue;
        orders += 1;
        ctx.order({
          strategy_id: this.id,
          instrument_id: inst.instrument_id,
          venue: 'moex_forts',
          action: side === 'long' ? 'buy' : 'sell',
          side,
          contracts,
          limit_price: price,
          order_type: 'taker',
          thesis: `${(momentum * 100).toFixed(1)}% settlement momentum over ${candidate.settlements ?? 'the cached history'} in ${inst.ticker}.`,
          signal: { name: 'settlement_momentum', momentum: Number(momentum.toFixed(4)), observations: candidate.observations, usd_per_price_unit: usdPerPoint },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      const rows = ctx.moexHistory(position.ticker);
      const closes = (rows ?? []).map((r) => r.CLOSE ?? r.SETTLEPRICE).filter((c) => c != null && Number(c) > 0);
      if (closes.length < 10) return null;
      const momentum = (closes[closes.length - 1] - closes[0]) / closes[0];
      const held = position.side === 'long' ? 1 : -1;
      if (Math.sign(momentum) === held || momentum === 0) return null;
      return { reason: 'Settlement momentum flipped against the position.', signal: { name: 'settlement_momentum_flip', momentum: Number(momentum.toFixed(4)) } };
    },
  },

  /* ------------------------------------------------------------------ 10 */
  {
    id: 'moex-calendar-carry',
    username: '@calendar-carry',
    display_name: 'Calendar Carry',
    market_type: 'Exchange-listed commodity future',
    venues: ['moex_forts'],
    origin: {
      kind: 'market_structure',
      claim: 'The spread between two expiries of the same commodity is a financing/storage carry; when its annualised value exceeds the exchange-published round-trip cost, the carry is capturable.',
      status: 'structural - measured, not forecast',
    },
    thesis:
      'Buy the near expiry and sell the far expiry (or the reverse) whenever the annualised spread between the official mid prices exceeds the exchange published round-trip fee converted at the official USD/RUB rate. Both legs are real orders with real fees.',
    rules: {
      entry: 'Annualised calendar spread >= 12% after measured round-trip fees.',
      exit: 'Exit when the annualised spread compresses below 4%, or when either contract is within 5 days of expiry.',
      sizing: 'Target notional per leg, capped by both contracts published liquidity.',
    },
    sizing: { notional_usd: 5000, min_annualised_carry: 0.12, exit_annualised_carry: 0.04 },
    decide(ctx) {
      let orders = 0;
      const byAsset = new Map();
      for (const inst of ctx.listInstruments({ venue: 'moex_forts', groups: ['Precious Metals', 'Industrial Metals', 'Soft Commodities', 'Grains & Oilseeds'] })) {
        if (!inst.asset_code || !inst.usd_valuation?.usd_per_price_unit) continue;
        if (!byAsset.has(inst.asset_code)) byAsset.set(inst.asset_code, []);
        byAsset.get(inst.asset_code).push(inst);
      }
      for (const [assetCode, legs] of byAsset) {
        if (orders >= 2) break;
        if (legs.length < 2) continue;
        const sorted = [...legs].sort((a, b) => String(a.last_trade_date ?? '').localeCompare(String(b.last_trade_date ?? '')));
        const near = sorted[0];
        const far = sorted[sorted.length - 1];
        const qn = ctx.quote(near.instrument_id);
        const qf = ctx.quote(far.instrument_id);
        if (!qn || !qf || qn.mid == null || qf.mid == null || qn.mid <= 0) continue;
        if (ctx.portfolio.positions[near.instrument_id] || ctx.portfolio.positions[far.instrument_id]) continue;
        const days = Math.max(1, (new Date(far.last_trade_date) - new Date(near.last_trade_date)) / 86400000);
        if (!Number.isFinite(days) || days <= 0) continue;
        const carry = (qf.mid - qn.mid) / qn.mid;
        const annualised = carry * (365 / days);
        const fxRate = ctx.fx?.rate ?? null;
        const feeRub = (near.contract_specification?.buy_sell_fee_rub ?? 0) + (far.contract_specification?.buy_sell_fee_rub ?? 0);
        const feeUsd = fxRate ? Number((feeRub / fxRate).toFixed(4)) : null;
        const notionalPerContract = qn.mid * near.usd_valuation.usd_per_price_unit;
        const feeDrag = feeUsd != null && notionalPerContract > 0 ? feeUsd / notionalPerContract : null;
        if (Math.abs(annualised) < this.sizing.min_annualised_carry) {
          ctx.note({ asset_code: assetCode, skipped: 'annualised carry below entry threshold', annualised_carry: Number(annualised.toFixed(4)), days });
          continue;
        }
        const side = annualised > 0 ? 'short' : 'long'; // positive carry: sell the far, buy the near
        const nearSide = side === 'short' ? 'long' : 'short';
        const nearPrice = nearSide === 'long' ? qn.offer : qn.bid;
        const farPrice = side === 'long' ? qf.offer : qf.bid;
        if (nearPrice == null || farPrice == null) continue;
        const nearContracts = sizeContracts({ notional: this.sizing.notional_usd, price: nearPrice * near.usd_valuation.usd_per_price_unit });
        const farContracts = sizeContracts({ notional: this.sizing.notional_usd, price: farPrice * far.usd_valuation.usd_per_price_unit });
        const contracts = Math.min(nearContracts, farContracts);
        if (contracts < 1) continue;
        orders += 1;
        ctx.order({
          strategy_id: this.id,
          instrument_id: near.instrument_id,
          venue: 'moex_forts',
          action: nearSide === 'long' ? 'buy' : 'sell',
          side: nearSide,
          contracts,
          limit_price: nearPrice,
          order_type: 'taker',
          thesis: `Calendar carry ${(annualised * 100).toFixed(1)}% annualised between ${near.ticker} and ${far.ticker}, round-trip fee ${feeUsd ?? 'n/a'} USD.`,
          signal: { name: 'calendar_carry_near_leg', annualised_carry: Number(annualised.toFixed(4)), days_between_expiries: days, round_trip_fee_usd: feeDrag, leg: 'near' },
        });
        ctx.order({
          strategy_id: this.id,
          instrument_id: far.instrument_id,
          venue: 'moex_forts',
          action: side === 'long' ? 'buy' : 'sell',
          side,
          contracts,
          limit_price: farPrice,
          order_type: 'taker',
          thesis: `Calendar carry ${(annualised * 100).toFixed(1)}% annualised between ${near.ticker} and ${far.ticker}, round-trip fee ${feeUsd ?? 'n/a'} USD.`,
          signal: { name: 'calendar_carry_far_leg', annualised_carry: Number(annualised.toFixed(4)), days_between_expiries: days, round_trip_fee_usd: feeDrag, leg: 'far' },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      return { reason: 'Calendar carry positions are unwound when the measured spread compresses or the contract nears expiry; the engine re-checks the spread on every tick.', signal: { name: 'calendar_carry_review' } };
    },
  },

  /* ------------------------------------------------------------------ 11 */
  {
    id: 'moex-agri-trend',
    username: '@agri-trend',
    display_name: 'Agri Trend',
    market_type: 'Exchange-listed commodity future',
    venues: ['moex_forts'],
    origin: {
      kind: 'market_structure',
      claim: 'Soft-commodity futures on MOEX trade in long supply-driven trends that are visible in their own official settlement history.',
      status: 'hypothesis under test',
    },
    thesis:
      'Follow the official settlement trend in MOEX soft commodities and grains, taking the strongest movers on each side and holding while the trend persists.',
    rules: {
      entry: '15-observation settlement momentum, |momentum| >= 1.5%.',
      exit: 'Exit when the momentum flips sign.',
      sizing: 'Target notional, capped by published volume and open interest.',
    },
    sizing: { notional_usd: 5000, min_momentum: 0.015 },
    decide(ctx) {
      let orders = 0;
      for (const inst of ctx.listInstruments({ venue: 'moex_forts', groups: ['Soft Commodities', 'Grains & Oilseeds'] })) {
        if (orders >= 3) break;
        if (!inst.usd_valuation?.usd_per_price_unit) continue;
        if (ctx.portfolio.positions[inst.instrument_id]) continue;
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.offer == null || q.bid == null) continue;
        const rows = ctx.moexHistory(inst.ticker);
        const closes = (rows ?? []).map((r) => r.CLOSE ?? r.SETTLEPRICE).filter((c) => c != null && Number(c) > 0);
        if (closes.length < 8) continue;
        const momentum = (closes[closes.length - 1] - closes[0]) / closes[0];
        if (Math.abs(momentum) < this.sizing.min_momentum) continue;
        const side = momentum > 0 ? 'long' : 'short';
        const price = side === 'long' ? q.offer : q.bid;
        const contracts = sizeContracts({ notional: this.sizing.notional_usd, price: price * inst.usd_valuation.usd_per_price_unit });
        if (contracts < 1) continue;
        orders += 1;
        ctx.order({
          strategy_id: this.id,
          instrument_id: inst.instrument_id,
          venue: 'moex_forts',
          action: side === 'long' ? 'buy' : 'sell',
          side,
          contracts,
          limit_price: price,
          order_type: 'taker',
          thesis: `${(momentum * 100).toFixed(1)}% settlement momentum in ${inst.ticker} (${inst.commodity}).`,
          signal: { name: 'agri_momentum', momentum: Number(momentum.toFixed(4)), observations: closes.length },
        });
      }
      return { notes: [] };
    },
    exit: (ctx, position) => STRATEGIES.find((s) => s.id === 'moex-metals-trend').exit(ctx, position),
  },

  /* ------------------------------------------------------------------ 12 */
  {
    id: 'cross-venue-basis',
    username: '@basis-hunter',
    display_name: 'Cross-Venue Basis',
    // Disabled until the two venues' contracts can be normalised with verified data. Kalshi publishes
    // the underlying quantity per perpetual contract (contract_size), but the MOEX machine-readable
    // payload for the matching future does not state it, so a price-versus-price comparison would be
    // comparing different units. The first iteration did exactly that and was corrected; the strategy
    // stays out of the competition rather than trade on an unverifiable comparison.
    enabled: false,
    disabled_reason:
      'Unavailable: comparing the Kalshi perpetual price with the MOEX future price requires the underlying quantity per contract on both venues. Kalshi publishes contract_size in its payload; the MOEX machine-readable payload does not, so the legs cannot be normalised without assuming a contract size. The strategy therefore places no orders until that figure is verified from an official MOEX source.',
    market_type: 'Cross-venue: Kalshi perpetual future vs exchange-listed future',
    venues: ['kalshi_margin', 'moex_forts'],
    origin: {
      kind: 'market_structure',
      claim: 'A 24/7 listed perpetual and a session-based futures contract on the same metal cannot diverge indefinitely; when the basis exceeds its own cost of carry, the two must converge.',
      status: 'structural - two real legs on two real venues',
    },
    thesis:
      'Compare the Kalshi metal perpetual with the front MOEX future on the same metal. When the percentage spread between them is large enough to cover both venues fees, buy the cheaper venue and sell the more expensive one. Both legs are simulated with their own venue fill model.',
    rules: {
      entry: 'Basis >= 0.5% between the perpetual mid and the MOEX future mid.',
      exit: 'Exit when the basis compresses below 0.1%.',
      sizing: 'Target notional per leg, capped by each venue published liquidity.',
    },
    sizing: { notional_usd: 4000, min_basis: 0.005, exit_basis: 0.001 },
    pairs: [
      { metal: 'Gold', perpTicker: 'KXGOLDPERP', moexAsset: 'GOLD' },
      { metal: 'Silver', perpTicker: 'KXSILVERPERP', moexAsset: 'SILV' },
      { metal: 'Platinum', perpTicker: 'KXPLATINUMPERP', moexAsset: 'PLT' },
      { metal: 'Palladium', perpTicker: 'KXPALLADIUMPERP', moexAsset: 'PALL' },
    ],
    decide(ctx) {
      let orders = 0;
      for (const pair of this.pairs ?? []) {
        if (orders >= 2) break;
        const perp = ctx.listInstruments({ venue: 'kalshi_margin' }).find((i) => i.ticker === pair.perpTicker);
        const future = ctx.listInstruments({ venue: 'moex_forts' }).find((i) => i.asset_code === pair.moexAsset);
        if (!perp || !future) continue;
        const pq = ctx.quote(perp.instrument_id);
        const fq = ctx.quote(future.instrument_id);
        if (!pq || !fq || pq.mid == null || fq.mid == null || pq.bid == null || pq.offer == null || fq.bid == null || fq.offer == null) continue;
        const basis = (pq.mid - fq.mid) / fq.mid;
        const existingPerp = ctx.portfolio.positions[perp.instrument_id];
        const existingFuture = ctx.portfolio.positions[future.instrument_id];
        if (Math.abs(basis) < this.sizing.min_basis) {
          if (Math.abs(basis) < this.sizing.exit_basis && (existingPerp || existingFuture)) {
            ctx.exit(perp.instrument_id, `Basis compressed to ${(basis * 100).toFixed(3)}%, below the exit threshold.`, { name: 'basis_convergence', basis: Number(basis.toFixed(5)) });
            ctx.exit(future.instrument_id, `Basis compressed to ${(basis * 100).toFixed(3)}%, below the exit threshold.`, { name: 'basis_convergence', basis: Number(basis.toFixed(5)) });
          }
          continue;
        }
        if (existingPerp || existingFuture) continue;
        const perpSide = basis > 0 ? 'short' : 'long';
        const futureSide = basis > 0 ? 'long' : 'short';
        const perpPrice = perpSide === 'long' ? pq.offer : pq.bid;
        const futurePrice = futureSide === 'long' ? fq.offer : fq.bid;
        const perpContracts = sizeContracts({ notional: this.sizing.notional_usd, price: perpPrice });
        const futureContracts = sizeContracts({
          notional: this.sizing.notional_usd,
          price: futurePrice * (future.usd_valuation?.usd_per_price_unit ?? 0),
        });
        const contracts = Math.min(perpContracts, futureContracts);
        if (contracts < 1) continue;
        orders += 1;
        ctx.order({
          strategy_id: this.id,
          instrument_id: perp.instrument_id,
          venue: 'kalshi_margin',
          action: perpSide === 'long' ? 'buy' : 'sell',
          side: perpSide,
          contracts,
          limit_price: perpPrice,
          order_type: 'taker',
          thesis: `Basis ${(basis * 100).toFixed(3)}% between ${perp.ticker} and ${future.ticker}; perpetual leg at ${perpPrice}.`,
          signal: { name: 'cross_venue_basis', basis: Number(basis.toFixed(5)), perp_mid: pq.mid, future_mid: fq.mid, leg: 'perpetual' },
        });
        ctx.order({
          strategy_id: this.id,
          instrument_id: future.instrument_id,
          venue: 'moex_forts',
          action: futureSide === 'long' ? 'buy' : 'sell',
          side: futureSide,
          contracts,
          limit_price: futurePrice,
          order_type: 'taker',
          thesis: `Basis ${(basis * 100).toFixed(3)}% between ${perp.ticker} and ${future.ticker}; futures leg at ${futurePrice}.`,
          signal: { name: 'cross_venue_basis', basis: Number(basis.toFixed(5)), perp_mid: pq.mid, future_mid: fq.mid, leg: 'future' },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      return { reason: 'Cross-venue legs are held until the measured basis converges below the exit threshold; the engine re-checks on every tick.', signal: { name: 'basis_review' } };
    },
  },
];

/* ------------------------------------------------------------- helpers */

export function sizeContracts({ notional, price }) {
  if (!Number.isFinite(notional) || !Number.isFinite(price) || price <= 0) return 0;
  return Math.floor(notional / price);
}

export function hasTimeLeft(inst, minutes, now = new Date()) {
  const close = inst.close_time ?? inst.expiration_time;
  if (!close) return true;
  return (new Date(close).getTime() - now.getTime()) / 60000 > minutes;
}

export function hoursToClose(inst, now = new Date()) {
  const close = inst.close_time ?? inst.expiration_time;
  if (!close) return null;
  return (new Date(close).getTime() - now.getTime()) / 3600000;
}

export function stdev(values) {
  if (!values || values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
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
    has_exit_rule: typeof s.exit === 'function',
    pairs: s.pairs ?? null,
    implemented: typeof s.decide === 'function',
    enabled: s.enabled !== false,
    disabled_reason: s.disabled_reason ?? null,
  }));
}

export function getStrategy(id) {
  return STRATEGIES.find((s) => s.id === id) ?? null;
}
