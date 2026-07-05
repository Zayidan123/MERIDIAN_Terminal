// MERIDIAN Terminal — single instrument read / delete.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const row = await db.instrument.findUnique({ where: { id } });
    if (!row) return fail("Instrument not found", 404);
    return ok(toInstrument(row));
  } catch (e) {
    console.error("[instrument.GET]", e);
    return fail("Internal error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.instrument.findUnique({ where: { id } });
    if (!existing) return fail("Instrument not found", 404);
    // WatchlistItem, Alert, Position, SignalEvent, Fundamental cascade via schema.
    await db.instrument.delete({ where: { id } });
    return ok(true);
  } catch (e) {
    console.error("[instrument.DELETE]", e);
    return fail("Internal error", 500);
  }
}
