// MERIDIAN Terminal — historical persisted candles endpoint.
// PRD §14: exposes the locally-persisted `price_ohlcv` rows for an instrument.
// Used by future backtesting / offline historical analysis. Returns whatever
// is stored locally; if nothing is stored yet, returns an empty array
// (callers should fetch fresh via /prices/[id] first to populate the store).

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import type { Candle } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ instrumentId: string }> }
) {
  try {
    const { instrumentId } = await params;
    const instrument = await db.instrument.findUnique({ where: { id: instrumentId } });
    if (!instrument) return fail("Instrument not found", 404);

    const url = new URL(_request.url);
    const timeframe = url.searchParams.get("timeframe"); // e.g. "1d","1h"
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "500", 10) || 500, 5000);

    const where: { instrumentId: string; timeframe?: string } = { instrumentId };
    if (timeframe) where.timeframe = timeframe;

    const rows = await db.priceOhlcv.findMany({
      where,
      orderBy: { timestamp: "asc" },
      take: limit,
    });

    const candles: Candle[] = rows.map((r) => ({
      time: r.timestamp,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));

    return ok({
      instrumentId,
      ticker: instrument.ticker,
      symbol: instrument.symbol,
      timeframe: timeframe ?? "all",
      count: candles.length,
      candles,
    });
  } catch (e) {
    console.error("[history.GET]", e);
    return fail("Internal error", 500);
  }
}
