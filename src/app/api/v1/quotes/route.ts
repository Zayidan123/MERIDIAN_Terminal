// MERIDIAN Terminal — concurrent live quotes for all Default watchlist
// instruments. Each row carries its own ok|error so the frontend can show
// per-row "source unavailable" without hiding successful rows.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { getQuotes } from "@/lib/data-sources";
import type { AssetClass, DataSourceKey, Instrument, Quote } from "@/lib/types";

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

interface QuoteRowSuccess {
  ok: true;
  instrumentId: string;
  ticker: string;
  symbol: string;
  quote: Quote;
  provenance: { source: string; sourceLabel: string; syncedAt: number; status?: string };
}
interface QuoteRowFailure {
  ok: false;
  instrumentId: string;
  ticker: string;
  symbol: string;
  error: string;
}
type QuoteRow = QuoteRowSuccess | QuoteRowFailure;

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

    const instruments = (wl.items ?? [])
      .map((i) => i.instrument)
      .filter((i): i is NonNullable<typeof i> => Boolean(i))
      .map(toInstrument);

    const results = await getQuotes(instruments);

    const rows: QuoteRow[] = results.map(({ instrument, result }) => {
      if (result.ok && result.data) {
        return {
          ok: true,
          instrumentId: instrument.id,
          ticker: instrument.ticker,
          symbol: instrument.symbol,
          quote: result.data,
          provenance: {
            source: result.provenance?.source ?? instrument.source,
            sourceLabel: result.provenance?.sourceLabel ?? instrument.source,
            syncedAt: result.provenance?.syncedAt ?? result.data.syncedAt,
            status: result.provenance?.status,
          },
        };
      }
      return {
        ok: false,
        instrumentId: instrument.id,
        ticker: instrument.ticker,
        symbol: instrument.symbol,
        error: result.error ?? "Source unavailable",
      };
    });

    // Aggregate provenance: latest syncedAt among successful rows.
    const syncedAts = rows
      .filter((r): r is QuoteRowSuccess => r.ok)
      .map((r) => r.provenance.syncedAt);
    const latestSyncedAt = syncedAts.length ? Math.max(...syncedAts) : Date.now();

    return ok(
      {
        quotes: rows,
        provenance: {
          source: "multi",
          sourceLabel: "Multi-source",
          syncedAt: latestSyncedAt,
        },
      },
      {
        source: "multi",
        sourceLabel: "Multi-source",
        syncedAt: latestSyncedAt,
      }
    );
  } catch (e) {
    console.error("[quotes.GET]", e);
    return fail("Internal error", 500);
  }
}
