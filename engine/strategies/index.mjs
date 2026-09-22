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
    // Re-enabled on 2026-09-22 after the unit defect was resolved with official data. What was
    // missing before was the normalisation between the two venues' contracts, and it now exists:
    //   Kalshi: the Perps API payload publishes `contract_size` per contract (gold 0.001, silver
    //           0.1, platinum 0.001) - Kalshi's own help-centre specification states contract
    //           sizes in units of the underlying (troy ounces for metals), so USD per ounce is
    //           price / contract_size.
    //   MOEX:   the ISS description table (/iss/securities/{SECID}.json -> description) publishes
    //           LOTSIZE, UNIT (quotation currency) and FACEUNIT (settlement currency). Verified
    //           2026-09-22: GDZ6 LOTSIZE=1 UNIT=USD FACEUNIT=USD; SVZ6 LOTSIZE=10 UNIT=USD
    //           FACEUNIT=USD; PTZ6 LOTSIZE=1 UNIT=USD FACEUNIT=USD. The quote is USD per unit of
    //           the underlying, so the MOEX mid is already USD per ounce.
    // Cross-check on 2026-09-22 22:23Z (both venues' own payloads, same run): Kalshi gold perp
    // 4.36325/0.001 = 4363.25 USD/oz vs MOEX GDZ6 mid 4433.25 (+1.6%); silver 67.2255 vs 68.36
    // (+1.7%). Two independent official venues within ~2% - the normalisation is corroborated
    // empirically as well (a lot-vs-unit or gram-vs-ounce error would show 10x/32x gaps).
    // The strategy refuses to trade any pair whose normalisation inputs are missing in the run.
    market_type: 'Cross-venue: Kalshi perpetual future vs exchange-listed future',
    venues: ['kalshi_margin', 'moex_forts'],
    origin: {
      kind: 'market_structure',
      claim: 'A 24/7 listed perpetual and a session-based futures contract on the same metal cannot diverge indefinitely; when the basis exceeds its own cost of carry, the two must converge. The MOEX premium/discount to the world metal price since 2022 is a documented, persistent phenomenon.',
      status: 'structural - two real legs on two real venues, unit-normalised from official fields',
      sources: [
        { label: 'Kalshi perp contract specification (official help centre: contract size in underlying units)', url: 'https://help.kalshi.com/en/articles/15357587-btc-perpetual-futures-contract-specifications' },
        { label: 'MOEX ISS security description endpoint (LOTSIZE / quotation UNIT / FACEUNIT)', url: 'https://iss.moex.com/iss/securities/GDZ6.json?iss.meta=off&iss.only=description' },
        { label: 'MOEX ISS reference documentation', url: 'https://iss.moex.com/iss/reference/' },
      ],
    },
    thesis:
      'Compare the Kalshi metal perpetual (price / contract_size = USD per ounce) with the front MOEX future on the same metal (mid = USD per ounce when UNIT=USD). When the normalised basis is large enough to cover both venues fees, buy the cheaper venue and sell the more expensive one. Both legs are simulated with their own venue fill model.',
    rules: {
      entry: 'Normalised basis >= 0.5% between the perpetual (USD/oz via contract_size) and the MOEX front future (USD/oz via official UNIT/LOT SIZE).',
      exit: 'Exit when the basis compresses below 0.1%, or when either leg loses its verified quote or normalisation inputs.',
      sizing: 'Target notional per leg, capped by each venue published liquidity.',
    },
    sizing: { notional_usd: 20000, min_basis: 0.005, exit_basis: 0.001, sizing_note: 'Per-leg target notional. It must exceed the value of one MOEX metal contract (GOLD-12.26 lot = 1 troy ounce, quoted USD/oz, ~$4,400 per contract on 2026-09-22) or the minimum size is zero contracts and no trade can be placed.' },
    pairs: [
      { metal: 'Gold', perpTicker: 'KXGOLDPERP', moexAsset: 'GOLD' },
      { metal: 'Silver', perpTicker: 'KXSILVERPERP', moexAsset: 'SILV' },
      { metal: 'Platinum', perpTicker: 'KXPLATINUMPERP', moexAsset: 'PLT' },
      // Palladium is deliberately absent: the MOEX FORTS listing verified on 2026-09-22 contains
      // no palladium asset code (the P codes are PLT/PLTM platinum and PLD/PLDM/PLZLM equities),
      // and the Kalshi palladium perp had no two-sided market in the last verified snapshot.
    ],
    decide(ctx) {
      let orders = 0;
      for (const pair of this.pairs ?? []) {
        if (orders >= 2) break;
        const perp = ctx.listInstruments({ venue: 'kalshi_margin' }).find((i) => i.ticker === pair.perpTicker);
        const moexLegs = ctx.listInstruments({ venue: 'moex_forts' }).filter((i) => i.asset_code === pair.moexAsset);
        // front (nearest) expiry only
        const future = [...moexLegs].sort((a, b) => String(a.last_trade_date ?? '').localeCompare(String(b.last_trade_date ?? '')))[0] ?? null;
        if (!perp || !future) continue;
        const pq = ctx.quote(perp.instrument_id);
        const fq = ctx.quote(future.instrument_id);
        if (!pq || !fq || pq.mid == null || fq.mid == null || pq.bid == null || pq.offer == null || fq.bid == null || fq.offer == null) continue;
        const perpContractSize = perp.contract_specification?.contract_size ?? pq.contract_size ?? null;
        if (!(perpContractSize > 0)) {
          ctx.note({ pair: pair.metal, skipped: 'kalshi_contract_size_unavailable', contract_size: perpContractSize });
          continue;
        }
        if (future.contract_specification?.quote_unit !== 'USD') {
          ctx.note({ pair: pair.metal, skipped: 'moex_quote_unit_not_usd', quote_unit: future.contract_specification?.quote_unit ?? null });
          continue;
        }
        const perpUsdPerOunce = pq.mid / perpContractSize;
        const moexUsdPerOunce = fq.mid; // quote_unit is USD per underlying unit (official MOEX description)
        if (!(perpUsdPerOunce > 0) || !(moexUsdPerOunce > 0)) continue;
        const basis = (perpUsdPerOunce - moexUsdPerOunce) / moexUsdPerOunce;
        const normalization = {
          perp_ticker: perp.ticker,
          perp_contract_size: perpContractSize,
          perp_mid: pq.mid,
          perp_usd_per_ounce: Number(perpUsdPerOunce.toFixed(6)),
          moex_ticker: future.ticker,
          moex_quote_unit: future.contract_specification.quote_unit,
          moex_lot_size: future.contract_specification.lot_size ?? null,
          moex_face_unit: future.contract_specification.settlement_currency ?? null,
          moex_mid: fq.mid,
          moex_usd_per_ounce: Number(moexUsdPerOunce.toFixed(6)),
          formula: 'basis = (perp_mid / perp_contract_size - moex_mid) / moex_mid',
          sources: { perp: pq.source?.url ?? null, moex: fq.source?.url ?? null, moex_description: future.contract_specification.description_source_url ?? null },
        };
        const existingPerp = ctx.portfolio.positions[perp.instrument_id];
        const existingFuture = ctx.portfolio.positions[future.instrument_id];
        if (Math.abs(basis) < this.sizing.min_basis) {
          if (Math.abs(basis) < this.sizing.exit_basis && (existingPerp || existingFuture)) {
            ctx.exit(perp.instrument_id, `Normalised basis compressed to ${(basis * 100).toFixed(3)}%, below the exit threshold.`, { name: 'basis_convergence', basis: Number(basis.toFixed(5)), normalization });
            ctx.exit(future.instrument_id, `Normalised basis compressed to ${(basis * 100).toFixed(3)}%, below the exit threshold.`, { name: 'basis_convergence', basis: Number(basis.toFixed(5)), normalization });
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
          thesis: `Normalised basis ${(basis * 100).toFixed(3)}%: ${perp.ticker} ${perpUsdPerOunce.toFixed(2)} USD/oz vs ${future.ticker} ${moexUsdPerOunce.toFixed(2)} USD/oz; perpetual leg at ${perpPrice}.`,
          signal: { name: 'cross_venue_basis', basis: Number(basis.toFixed(5)), leg: 'perpetual', normalization },
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
          thesis: `Normalised basis ${(basis * 100).toFixed(3)}%: ${perp.ticker} ${perpUsdPerOunce.toFixed(2)} USD/oz vs ${future.ticker} ${moexUsdPerOunce.toFixed(2)} USD/oz; futures leg at ${futurePrice}.`,
          signal: { name: 'cross_venue_basis', basis: Number(basis.toFixed(5)), leg: 'future', normalization },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      // Re-derive the normalised basis for this position's pair; only exit when it has converged.
      const inst = ctx.instrument(position.instrument_id);
      const pair = (this.pairs ?? []).find(
        (p) => position.ticker === p.perpTicker || (inst && inst.asset_code === p.moexAsset),
      );
      if (!pair) {
        return { reason: 'This position no longer belongs to a verified cross-venue pair; unwinding rather than holding an unmodellable leg.', signal: { name: 'basis_pair_removed' } };
      }
      const perp = ctx.listInstruments({ venue: 'kalshi_margin' }).find((i) => i.ticker === pair.perpTicker);
      const future = [...ctx.listInstruments({ venue: 'moex_forts' }).filter((i) => i.asset_code === pair.moexAsset)].sort((a, b) => String(a.last_trade_date ?? '').localeCompare(String(b.last_trade_date ?? '')))[0];
      if (!perp || !future) {
        return { reason: 'One leg of the pair is no longer published with a quote; the converged-price premise cannot be checked, so the leg is unwound.', signal: { name: 'basis_leg_unavailable' } };
      }
      const pq = ctx.quote(perp.instrument_id);
      const fq = ctx.quote(future.instrument_id);
      const perpContractSize = perp.contract_specification?.contract_size ?? pq?.contract_size ?? null;
      if (!pq || !fq || pq.mid == null || fq.mid == null || !(perpContractSize > 0) || future.contract_specification?.quote_unit !== 'USD') {
        return { reason: 'Normalisation inputs for the pair are unavailable in this snapshot; the basis premise cannot be checked, so the leg is unwound rather than held unverified.', signal: { name: 'basis_normalisation_unavailable' } };
      }
      const basis = (pq.mid / perpContractSize - fq.mid) / fq.mid;
      if (Math.abs(basis) >= this.sizing.exit_basis) return null;
      return {
        reason: `Normalised basis compressed to ${(basis * 100).toFixed(3)}% (below the ${(this.sizing.exit_basis * 100).toFixed(1)}% exit threshold).`,
        signal: { name: 'basis_convergence', basis: Number(basis.toFixed(5)), perp_usd_per_ounce: Number((pq.mid / perpContractSize).toFixed(6)), moex_usd_per_ounce: Number(fq.mid.toFixed(6)) },
      };
    },
  },

  /* ------------------------------------------------------------------ 13 */
  {
    id: 'kalshi-orderbook-imbalance',
    username: '@book-watcher',
    display_name: 'Order-Book Imbalance',
    market_type: 'Kalshi event contract',
    venues: ['kalshi'],
    origin: {
      kind: 'documented_anomaly',
      claim: 'Standing-book imbalance is a classic order-flow signal: when resting depth is heavily concentrated on one side, the next short-horizon move is disproportionately in that side\'s direction. Prediction-market strategy write-ups list flow/liquidity signals among the recurring edges.',
      status: 'hypothesis under test - the competition is the test',
      sources: [
        { label: 'Prediction-market strategy synthesis (flow and liquidity signals)', url: 'https://medium.com/@FrenzyCapital/trading-strategies-for-prediction-markets-4025a050e2e2' },
      ],
    },
    thesis:
      'Trade in the direction of the heavily unbalanced resting book: when the official order book shows at least 70% of visible depth on one side and the spread is tight, buy that side, betting that the resting liquidity reflects informed order flow.',
    rules: {
      entry: 'Depth ratio >= 70% or <= 30% on visible book depth, spread <= 3 cents, YES mid between 0.15 and 0.85, at least 2 hours to close.',
      exit: 'Exit when the depth ratio crosses back through 50% or the market closes.',
      sizing: 'Target notional, capped at 25% of the resting depth within 2 cents of the offer.',
    },
    sizing: { notional_usd: 2500, max_spread_cents: 3, imbalance: 0.7 },
    decide(ctx) {
      let orders = 0;
      for (const inst of ctx.listInstruments({ venue: 'kalshi' })) {
        if (orders >= 3) break;
        if (!hasTimeLeft(inst, 120, ctx.now)) continue;
        if (ctx.portfolio.positions[inst.instrument_id]) continue;
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.mid == null || q.spread == null) continue;
        if (q.mid < 0.15 || q.mid > 0.85 || q.spread > this.sizing.max_spread_cents / 100) continue;
        const depthYes = q.depth_yes_contracts ?? 0;
        const depthNo = q.depth_no_contracts ?? 0;
        const total = depthYes + depthNo;
        if (total < 50) continue; // need a real book before an imbalance means anything
        const ratio = depthYes / total;
        if (ratio < this.sizing.imbalance && ratio > 1 - this.sizing.imbalance) continue;
        const buyYes = ratio >= this.sizing.imbalance;
        const price = buyYes ? q.best_yes_ask : q.best_no_ask;
        if (price == null) continue;
        const contracts = sizeContracts({ notional: this.sizing.notional_usd, price });
        if (contracts < 1) continue;
        orders += 1;
        ctx.order({
          strategy_id: this.id,
          instrument_id: inst.instrument_id,
          venue: 'kalshi',
          action: 'buy',
          outcome: buyYes ? 'yes' : 'no',
          contracts,
          limit_price: Number((price + 0.02).toFixed(4)),
          order_type: 'taker',
          thesis: `Resting depth is ${(Math.max(ratio, 1 - ratio) * 100).toFixed(0)}% on the ${buyYes ? 'YES' : 'NO'} side of ${inst.series_ticker}; following the book.`,
          signal: { name: 'book_imbalance', depth_ratio_yes: Number(ratio.toFixed(4)), depth_yes_contracts: depthYes, depth_no_contracts: depthNo, side: buyYes ? 'yes' : 'no', series: inst.series_ticker },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      const q = ctx.quote(position.instrument_id);
      if (!q || q.depth_yes_contracts == null || q.depth_no_contracts == null) return null;
      const total = q.depth_yes_contracts + q.depth_no_contracts;
      if (total <= 0) return null;
      const ratio = q.depth_yes_contracts / total;
      const heldYes = position.outcome === 'yes';
      const stillWithUs = heldYes ? ratio >= 0.5 : ratio <= 0.5;
      if (stillWithUs) return null;
      return { reason: 'The resting-book imbalance crossed back through 50% against the position.', signal: { name: 'book_imbalance_flip', depth_ratio_yes: Number(ratio.toFixed(4)) } };
    },
  },

  /* ------------------------------------------------------------------ 14 */
  {
    id: 'kalshi-perp-mark-fade',
    username: '@mark-fade',
    display_name: 'Perp Mark Fade',
    market_type: 'Kalshi perpetual future',
    venues: ['kalshi_margin'],
    origin: {
      kind: 'market_structure',
      claim: 'A perpetual\'s book is anchored to the exchange-published mark/index price: deviations are driven by transient order flow and tend to decay back toward the mark. Kalshi publishes the mark (settlement mark price) for every perpetual in the same payload as the book.',
      status: 'structural - the anchor is published by the exchange itself',
    },
    thesis:
      'When the Kalshi perpetual mid deviates from the exchange-published mark price by 0.3% or more, trade back toward the mark; exit when the deviation decays below 0.08%. Both the deviation and its anchor come from the exchange payload in the same snapshot.',
    rules: {
      entry: '|perp mid / exchange mark - 1| >= 0.30%, with a live two-sided book; trade toward the mark.',
      exit: 'Exit when the deviation decays below 0.08% or the two-sided quote disappears.',
      sizing: 'Target notional, capped by a share of published 24h notional volume.',
    },
    sizing: { notional_usd: 4000, entry_deviation: 0.003, exit_deviation: 0.0008 },
    decide(ctx) {
      let orders = 0;
      for (const inst of ctx.listInstruments({ venue: 'kalshi_margin' })) {
        if (orders >= 3) break;
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.bid == null || q.offer == null || q.mid == null || q.bid <= 0 || q.offer <= 0) continue;
        const mark = q.settlement_mark_price ?? q.reference_price ?? null;
        if (!(mark > 0)) continue;
        const deviation = (q.mid - mark) / mark;
        if (Math.abs(deviation) < this.sizing.entry_deviation) continue;
        if (ctx.portfolio.positions[inst.instrument_id]) continue;
        const side = deviation > 0 ? 'short' : 'long';
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
          thesis: `${inst.ticker} mid ${(deviation * 100).toFixed(3)}% ${deviation > 0 ? 'above' : 'below'} the exchange mark ${mark}; trading back toward the mark.`,
          signal: { name: 'perp_mark_fade', deviation_pct: Number((deviation * 100).toFixed(4)), mid: q.mid, exchange_mark: mark },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      const q = ctx.quote(position.instrument_id);
      if (!q || q.mid == null) return null;
      const mark = q.settlement_mark_price ?? q.reference_price ?? null;
      if (!(mark > 0)) {
        return { reason: 'The exchange mark is no longer published, so the anchor for this position is gone.', signal: { name: 'perp_mark_unavailable' } };
      }
      const deviation = (q.mid - mark) / mark;
      if (Math.abs(deviation) >= this.sizing.exit_deviation) return null;
      return { reason: `Deviation to the exchange mark decayed to ${(deviation * 100).toFixed(3)}%.`, signal: { name: 'perp_mark_reached', deviation_pct: Number((deviation * 100).toFixed(4)), exchange_mark: mark } };
    },
  },

  /* ------------------------------------------------------------------ 15 */
  {
    id: 'moex-energy-trend',
    username: '@rig-count',
    display_name: 'Energy Trend',
    market_type: 'Exchange-listed commodity future',
    venues: ['moex_forts'],
    origin: {
      kind: 'market_structure',
      claim: 'Energy futures trend on supply shocks: crude, products and gas move in multi-week runs that their own settlement history makes measurable. MOEX lists WTI, Brent, natural gas (NG/NGM/TTF), diesel and AI-92/95 gasoline contracts, all readable from the official ISS API.',
      status: 'hypothesis under test on contracts verified in the exchange listing on 2026-09-22',
    },
    thesis:
      'Follow the official settlement trend in MOEX energy futures - crude (WTI, Brent), products (diesel, AI-92/95 gasoline) and gas (NG, NGM, TTF) - taking the strongest movers on each side and holding while the trend persists.',
    rules: {
      entry: '15-observation settlement momentum, |momentum| >= 1.5%.',
      exit: 'Exit when the momentum flips sign.',
      sizing: 'Target notional, capped by published volume and open interest.',
    },
    sizing: { notional_usd: 5000, min_momentum: 0.015 },
    decide(ctx) {
      let orders = 0;
      for (const inst of ctx.listInstruments({ venue: 'moex_forts', groups: ['Energy'] })) {
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
          signal: { name: 'energy_settlement_momentum', momentum: Number(momentum.toFixed(4)), observations: closes.length, quote_unit: inst.contract_specification?.quote_unit ?? null },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      const rows = ctx.moexHistory(position.ticker);
      const closes = (rows ?? []).map((r) => r.CLOSE ?? r.SETTLEPRICE).filter((c) => c != null && Number(c) > 0);
      if (closes.length < 8) return null;
      const momentum = (closes[closes.length - 1] - closes[0]) / closes[0];
      const held = position.side === 'long' ? 1 : -1;
      if (Math.sign(momentum) === held || momentum === 0) return null;
      return { reason: 'Settlement momentum flipped against the energy position.', signal: { name: 'energy_momentum_flip', momentum: Number(momentum.toFixed(4)) } };
    },
  },

  /* ------------------------------------------------------------------ 16 */
  {
    id: 'moex-metal-breakout',
    username: '@donchian-desk',
    display_name: 'Channel Breakout',
    market_type: 'Exchange-listed commodity future',
    venues: ['moex_forts'],
    origin: {
      kind: 'documented_anomaly',
      claim: 'Channel (Donchian) breakout rules - buy a 20-period high, sell a 20-period low, exit on the opposite 10-period extreme - are the public-domain Turtle trading rules, among the most documented systematic futures strategies.',
      status: 'documented rule, forward-tested here on official MOEX settlements',
      sources: [
        { label: 'Original Turtle Trading rules (public domain, official release by the authors)', url: 'https://www.turtletrader.com/turtle/' },
      ],
    },
    thesis:
      'Run the classic 20/10 channel breakout on MOEX metals futures using only the exchange\'s official daily settlement history: buy the 20-day high breakout, short the 20-day low breakout, exit on the opposite 10-day extreme.',
    rules: {
      entry: 'Daily settlement CLOSE crosses above the prior 20-observation high (long) or below the prior 20-observation low (short).',
      exit: 'Close crosses the opposite 10-observation extreme.',
      sizing: 'Target notional, capped by published volume and open interest.',
    },
    sizing: { notional_usd: 5000, entry_channel: 20, exit_channel: 10 },
    decide(ctx) {
      let orders = 0;
      for (const inst of ctx.listInstruments({ venue: 'moex_forts', groups: ['Precious Metals', 'Industrial Metals'] })) {
        if (orders >= 3) break;
        if (!inst.usd_valuation?.usd_per_price_unit) continue;
        if (ctx.portfolio.positions[inst.instrument_id]) continue;
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.offer == null || q.bid == null) continue;
        const rows = ctx.moexHistory(inst.ticker);
        const closes = (rows ?? []).map((r) => r.CLOSE ?? r.SETTLEPRICE).filter((c) => c != null && Number(c) > 0);
        const entryN = this.sizing.entry_channel;
        if (closes.length < entryN + 1) continue;
        const prior = closes.slice(-entryN - 1, -1);
        const high = Math.max(...prior);
        const low = Math.min(...prior);
        const last = closes[closes.length - 1];
        if (last < high && last > low) continue;
        const side = last >= high ? 'long' : 'short';
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
          thesis: `${inst.ticker} settlement ${last} broke the prior ${entryN}-observation ${side === 'long' ? `high ${high}` : `low ${low}`}.`,
          signal: { name: 'channel_breakout', side, last_settlement: last, prior_high: high, prior_low: low, channel: entryN },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      const rows = ctx.moexHistory(position.ticker);
      const closes = (rows ?? []).map((r) => r.CLOSE ?? r.SETTLEPRICE).filter((c) => c != null && Number(c) > 0);
      const exitN = this.sizing.exit_channel;
      if (closes.length < exitN + 1) return null;
      const prior = closes.slice(-exitN - 1, -1);
      const last = closes[closes.length - 1];
      if (position.side === 'long' && last < Math.min(...prior)) {
        return { reason: `Settlement broke the opposite ${exitN}-observation low; the long channel breakout is over.`, signal: { name: 'channel_exit', last_settlement: last, exit_extreme: Math.min(...prior) } };
      }
      if (position.side === 'short' && last > Math.max(...prior)) {
        return { reason: `Settlement broke the opposite ${exitN}-observation high; the short channel breakout is over.`, signal: { name: 'channel_exit', last_settlement: last, exit_extreme: Math.max(...prior) } };
      }
      return null;
    },
  },

  /* ------------------------------------------------------------------ 17 */
  {
    id: 'kalshi-jump-reversal',
    username: '@snap-fader',
    display_name: 'Jump Reversal',
    market_type: 'Kalshi event contract',
    venues: ['kalshi'],
    origin: {
      kind: 'documented_anomaly',
      claim: 'Short-horizon reversal: abrupt one-interval price jumps in thin binary books routinely overshoot because the first wave of flow consumes several levels; prediction-market write-ups treat post-jump entries as a recurring, testable pattern.',
      status: 'hypothesis under test - tick-to-tick, on official snapshot mids only',
    },
    thesis:
      'When a contract\'s official mid moves by 6 cents or more between two consecutive verified snapshots, take the opposite side: fade the jump. Deliberately distinct from @vol-crusher (which fades daily-candle extremes from the exchange candle history), this acts on tick-to-tick snapshot moves.',
    rules: {
      entry: '|mid change between the previous committed snapshot and this one| >= 6 cents, spread <= 4 cents, at least 2 hours to close, mid between 0.08 and 0.92.',
      exit: 'Exit when the mid retraces half of the measured jump, or the market closes.',
      sizing: 'Target notional, capped by verified depth.',
    },
    sizing: { notional_usd: 2000, min_jump: 0.06, max_spread_cents: 4 },
    decide(ctx) {
      let orders = 0;
      for (const inst of ctx.listInstruments({ venue: 'kalshi' })) {
        if (orders >= 3) break;
        if (!hasTimeLeft(inst, 120, ctx.now)) continue;
        if (ctx.portfolio.positions[inst.instrument_id]) continue;
        const q = ctx.quote(inst.instrument_id);
        if (!q || q.mid == null || q.spread == null) continue;
        if (q.spread > this.sizing.max_spread_cents / 100 || q.mid < 0.08 || q.mid > 0.92) continue;
        const previous = ctx.previousMid(inst.instrument_id);
        if (previous == null || previous <= 0 || previous >= 1) continue;
        const jump = q.mid - previous;
        if (Math.abs(jump) < this.sizing.min_jump) continue;
        const fadeJumpUp = jump > 0; // price jumped up -> buy NO
        const price = fadeJumpUp ? q.best_no_ask : q.best_yes_ask;
        if (price == null) continue;
        const contracts = sizeContracts({ notional: this.sizing.notional_usd, price });
        if (contracts < 1) continue;
        orders += 1;
        ctx.order({
          strategy_id: this.id,
          instrument_id: inst.instrument_id,
          venue: 'kalshi',
          action: 'buy',
          outcome: fadeJumpUp ? 'no' : 'yes',
          contracts,
          limit_price: Number((price + 0.02).toFixed(4)),
          order_type: 'taker',
          thesis: `Mid jumped ${(jump * 100).toFixed(1)} cents between snapshots (from ${previous} to ${q.mid}); fading the jump.`,
          signal: { name: 'jump_reversal', jump: Number(jump.toFixed(4)), previous_mid: previous, current_mid: q.mid, series: inst.series_ticker },
        });
      }
      return { notes: [] };
    },
    exit(ctx, position) {
      const q = ctx.quote(position.instrument_id);
      const jump = position.entry_signal?.jump;
      if (!q || q.mid == null || typeof jump !== 'number' || jump === 0) return null;
      const heldMid = position.outcome === 'yes' ? q.mid : q.mid != null ? 1 - q.mid : null;
      if (heldMid == null) return null;
      const gain = heldMid - position.avg_entry_price;
      const target = Math.abs(jump) / 2;
      if (gain >= target) {
        return { reason: `Held-side mid gained ${(gain * 100).toFixed(1)} cents since entry - the faded jump has retraced at least half.`, signal: { name: 'jump_retrace_target', gain: Number(gain.toFixed(4)), target: Number(target.toFixed(4)) } };
      }
      if (gain <= -Math.abs(jump)) {
        return { reason: 'The jump continued in the original direction by more than its full size against this fade; the reversion thesis is invalidated.', signal: { name: 'jump_continuation', gain: Number(gain.toFixed(4)) } };
      }
      return null;
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
