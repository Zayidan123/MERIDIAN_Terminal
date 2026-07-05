// MERIDIAN Terminal — OHLCV persistence (PRD §14 `price_ohlcv`).
// Persists real candles to the local DB as they're fetched, enabling
// historical queries + future backtesting without re-hitting APIs.
// Integrity (PRD §6): we only ever persist REAL data returned by sources.
// Persistence is best-effort — a DB write failure must never break the read.

import { db } from "@/lib/db";
import type { Candle, Instrument, Range } from "@/lib/types";

/// Map a MERIDIAN range to the candle timeframe string stored in PriceOhlcv.
/// Mirrors the interval chosen by the binance/yahoo data-source clients so
/// persisted rows are consistent across fetches.
export function rangeToTimeframe(range: Range, source: string): string {
  if (source === "binance") {
    switch (range) {
      case "1d":
        return "15m";
      case "7d":
        return "1h";
      case "1m":
        return "4h";
      case "3m":
        return "1d";
      case "1y":
        return "1d";
    }
  }
  // yahoo
  switch (range) {
    case "1d":
      return "5m";
    case "7d":
      return "30m";
    case "1m":
    case "3m":
    case "1y":
      return "1d";
  }
}

/// Persist a batch of candles for an instrument+range. Upsert by the
/// (instrumentId, timeframe, timestamp) unique key so re-fetching the same
/// window updates existing rows instead of duplicating.
/// Non-blocking: fires a single createMany with skipDuplicates for efficiency,
/// swallows errors. Caller never waits on this for the data path.
export function persistCandles(
  instrument: Instrument,
  range: Range,
  candles: Candle[]
): void {
  if (candles.length === 0) return;
  const timeframe = rangeToTimeframe(range, instrument.source);
  const rows = candles.map((c) => ({
    instrumentId: instrument.id,
    timeframe,
    timestamp: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    source: instrument.source,
  }));
  // createMany with skipDuplicates handles the upsert semantics for the
  // compound unique index. SQLite supports this natively in Prisma.
  db.priceOhlcv
    .createMany({ data: rows, skipDuplicates: true })
    .catch((e) => {
      console.error("[persistCandles] failed", e);
    });
}

/// Read persisted candles for an instrument+range from the local DB.
/// Returns null if not enough rows are stored (caller falls back to API).
/// Used for offline/historical analysis + future backtesting.
export async function readPersistedCandles(
  instrumentId: string,
  range: Range,
  source: string
): Promise<Candle[] | null> {
  const timeframe = rangeToTimeframe(range, source);
  const limit =
    range === "1d" ? 96 : range === "7d" ? 168 : range === "1m" ? 180 : range === "3m" ? 90 : 365;
  try {
    const rows = await db.priceOhlcv.findMany({
      where: { instrumentId, timeframe },
      orderBy: { timestamp: "asc" },
      take: limit,
    });
    if (rows.length < 5) return null; // not enough local history to be useful
    return rows.map((r) => ({
      time: r.timestamp,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
  } catch (e) {
    console.error("[readPersistedCandles] failed", e);
    return null;
  }
}
