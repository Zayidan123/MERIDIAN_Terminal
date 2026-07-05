// MERIDIAN Terminal — single live quote for one instrument.

import { db } from "@/lib/db";
import { fail, fromResult } from "@/lib/api";
import { getQuote } from "@/lib/data-sources";
import type { AssetClass, DataSourceKey, Instrument } from "@/lib/types";

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
  _request: Request,
  { params }: { params: Promise<{ instrumentId: string }> }
) {
  try {
    const { instrumentId } = await params;
    const row = await db.instrument.findUnique({ where: { id: instrumentId } });
    if (!row) return fail("Instrument not found", 404);
    const instrument = toInstrument(row);
    const result = await getQuote(instrument);
    return fromResult(result);
  } catch (e) {
    console.error("[quote.GET]", e);
    return fail("Internal error", 500);
  }
}
