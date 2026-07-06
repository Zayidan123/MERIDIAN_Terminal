// MERIDIAN Terminal — bulk historical candle import for backtesting.
// POST { instrumentId?: string, all?: boolean, range?: "1y"|"3m" }
// Fetches real candles from the source API and persists them to price_ohlcv
// (the data facade auto-persists on every fetch via persistCandles).
// This "warms up" the local DB so backtests can run without re-hitting APIs.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { getCandles } from "@/lib/data-sources";
import type { Instrument, Range, AssetClass, DataSourceKey } from "@/lib/types";

function toInstrument(row: {
  id: string; assetClass: string; ticker: string; symbol: string;
  name: string; exchange: string | null; currency: string; source: string;
  lotSize: number | null; metadata: string | null;
}): Instrument {
  return {
    id: row.id, assetClass: row.assetClass as AssetClass, ticker: row.ticker,
    symbol: row.symbol, name: row.name, exchange: row.exchange,
    currency: row.currency, source: row.source as DataSourceKey,
    lotSize: row.lotSize, metadata: row.metadata,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const range = (body.range as Range) || "1y";
    if (!["1y", "3m"].includes(range)) return fail("range must be '1y' or '3m'", 400);

    // Determine target instruments.
    let instruments: Instrument[];
    if (body.all) {
      const rows = await db.instrument.findMany();
      instruments = rows.map(toInstrument);
    } else if (body.instrumentId) {
      const row = await db.instrument.findUnique({ where: { id: body.instrumentId } });
      if (!row) return fail("Instrument not found", 404);
      instruments = [toInstrument(row)];
    } else {
      return fail("Provide instrumentId or all=true", 400);
    }

    // Fetch + persist (facade auto-persists). Sequential to avoid hammering APIs.
    const imported: { ticker: string; symbol: string; count: number }[] = [];
    const failed: { ticker: string; symbol: string; error: string }[] = [];
    for (const inst of instruments) {
      const result = await getCandles(inst, range);
      if (result.ok && result.data && result.data.length > 0) {
        imported.push({ ticker: inst.ticker, symbol: inst.symbol, count: result.data.length });
      } else {
        failed.push({ ticker: inst.ticker, symbol: inst.symbol, error: result.error ?? "No data" });
      }
    }
    return ok({ range, imported, failed });
  } catch (e) {
    console.error("[backtest.import]", e);
    return fail("Internal error", 500);
  }
}
