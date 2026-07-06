// MERIDIAN Terminal — backtest runner + metrics.
// Iterates candles, executes trades based on signals, computes performance
// metrics. All on REAL historical data (PRD §6). Long-only in v1.

import type { Candle } from "@/lib/types";
import { generateSignals, type Signal, type StrategyType, type StrategyParams } from "./strategies";

export interface BacktestTrade {
  side: "LONG";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number; // absolute
  pnlPct: number; // percent
  exitReason: string;
}

export interface EquityPoint {
  time: number;
  equity: number;
  drawdown: number; // percent from peak, negative or 0
}

export interface BacktestMetrics {
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  winRate: number; // 0-100
  tradeCount: number;
  sharpeRatio: number | null;
  profitFactor: number | null;
  avgWinPct: number;
  avgLossPct: number;
  largestWinPct: number;
  largestLossPct: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
  signals: { index: number; action: string; reason: string; time: number; price: number }[];
}

/// Run a backtest over a candle series.
/// Execution model:
///   - Long only (v1).
///   - When flat and a BUY signal fires → enter at the NEXT candle's open.
///   - When long and a SELL signal fires → exit at the NEXT candle's open.
///   - If still long at the end → exit at the last close.
///   - Position size = all-in (100% of equity) per trade (no fractional sizing
///     in v1; keeps the model simple and the metrics comparable).
export function runBacktest(
  candles: Candle[],
  type: StrategyType,
  params: StrategyParams,
  initialCapital: number
): BacktestResult {
  const signals = generateSignals(candles, type, params);

  // Build a queue of signals indexed by candle index.
  // We process candle-by-candle. When a signal fires at index i, we execute
  // at i+1's open (if i+1 exists). This avoids look-ahead bias.
  const signalsByIndex = new Map<number, Signal>();
  for (const s of signals) signalsByIndex.set(s.index, s);

  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDD = 0;

  // Position state
  let position: { entryPrice: number; entryTime: number; size: number } | null = null;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    // Execute pending signal from the PREVIOUS candle at this candle's open.
    const pending = signalsByIndex.get(i - 1);
    if (pending) {
      const execPrice = candle.open;
      if (pending.action === "BUY" && !position) {
        position = {
          entryPrice: execPrice,
          entryTime: candle.time,
          size: equity / execPrice, // all-in
        };
      } else if (pending.action === "SELL" && position) {
        const exitPrice = execPrice;
        const pnl = (exitPrice - position.entryPrice) * position.size;
        const pnlPct = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
        equity += pnl;
        trades.push({
          side: "LONG",
          entryTime: position.entryTime,
          exitTime: candle.time,
          entryPrice: position.entryPrice,
          exitPrice,
          size: position.size,
          pnl,
          pnlPct,
          exitReason: pending.reason,
        });
        position = null;
      }
    }

    // Mark-to-market equity at this candle's close.
    const mtmEquity = position
      ? equity + (candle.close - position.entryPrice) * position.size
      : equity;
    if (mtmEquity > peak) peak = mtmEquity;
    const dd = peak > 0 ? ((mtmEquity - peak) / peak) * 100 : 0;
    if (dd < maxDD) maxDD = dd;
    equityCurve.push({ time: candle.time, equity: mtmEquity, drawdown: dd });
  }

  // Close any open position at the last close.
  if (position) {
    const last = candles[candles.length - 1];
    const exitPrice = last.close;
    const pnl = (exitPrice - position.entryPrice) * position.size;
    const pnlPct = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
    equity += pnl;
    trades.push({
      side: "LONG",
      entryTime: position.entryTime,
      exitTime: last.time,
      entryPrice: position.entryPrice,
      exitPrice,
      size: position.size,
      pnl,
      pnlPct,
      exitReason: "End of period",
    });
    position = null;
  }

  const metrics = computeMetrics(trades, equityCurve, initialCapital, equity);
  const signalLog = signals.map((s) => ({
    index: s.index,
    action: s.action,
    reason: s.reason,
    time: candles[s.index]?.time ?? 0,
    price: candles[s.index]?.close ?? 0,
  }));

  return { trades, equityCurve, metrics, signals: signalLog };
}

function computeMetrics(
  trades: BacktestTrade[],
  equityCurve: EquityPoint[],
  initialCapital: number,
  finalEquity: number
): BacktestMetrics {
  const totalReturnPct = ((finalEquity - initialCapital) / initialCapital) * 100;
  const maxDrawdownPct = Math.min(...equityCurve.map((p) => p.drawdown), 0);

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : null;

  const avgWinPct = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLossPct = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
  const largestWinPct = wins.length > 0 ? Math.max(...wins.map((t) => t.pnlPct)) : 0;
  const largestLossPct = losses.length > 0 ? Math.min(...losses.map((t) => t.pnlPct)) : 0;

  // Sharpe ratio (annualized, risk-free=0): mean(returns) / std(returns) * sqrt(periodsPerYear)
  // Use equity curve returns. Assume daily candles → sqrt(252).
  let sharpeRatio: number | null = null;
  if (equityCurve.length > 2) {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1].equity;
      const cur = equityCurve[i].equity;
      if (prev > 0) returns.push((cur - prev) / prev);
    }
    if (returns.length >= 5) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance =
        returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
      const std = Math.sqrt(variance);
      if (std > 0) sharpeRatio = (mean / std) * Math.sqrt(252);
    }
  }

  return {
    initialCapital,
    finalEquity,
    totalReturnPct,
    maxDrawdownPct,
    winRate,
    tradeCount: trades.length,
    sharpeRatio,
    profitFactor,
    avgWinPct,
    avgLossPct,
    largestWinPct,
    largestLossPct,
  };
}
