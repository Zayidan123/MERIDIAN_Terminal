// MERIDIAN Terminal — single position PATCH / DELETE (PRD FR-3.1).
// PATCH: update entryPrice / size / side / note. Each field validated when
//        present. Returns updated position with instrument relation. The
//        response shape mirrors POST (market fields null — caller refetches
//        via GET /portfolio for live enrichment).
// DELETE: hard-delete the position. Returns { ok: true }.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
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

interface PatchBody {
  entryPrice?: unknown;
  size?: unknown;
  side?: unknown;
  note?: unknown;
}

/// Parse a "number > 0" field that may arrive as number or numeric string.
/// Returns `null` if absent, throws an Error message otherwise.
function parsePositiveNumber(
  v: unknown,
  field: string
): number | null {
  if (v === undefined || v === null) return null;
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string" && v.trim() !== "") {
    n = Number(v);
  } else {
    throw `${field} must be a finite number > 0`;
  }
  if (!Number.isFinite(n) || n <= 0) {
    throw `${field} must be a finite number > 0`;
  }
  return n;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as PatchBody | null;
    if (!body) return fail("Invalid JSON body", 400);

    const existing = await db.position.findUnique({ where: { id } });
    if (!existing) return fail("Position not found", 404);

    const data: {
      entryPrice?: number;
      size?: number;
      side?: string;
      note?: string | null;
    } = {};

    try {
      const ep = parsePositiveNumber(body.entryPrice, "entryPrice");
      if (ep !== null) data.entryPrice = ep;
      const sz = parsePositiveNumber(body.size, "size");
      if (sz !== null) data.size = sz;
    } catch (msg) {
      return fail(String(msg), 400);
    }

    if (body.side !== undefined) {
      const side = typeof body.side === "string" ? body.side : "";
      if (!VALID_SIDES.includes(side as Side)) {
        return fail(`side must be one of ${VALID_SIDES.join("|")}`, 400);
      }
      data.side = side;
    }

    if (body.note !== undefined) {
      if (body.note === null) {
        data.note = null;
      } else if (typeof body.note === "string") {
        data.note = body.note.trim() || null;
      } else {
        return fail("note must be a string or null", 400);
      }
    }

    if (Object.keys(data).length === 0) {
      return fail("No valid fields to update", 400);
    }

    const updated = await db.position.update({
      where: { id },
      data,
      include: { instrument: true },
    });

    const base = toPositionWithInstrument(updated as unknown as PositionRow);
    // PATCH returns the updated row without re-fetching a live quote.
    // The next GET /portfolio will recompute market fields against live prices.
    return ok({
      ...base,
      lastPrice: null,
      marketValue: null,
      unrealizedPnl: null,
      unrealizedPnlPct: null,
    });
  } catch (e) {
    console.error("[position.PATCH]", e);
    return fail("Internal error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.position.findUnique({ where: { id } });
    if (!existing) return fail("Position not found", 404);

    // Hard-delete per spec.
    await db.position.delete({ where: { id } });
    return ok(true);
  } catch (e) {
    console.error("[position.DELETE]", e);
    return fail("Internal error", 500);
  }
}
