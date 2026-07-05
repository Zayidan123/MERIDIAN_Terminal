// MERIDIAN Terminal — anomaly & pattern scanner (PRD FR-2.2, FR-2.4).
// POST: scans every instrument in the Default watchlist against REAL
// historical candles (range 3m) and detects:
//   - VOLUME_SPIKE  : volumeZScore(20) > 2.5                (WARN)
//   - BREAKOUT      : last close > max of prior 20 closes    (INFO)
//   - RSI_OB        : rsi14 > 70                             (WARN)
//   - RSI_OS        : rsi14 < 30                             (WARN)
//   - ANOMALY       : |last return - μ| > 3σ                 (CRITICAL)
// All baselines (μ, σ, volume z-score, RSI) are computed from the real
// candle window — NEVER from arbitrary thresholds (PRD §6).
// Dedupes per (instrumentId, signalType) within the last 1 hour to avoid
// spamming the SignalEvent table when polled frequently.
//
// Designed to be polled periodically by the frontend (e.g. every 2-5 min).

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { getCandles } from "@/lib/data-sources";
import { snapshot, volumeZScore, returnsStats } from "@/lib/indicators";
import type { AssetClass, Candle, DataSourceKey, Instrument } from "@/lib/types";

const ONE_HOUR_MS = 60 * 60 * 1000;

interface DetectedResult {
  instrumentId: string;
  ticker: string;
  symbol: string;
  signalType: string;
  severity: string;
  message: string;
  priceAtEvent: number;
  context: Record<string, unknown>;
  signalEventId: string;
}

interface SkippedResult {
  instrumentId: string;
  ticker: string;
  symbol: string;
  error: string;
}

interface ScanResponse {
  scanned: number;
  detected: DetectedResult[];
  skipped: SkippedResult[];
}

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

interface Detection {
  signalType: string;
  severity: string;
  message: string;
  context: Record<string, unknown>;
  priceAtEvent: number;
}

/// Pure detection over a real candle window. Returns 0..N detections.
function detect(instrument: Instrument, candles: Candle[]): Detection[] {
  const out: Detection[] = [];
  if (candles.length < 21) return out;

  const last = candles[candles.length - 1];
  const lastClose = last.close;
  const sym = instrument.symbol;

  // VOLUME_SPIKE — z-score of last bar's volume vs prior 20.
  const z = volumeZScore(candles, 20);
  if (z !== null && z > 2.5) {
    out.push({
      signalType: "VOLUME_SPIKE",
      severity: "WARN",
      message: `${sym}: Volume spike: z-score ${z.toFixed(2)}`,
      context: {
        zScore: z,
        lookback: 20,
        lastVolume: last.volume,
        lastClose,
      },
      priceAtEvent: lastClose,
    });
  }

  // BREAKOUT — last close > max of prior 20 closes (excludes last).
  const prior20 = candles.slice(-21, -1);
  if (prior20.length === 20) {
    const high = Math.max(...prior20.map((c) => c.close));
    if (lastClose > high) {
      out.push({
        signalType: "BREAKOUT",
        severity: "INFO",
        message: `${sym}: 20-period breakout above ${high.toFixed(4)}`,
        context: {
          breakoutLevel: high,
          lastClose,
          lookback: 20,
        },
        priceAtEvent: lastClose,
      });
    }
  }

  // RSI overbought / oversold.
  const snap = snapshot(candles);
  if (snap.rsi14 !== null) {
    if (snap.rsi14 > 70) {
      out.push({
        signalType: "RSI_OB",
        severity: "WARN",
        message: `${sym}: RSI overbought ${snap.rsi14.toFixed(2)}`,
        context: { rsi14: snap.rsi14, lastClose },
        priceAtEvent: lastClose,
      });
    } else if (snap.rsi14 < 30) {
      out.push({
        signalType: "RSI_OS",
        severity: "WARN",
        message: `${sym}: RSI oversold ${snap.rsi14.toFixed(2)}`,
        context: { rsi14: snap.rsi14, lastClose },
        priceAtEvent: lastClose,
      });
    }
  }

  // ANOMALY — last log-return deviates from baseline μ by > 3σ.
  const retStats = returnsStats(candles);
  if (retStats.sample >= 10 && retStats.std > 0) {
    const prevClose = candles[candles.length - 2].close;
    if (prevClose > 0) {
      const lastReturn = Math.log(lastClose / prevClose);
      const deviation = Math.abs(lastReturn - retStats.mean);
      if (deviation > 3 * retStats.std) {
        const retPct = lastReturn * 100;
        const meanPct = retStats.mean * 100;
        const stdPct = retStats.std * 100;
        out.push({
          signalType: "ANOMALY",
          severity: "CRITICAL",
          message: `${sym}: Return anomaly: ${retPct.toFixed(3)}% vs baseline μ=${meanPct.toFixed(3)}% σ=${stdPct.toFixed(3)}%`,
          context: {
            lastReturn: retPct,
            mean: meanPct,
            std: stdPct,
            sample: retStats.sample,
            deviation: deviation * 100,
            zScore: deviation / retStats.std,
            lastClose,
          },
          priceAtEvent: lastClose,
        });
      }
    }
  }

  return out;
}

export async function POST() {
  try {
    const wl = await db.watchlist.findFirst({
      where: { name: "Default" },
      include: { items: { include: { instrument: true } } },
    });

    if (!wl) {
      const data: ScanResponse = {
        scanned: 0,
        detected: [],
        skipped: [],
      };
      return ok(data);
    }

    const instruments = (wl.items ?? [])
      .map((i) => i.instrument)
      .filter((i): i is NonNullable<typeof i> => Boolean(i))
      .map(toInstrument);

    const detected: DetectedResult[] = [];
    const skipped: SkippedResult[] = [];
    const oneHourAgo = new Date(Date.now() - ONE_HOUR_MS);

    for (const instrument of instruments) {
      try {
        const cr = await getCandles(instrument, "3m");
        if (!cr.ok || !cr.data || cr.data.length === 0) {
          skipped.push({
            instrumentId: instrument.id,
            ticker: instrument.ticker,
            symbol: instrument.symbol,
            error: cr.error || "Candles unavailable",
          });
          continue;
        }
        const candles = cr.data;
        const detections = detect(instrument, candles);

        // Last 3 candles — included in every emitted SignalEvent's context
        // for later accuracy evaluation (PRD FR-2.4).
        const last3 = candles.slice(-3).map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));

        for (const d of detections) {
          // Dedupe: skip silently if same (instrumentId, signalType) was
          // recorded in the last hour.
          const existing = await db.signalEvent.findFirst({
            where: {
              instrumentId: instrument.id,
              signalType: d.signalType,
              createdAt: { gt: oneHourAgo },
            },
            select: { id: true },
          });
          if (existing) continue;

          const contextJson = JSON.stringify({
            ...d.context,
            last3Candles: last3,
          });

          const created = await db.signalEvent.create({
            data: {
              instrumentId: instrument.id,
              signalType: d.signalType,
              severity: d.severity,
              message: d.message,
              contextJson,
              priceAtEvent: d.priceAtEvent,
            },
          });

          detected.push({
            instrumentId: instrument.id,
            ticker: instrument.ticker,
            symbol: instrument.symbol,
            signalType: d.signalType,
            severity: d.severity,
            message: d.message,
            priceAtEvent: d.priceAtEvent,
            context: d.context,
            signalEventId: created.id,
          });
        }
      } catch (err) {
        skipped.push({
          instrumentId: instrument.id,
          ticker: instrument.ticker,
          symbol: instrument.symbol,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const data: ScanResponse = {
      scanned: instruments.length,
      detected,
      skipped,
    };
    return ok(data);
  } catch (e) {
    console.error("[signals.scan.POST]", e);
    return fail("Internal error", 500);
  }
}
