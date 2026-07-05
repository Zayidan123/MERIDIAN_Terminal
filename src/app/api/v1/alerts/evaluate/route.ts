// MERIDIAN Terminal — Alert evaluation engine (PRD FR-2.1, FR-2.2, FR-2.4).
// POST: evaluates every ACTIVE alert against REAL market data fetched live
// from Binance/Yahoo. When a condition is met, atomically marks the alert
// TRIGGERED and creates a SignalEvent with full context for later evaluation.
//
// Per-alert data fetch failures are surfaced in `skipped` (not fatal). Already
// TRIGGERED alerts are never re-evaluated (only status="ACTIVE" alerts run).
//
// Designed to be polled periodically by the frontend (e.g. every 60s).

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { getCandles, getQuote } from "@/lib/data-sources";
import { snapshot, volumeZScore, rsi } from "@/lib/indicators";
import type {
  AssetClass,
  Candle,
  DataSourceKey,
  Instrument,
  Quote,
  Range,
} from "@/lib/types";

interface TriggeredResult {
  alertId: string;
  instrumentId: string;
  ticker: string;
  symbol: string;
  metric: string;
  operator: string;
  threshold: number;
  observed: number;
  priceAtEvent: number;
  severity: string;
  message: string;
  signalEventId: string;
}

interface SkippedResult {
  alertId: string;
  instrumentId: string;
  ticker: string;
  symbol: string;
  error: string;
}

interface EvaluateResponse {
  evaluated: number;
  triggered: TriggeredResult[];
  skipped: SkippedResult[];
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

/// Generic operator comparison. For metrics without a meaningful "previous"
/// value (pct_change_24h, volume_spike), cross_up/cross_down degrade to gt/lt.
function compare(
  operator: string,
  current: number,
  threshold: number,
  previous: number | null
): boolean {
  switch (operator) {
    case "gt":
      return current > threshold;
    case "lt":
      return current < threshold;
    case "cross_up":
      if (previous === null) return current > threshold;
      return previous <= threshold && current > threshold;
    case "cross_down":
      if (previous === null) return current < threshold;
      return previous >= threshold && current < threshold;
    default:
      return false;
  }
}

function severityForAlertTrigger(metric: string): string {
  if (metric === "volume_spike") return "WARN";
  if (metric === "rsi") return "WARN";
  return "INFO";
}

const OP_LABEL: Record<string, string> = {
  gt: ">",
  lt: "<",
  cross_up: "crossed above",
  cross_down: "crossed below",
};

const METRIC_LABEL: Record<string, string> = {
  price: "Price",
  pct_change_24h: "24h % change",
  volume_spike: "Volume z-score",
  rsi: "RSI(14)",
  price_above_ma: "Price vs MA",
};

function messageFor(
  metric: string,
  operator: string,
  threshold: number,
  observed: number,
  symbol: string
): string {
  const op = OP_LABEL[operator] ?? operator;
  const label = METRIC_LABEL[metric] ?? metric;
  return `${symbol}: ${label} ${op} ${threshold} (now ${observed.toFixed(4)})`;
}

/// Per-request caches to avoid re-fetching the same instrument's quote/candles
/// when multiple alerts reference it. Cache miss stores `null` for failures so
/// we don't hammer upstream twice in one evaluation pass.
type QuoteResult = { ok: true; quote: Quote } | { ok: false; error: string };
type CandleResult =
  | { ok: true; candles: Candle[] }
  | { ok: false; error: string };

class FetchCache {
  // NOTE: field names must not collide with method names — class fields are
  // instance properties and would shadow prototype methods at runtime.
  private quoteMap = new Map<string, QuoteResult | null>();
  private candleMap = new Map<string, CandleResult | null>();

  async quote(instrument: Instrument): Promise<QuoteResult> {
    const cached = this.quoteMap.get(instrument.id);
    if (cached !== undefined) {
      if (cached === null) {
        return { ok: false, error: "Quote unavailable (cached failure)" };
      }
      return cached;
    }
    const r = await getQuote(instrument);
    if (r.ok && r.data) {
      const result: QuoteResult = { ok: true, quote: r.data };
      this.quoteMap.set(instrument.id, result);
      return result;
    }
    this.quoteMap.set(instrument.id, null);
    return { ok: false, error: r.error || "Quote unavailable" };
  }

  async candles(
    instrument: Instrument,
    range: Range
  ): Promise<CandleResult> {
    const key = `${instrument.id}:${range}`;
    const cached = this.candleMap.get(key);
    if (cached !== undefined) {
      if (cached === null) {
        return { ok: false, error: "Candles unavailable (cached failure)" };
      }
      return cached;
    }
    const r = await getCandles(instrument, range);
    if (r.ok && r.data) {
      const result: CandleResult = { ok: true, candles: r.data };
      this.candleMap.set(key, result);
      return result;
    }
    this.candleMap.set(key, null);
    return { ok: false, error: r.error || "Candles unavailable" };
  }
}

/// Per-alert evaluation. Returns:
///   - { kind: "triggered", observed, priceAtEvent, context } when condition met
///   - { kind: "no-trigger" } when condition not met
///   - { kind: "skipped", error } when data unavailable
type EvalOutcome =
  | {
      kind: "triggered";
      observed: number;
      priceAtEvent: number;
      context: Record<string, unknown>;
    }
  | { kind: "no-trigger" }
  | { kind: "skipped"; error: string };

async function evaluateAlert(
  alert: {
    id: string;
    metric: string;
    operator: string;
    threshold: number;
  },
  instrument: Instrument,
  cache: FetchCache
): Promise<EvalOutcome> {
  const { metric, operator, threshold } = alert;

  if (metric === "price") {
    const qr = await cache.quote(instrument);
    if (!qr.ok) return { kind: "skipped", error: qr.error };
    const q = qr.quote;
    const observed = q.price;
    const previous = q.prevClose;
    if (!compare(operator, observed, threshold, previous)) {
      return { kind: "no-trigger" };
    }
    return {
      kind: "triggered",
      observed,
      priceAtEvent: q.price,
      context: {
        metric,
        operator,
        threshold,
        observed,
        prevClose: previous,
        priceAtEvent: q.price,
      },
    };
  }

  if (metric === "pct_change_24h") {
    const qr = await cache.quote(instrument);
    if (!qr.ok) return { kind: "skipped", error: qr.error };
    const q = qr.quote;
    if (q.changePct24h === null) {
      return { kind: "skipped", error: "changePct24h unavailable" };
    }
    const observed = q.changePct24h;
    if (!compare(operator, observed, threshold, null)) {
      return { kind: "no-trigger" };
    }
    return {
      kind: "triggered",
      observed,
      priceAtEvent: q.price,
      context: {
        metric,
        operator,
        threshold,
        observed,
        priceAtEvent: q.price,
      },
    };
  }

  if (metric === "rsi") {
    const cr = await cache.candles(instrument, "3m");
    if (!cr.ok) return { kind: "skipped", error: cr.error };
    const candles = cr.candles;
    if (candles.length === 0) {
      return { kind: "skipped", error: "No candles available" };
    }
    const snap = snapshot(candles);
    if (snap.rsi14 === null) {
      return {
        kind: "skipped",
        error: "RSI not available (insufficient data)",
      };
    }
    const observed = snap.rsi14;
    // For cross detection, pull the second-to-last RSI from the series.
    const rsiSeries = rsi(candles, 14);
    const previous =
      rsiSeries.length >= 2
        ? rsiSeries[rsiSeries.length - 2].value
        : null;
    if (!compare(operator, observed, threshold, previous)) {
      return { kind: "no-trigger" };
    }
    const lastClose = candles[candles.length - 1].close;
    return {
      kind: "triggered",
      observed,
      priceAtEvent: lastClose,
      context: {
        metric,
        operator,
        threshold,
        observed,
        previousRsi: previous,
        candleCount: candles.length,
        priceAtEvent: lastClose,
      },
    };
  }

  if (metric === "volume_spike") {
    const cr = await cache.candles(instrument, "1m");
    if (!cr.ok) return { kind: "skipped", error: cr.error };
    const candles = cr.candles;
    if (candles.length === 0) {
      return { kind: "skipped", error: "No candles available" };
    }
    const z = volumeZScore(candles, 20);
    if (z === null) {
      return {
        kind: "skipped",
        error: "Volume z-score not available (insufficient data)",
      };
    }
    const observed = z;
    if (!compare(operator, observed, threshold, null)) {
      return { kind: "no-trigger" };
    }
    const lastClose = candles[candles.length - 1].close;
    return {
      kind: "triggered",
      observed,
      priceAtEvent: lastClose,
      context: {
        metric,
        operator,
        threshold,
        observed,
        lookback: 20,
        candleCount: candles.length,
        priceAtEvent: lastClose,
      },
    };
  }

  if (metric === "price_above_ma") {
    const cr = await cache.candles(instrument, "3m");
    if (!cr.ok) return { kind: "skipped", error: cr.error };
    const candles = cr.candles;
    if (candles.length === 0) {
      return { kind: "skipped", error: "No candles available" };
    }
    const snap = snapshot(candles);
    const ma = snap.ma20 ?? snap.ma50;
    if (ma === null || ma === 0) {
      return {
        kind: "skipped",
        error: "MA not available (insufficient data)",
      };
    }
    const lastClose = candles[candles.length - 1].close;
    const prevClose =
      candles.length >= 2 ? candles[candles.length - 2].close : null;
    // observed = percentage offset from MA (threshold of 0 = right at MA).
    const observed = ((lastClose - ma) / ma) * 100;
    const previous =
      prevClose !== null ? ((prevClose - ma) / ma) * 100 : null;
    if (!compare(operator, observed, threshold, previous)) {
      return { kind: "no-trigger" };
    }
    return {
      kind: "triggered",
      observed,
      priceAtEvent: lastClose,
      context: {
        metric,
        operator,
        threshold,
        observed,
        ma,
        maPeriod: snap.ma20 !== null ? 20 : 50,
        lastClose,
        prevClose,
        priceAtEvent: lastClose,
      },
    };
  }

  return { kind: "skipped", error: `Unknown metric: ${metric}` };
}

export async function POST() {
  try {
    const alerts = await db.alert.findMany({
      where: { status: "ACTIVE" },
      include: { instrument: true },
    });

    const cache = new FetchCache();
    const triggered: TriggeredResult[] = [];
    const skipped: SkippedResult[] = [];

    for (const alert of alerts) {
      const instrument = toInstrument(alert.instrument);
      try {
        const outcome = await evaluateAlert(alert, instrument, cache);

        if (outcome.kind === "skipped") {
          skipped.push({
            alertId: alert.id,
            instrumentId: instrument.id,
            ticker: instrument.ticker,
            symbol: instrument.symbol,
            error: outcome.error,
          });
          continue;
        }

        if (outcome.kind === "no-trigger") {
          continue;
        }

        // Triggered — atomically mark alert + create SignalEvent.
        const severity = severityForAlertTrigger(alert.metric);
        const message = messageFor(
          alert.metric,
          alert.operator,
          alert.threshold,
          outcome.observed,
          instrument.symbol
        );
        const contextJson = JSON.stringify(outcome.context);

        const [, signalEvent] = await db.$transaction([
          db.alert.update({
            where: { id: alert.id },
            data: {
              status: "TRIGGERED",
              triggeredAt: new Date(),
            },
          }),
          db.signalEvent.create({
            data: {
              instrumentId: instrument.id,
              signalType: "ALERT_TRIGGER",
              severity,
              message,
              contextJson,
              priceAtEvent: outcome.priceAtEvent,
            },
          }),
        ]);

        triggered.push({
          alertId: alert.id,
          instrumentId: instrument.id,
          ticker: instrument.ticker,
          symbol: instrument.symbol,
          metric: alert.metric,
          operator: alert.operator,
          threshold: alert.threshold,
          observed: outcome.observed,
          priceAtEvent: outcome.priceAtEvent,
          severity,
          message,
          signalEventId: signalEvent.id,
        });
      } catch (err) {
        skipped.push({
          alertId: alert.id,
          instrumentId: instrument.id,
          ticker: instrument.ticker,
          symbol: instrument.symbol,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const data: EvaluateResponse = {
      evaluated: alerts.length,
      triggered,
      skipped,
    };
    return ok(data);
  } catch (e) {
    console.error("[alerts.evaluate.POST]", e);
    return fail("Internal error", 500);
  }
}
