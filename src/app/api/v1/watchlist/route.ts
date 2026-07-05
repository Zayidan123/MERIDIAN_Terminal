// MERIDIAN Terminal — Default watchlist with its instruments.

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

export async function GET() {
  try {
    let wl = await db.watchlist.findFirst({
      where: { name: "Default" },
      include: {
        items: {
          include: { instrument: true },
          orderBy: { instrument: { symbol: "asc" } },
        },
      },
    });
    if (!wl) {
      wl = await db.watchlist.create({
        data: { name: "Default" },
        include: { items: { include: { instrument: true } } },
      });
    }

    const items = (wl.items ?? [])
      .slice()
      .sort((a, b) => (a.instrument?.symbol ?? "").localeCompare(b.instrument?.symbol ?? ""))
      .map((item) => ({
        id: item.id,
        instrument: item.instrument ? toInstrument(item.instrument) : null,
        addedAt: item.addedAt.getTime(),
      }));

    return ok({ id: wl.id, name: wl.name, items });
  } catch (e) {
    console.error("[watchlist.GET]", e);
    return fail("Internal error", 500);
  }
}
