// MERIDIAN Terminal — run a backtest.
// POST { instrumentId, strategyType, params?, initialCapital?, range? }
// Loads candles (from persisted price_ohlcv first; falls back to live fetch
// + persist if not enough local data), runs the strategy, saves the result,
// returns the full BacktestResult.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { getCandles } from "@/lib/data-sources";
import { readPersistedCandles } from "@/lib/persist-candles";
import { runBacktest } from "@/lib/backtest/runner";
import { STRATEGIES, type StrategyType, type StrategyParams } from "@/lib/backtest/strategies";
import type { Instrument, Range, AssetClass, DataSourceKey, Candle } from "@/lib/types";

function toInstrument(row: {
  id: string; assetClass: string; ticker: string; symbol: string;
  name: string; exchange: string | null; currency: string; source: string;
  lotSize: number | null; metadata: string | null;
}): Instrument {
  return {
    id: row.id, assetClass: row.assetClass as AssetClass, ticker: row.ticker,
    symbol: row.symbol, name: row.name, exchange: row.exchange,
    currency: row.currency, source: row.source as DataSourceKey,
    lotSize: row.lotSize, metadata: row.metadata,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { instrumentId, strategyType, params, initialCapital, range } = body;
    if (!instrumentId) return fail("instrumentId required", 400);
    if (!strategyType) return fail("strategyType required", 400);

    const validTypes = STRATEGIES.map((s) => s.type);
    if (!validTypes.includes(strategyType as StrategyType)) {
      return fail(`strategyType must be one of: ${validTypes.join(", ")}`, 400);
    }

    const row = await db.instrument.findUnique({ where: { id: instrumentId } });
    if (!row) return fail("Instrument not found", 404);
    const instrument = toInstrument(row);

    const candleRange: Range = range || "1y";
    const capital = typeof initialCapital === "number" && initialCapital > 0 ? initialCapital : 10000;
    const stratParams: StrategyParams = params ?? {};

    // 1. Try persisted candles first (fast, no API hit).
    let candles = await readPersistedCandles(instrument.id, candleRange, instrument.source);

    // 2. If not enough local data, fetch live (facade auto-persists) + retry read.
    if (!candles || candles.length < 30) {
      const result = await getCandles(instrument, candleRange);
      if (!result.ok || !result.data || result.data.length < 30) {
        return fail(
          result.error ?? `Insufficient candle data (${result.data?.length ?? 0} candles, need ≥30)`,
          502
        );
      }
      candles = result.data as Candle[];
      // persistCandles already fired in the facade (non-blocking). Wait briefly
      // so the subsequent readPersistedCandles can see them (best-effort).
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!candles || candles.length < 30) {
      return fail("Not enough historical data to backtest (need ≥30 candles)", 400);
    }

    // 3. Run the backtest.
    const result = runBacktest(candles, strategyType as StrategyType, stratParams, capital);

    // 4. Persist the backtest + trades.
    const startTs = BigInt(candles[0].time);
    const endTs = BigInt(candles[candles.length - 1].time);
    const timeframe = candleRange === "1y" || candleRange === "3m" ? "1d" : candleRange === "1m" ? "4h" : "1h";

    const backtest = await db.backtest.create({
      data: {
        instrumentId: instrument.id,
        strategyType: strategyType as StrategyType,
        paramsJson: JSON.stringify(stratParams),
        timeframe,
        startTs,
        endTs,
        candleCount: candles.length,
        initialCapital: capital,
        finalEquity: result.metrics.finalEquity,
        totalReturnPct: result.metrics.totalReturnPct,
        maxDrawdownPct: result.metrics.maxDrawdownPct,
        winRate: result.metrics.winRate,
        tradeCount: result.metrics.tradeCount,
        sharpeRatio: result.metrics.sharpeRatio,
        profitFactor: result.metrics.profitFactor,
        resultsJson: JSON.stringify({
          equityCurve: result.equityCurve,
          metrics: result.metrics,
          signals: result.signals,
        }),
        trades: {
          create: result.trades.map((t) => ({
            side: t.side,
            entryTime: BigInt(t.entryTime),
            exitTime: BigInt(t.exitTime),
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            size: t.size,
            pnl: t.pnl,
            pnlPct: t.pnlPct,
            exitReason: t.exitReason,
          })),
        },
      },
    });

    return ok({
      id: backtest.id,
      instrument: { id: instrument.id, symbol: instrument.symbol, ticker: instrument.ticker },
      strategyType,
      params: stratParams,
      timeframe,
      candleCount: candles.length,
      period: { start: Number(startTs), end: Number(endTs) },
      metrics: result.metrics,
      tradeCount: result.trades.length,
      equityCurvePoints: result.equityCurve.length,
      createdAt: backtest.createdAt,
    });
  } catch (e) {
    console.error("[backtest.run]", e);
    return fail("Internal error", 500);
  }
}
