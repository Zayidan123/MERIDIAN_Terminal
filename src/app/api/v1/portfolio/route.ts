// MERIDIAN Terminal — Portfolio list + create (PRD FR-3.1).
// GET: list all positions with instrument relation. For each position, fetch
//      the live quote (getQuote) concurrently and compute lastPrice,
//      marketValue, unrealizedPnl, unrealizedPnlPct. When the quote fetch
//      fails for a position, lastPrice/marketValue/unrealizedPnl/
//      unrealizedPnlPct are null and an `error` field is set on that row —
//      integrity policy §6 (never fabricate a price).
// POST: create a position. Validates side ∈ {LONG,SHORT}, entryPrice>0,
//       size>0, instrumentId exists. openedAt defaults to now.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { getQuote } from "@/lib/data-sources";
import type {
  AssetClass,
  DataSourceKey,
  Instrument,
} from "@/lib/types";

const VALID_SIDES = ["LONG", "SHORT"] as const;
type Side = (typeof VALID_SIDES)[number];

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

interface PositionWithInstrument {
  id: string;
  instrumentId: string;
  instrument: Instrument;
  side: string;
  entryPrice: number;
  size: number;
  openedAt: number;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PositionWithMarket extends PositionWithInstrument {
  lastPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  error?: string;
}

interface PositionRow {
  id: string;
  instrumentId: string;
  instrument: {
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
  };
  side: string;
  entryPrice: number;
  size: number;
  openedAt: Date;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPositionWithInstrument(row: PositionRow): PositionWithInstrument {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    instrument: toInstrument(row.instrument),
    side: row.side,
    entryPrice: row.entryPrice,
    size: row.size,
    openedAt: row.openedAt.getTime(),
    note: row.note,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/// Compute per-position market fields from a live quote price.
/// lastPrice null → all derived fields null (integrity policy §6).
function computeMarketFields(
  side: string,
  entryPrice: number,
  size: number,
  lastPrice: number | null
): {
  lastPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
} {
  if (lastPrice === null || !Number.isFinite(lastPrice)) {
    return {
      lastPrice: null,
      marketValue: null,
      unrealizedPnl: null,
      unrealizedPnlPct: null,
    };
  }
  const marketValue = size * lastPrice;
  const cost = entryPrice * size;
  const pnl =
    side === "SHORT"
      ? (entryPrice - lastPrice) * size
      : (lastPrice - entryPrice) * size;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : null;
  return {
    lastPrice,
    marketValue,
    unrealizedPnl: pnl,
    unrealizedPnlPct: pnlPct,
  };
}

export async function GET() {
  try {
    const rows = await db.position.findMany({
      include: { instrument: true },
      orderBy: { createdAt: "desc" },
    });

    // Concurrent live quotes for every position's instrument.
    const quoteResults = await Promise.all(
      rows.map(async (r) => {
        const instrument = toInstrument(r.instrument);
        const result = await getQuote(instrument);
        return { row: r as unknown as PositionRow, instrument, result };
      })
    );

    const data: PositionWithMarket[] = quoteResults.map(({ row, result }) => {
      const base = toPositionWithInstrument(row);
      if (result.ok && result.data) {
        const price = result.data.price;
        return {
          ...base,
          ...computeMarketFields(row.side, row.entryPrice, row.size, price),
        };
      }
      // Quote fetch failed — surface honestly, never fabricate.
      return {
        ...base,
        lastPrice: null,
        marketValue: null,
        unrealizedPnl: null,
        unrealizedPnlPct: null,
        error: result.error ?? "Live quote unavailable",
      };
    });

    return ok(data);
  } catch (e) {
    console.error("[portfolio.GET]", e);
    return fail("Internal error", 500);
  }
}

interface CreateBody {
  instrumentId?: unknown;
  side?: unknown;
  entryPrice?: unknown;
  size?: unknown;
  openedAt?: unknown;
  note?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CreateBody | null;
    if (!body) return fail("Invalid JSON body", 400);

    const instrumentId =
      typeof body.instrumentId === "string" ? body.instrumentId.trim() : "";
    const side = typeof body.side === "string" ? body.side : "";

    if (!instrumentId) return fail("instrumentId is required", 400);
    if (!VALID_SIDES.includes(side as Side)) {
      return fail(`side must be one of ${VALID_SIDES.join("|")}`, 400);
    }

    let entryPrice: number;
    if (typeof body.entryPrice === "number") {
      entryPrice = body.entryPrice;
    } else if (
      typeof body.entryPrice === "string" &&
      body.entryPrice.trim() !== ""
    ) {
      entryPrice = Number(body.entryPrice);
    } else {
      return fail("entryPrice must be a number > 0", 400);
    }
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      return fail("entryPrice must be a number > 0", 400);
    }

    let size: number;
    if (typeof body.size === "number") {
      size = body.size;
    } else if (typeof body.size === "string" && body.size.trim() !== "") {
      size = Number(body.size);
    } else {
      return fail("size must be a number > 0", 400);
    }
    if (!Number.isFinite(size) || size <= 0) {
      return fail("size must be a number > 0", 400);
    }

    let openedAt: Date | undefined;
    if (body.openedAt !== undefined && body.openedAt !== null) {
      const t =
        typeof body.openedAt === "number"
          ? body.openedAt
          : typeof body.openedAt === "string"
            ? Date.parse(body.openedAt)
            : NaN;
      if (!Number.isFinite(t)) {
        return fail("openedAt must be an epoch ms number or ISO string", 400);
      }
      openedAt = new Date(t);
    }

    const note =
      typeof body.note === "string" && body.note.trim() !== ""
        ? body.note.trim()
        : null;

    const instrument = await db.instrument.findUnique({
      where: { id: instrumentId },
    });
    if (!instrument)
      return fail(`Instrument "${instrumentId}" not found`, 400);

    const created = await db.position.create({
      data: {
        instrumentId,
        side,
        entryPrice,
        size,
        openedAt,
        note,
      },
      include: { instrument: true },
    });

    const base = toPositionWithInstrument(created as unknown as PositionRow);
    // POST returns the freshly-created position; we don't fetch a live quote
    // here (the next GET list will enrich it). Keeps the create call cheap and
    // avoids coupling a successful write to a possibly-rate-limited upstream.
    return ok({
      ...base,
      lastPrice: null,
      marketValue: null,
      unrealizedPnl: null,
      unrealizedPnlPct: null,
    });
  } catch (e) {
    console.error("[portfolio.POST]", e);
    return fail("Internal error", 500);
  }
}
