// MERIDIAN Terminal — Instruments list + add.
// GET: list all instruments (optionally filtered by assetClass). Idempotent
//      ensureSeed so the universe always exists on first call.
// POST: add a custom instrument + attach to Default watchlist.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";
import type { AssetClass, DataSourceKey, Instrument } from "@/lib/types";

const VALID_ASSET_CLASSES: AssetClass[] = ["CRYPTO", "EQUITY", "FOREX", "COMMODITY"];
const VALID_SOURCES: DataSourceKey[] = ["binance", "yahoo"];

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

export async function GET(request: Request) {
  try {
    await ensureSeed();
    const { searchParams } = new URL(request.url);
    const assetClass = searchParams.get("assetClass");
    const where = assetClass ? { assetClass } : {};
    const rows = await db.instrument.findMany({
      where,
      orderBy: [{ assetClass: "asc" }, { symbol: "asc" }],
    });
    const data = rows.map(toInstrument);
    return ok(data);
  } catch (e) {
    console.error("[instruments.GET]", e);
    return fail("Internal error", 500);
  }
}

interface CreateBody {
  ticker?: unknown;
  symbol?: unknown;
  name?: unknown;
  assetClass?: unknown;
  currency?: unknown;
  source?: unknown;
  exchange?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CreateBody | null;
    if (!body) return fail("Invalid JSON body", 400);

    const ticker = typeof body.ticker === "string" ? body.ticker.trim() : "";
    const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const assetClass = typeof body.assetClass === "string" ? (body.assetClass as AssetClass) : null;
    const currency = typeof body.currency === "string" ? body.currency.trim() : "";
    const source = typeof body.source === "string" ? (body.source as DataSourceKey) : null;
    const exchange = typeof body.exchange === "string" && body.exchange.trim() ? body.exchange.trim() : null;

    if (!ticker) return fail("ticker is required", 400);
    if (!symbol) return fail("symbol is required", 400);
    if (!name) return fail("name is required", 400);
    if (!currency) return fail("currency is required", 400);
    if (!assetClass || !VALID_ASSET_CLASSES.includes(assetClass))
      return fail(`assetClass must be one of ${VALID_ASSET_CLASSES.join("|")}`, 400);
    if (!source || !VALID_SOURCES.includes(source))
      return fail(`source must be one of ${VALID_SOURCES.join("|")}`, 400);

    let created;
    try {
      created = await db.instrument.create({
        data: {
          assetClass,
          ticker,
          symbol,
          name,
          exchange: exchange ?? null,
          currency,
          source,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("unique") || (e as { code?: string }).code === "P2002") {
        return fail(`Instrument with ticker "${ticker}" already exists`, 409);
      }
      throw e;
    }

    // Attach to Default watchlist (create watchlist if missing for safety).
    let wl = await db.watchlist.findFirst({ where: { name: "Default" } });
    if (!wl) wl = await db.watchlist.create({ data: { name: "Default" } });
    const existingItem = await db.watchlistItem.findUnique({
      where: { watchlistId_instrumentId: { watchlistId: wl.id, instrumentId: created.id } },
    });
    if (!existingItem) {
      await db.watchlistItem.create({ data: { watchlistId: wl.id, instrumentId: created.id } });
    }

    return NextResponse.json({ ok: true, data: toInstrument(created) }, { status: 201 });
  } catch (e) {
    console.error("[instruments.POST]", e);
    return fail("Internal error", 500);
  }
}
