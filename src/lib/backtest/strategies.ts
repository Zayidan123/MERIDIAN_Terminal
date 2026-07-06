// MERIDIAN Terminal — backtest strategy definitions + signal generation.
// Each strategy is a pure function: takes candles + params → array of
// "signals" (BUY/SELL at a given index). The runner consumes these to
// simulate trades. All computation is on REAL historical candles (PRD §6).

import type { Candle } from "@/lib/types";
import { sma, rsi } from "@/lib/indicators";

export type StrategyType = "MA_CROSS" | "RSI_THRESHOLD" | "BREAKOUT" | "BUY_HOLD";

export interface StrategyParams {
  // MA_CROSS
  fast?: number; // default 20
  slow?: number; // default 50
  // RSI_THRESHOLD
  period?: number; // default 14
  oversold?: number; // default 30
  overbought?: number; // default 70
  // BREAKOUT
  lookback?: number; // default 20
}

export interface Signal {
  index: number; // candle index the signal applies to
  action: "BUY" | "SELL";
  reason: string;
}

export interface StrategyMeta {
  type: StrategyType;
  label: string;
  description: string;
  defaultParams: StrategyParams;
}

export const STRATEGIES: StrategyMeta[] = [
  {
    type: "MA_CROSS",
    label: "MA Crossover",
    description:
      "Buy when fast MA crosses above slow MA; sell on cross below. Trend-following.",
    defaultParams: { fast: 20, slow: 50 },
  },
  {
    type: "RSI_THRESHOLD",
    label: "RSI Mean Reversion",
    description:
      "Buy when RSI < oversold; sell when RSI > overbought. Contrarian.",
    defaultParams: { period: 14, oversold: 30, overbought: 70 },
  },
  {
    type: "BREAKOUT",
    label: "N-Period Breakout",
    description:
      "Buy when close > N-period high; sell when close < N-period low. Momentum.",
    defaultParams: { lookback: 20 },
  },
  {
    type: "BUY_HOLD",
    label: "Buy & Hold (benchmark)",
    description: "Buy at first candle, hold to end. Baseline to compare strategies against.",
    defaultParams: {},
  },
];

/// Generate trading signals for a strategy over a candle series.
export function generateSignals(
  candles: Candle[],
  type: StrategyType,
  params: StrategyParams
): Signal[] {
  if (candles.length < 5) return [];
  switch (type) {
    case "MA_CROSS":
      return maCrossSignals(candles, params.fast ?? 20, params.slow ?? 50);
    case "RSI_THRESHOLD":
      return rsiThresholdSignals(
        candles,
        params.period ?? 14,
        params.oversold ?? 30,
        params.overbought ?? 70
      );
    case "BREAKOUT":
      return breakoutSignals(candles, params.lookback ?? 20);
    case "BUY_HOLD":
      return [{ index: 0, action: "BUY", reason: "Initial entry" }];
  }
}

function maCrossSignals(candles: Candle[], fastP: number, slowP: number): Signal[] {
  const signals: Signal[] = [];
  const fast = sma(candles, fastP);
  const slow = sma(candles, slowP);
  // Align by index: sma returns arrays starting at (period-1).
  // fast[i].value is the MA at candles[i].time. We compare fast vs slow at
  // each index where both exist.
  const fastMap = new Map(fast.map((p) => [p.time, p.value]));
  const slowMap = new Map(slow.map((p) => [p.time, p.value]));
  let prevFast: number | null = null;
  let prevSlow: number | null = null;
  for (let i = 0; i < candles.length; i++) {
    const t = candles[i].time;
    const f = fastMap.get(t);
    const s = slowMap.get(t);
    if (f == null || s == null) continue;
    if (prevFast != null && prevSlow != null) {
      // Cross up: prevFast <= prevSlow && f > s
      if (prevFast <= prevSlow && f > s) {
        signals.push({ index: i, action: "BUY", reason: `MA${fastP} crossed above MA${slowP}` });
      }
      // Cross down: prevFast >= prevSlow && f < s
      if (prevFast >= prevSlow && f < s) {
        signals.push({ index: i, action: "SELL", reason: `MA${fastP} crossed below MA${slowP}` });
      }
    }
    prevFast = f;
    prevSlow = s;
  }
  return signals;
}

function rsiThresholdSignals(
  candles: Candle[],
  period: number,
  oversold: number,
  overbought: number
): Signal[] {
  const signals: Signal[] = [];
  const rsiSeries = rsi(candles, period);
  const rsiMap = new Map(rsiSeries.map((p) => [p.time, p.value]));
  for (let i = 0; i < candles.length; i++) {
    const v = rsiMap.get(candles[i].time);
    if (v == null) continue;
    if (v < oversold) {
      signals.push({ index: i, action: "BUY", reason: `RSI ${v.toFixed(1)} < ${oversold}` });
    } else if (v > overbought) {
      signals.push({ index: i, action: "SELL", reason: `RSI ${v.toFixed(1)} > ${overbought}` });
    }
  }
  return signals;
}

function breakoutSignals(candles: Candle[], lookback: number): Signal[] {
  const signals: Signal[] = [];
  if (candles.length < lookback + 1) return signals;
  for (let i = lookback; i < candles.length; i++) {
    const window = candles.slice(i - lookback, i);
    const high = Math.max(...window.map((c) => c.high));
    const low = Math.min(...window.map((c) => c.low));
    const close = candles[i].close;
    if (close > high) {
      signals.push({
        index: i,
        action: "BUY",
        reason: `Close ${close} > ${lookback}-period high ${high}`,
      });
    } else if (close < low) {
      signals.push({
        index: i,
        action: "SELL",
        reason: `Close ${close} < ${lookback}-period low ${low}`,
      });
    }
  }
  return signals;
}
