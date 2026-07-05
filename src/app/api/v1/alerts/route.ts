// MERIDIAN Terminal — Alerts list + create (PRD FR-2.1).
// GET: list alerts where status != "DELETED", instrument included,
//      ordered by createdAt desc.
// POST: create an alert. Validates metric/operator/threshold/instrumentId,
//       defaults status to "ACTIVE".

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import type { AssetClass, DataSourceKey, Instrument } from "@/lib/types";

const VALID_METRICS = [
  "price",
  "pct_change_24h",
  "volume_spike",
  "rsi",
  "price_above_ma",
] as const;
const VALID_OPERATORS = ["gt", "lt", "cross_up", "cross_down"] as const;

type Metric = (typeof VALID_METRICS)[number];
type Operator = (typeof VALID_OPERATORS)[number];

export interface AlertWithInstrument {
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

export function toAlertWithInstrument(row: AlertRow): AlertWithInstrument {
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

export async function GET() {
  try {
    const rows = await db.alert.findMany({
      where: { status: { not: "DELETED" } },
      include: { instrument: true },
      orderBy: { createdAt: "desc" },
    });
    return ok(rows.map((r) => toAlertWithInstrument(r as unknown as AlertRow)));
  } catch (e) {
    console.error("[alerts.GET]", e);
    return fail("Internal error", 500);
  }
}

interface CreateBody {
  instrumentId?: unknown;
  metric?: unknown;
  operator?: unknown;
  threshold?: unknown;
  note?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CreateBody | null;
    if (!body) return fail("Invalid JSON body", 400);

    const instrumentId =
      typeof body.instrumentId === "string" ? body.instrumentId.trim() : "";
    const metric = typeof body.metric === "string" ? body.metric : "";
    const operator = typeof body.operator === "string" ? body.operator : "";

    if (!instrumentId) return fail("instrumentId is required", 400);
    if (!VALID_METRICS.includes(metric as Metric)) {
      return fail(`metric must be one of ${VALID_METRICS.join("|")}`, 400);
    }
    if (!VALID_OPERATORS.includes(operator as Operator)) {
      return fail(`operator must be one of ${VALID_OPERATORS.join("|")}`, 400);
    }

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

    const note =
      typeof body.note === "string" && body.note.trim() !== ""
        ? body.note.trim()
        : null;

    const instrument = await db.instrument.findUnique({
      where: { id: instrumentId },
    });
    if (!instrument)
      return fail(`Instrument "${instrumentId}" not found`, 400);

    const created = await db.alert.create({
      data: {
        instrumentId,
        metric,
        operator,
        threshold,
        note,
        status: "ACTIVE",
      },
      include: { instrument: true },
    });

    return ok(toAlertWithInstrument(created as unknown as AlertRow));
  } catch (e) {
    console.error("[alerts.POST]", e);
    return fail("Internal error", 500);
  }
}
