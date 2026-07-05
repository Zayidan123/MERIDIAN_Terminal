// MERIDIAN Terminal — OHLCV candles for an instrument.
// GET ?range=1d|7d|1m|3m|1y (default 7d).

import { db } from "@/lib/db";
import { ok, fail, fromResult } from "@/lib/api";
import { getCandles } from "@/lib/data-sources";
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
    const rangeParam = searchParams.get("range") ?? "7d";
    const range = VALID_RANGES.includes(rangeParam as Range) ? (rangeParam as Range) : "7d";

    const row = await db.instrument.findUnique({ where: { id: instrumentId } });
    if (!row) return fail("Instrument not found", 404);
    const instrument = toInstrument(row);

    const result = await getCandles(instrument, range);
    if (!result.ok || !result.data) return fromResult(result);

    return ok(
      { instrument, range, candles: result.data },
      result.provenance
    );
  } catch (e) {
    console.error("[prices.GET]", e);
    return fail("Internal error", 500);
  }
}
