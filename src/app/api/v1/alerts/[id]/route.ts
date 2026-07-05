// MERIDIAN Terminal — single alert PATCH / DELETE.
// PATCH: update allowed fields (status, threshold, operator, note).
// DELETE: soft-delete — sets status = "DELETED".

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import type { AssetClass, DataSourceKey, Instrument } from "@/lib/types";

const VALID_OPERATORS = ["gt", "lt", "cross_up", "cross_down"] as const;
const VALID_STATUSES = ["ACTIVE", "TRIGGERED", "PAUSED", "DELETED"] as const;

type Operator = (typeof VALID_OPERATORS)[number];
type Status = (typeof VALID_STATUSES)[number];

interface AlertWithInstrument {
  id: string;
  instrumentId: string;
  instrument: Instrument;
  metric: string;
  operator: string;
  threshold: number;
  status: string;
  note: string | null;
  createdAt: number;
  triggeredAt: number | null;
  updatedAt: number;
}

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

interface AlertRow {
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
  metric: string;
  operator: string;
  threshold: number;
  status: string;
  note: string | null;
  createdAt: Date;
  triggeredAt: Date | null;
  updatedAt: Date;
}

function toAlertWithInstrument(row: AlertRow): AlertWithInstrument {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    instrument: toInstrument(row.instrument),
    metric: row.metric,
    operator: row.operator,
    threshold: row.threshold,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt.getTime(),
    triggeredAt: row.triggeredAt ? row.triggeredAt.getTime() : null,
    updatedAt: row.updatedAt.getTime(),
  };
}

interface PatchBody {
  status?: unknown;
  threshold?: unknown;
  operator?: unknown;
  note?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as PatchBody | null;
    if (!body) return fail("Invalid JSON body", 400);

    const existing = await db.alert.findUnique({ where: { id } });
    if (!existing) return fail("Alert not found", 404);

    const data: {
      status?: string;
      threshold?: number;
      operator?: string;
      note?: string | null;
    } = {};

    if (body.status !== undefined) {
      const status = typeof body.status === "string" ? body.status : "";
      if (!VALID_STATUSES.includes(status as Status)) {
        return fail(`status must be one of ${VALID_STATUSES.join("|")}`, 400);
      }
      data.status = status;
    }

    if (body.threshold !== undefined) {
      let threshold: number;
      if (typeof body.threshold === "number") {
        threshold = body.threshold;
      } else if (
        typeof body.threshold === "string" &&
        body.threshold.trim() !== ""
      ) {
        threshold = Number(body.threshold);
      } else {
        return fail("threshold must be a finite number", 400);
      }
      if (!Number.isFinite(threshold)) {
        return fail("threshold must be a finite number", 400);
      }
      data.threshold = threshold;
    }

    if (body.operator !== undefined) {
      const operator = typeof body.operator === "string" ? body.operator : "";
      if (!VALID_OPERATORS.includes(operator as Operator)) {
        return fail(
          `operator must be one of ${VALID_OPERATORS.join("|")}`,
          400
        );
      }
      data.operator = operator;
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

    const updated = await db.alert.update({
      where: { id },
      data,
      include: { instrument: true },
    });

    return ok(toAlertWithInstrument(updated as unknown as AlertRow));
  } catch (e) {
    console.error("[alert.PATCH]", e);
    return fail("Internal error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.alert.findUnique({ where: { id } });
    if (!existing) return fail("Alert not found", 404);

    // Soft-delete: set status = "DELETED".
    await db.alert.update({
      where: { id },
      data: { status: "DELETED" },
    });

    return ok(true);
  } catch (e) {
    console.error("[alert.DELETE]", e);
    return fail("Internal error", 500);
  }
}
