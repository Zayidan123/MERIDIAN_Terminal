# Task 2-b: Alerts & Signals API

**Agent**: full-stack-developer (alerts & signals API)
**Task ID**: 2-b
**Status**: complete
**Lint**: clean (exit 0)

## Files created (5 routes)
- `src/app/api/v1/alerts/route.ts` — GET (list, instrument included, status != DELETED, createdAt desc) + POST (validate metric/operator/threshold/instrumentId, default ACTIVE)
- `src/app/api/v1/alerts/[id]/route.ts` — PATCH (status/threshold/operator/note, validated) + DELETE (soft-delete → status=DELETED)
- `src/app/api/v1/alerts/evaluate/route.ts` — POST signal engine. Iterates ACTIVE alerts, fetches real data (cached per-request), checks condition per metric, atomically marks TRIGGERED + creates SignalEvent.
- `src/app/api/v1/signals/route.ts` — GET recent SignalEvents with filters (limit/signalType/since)
- `src/app/api/v1/signals/scan/route.ts` — POST anomaly scanner over Default watchlist. Detects VOLUME_SPIKE/BREAKOUT/RSI_OB/RSI_OS/ANOMALY from real candles, dedupes per (instrumentId, signalType) within last 1h.

## Data integrity (PRD §6)
- All metric evaluations use REAL market data: `getQuote()` for price/pct_change_24h, `getCandles()` for rsi/volume_spike/price_above_ma.
- All baselines (μ, σ, volume z-score, RSI, MA) computed from real historical candles via `snapshot/volumeZScore/returnsStats/rsi/sma` from `@/lib/indicators`.
- Per-alert data fetch failures are surfaced in `skipped` array — never fabricated. Yahoo instruments frequently surface HTTP 429 (rate-limited) in this sandbox; that's the integrity policy working as designed.
- Each SignalEvent stores the full context that triggered it (metric, operator, threshold, observed, prevClose/previousRsi/ma/last3Candles, etc.) for later accuracy evaluation (FR-2.4).

## Bug found & fixed during smoke testing
- `FetchCache` class initially had a private field `candles: Map<...>` shadowing the `candles(...)` method (class fields are instance properties, methods are on the prototype — the field shadowed the method at runtime, producing `cache.candles is not a function`).
- Fix: renamed the fields to `quoteMap` and `candleMap`. Added an inline comment explaining the JS class-field/method shadowing pitfall.

## Smoke-test results (live dev server)
- GET /alerts (empty list) → 200 ✓
- POST /alerts validation: missing instrumentId, bad metric, bad operator, non-finite threshold, nonexistent instrumentId → all 400 with correct messages ✓
- POST /alerts success → 200 with instrument included, status=ACTIVE ✓
- PATCH /alerts/[id] validation: bad status, bad operator, no fields → all 400 ✓
- PATCH 404 for unknown id ✓
- DELETE soft-delete → 200, alert disappears from GET list ✓
- POST /alerts/evaluate:
  - 3 ACTIVE alerts on BTC (price>1000, pct_change_24h>-100, price>150000), real BTC quote fetched from Binance = $62,616
  - 2 triggered (price>1000, pct_change_24h>-100), 1 no-trigger (price>150000), 0 skipped
  - SignalEvents created with proper severity (volume_spike/rsi=WARN, others=INFO)
  - Idempotent: second evaluate call shows 1 evaluated (only the remaining ACTIVE), 0 triggered
  - All 5 metrics tested (price, pct_change_24h, rsi, volume_spike, price_above_ma) — all working with real data
  - EUR/USD alert correctly skipped with `error: "HTTP 429"` (Yahoo rate-limited) ✓
- GET /signals with filters: limit (1, 500 capped at 200), signalType (ALERT_TRIGGER, VOLUME_SPIKE empty), since (future=0 results, 0=all) ✓
- POST /signals/scan: 19 instruments scanned, 0 detected (no current anomalies), 12 skipped (Yahoo HTTP 429), 7 crypto scanned successfully ✓

## Polling strategy for the frontend
- **POST /alerts/evaluate**: poll every 60s. Each call returns `{ evaluated, triggered[], skipped[] }`. The frontend should:
  1. After each poll, if `triggered.length > 0`, refetch GET /alerts to update statuses (ACTIVE → TRIGGERED) and GET /signals to show new ALERT_TRIGGER events.
  2. If `skipped.length > 0`, surface the per-instrument errors in a "data source degraded" panel.
- **POST /signals/scan**: poll every 2–5 minutes (heavier — fetches 3m candles for every watchlist instrument). Deduplication ensures no spam. After each poll, if `detected.length > 0`, refetch GET /signals to display new anomaly events.
- Both endpoints are safe to call concurrently. Neither blocks the other.

## Response shapes (TypeScript interfaces)

```ts
// GET /api/v1/alerts                       POST /api/v1/alerts
// PATCH /api/v1/alerts/[id]
data: AlertWithInstrument[]
// (POST/PATCH return a single AlertWithInstrument, not an array)
type AlertWithInstrument = {
  id: string;
  instrumentId: string;
  instrument: Instrument;        // full relation: { id, assetClass, ticker, symbol, name, exchange, currency, source, lotSize, metadata }
  metric: "price" | "pct_change_24h" | "volume_spike" | "rsi" | "price_above_ma";
  operator: "gt" | "lt" | "cross_up" | "cross_down";
  threshold: number;
  status: "ACTIVE" | "TRIGGERED" | "PAUSED" | "DELETED";
  note: string | null;
  createdAt: number;             // epoch ms
  triggeredAt: number | null;    // epoch ms
  updatedAt: number;             // epoch ms
};

// DELETE /api/v1/alerts/[id]
data: true

// POST /api/v1/alerts/evaluate
data: {
  evaluated: number;             // total ACTIVE alerts processed
  triggered: Array<{
    alertId: string;
    instrumentId: string;
    ticker: string;
    symbol: string;
    metric: string;
    operator: string;
    threshold: number;
    observed: number;
    priceAtEvent: number;
    severity: "INFO" | "WARN" | "CRITICAL";
    message: string;
    signalEventId: string;
  }>;
  skipped: Array<{
    alertId: string;
    instrumentId: string;
    ticker: string;
    symbol: string;
    error: string;
  }>;
}

// GET /api/v1/signals?limit=&signalType=&since=
data: SignalEventWithInstrument[]
type SignalEventWithInstrument = {
  id: string;
  instrumentId: string;
  instrument: Instrument;
  signalType: "VOLUME_SPIKE" | "BREAKOUT" | "RSI_OB" | "RSI_OS" | "ALERT_TRIGGER" | "ANOMALY";
  severity: "INFO" | "WARN" | "CRITICAL";
  message: string;
  priceAtEvent: number | null;
  context: Record<string, unknown> | null;   // parsed from contextJson
  createdAt: number;                          // epoch ms
};

// POST /api/v1/signals/scan
data: {
  scanned: number;               // total instruments attempted
  detected: Array<{
    instrumentId: string;
    ticker: string;
    symbol: string;
    signalType: string;
    severity: string;
    message: string;
    priceAtEvent: number;
    context: Record<string, unknown>;         // includes last3Candles on the stored event
    signalEventId: string;
  }>;
  skipped: Array<{
    instrumentId: string;
    ticker: string;
    symbol: string;
    error: string;
  }>;
}
```

## Metric semantics (for the frontend's alert-create form)
- `price` (gt/lt/cross_up/cross_down): threshold is absolute price (e.g. 100000 USD). cross_up fires when prevClose ≤ threshold < current price.
- `pct_change_24h` (gt/lt): threshold is percent (e.g. 5 = +5%). Cross operators degrade to gt/lt.
- `rsi` (gt/lt/cross_up/cross_down): threshold is RSI value 0–100. cross uses second-to-last RSI from series.
- `volume_spike` (gt/lt): threshold is z-score (e.g. 2.5 = 2.5σ above 20-bar mean volume). Cross operators degrade to gt/lt.
- `price_above_ma` (gt/lt/cross_up/cross_down): threshold is **percentage offset from MA** (e.g. 0 = right at MA, 5 = 5% above MA, -3 = 3% below). MA used is MA20 (or MA50 if MA20 null).

## Severity rules
- ALERT_TRIGGER: `volume_spike` → WARN, `rsi` → WARN, others → INFO
- VOLUME_SPIKE → WARN
- BREAKOUT → INFO
- RSI_OB / RSI_OS → WARN
- ANOMALY → CRITICAL
