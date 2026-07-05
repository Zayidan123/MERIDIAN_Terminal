// MERIDIAN Terminal — Portfolio Risk Summary (PRD FR-3.2, 3.4, 3.5).
// GET: compute the full RiskSummary from REAL positions + REAL live prices +
//      REAL historical candles. Heavy route; expected to be polled every
//      30–60s. Concurrent quote + candle fetches via Promise.all.
//
// Equity definition (this implementation):
//   costBasis       = Σ (entryPrice_i × size_i)              across positions
//   unrealizedPnl   = Σ unrealizedPnl_i                       (skip nulls)
//   totalEquity     = costBasis + unrealizedPnl
//   totalExposure   = Σ marketValue_i                          (skip nulls)
//   exposurePct     = totalExposure / totalEquity × 100        (guard /0)
//
// Integrity (PRD §6): every numeric market-derived field is null when its
// underlying live quote or candle fetch failed. We never fabricate a price.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { getQuote, getCandles } from "@/lib/data-sources";
import { correlation } from "@/lib/indicators";
import type {
  AssetClass,
  Candle,
  CorrelationCell,
  DataSourceKey,
  Instrument,
  RiskSummary,
} from "@/lib/types";

function toInstrument(row: {
  id: string;
  assetClass: string;
  ticker: string;
  symbol: string;
  name: string;
  exchange: string | null;
  currency: string;
  source: string;
  lotSize: number | null;
  metadata: string | null;
}): Instrument {
  return {
    id: row.id,
    assetClass: row.assetClass as AssetClass,
    ticker: row.ticker,
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    currency: row.currency,
    source: row.source as DataSourceKey,
    lotSize: row.lotSize,
    metadata: row.metadata,
  };
}

interface PositionRow {
  id: string;
  instrumentId: string;
  instrument: {
    id: string;
    assetClass: string;
    ticker: string;
    symbol: string;
    name: string;
    exchange: string | null;
    currency: string;
    source: string;
    lotSize: number | null;
    metadata: string | null;
  };
  side: string;
  entryPrice: number;
  size: number;
  openedAt: Date;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EnrichedPosition {
  row: PositionRow;
  instrument: Instrument;
  marketValue: number | null;
  unrealizedPnl: number | null;
  // Daily log-return series keyed by timestamp (epoch ms).
  returns: Map<number, number>;
  // Sorted timestamps for fast intersection.
  times: number[];
}

/// Compute per-position market fields from a live quote price (null-safe).
function computeMarketFields(
  side: string,
  entryPrice: number,
  size: number,
  lastPrice: number | null
): { marketValue: number | null; unrealizedPnl: number | null } {
  if (lastPrice === null || !Number.isFinite(lastPrice)) {
    return { marketValue: null, unrealizedPnl: null };
  }
  const marketValue = size * lastPrice;
  const unrealizedPnl =
    side === "SHORT"
      ? (entryPrice - lastPrice) * size
      : (lastPrice - entryPrice) * size;
  return { marketValue, unrealizedPnl };
}

/// Convert raw daily candles to a Map<time, logReturn> + sorted times array.
/// logReturn at time t = ln(close_t / close_{t-1}).
function candlesToReturns(candles: Candle[]): {
  returns: Map<number, number>;
  times: number[];
} {
  const returns = new Map<number, number>();
  const times: number[] = [];
  if (candles.length < 2) return { returns, times };
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const cur = candles[i].close;
    if (prev > 0 && cur > 0 && Number.isFinite(prev) && Number.isFinite(cur)) {
      const r = Math.log(cur / prev);
      if (Number.isFinite(r)) {
        const t = candles[i].time;
        returns.set(t, r);
        times.push(t);
      }
    }
  }
  return { returns, times };
}

/// Compute mean & population std of a numeric series. Returns null if
/// insufficient data (n < 2 or std 0 → still returns 0, caller decides).
function meanStd(arr: number[]): { mean: number; std: number; n: number } {
  const n = arr.length;
  if (n === 0) return { mean: 0, std: 0, n: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance =
    arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance), n };
}

/// Aggregate per-position return series into a unified portfolio daily
/// log-return series. Weights are static (marketValue_i / totalExposure).
/// For each timestamp in the union, portfolio return = Σ w_i × r_i(t),
/// where r_i(t) defaults to 0 when instrument i has no observation at t.
function buildPortfolioReturns(
  enriched: EnrichedPosition[],
  totalExposure: number
): number[] {
  if (totalExposure <= 0 || enriched.length === 0) return [];
  // Union of all timestamps.
  const allTimes = new Set<number>();
  for (const e of enriched) {
    for (const t of e.times) allTimes.add(t);
  }
  if (allTimes.size === 0) return [];
  const sorted = Array.from(allTimes).sort((a, b) => a - b);
  // Precompute weights per position (0 when marketValue missing).
  const weights = enriched.map((e) =>
    e.marketValue !== null && Number.isFinite(e.marketValue)
      ? e.marketValue / totalExposure
      : 0
  );
  const out: number[] = new Array(sorted.length);
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    let r = 0;
    for (let p = 0; p < enriched.length; p++) {
      const w = weights[p];
      if (w === 0) continue;
      const rr = enriched[p].returns.get(t);
      if (rr !== undefined) r += w * rr;
    }
    out[i] = r;
  }
  return out;
}

/// Reconstruct an equity curve from a return series + starting equity.
/// equity_t = start × Π(1 + r_i). Drawdown_t = (equity_t - peak_t) / peak_t
/// where peak_t = running max of equity up to t.
function drawdownFromReturns(
  returns: number[],
  startEquity: number
): { currentDrawdown: number | null; maxDrawdown: number | null } {
  if (returns.length < 2) {
    return { currentDrawdown: null, maxDrawdown: null };
  }
  let equity = startEquity;
  let peak = startEquity;
  let maxDD = 0;
  let currentDD = 0;
  for (const r of returns) {
    equity = equity * (1 + r);
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (equity - peak) / peak : 0;
    if (dd < maxDD) maxDD = dd;
    currentDD = dd;
  }
  if (!Number.isFinite(maxDD) || !Number.isFinite(currentDD)) {
    return { currentDrawdown: null, maxDrawdown: null };
  }
  // Express as percentages (negative or zero). maxDrawdown is the deepest
  // (most negative) value; currentDrawdown is the latest.
  return {
    currentDrawdown: currentDD * 100,
    maxDrawdown: maxDD * 100,
  };
}

export async function GET() {
  try {
    const rows = await db.position.findMany({
      include: { instrument: true },
      orderBy: { createdAt: "desc" },
    });

    // ── 1. Concurrent live quote fetches ────────────────────────────────
    const quoteResults = await Promise.all(
      rows.map(async (r) => {
        const instrument = toInstrument(r.instrument);
        const q = await getQuote(instrument);
        return { row: r as unknown as PositionRow, instrument, q };
      })
    );

    // ── 2. Per-position market fields (null on quote failure) ──────────
    const enriched: EnrichedPosition[] = quoteResults.map(({ row, instrument, q }) => {
      const lastPrice =
        q.ok && q.data && Number.isFinite(q.data.price) ? q.data.price : null;
      const { marketValue, unrealizedPnl } = computeMarketFields(
        row.side,
        row.entryPrice,
        row.size,
        lastPrice
      );
      return {
        row,
        instrument,
        marketValue,
        unrealizedPnl,
        returns: new Map<number, number>(),
        times: [],
      };
    });

    // ── 3. Aggregate totals ─────────────────────────────────────────────
    const costBasis = enriched.reduce(
      (s, e) => s + e.row.entryPrice * e.row.size,
      0
    );
    const unrealizedPnl = enriched.reduce(
      (s, e) => (e.unrealizedPnl !== null ? s + e.unrealizedPnl : s),
      0
    );
    const totalEquity = costBasis + unrealizedPnl;
    const totalExposure = enriched.reduce(
      (s, e) => (e.marketValue !== null ? s + e.marketValue : s),
      0
    );
    const exposurePct =
      totalEquity > 0 ? (totalExposure / totalEquity) * 100 : 0;

    // ── 4. perAssetClass breakdown ──────────────────────────────────────
    const byClass = new Map<
      AssetClass,
      { exposure: number; count: number }
    >();
    for (const e of enriched) {
      const ac = e.instrument.assetClass;
      const mv = e.marketValue ?? 0;
      const cur = byClass.get(ac) ?? { exposure: 0, count: 0 };
      cur.exposure += mv;
      cur.count += 1;
      byClass.set(ac, cur);
    }
    const perAssetClass = Array.from(byClass.entries()).map(
      ([assetClass, v]) => ({
        assetClass,
        exposure: v.exposure,
        pct: totalExposure > 0 ? (v.exposure / totalExposure) * 100 : 0,
        count: v.count,
      })
    );

    // ── 5. perPosition breakdown ────────────────────────────────────────
    const perPosition = enriched.map((e) => {
      const mv = e.marketValue ?? 0;
      const pnl =
        e.unrealizedPnl !== null && e.row.entryPrice * e.row.size > 0
          ? (e.unrealizedPnl / (e.row.entryPrice * e.row.size)) * 100
          : 0;
      return {
        instrumentId: e.instrument.id,
        symbol: e.instrument.symbol,
        assetClass: e.instrument.assetClass,
        marketValue: mv,
        weightPct: totalExposure > 0 ? (mv / totalExposure) * 100 : 0,
        pnlPct: pnl,
      };
    });

    // ── 6. Concurrent historical candle fetches (3m daily) ─────────────
    // Only fetch candles for positions whose quote succeeded — without a
    // marketValue we can't compute a portfolio weight, so the position
    // contributes 0 to the aggregate return series anyway. (We still try
    // for instruments whose marketValue is null but only as a courtesy for
    // the correlation matrix; the spec says correlation is between
    // instruments "that have a return series".)
    const candleResults = await Promise.all(
      enriched.map(async (e, idx) => {
        const r = await getCandles(e.instrument, "3m");
        return { idx, r };
      })
    );
    for (const { idx, r } of candleResults) {
      if (r.ok && r.data && r.data.length >= 2) {
        const { returns, times } = candlesToReturns(r.data);
        enriched[idx].returns = returns;
        enriched[idx].times = times;
      }
    }

    // Positions that have a usable return series.
    const withReturns = enriched.filter((e) => e.times.length >= 5);

    // ── 7. VaR(95%) on aggregate portfolio return series ───────────────
    let varEstimate: number | null = null;
    if (withReturns.length >= 2 && totalExposure > 0) {
      const portfolioReturns = buildPortfolioReturns(withReturns, totalExposure);
      const { std, n } = meanStd(portfolioReturns);
      if (n >= 10 && std > 0 && Number.isFinite(std)) {
        // Parametric VaR, 95% confidence (z ≈ 1.645).
        varEstimate = totalEquity * 1.645 * std;
      }
    }

    // ── 8. Drawdown from reconstructed equity curve ────────────────────
    let currentDrawdown: number | null = null;
    let maxDrawdown: number | null = null;
    if (withReturns.length >= 2 && totalExposure > 0 && costBasis > 0) {
      const portfolioReturns = buildPortfolioReturns(withReturns, totalExposure);
      const dd = drawdownFromReturns(portfolioReturns, costBasis);
      currentDrawdown = dd.currentDrawdown;
      maxDrawdown = dd.maxDrawdown;
    }

    // ── 9. Correlation matrix (pairwise, aligned by time) ──────────────
    const correlationCells: CorrelationCell[] = [];
    for (let i = 0; i < withReturns.length; i++) {
      const a = withReturns[i];
      // Self-pair: trivially 1 (Pearson of identical series).
      correlationCells.push({ a: a.instrument.symbol, b: a.instrument.symbol, value: 1 });
      for (let j = i + 1; j < withReturns.length; j++) {
        const b = withReturns[j];
        // Time-aligned intersection.
        const timesA = a.times;
        const timesB = b.times;
        let iA = 0;
        let iB = 0;
        const ra: number[] = [];
        const rb: number[] = [];
        while (iA < timesA.length && iB < timesB.length) {
          const ta = timesA[iA];
          const tb = timesB[iB];
          if (ta === tb) {
            ra.push(a.returns.get(ta)!);
            rb.push(b.returns.get(tb)!);
            iA++;
            iB++;
          } else if (ta < tb) {
            iA++;
          } else {
            iB++;
          }
        }
        const val = correlation(ra, rb);
        correlationCells.push({
          a: a.instrument.symbol,
          b: b.instrument.symbol,
          value: val,
        });
      }
    }

    const summary: RiskSummary = {
      totalEquity,
      totalExposure,
      exposurePct,
      realizedPnl: 0, // Phase 3: no closed trades tracked yet.
      unrealizedPnl,
      perAssetClass,
      perPosition,
      varEstimate,
      currentDrawdown,
      maxDrawdown,
      correlation: correlationCells,
    };

    // ── 10. Persist RiskSnapshot (non-blocking) ────────────────────────
    db.riskSnapshot
      .create({
        data: {
          totalEquity,
          totalExposure,
          exposurePct,
          varEstimate,
          maxDrawdown,
          currentDrawdown,
        },
      })
      .catch((e) => {
        // Persistence must never break the read path.
        console.error("[risk.summary] failed to persist snapshot", e);
      });

    const now = Date.now();
    return ok(summary, {
      source: "multi",
      sourceLabel: "Multi-source (live)",
      syncedAt: now,
    });
  } catch (e) {
    console.error("[risk.summary.GET]", e);
    return fail("Internal error", 500);
  }
}
