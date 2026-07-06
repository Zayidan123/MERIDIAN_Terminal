// MERIDIAN Terminal — backtest detail (full results + trades).

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const r = await db.backtest.findUnique({
      where: { id },
      include: {
        instrument: { select: { id: true, symbol: true, ticker: true, assetClass: true, currency: true } },
        trades: { orderBy: { entryTime: "asc" } },
      },
    });
    if (!r) return fail("Backtest not found", 404);

    const results = JSON.parse(r.resultsJson) as {
      equityCurve: { time: number; equity: number; drawdown: number }[];
      metrics: Record<string, unknown>;
      signals: { index: number; action: string; reason: string; time: number; price: number }[];
    };

    return ok({
      id: r.id,
      instrument: r.instrument,
      strategyType: r.strategyType,
      params: JSON.parse(r.paramsJson),
      timeframe: r.timeframe,
      period: { start: Number(r.startTs), end: Number(r.endTs) },
      candleCount: r.candleCount,
      createdAt: r.createdAt,
      metrics: results.metrics,
      equityCurve: results.equityCurve,
      signals: results.signals,
      trades: r.trades.map((t) => ({
        id: t.id,
        side: t.side,
        entryTime: Number(t.entryTime),
        exitTime: Number(t.exitTime),
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        size: t.size,
        pnl: t.pnl,
        pnlPct: t.pnlPct,
        exitReason: t.exitReason,
      })),
    });
  } catch (e) {
    console.error("[backtest.detail]", e);
    return fail("Internal error", 500);
  }
}
