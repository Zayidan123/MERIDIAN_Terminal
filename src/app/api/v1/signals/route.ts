// MERIDIAN Terminal — list recent SignalEvents with filters.
// GET ?limit=50 (max 200) ?signalType=VOLUME_SPIKE|BREAKOUT|RSI_OB|RSI_OS|
//    ALERT_TRIGGER|ANOMALY (optional) ?since=<epochMs> (optional).
// Returns events newest-first with the `instrument` relation included.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import type { AssetClass, DataSourceKey, Instrument } from "@/lib/types";

const VALID_SIGNAL_TYPES = [
  "VOLUME_SPIKE",
  "BREAKOUT",
  "RSI_OB",
  "RSI_OS",
  "ALERT_TRIGGER",
  "ANOMALY",
] as const;
type SignalType = (typeof VALID_SIGNAL_TYPES)[number];

export interface SignalEventWithInstrument {
  id: string;
  instrumentId: string;
  instrument: Instrument;
  signalType: string;
  severity: string;
  message: string;
  priceAtEvent: number | null;
  context: Record<string, unknown> | null;
  createdAt: number;
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

interface SignalRow {
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
  signalType: string;
  severity: string;
  message: string;
  contextJson: string;
  priceAtEvent: number | null;
  createdAt: Date;
}

function toSignalEventWithInstrument(
  row: SignalRow
): SignalEventWithInstrument {
  let context: Record<string, unknown> | null = null;
  try {
    if (row.contextJson) {
      const parsed = JSON.parse(row.contextJson) as Record<string, unknown>;
      context = parsed;
    }
  } catch {
    // Corrupt JSON — surface as null rather than crashing the whole list.
    context = null;
  }
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    instrument: toInstrument(row.instrument),
    signalType: row.signalType,
    severity: row.severity,
    message: row.message,
    priceAtEvent: row.priceAtEvent,
    context,
    createdAt: row.createdAt.getTime(),
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // limit: 1..200, default 50
    let limit = 50;
    const limitParam = searchParams.get("limit");
    if (limitParam !== null) {
      const n = Number(limitParam);
      if (Number.isFinite(n)) {
        limit = Math.min(Math.max(Math.floor(n), 1), 200);
      }
    }

    // signalType filter (validated; ignored if invalid)
    const signalTypeRaw = searchParams.get("signalType");
    const signalType =
      signalTypeRaw && VALID_SIGNAL_TYPES.includes(signalTypeRaw as SignalType)
        ? signalTypeRaw
        : undefined;

    // since: epoch ms → Date
    const sinceParam = searchParams.get("since");
    let sinceDate: Date | undefined;
    if (sinceParam !== null) {
      const n = Number(sinceParam);
      if (Number.isFinite(n) && n > 0) {
        sinceDate = new Date(n);
      }
    }

    const where: {
      signalType?: string;
      createdAt?: { gt: Date };
    } = {};
    if (signalType) where.signalType = signalType;
    if (sinceDate) where.createdAt = { gt: sinceDate };

    const rows = await db.signalEvent.findMany({
      where,
      include: { instrument: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return ok(
      rows.map((r) => toSignalEventWithInstrument(r as unknown as SignalRow))
    );
  } catch (e) {
    console.error("[signals.GET]", e);
    return fail("Internal error", 500);
  }
}
