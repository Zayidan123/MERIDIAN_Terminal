// MERIDIAN Terminal — technical indicators computed from real OHLCV.
// Pure functions, no external data. PRD FR-1.2.

import type { Candle, IndicatorPoint, TechnicalSnapshot } from "@/lib/types";

export function sma(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (period <= 0 || candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

export function ema(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (period <= 0 || candles.length === 0) return out;
  const k = 2 / (period + 1);
  let prev = candles[0].close;
  out.push({ time: candles[0].time, value: prev });
  for (let i = 1; i < candles.length; i++) {
    const v = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: v });
    prev = v;
  }
  return out;
}

/// Wilder's RSI.
export function rsi(candles: Candle[], period = 14): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out.push({ time: candles[period].time, value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss) });
  for (let i = period + 1; i < candles.length; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out.push({
      time: candles[i].time,
      value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss),
    });
  }
  return out;
}

/// MACD (12,26,9).
export function macd(candles: Candle[]): {
  macd: IndicatorPoint[];
  signal: IndicatorPoint[];
  hist: IndicatorPoint[];
} {
  const ema12 = ema(candles, 12);
  const ema26 = ema(candles, 26);
  // align by time
  const map26 = new Map(ema26.map((p) => [p.time, p.value]));
  const macdLine: IndicatorPoint[] = [];
  for (const p of ema12) {
    const v26 = map26.get(p.time);
    if (v26 !== undefined) macdLine.push({ time: p.time, value: p.value - v26 });
  }
  // signal = EMA(9) of macd line
  const pseudo: Candle[] = macdLine.map((p) => ({
    time: p.time,
    open: p.value,
    high: p.value,
    low: p.value,
    close: p.value,
    volume: 0,
  }));
  const signalLine = ema(pseudo, 9);
  const sigMap = new Map(signalLine.map((p) => [p.time, p.value]));
  const hist: IndicatorPoint[] = macdLine.map((p) => ({
    time: p.time,
    value: p.value - (sigMap.get(p.time) ?? 0),
  }));
  return { macd: macdLine, signal: signalLine, hist };
}

export function snapshot(candles: Candle[]): TechnicalSnapshot {
  const last = candles[candles.length - 1];
  const ma20 = sma(candles, 20).at(-1)?.value ?? null;
  const ma50 = sma(candles, 50).at(-1)?.value ?? null;
  const ema12 = ema(candles, 12).at(-1)?.value ?? null;
  const rsi14 = rsi(candles, 14).at(-1)?.value ?? null;
  const m = macd(candles);
  return {
    ma20,
    ma50,
    ema12,
    rsi14,
    macd: m.macd.at(-1)?.value ?? null,
    macdSignal: m.signal.at(-1)?.value ?? null,
    macdHist: m.hist.at(-1)?.value ?? null,
  };
}

/// Mean & stddev of log-returns (for anomaly detection baseline).
export function returnsStats(candles: Candle[]): {
  mean: number;
  std: number;
  sample: number;
} {
  if (candles.length < 2) return { mean: 0, std: 0, sample: 0 };
  const rets: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i - 1].close > 0) rets.push(Math.log(candles[i].close / candles[i - 1].close));
  }
  const n = rets.length;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance), sample: n };
}

/// Volume z-score (for volume-spike detection). Returns last bar z vs prior N.
export function volumeZScore(candles: Candle[], lookback = 20): number | null {
  if (candles.length < lookback + 1) return null;
  const window = candles.slice(-lookback - 1, -1).map((c) => c.volume);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  const lastVol = candles[candles.length - 1].volume;
  return (lastVol - mean) / std;
}

/// Pearson correlation of two return series (PRD FR-3.5).
export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  const ma = a.slice(0, n).reduce((x, y) => x + y, 0) / n;
  const mb = b.slice(0, n).reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  if (den === 0) return null;
  return num / den;
}

/// Historical value at risk (parametric, 95%) from return distribution.
export function valueAtRisk(candles: Candle[], equity: number, confidence = 0.95): number | null {
  const { std, sample } = returnsStats(candles);
  if (sample < 10 || std === 0) return null;
  // z for 95% ~= 1.645
  const z = confidence === 0.99 ? 2.326 : 1.645;
  return equity * std * z;
}
