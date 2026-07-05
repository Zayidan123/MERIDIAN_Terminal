// MERIDIAN Terminal — technical indicator snapshot computed from real candles.
// GET ?range=1d|7d|1m|3m|1y (default 3m).

import { db } from "@/lib/db";
import { ok, fail, fromResult } from "@/lib/api";
import { getCandles } from "@/lib/data-sources";
import { snapshot, volumeZScore, returnsStats } from "@/lib/indicators";
import type { AssetClass, DataSourceKey, Instrument, Range } from "@/lib/types";

const VALID_RANGES: Range[] = ["1d", "7d", "1m", "3m", "1y"];

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ instrumentId: string }> }
) {
  try {
    const { instrumentId } = await params;
    const { searchParams } = new URL(request.url);
    const rangeParam = searchParams.get("range") ?? "3m";
    const range = VALID_RANGES.includes(rangeParam as Range) ? (rangeParam as Range) : "3m";

    const row = await db.instrument.findUnique({ where: { id: instrumentId } });
    if (!row) return fail("Instrument not found", 404);
    const instrument = toInstrument(row);

    const result = await getCandles(instrument, range);
    if (!result.ok || !result.data) return fromResult(result);
    const candles = result.data;
    if (candles.length === 0) {
      return fail("No candles available for this range", 502);
    }

    const technicals = snapshot(candles);
    const volZ = volumeZScore(candles);
    const retStats = returnsStats(candles);
    const lastClose = candles[candles.length - 1].close;

    return ok(
      {
        technicals,
        volumeZScore: volZ,
        returnsStats: retStats,
        lastClose,
        range,
        candleCount: candles.length,
      },
      result.provenance
    );
  } catch (e) {
    console.error("[technicals.GET]", e);
    return fail("Internal error", 500);
  }
}
