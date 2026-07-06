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
///
/// SQLite in Prisma does NOT support `createMany({ skipDuplicates: true })`
/// (that option is PostgreSQL/MySQL only). We use raw `INSERT OR IGNORE`
/// which is native SQLite syntax that achieves the same semantics: rows
/// violating the unique (instrumentId, timeframe, timestamp) constraint are
/// silently skipped, new rows are inserted.
///
/// Non-blocking: the write is fire-and-forget. Caller never waits on this
/// for the data path. Errors are logged, never thrown.
export function persistCandles(
  instrument: Instrument,
  range: Range,
  candles: Candle[]
): void {
  if (candles.length === 0) return;
  const timeframe = rangeToTimeframe(range, instrument.source);
  // Build a parameterized multi-row INSERT OR IGNORE.
  // fetchedAt has @default(now()) in schema → omit it, let DB default apply.
  // Each row gets a generated id (crypto.randomUUID). Values are passed as
  // flat params to prevent SQL injection (§16.5).
  const placeholders: string[] = [];
  const params: (string | number)[] = [];
  for (const c of candles) {
    placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    params.push(
      crypto.randomUUID(),
      instrument.id,
      timeframe,
      c.time,
      c.open,
      c.high,
      c.low,
      c.close,
      c.volume,
      instrument.source
    );
  }
  const sql = `INSERT OR IGNORE INTO PriceOhlcv (id, instrumentId, timeframe, timestamp, open, high, low, close, volume, source) VALUES ${placeholders.join(", ")}`;
  db.$executeRawUnsafe(sql, ...params).catch((e) => {
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
      time: Number(r.timestamp),
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
