// MERIDIAN Terminal — list past backtests + detail by id.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";

/// GET /api/v1/backtest — list recent backtests (without full results).
export async function GET() {
  try {
    const rows = await db.backtest.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { instrument: { select: { id: true, symbol: true, ticker: true, assetClass: true } } },
    });
    const data = rows.map((r) => ({
      id: r.id,
      instrument: r.instrument,
      strategyType: r.strategyType,
      paramsJson: r.paramsJson,
      timeframe: r.timeframe,
      candleCount: r.candleCount,
      initialCapital: r.initialCapital,
      finalEquity: r.finalEquity,
      totalReturnPct: r.totalReturnPct,
      maxDrawdownPct: r.maxDrawdownPct,
      winRate: r.winRate,
      tradeCount: r.tradeCount,
      sharpeRatio: r.sharpeRatio,
      profitFactor: r.profitFactor,
      createdAt: r.createdAt,
    }));
    return ok(data);
  } catch (e) {
    console.error("[backtest.list]", e);
    return fail("Internal error", 500);
  }
}
