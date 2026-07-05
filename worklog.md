# MERIDIAN Terminal — Work Log

Multi-asset research, signal, risk & portfolio terminal.
Platform name: **MERIDIAN Terminal**.

Real data sources (verified working in this sandbox):
- Crypto: Binance `data-api.binance.vision` (klines + ticker/price)
- IDX equities: Yahoo Finance `query2.finance.yahoo.com` (`.JK` tickers)
- Forex: Yahoo Finance (`EURUSD=X`, etc.)
- Gold: Yahoo Finance `GC=F` (COMEX Gold Futures)

Non-negotiable data integrity rule (PRD §6): NO simulated/dummy/placeholder data
in any environment. When a source is down/rate-limited, surface the failure
explicitly (Loading / No data / Source unavailable). Every panel shows a
Provenance Bar (source + sync time).

---
Task ID: 1
Agent: main (orchestrator)
Task: Foundation — institutional theme/fonts, Prisma schema (db pushed), lib utilities (types, formatters, indicators, data-health w/ logging+cache, data source clients for Binance & Yahoo, unified facade, seed of real instruments, API helpers).

Work Log:
- Wrote `src/app/globals.css` with institutional dark palette (#0B0E13 bg, #151920 panel, #262B33 border, #E7E9EC text, gain #2E9E6D, loss #C7484B, brand #3B5FE0). Added slim scrollbar, live-pulse + flash animations, `.tabular` helper.
- Wrote `src/app/layout.tsx` with Inter (body), IBM Plex Sans (heading), JetBrains Mono (mono) fonts; forced `.dark` class on `<html>`; updated metadata to MERIDIAN Terminal.
- Wrote `prisma/schema.prisma` with models: Instrument, Fundamental, Watchlist, WatchlistItem, Alert, SignalEvent, Position, RiskSnapshot, DataSourceHealthLog. Ran `bun run db:push` (synced + generated client).
- Wrote `src/lib/types.ts` (domain types: AssetClass, Instrument, Candle, Quote, Fundamental, HealthStatus, Provenance, AlertRule, SignalEvent, Position, RiskSummary, CorrelationCell, DataResult).
- Wrote `src/lib/format.ts` (fmtPrice/fmtCompact/fmtPct/fmtTimeAgo/fmtClock/changeColor + ASSET_CLASS_META + SOURCE_LABELS).
- Wrote `src/lib/data-health.ts` (in-memory TTL cache, `logHealth` writes to DataSourceHealthLog non-blocking + keeps ring buffer, `fetchWithRetry` w/ timeout+backoff, `getRecentHealth`, `getLatestHealthBySource`).
- Wrote `src/lib/indicators.ts` (sma, ema, rsi Wilder, macd, snapshot, returnsStats, volumeZScore, correlation, valueAtRisk).
- Wrote `src/lib/data-sources/binance.ts` (getKlines, getQuote — derives 24h stats from 24h klines, honest nulls on failure).
- Wrote `src/lib/data-sources/yahoo.ts` (getChart, getQuote — IDX/forex/gold via query2 + User-Agent).
- Wrote `src/lib/data-sources/index.ts` (unified facade getCandles/getQuote/getQuotes).
- Wrote `src/lib/seed.ts` (SEED_INSTRUMENTS — real tickers only: 7 crypto Binance, 7 IDX, 4 forex, 1 gold; `ensureSeed` idempotent).
- Wrote `src/lib/api.ts` (ok/fail/fromResult envelope helpers).

Stage Summary:
- Foundation complete. DB synced. All data-layer primitives ready.
- Conventions established: every data-source call returns `DataResult<T>` with optional `provenance`; failures are surfaced, never fabricated. API routes use `ok/fail/fromResult` envelope.
- Next: parallel API route subagents (2-a data layer, 2-b alerts/signals, 2-c portfolio/risk), then frontend.

---
Task ID: 2-a
Agent: full-stack-developer (data layer API)
Task: Build the 12 App-Router API routes under `src/app/api/v1/...` for the
MERIDIAN Terminal data layer — instruments CRUD, watchlist management, prices
(candles), quotes (single + concurrent batch), technicals, fundamentals,
market-summary, health, and explicit seed. Every route honors PRD §6 (no
fabricated data; failures surface as explicit `ok:false` with per-row errors).
Every market-data response carries a `provenance` object.

Work Log:
- Read worklog + lib foundations (types, api envelope, data-sources facade,
  binance + yahoo clients, indicators, data-health, seed, format, schema).
- Exported the shared `UA` User-Agent constant from `src/lib/data-sources/yahoo.ts`
  so the fundamentals route can reuse it for the Yahoo quoteSummary fetch.
- Created `src/app/api/v1/instruments/route.ts` — GET (calls ensureSeed first,
  optional `?assetClass=` filter, returns Instrument[]) + POST (validates
  ticker/symbol/name/currency/assetClass/source, unique-constraint → 409,
  also attaches to Default watchlist).
- Created `src/app/api/v1/instruments/[id]/route.ts` — GET (404 if missing) +
  DELETE (cascades via schema onDelete Cascade). Returns `{ ok, data: true }`.
- Created `src/app/api/v1/watchlist/route.ts` — GET returns Default watchlist
  with included instruments sorted by symbol, shape:
  `{ id, name, items: [{ id, instrument, addedAt }] }`.
- Created `src/app/api/v1/watchlist/[instrumentId]/route.ts` — POST (upsert =
  idempotent add) + DELETE (deleteMany on watchlistId+instrumentId).
- Created `src/app/api/v1/prices/[instrumentId]/route.ts` — GET `?range=`
  (default 7d, validates against allowed list). Calls getCandles, returns
  `{ instrument, range, candles }` + provenance via ok(). On data failure
  returns fromResult(...) → 502.
- Created `src/app/api/v1/quotes/route.ts` — GET concurrent quotes for all
  Default watchlist instruments. Returns per-row discriminated union:
  success `{ ok:true, instrumentId, ticker, symbol, quote, provenance }` or
  failure `{ ok:false, instrumentId, ticker, symbol, error }`. Aggregate
  `provenance.syncedAt` = max of successful rows.
- Created `src/app/api/v1/quotes/[instrumentId]/route.ts` — GET single quote,
  delegates to fromResult(getQuote(instrument)).
- Created `src/app/api/v1/technicals/[instrumentId]/route.ts` — GET `?range=`
  (default 3m). Fetches candles, computes `snapshot(candles)` + `volumeZScore`
  + `returnsStats` + `lastClose`. Returns `{ technicals, volumeZScore,
  returnsStats, lastClose, range, candleCount }` + provenance.
- Created `src/app/api/v1/fundamentals/[instrumentId]/route.ts` — GET:
  • FOREX/COMMODITY → 400 "Fundamentals not applicable for this asset class".
  • CRYPTO → 502 "No fundamental data source configured for this crypto
    instrument" (Binance tickers don't map cleanly to Yahoo crypto tickers;
    prefer honesty over fabrication).
  • EQUITY → fetches Yahoo `/v10/finance/quoteSummary/{ticker}?modules=
    summaryDetail,defaultKeyStatistics,financialData` with the shared UA.
    Defensive field parsing (tolerates both `{raw: n}` and flat `n` shapes).
    Parses trailingPE / priceToBook / returnOnEquity / totalRevenue /
    netIncomeToCommon / trailingEps / bookValuePerShare. Computes Graham
    number = sqrt(22.5 * EPS * BVPS) only when both available & positive;
    dcfFair always null (we don't have FCF proxies — never invent).
    Upserts into Fundamental table (keyed by ticker) + returns stored record
    with provenance `{ source:"yahoo", sourceLabel:"Yahoo Finance",
    syncedAt, status:"OK" }`. On fetch failure → 502 with the upstream error
    (e.g. "HTTP 429" when rate-limited). Logs to DataSourceHealthLog.
- Created `src/app/api/v1/market-summary/route.ts` — GET cross-asset snapshot
  for the dashboard header. Pulls 5 representative instruments (BTCUSDT,
  ETHUSDT, BBCA.JK, GC=F, EURUSD=X) from db by ticker, calls getQuotes,
  aggregates gainers/losers/unchanged/failed counts + avgChangePct +
  byAssetClass average pct (null when class has 0 successful quotes).
- Created `src/app/api/v1/health/route.ts` — GET returns `{ latest, recent }`
  where `latest` is per-source typed records from `getLatestHealthBySource()`
  and `recent` is the most recent 30 rows from DataSourceHealthLog ordered
  by createdAt desc.
- Created `src/app/api/v1/seed/route.ts` — POST explicitly runs ensureSeed()
  and returns `{ ok, data: { seeded: true } }`.
- All route handlers: Next.js 16 async `params: Promise<{...}>` awaited before
  reading. Whole body wrapped in try/catch → `fail("Internal error", 500)`.
  No `any` types — used `unknown` + runtime type guards for body parsing.
- Verified lint: `bun run lint` → exit 0, no errors.
- Smoke-tested every route against the live dev server:
  • instruments GET (with and without ?assetClass), POST custom + duplicate
    (409) + invalid source (400) + DELETE cleanup ✓
  • watchlist GET, POST add (idempotent) + DELETE remove ✓
  • prices/quotes/technicals for BTCUSDT (real Binance data, all OK) ✓
  • quotes (all 19 watchlist rows) — Yahoo rows surfaced HTTP 429 per-row
    with ok:false (integrity policy working as designed) ✓
  • fundamentals for FOREX (400), CRYPTO (502), EQUITY BBCA.JK (502 HTTP 429
    — Yahoo quoteSummary rate-limited in sandbox, surfaced honestly) ✓
  • market-summary (2 gainers, 0 losers, 3 failed, byAssetClass CRYPTO has
    avg, others null) ✓
  • health (latest empty until first external call — expected, since
    getLatestHealthBySource uses the in-memory ring buffer) ✓
  • seed POST ✓
  • 404 for unknown instrument id ✓
  • invalid range falls back to default ✓

Stage Summary:
Files created (12 routes + 1 lib tweak):
- src/lib/data-sources/yahoo.ts            (modified: exported UA constant)
- src/app/api/v1/instruments/route.ts
- src/app/api/v1/instruments/[id]/route.ts
- src/app/api/v1/watchlist/route.ts
- src/app/api/v1/watchlist/[instrumentId]/route.ts
- src/app/api/v1/prices/[instrumentId]/route.ts
- src/app/api/v1/quotes/route.ts
- src/app/api/v1/quotes/[instrumentId]/route.ts
- src/app/api/v1/technicals/[instrumentId]/route.ts
- src/app/api/v1/fundamentals/[instrumentId]/route.ts
- src/app/api/v1/market-summary/route.ts
- src/app/api/v1/health/route.ts
- src/app/api/v1/seed/route.ts

Key decisions:
- All envelopes are `{ ok:true, data, provenance? }` or
  `{ ok:false, error, ... }` — `ok`/`fail`/`fromResult` helpers from lib/api.
- ensureSeed() is called only on GET /instruments and POST /seed (per task
  spec) to avoid wasteful upserts on every price/quote call.
- All datetime fields returned as epoch ms (number) at the API boundary —
  Prisma Date objects are converted via .getTime().
- Per-row discriminated union on /quotes so the frontend can render each row
  independently with a per-row "Source unavailable" badge when its source
  fails — this is the core of the integrity policy at the UI level.
- Yahoo quoteSummary is wrapped in fetchWithRetry (2 retries, 8s timeout) and
  logs to DataSourceHealthLog via logHealth(), matching the chart/price paths.
- Lint: clean (exit 0).

Response shapes the frontend agent should consume (TypeScript interfaces):

```ts
// GET /api/v1/instruments          POST /api/v1/instruments
// GET /api/v1/instruments/[id]
type Instrument = {
  id: string;
  assetClass: "CRYPTO" | "EQUITY" | "FOREX" | "COMMODITY";
  ticker: string; symbol: string; name: string;
  exchange: string | null; currency: string;
  source: "binance" | "yahoo" | "coingecko";
  lotSize: number | null; metadata: string | null;
};
data: Instrument[] | Instrument

// DELETE /api/v1/instruments/[id]
data: true

// GET /api/v1/watchlist
data: {
  id: string; name: string;
  items: { id: string; instrument: Instrument; addedAt: number }[];
}

// POST /api/v1/watchlist/[id]      DELETE /api/v1/watchlist/[id]
data: { added: true, watchlistId: string, instrumentId: string }
   |  { removed: true }

// GET /api/v1/prices/[id]?range=1d|7d|1m|3m|1y
data: { instrument: Instrument; range: string; candles: Candle[] }
provenance: { source, sourceLabel, syncedAt, status? }
// Candle = { time, open, high, low, close, volume } (time = epoch ms)

// GET /api/v1/quotes
data: {
  quotes: ({
    ok: true; instrumentId: string; ticker: string; symbol: string;
    quote: Quote; provenance: Provenance;
  } | {
    ok: false; instrumentId: string; ticker: string; symbol: string;
    error: string;
  })[];
  provenance: { source:"multi", sourceLabel:"Multi-source", syncedAt: number };
}

// GET /api/v1/quotes/[id]
data: Quote
// Quote = { ticker, symbol, assetClass, price, prevClose, change24h,
//   changePct24h, high24h, low24h, volume24h, quoteVolume24h, currency,
//   source, syncedAt }

// GET /api/v1/technicals/[id]?range=...
data: {
  technicals: { ma20, ma50, ema12, rsi14, macd, macdSignal, macdHist }; // all number|null
  volumeZScore: number | null;
  returnsStats: { mean: number; std: number; sample: number };
  lastClose: number; range: string; candleCount: number;
}

// GET /api/v1/fundamentals/[id]
// success (equity):
data: Fundamental
// Fundamental = { ticker, revenue, netIncome, eps, roe, per, pbv, graham,
//   dcfFair, source, fetchedAt } (all numeric fields nullable)
// failure → { ok:false, error: string } with HTTP 400 (FOREX/COMMODITY) or
//   502 (CRYPTO or Yahoo fetch failure)

// GET /api/v1/market-summary
data: {
  gainers: number; losers: number; unchanged: number; failed: number;
  avgChangePct: number | null;
  byAssetClass: { CRYPTO: number|null; EQUITY: number|null;
                  FOREX: number|null; COMMODITY: number|null };
  asOf: number;
}

// GET /api/v1/health
data: {
  latest: { source: DataSourceKey; status: HealthStatus; latencyMs: number;
            checkedAt: number }[];
  recent: { id: string; source: string; endpoint: string; status: string;
            latencyMs: number | null; errorMessage: string | null;
            createdAt: number }[];
}

// POST /api/v1/seed
data: { seeded: true }
```

Lint issues: none. `bun run lint` exits 0.

Notes for the frontend agent:
- Always handle `ok:false` per-row on `/api/v1/quotes` — Yahoo rows will
  frequently fail with HTTP 429 in this sandbox; render a "Source unavailable"
  badge for those rows without hiding successful crypto rows.
- The fundamentals route for EQUITY may return 502 with `error:"HTTP 429"`
  when Yahoo is rate-limiting; show a retry affordance + the provenance bar.
- All epoch times are returned in milliseconds.
- The `/api/v1/health` `latest` array starts empty until the first external
  call populates the in-memory ring buffer. If the frontend hits it on first
  paint, expect `latest: []`; poll after the first market-data request to see
  populated status.

---
Task ID: 2-b
Agent: full-stack-developer (alerts & signals API)
Task: Build the 5 Alerts & Signals App-Router API routes for MERIDIAN Terminal —
alerts list/create, alert PATCH/soft-delete, alert evaluation engine (signal
detection from REAL market data), signals list with filters, and anomaly/pattern
scanner over the watchlist. Every route honors PRD §6 (no fabricated data;
failures surface explicitly). Each emitted SignalEvent carries the full data
context that triggered it for later accuracy evaluation (FR-2.4).

Work Log:
- Read worklog + lib foundations (types, api envelope, data-sources facade,
  indicators, seed, format, schema) + 2-a route patterns for consistency.
- Created `src/app/api/v1/alerts/route.ts` — GET (status != "DELETED",
  include instrument, orderBy createdAt desc) + POST (validates metric ∈
  {price, pct_change_24h, volume_spike, rsi, price_above_ma}, operator ∈
  {gt, lt, cross_up, cross_down}, threshold is finite number, instrumentId
  exists in DB; defaults status "ACTIVE"). Returns AlertWithInstrument.
- Created `src/app/api/v1/alerts/[id]/route.ts` — PATCH (only status /
  threshold / operator / note; each field validated if present; "No valid
  fields to update" if body empty) + DELETE (soft-delete: status="DELETED",
  row retained). 404 on missing id for both.
- Created `src/app/api/v1/alerts/evaluate/route.ts` — POST signal engine.
  Loads all status="ACTIVE" alerts (with instrument), iterates sequentially.
  Per-alert, fetches real data via getQuote / getCandles and computes the
  observed value per metric:
    • price → quote.price; previous = quote.prevClose (for cross detection)
    • pct_change_24h → quote.changePct24h; previous = null (cross degrades)
    • rsi → snapshot(candles 3m).rsi14; previous = rsi(candles,14)[-2]
    • volume_spike → volumeZScore(candles 1m, 20); previous = null
    • price_above_ma → ((lastClose - ma) / ma) * 100 % offset; previous
      computed from prevClose vs same ma; ma = snapshot.ma20 ?? snapshot.ma50
  On condition met: db.$transaction([update alert status="TRIGGERED" +
  triggeredAt=now, create SignalEvent signalType="ALERT_TRIGGER" with full
  contextJson]). Severity: volume_spike & rsi → WARN, others → INFO.
  On data fetch failure: pushed to skipped[] with the upstream error (e.g.
  "HTTP 429"). Already-TRIGGERED alerts are not re-evaluated (only ACTIVE
  alerts are loaded). Per-request FetchCache memoizes quote + candle fetches
  per instrumentId:range so multiple alerts on the same instrument don't
  hammer upstream.
- Created `src/app/api/v1/signals/route.ts` — GET recent SignalEvents with
  filters: ?limit (1..200, default 50), ?signalType (validated against
  allowed set; invalid silently ignored), ?since=<epochMs>. Includes
  instrument relation. contextJson parsed to `context` object (null on
  parse failure, never crashes the list). Ordered createdAt desc.
- Created `src/app/api/v1/signals/scan/route.ts` — POST anomaly & pattern
  scanner. Loads Default watchlist instruments, fetches real 3m candles per
  instrument, runs pure `detect()` function:
    • VOLUME_SPIKE  volumeZScore(20) > 2.5    → WARN
    • BREAKOUT      lastClose > max(prior 20)  → INFO
    • RSI_OB        rsi14 > 70                 → WARN
    • RSI_OS        rsi14 < 30                 → WARN
    • ANOMALY       |lastLogRet - μ| > 3σ      → CRITICAL
  All baselines (μ, σ, z-score, RSI) computed from the REAL candle window —
  no arbitrary thresholds. Per detection: dedupe via
  db.signalEvent.findFirst({ instrumentId, signalType, createdAt > 1h ago });
  if exists, skip silently. Otherwise create SignalEvent with contextJson
  that includes the metric-specific computed values + last3Candles for later
  evaluation. Candle-fetch failures per instrument → skipped[] with error.
- Bug found & fixed during smoke test: FetchCache initially had a private
  field `candles: Map<...>` colliding with the `candles(...)` method name.
  Class fields are instance properties; they shadow prototype methods at
  runtime, so `cache.candles(...)` threw "cache.candles is not a function".
  Renamed fields to `quoteMap` / `candleMap` and added an inline comment.
- All route handlers: Next.js 16 `params: Promise<{...}>` awaited before
  reading. Whole body wrapped in try/catch → `fail("Internal error", 500)`.
  No `any` types — `unknown` + runtime narrowing for body parsing. No
  `eval`/`exec`, no SQL string concatenation (Prisma only).
- Verified lint: `bun run lint` → exit 0, no errors.
- Smoke-tested every route against the live dev server:
  • alerts GET (empty then 3 → 6 after creations) ✓
  • alerts POST validation (missing instrumentId, bad metric, bad operator,
    non-finite threshold, nonexistent instrumentId) → all 400 with correct
    messages ✓
  • alerts POST success → 200 with instrument included, status=ACTIVE ✓
  • alerts/[id] PATCH validation (bad status, bad operator, no fields, 404)
    ✓ + success (note + threshold update, status PAUSED→ACTIVE) ✓
  • alerts/[id] DELETE soft-delete (alert disappears from GET list) + 404
    for unknown id ✓
  • alerts/evaluate POST: 3 ACTIVE BTC alerts evaluated against real
    Binance quote ($62,616). 2 triggered (price>1000, pct_change_24h>-100),
    1 no-trigger (price>150000). SignalEvents created with proper severity
    (INFO for price/pct_change_24h, WARN for rsi/volume_spike). Idempotent
    re-evaluate (only remaining ACTIVE alert processed) ✓
  • alerts/evaluate with EUR/USD alert (Yahoo): correctly skipped with
    `error: "HTTP 429"` — integrity policy working ✓
  • alerts/evaluate all 5 metrics (price, pct_change_24h, rsi=47.85,
    volume_spike z=-1.70, price_above_ma offset=+0.92%) — all working with
    real data + correct context (prevClose / previousRsi / ma / lastClose) ✓
  • signals GET with filters: limit (1, 500 capped at 200), signalType
    (ALERT_TRIGGER=2 results, VOLUME_SPIKE=0), since (future=0, 0=all) ✓
  • signals/scan POST: 19 watchlist instruments scanned, 0 detected (no
    current anomalies), 12 skipped (Yahoo HTTP 429), 7 crypto scanned
    successfully. ~1.3s end-to-end ✓

Stage Summary:
Files created (5 routes):
- src/app/api/v1/alerts/route.ts
- src/app/api/v1/alerts/[id]/route.ts
- src/app/api/v1/alerts/evaluate/route.ts
- src/app/api/v1/signals/route.ts
- src/app/api/v1/signals/scan/route.ts

Key decisions:
- Per-request FetchCache in /alerts/evaluate memoizes quote + candle fetches
  (keyed by instrumentId:range) so multiple alerts on the same instrument
  don't trigger duplicate upstream calls within one evaluation pass.
- /alerts/evaluate runs sequentially (not Promise.all) to avoid hammering
  external APIs; latency budget is comfortable (~500ms for 4 alerts even
  when fetching 3m + 1m candles for the same instrument).
- /signals/scan also runs sequentially for the same reason.
- price_above_ma threshold is interpreted as a percentage offset from MA
  (threshold=0 = right at MA, threshold=5 = 5% above MA). This is the most
  flexible interpretation and matches the spec's "cross_up = prevClose <=
  ma && lastClose > ma" when threshold=0.
- For metrics without a meaningful "previous" value (pct_change_24h,
  volume_spike), cross_up/cross_down degrade to gt/lt — documented inline.
- Dedupe in /signals/scan is silent (deduped detections are NOT added to
  detected[] or skipped[]). The frontend can hit GET /signals to see all
  existing events.
- SignalEvent.contextJson is parsed to `context` object at the GET /signals
  boundary (null on parse failure — never crashes the list response).
- All datetime fields returned as epoch ms at the API boundary (Prisma Date
  → .getTime()), matching the 2-a convention.

Response shapes the frontend agent should consume (TypeScript interfaces):

```ts
// GET /api/v1/alerts                       POST /api/v1/alerts
// PATCH /api/v1/alerts/[id]
// (POST/PATCH return a single object, GET returns an array)
type AlertWithInstrument = {
  id: string;
  instrumentId: string;
  instrument: Instrument;        // { id, assetClass, ticker, symbol, name,
                                 //   exchange, currency, source, lotSize, metadata }
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
  evaluated: number;
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
  signalType: "VOLUME_SPIKE" | "BREAKOUT" | "RSI_OB" | "RSI_OS"
            | "ALERT_TRIGGER" | "ANOMALY";
  severity: "INFO" | "WARN" | "CRITICAL";
  message: string;
  priceAtEvent: number | null;
  context: Record<string, unknown> | null;
  createdAt: number;
};

// POST /api/v1/signals/scan
data: {
  scanned: number;
  detected: Array<{
    instrumentId: string;
    ticker: string;
    symbol: string;
    signalType: string;
    severity: string;
    message: string;
    priceAtEvent: number;
    context: Record<string, unknown>;
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

Lint issues: none. `bun run lint` exits 0.

Notes for the frontend agent:
- Polling strategy:
  • POST /alerts/evaluate every 60s. After each poll: if triggered.length > 0,
    refetch GET /alerts (to update ACTIVE → TRIGGERED) and GET /signals (to
    display new ALERT_TRIGGER events). Surface skipped[] in a "data source
    degraded" panel per-instrument (e.g. "EUR/USD: HTTP 429").
  • POST /signals/scan every 2-5 minutes (heavier — fetches 3m candles for
    every watchlist instrument). After each poll: if detected.length > 0,
    refetch GET /signals to display new anomaly events. Deduplication is
    server-side (1h window per instrumentId+signalType), so the frontend
    doesn't need to dedupe.
  • Both endpoints are safe to call concurrently.
- Metric semantics for the alert-create form:
  • price: absolute price (e.g. 100000). cross_up fires when prevClose ≤
    threshold < current price.
  • pct_change_24h: percent (e.g. 5 = +5%). Cross degrades to gt/lt.
  • rsi: RSI value 0–100. cross uses second-to-last RSI from series.
  • volume_spike: z-score (e.g. 2.5 = 2.5σ above 20-bar mean volume).
  • price_above_ma: **percentage offset from MA** (0 = right at MA, 5 = 5%
    above). MA used is MA20 (or MA50 if MA20 null).
- Yahoo instruments (EQUITY/FOREX/COMMODITY) will frequently surface HTTP
  429 in the `skipped` arrays of both /alerts/evaluate and /signals/scan.
  Render those rows with a "Source unavailable" badge without hiding the
  successful crypto rows.
- All epoch times are returned in milliseconds.
- The `context` object on SignalEvent varies by signalType — render it
  defensively (Object.entries → key/value table). Common keys: metric,
  operator, threshold, observed, priceAtEvent (ALERT_TRIGGER); zScore,
  lookback (VOLUME_SPIKE); breakoutLevel (BREAKOUT); rsi14 (RSI_OB/OS);
  lastReturn, mean, std, zScore (ANOMALY); last3Candles (always present on
  scan-emitted events for later accuracy evaluation).

---
Task ID: 2-c
Agent: full-stack-developer (portfolio & risk API)
Task: Build the 4 Portfolio & Risk Management App-Router API routes for
MERIDIAN Terminal — portfolio list/create, single position PATCH/DELETE,
full portfolio RiskSummary (exposure per asset class, VaR, drawdown,
correlation matrix — all from REAL live prices + REAL 3m daily candles),
and a pure position-sizing calculator. Every route honors PRD §6 (no
fabricated data; per-position quote/candle failures surface explicitly as
null fields + an `error` string). RiskSummary persists a RiskSnapshot row
(non-blocking) for historical trending.

Work Log:
- Read worklog + lib foundations (types, api envelope, data-sources facade,
  indicators w/ correlation() helper, schema, db client) + 2-a and 2-b
  route patterns for consistency.
- Created `src/app/api/v1/portfolio/route.ts` —
  • GET: list all positions with instrument relation (createdAt desc),
    then concurrent `Promise.all(getQuote)` per position. Computes
    lastPrice, marketValue (size × lastPrice — same for LONG/SHORT,
    sign handled in PnL), unrealizedPnl ((last-entry)×size LONG /
    (entry-last)×size SHORT), unrealizedPnlPct (pnl/cost × 100). On
    quote failure: lastPrice/marketValue/unrealizedPnl/unrealizedPnlPct
    all null + `error: string` on that row.
  • POST: validates side ∈ {LONG,SHORT}, entryPrice>0, size>0,
    instrumentId exists (400 on any failure). openedAt optional —
    accepts epoch ms number or ISO string, defaults to now. note optional.
    Returns the created position with instrument; market fields are null
    on the create response (caller refetches via GET for live enrichment
    — keeps the write cheap & decoupled from rate-limited upstreams).
- Created `src/app/api/v1/portfolio/[id]/route.ts` —
  • PATCH: 404 if missing. Validates each present field (entryPrice/size
    >0 via shared `parsePositiveNumber` helper, side ∈ {LONG,SHORT},
    note string|null). "No valid fields to update" → 400. Returns
    updated position with instrument; market fields null on response
    (same rationale as POST).
  • DELETE: hard-delete per spec. 404 if missing. Returns `{ ok:true }`.
- Created `src/app/api/v1/risk/summary/route.ts` — the heavy route.
  Documented the equity definition in a header comment:
    costBasis     = Σ entryPrice_i × size_i
    unrealizedPnl = Σ unrealizedPnl_i  (skip nulls)
    totalEquity   = costBasis + unrealizedPnl
    totalExposure = Σ marketValue_i    (skip nulls)
    exposurePct   = totalExposure / totalEquity × 100
  Pipeline:
    1. Fetch all positions w/ instrument.
    2. Concurrent `getQuote` for every position's instrument.
    3. Per-position marketValue/unrealizedPnl (null on quote failure).
    4. Aggregate totals.
    5. perAssetClass: group by instrument.assetClass, sum marketValue,
       pct of totalExposure, count.
    6. perPosition: { instrumentId, symbol, assetClass, marketValue,
       weightPct (of totalExposure), pnlPct } — marketValue is number
       (0 when quote failed, per RiskSummary type).
    7. Concurrent `getCandles(instrument, "3m")` for every position.
       Convert each to Map<time, logReturn> + sorted times array.
    8. withReturns = positions whose return series has ≥5 points.
    9. VaR(95%): require ≥2 positions with returns AND totalExposure>0.
       Build aggregate portfolio return series = Σ w_i × r_i(t) where
       w_i = marketValue_i / totalExposure, r_i(t) defaults to 0 when
       instrument i has no observation at t. VaR = totalEquity × 1.645
       × std(portfolioReturns). Null if n<10 or std=0.
   10. Drawdown: same portfolio return series. equity_t = costBasis ×
       Π(1+r_t). peak = running max. dd_t = (equity-peak)/peak.
       currentDrawdown = last dd × 100. maxDrawdown = min dd × 100.
       Null if <2 positions or <2 returns.
   11. Correlation: pairwise between every pair of `withReturns`
       instruments. Self-pairs (a==a) → value 1 (trivial). Cross-pairs:
       two-pointer time-alignment of times arrays (intersection), then
       `correlation(ra, rb)` helper (returns null if <5 overlapping pts
       or zero variance). Flat list of { a:symbol, b:symbol, value }.
   12. Persist RiskSnapshot row (totalEquity, totalExposure, exposurePct,
       varEstimate, maxDrawdown, currentDrawdown) via fire-and-forget
       `db.riskSnapshot.create(...).catch(...)` — matches the data-health
       log pattern; never breaks the read path.
   13. Return `{ ok, data: RiskSummary, provenance:{ source:"multi",
       sourceLabel:"Multi-source (live)", syncedAt: now } }`.
- Created `src/app/api/v1/risk/position-size/route.ts` —
  POST pure calc (no external data). Body: { equity, riskPct, entryPrice,
  stopPrice, side? }. Validates all numeric inputs finite & >0 (numeric
  strings accepted). side defaults "LONG". Computes:
    riskAmount    = equity × riskPct/100
    perUnitRisk   = |entryPrice - stopPrice|
    positionSize  = riskAmount / perUnitRisk
    positionValue = positionSize × entryPrice
  Returns { equity, riskPct, riskAmount, entryPrice, stopPrice,
  perUnitRisk, positionSize, positionValue, side }. 400 if stopPrice
  equals entryPrice (perUnitRisk=0 → infinite size).
- All route handlers: Next.js 16 async `params: Promise<{...}>` awaited
  before reading. Whole body wrapped in try/catch → `fail("Internal
  error", 500)`. No `any` — `unknown` + runtime narrowing for body
  parsing. No `eval`/`exec`, no SQL string concatenation (Prisma only).
  Concurrent fetches via Promise.all.
- Bug found & fixed during smoke test: in `computeMarketFields` of the
  risk summary route, the local variable was originally named `pnl` but
  the return statement referenced `unrealizedPnl` (undefined identifier).
  Renamed the local to `unrealizedPnl` to match. Caught immediately via
  the dev.log ReferenceError stack trace on the first /risk/summary call.
- Verified lint: `bun run lint` → exit 0, no errors.
- Smoke-tested every route against the live dev server:
  • portfolio POST validation (bad side, entryPrice 0, bad instrumentId,
    invalid JSON) → all 400 with correct messages ✓
  • portfolio POST success ×3 (BTC LONG 60000×0.5, ETH SHORT 3000×2,
    SOL LONG 150×10 with ISO openedAt) ✓
  • portfolio GET — 3 positions enriched with live Binance quotes:
    BTC last=62676 mv=31338 pnl=+1344 pnl%=+4.46%, ETH SHORT last=1763
    mv=3526 pnl=+2473 pnl%=+41.2%, SOL last=80.68 mv=807 pnl=-693
    pnl%=-46.2% — PnL signs correct for both LONG and SHORT ✓
  • portfolio/[id] PATCH validation (404 missing, no fields 400, bad
    side 400, negative entryPrice 400) + success (entryPrice+size+note+
    side update) ✓
  • portfolio/[id] DELETE 404 + success (position removed from GET list) ✓
  • portfolio POST EQUITY (ASII.JK — Yahoo source) + GET — row shows
    `error: "HTTP 429"`, lastPrice/marketValue/unrealizedPnl/
    unrealizedPnlPct all null — integrity policy working as designed ✓
  • risk/summary GET with 3 crypto positions:
    totalEquity=41451.65 (=costBasis 38800 + unrealized +2651.65 ✓)
    totalExposure=36515.97 (=Σmv: 31365+3532+1619 ✓)
    exposurePct=88.09% (=36515/41451 ✓)
    unrealizedPnl=+2651.65 ✓
    perAssetClass: CRYPTO 100% count=3 ✓
    perPosition: BTC 85.9%, ETH 9.7%, SOL 4.4% (Σ=100% ✓)
    varEstimate=$1349.51 (parametric 95% on portfolio log-returns) ✓
    currentDrawdown=-24.51%, maxDrawdown=-29.79% (reconstructed from
    historical portfolio equity curve) ✓
    correlation: 6 cells (3 self-pairs value=1 + 3 cross-pairs:
    SOL/ETH=0.84, SOL/BTC=0.82, ETH/BTC=0.89 — high correlation as
    expected for major cryptos) ✓
    provenance: { source:"multi", sourceLabel:"Multi-source (live)",
    syncedAt: 1783254363440 } ✓
  • risk/summary GET with mixed CRYPTO+EQUITY (EQUITY quote failed):
    EQUITY position contributes 0 to exposure (marketValue null→0),
    its cost basis still counts toward totalEquity (per documented
    definition), exposurePct drops accordingly, correlation matrix
    excludes the failed-quote instrument (only CRYPTO×CRYPTO pairs) —
    honest behavior, frontend shows per-position error via /portfolio ✓
  • risk/summary GET on empty portfolio: returns all-zero totals, null
    VaR/drawdown, empty perAssetClass/perPosition/correlation ✓
  • RiskSnapshot persistence verified: 2 rows in DB after 2 calls, with
    exact totalEquity/totalExposure/exposurePct/varEstimate/maxDrawdown/
    currentDrawdown values matching the responses ✓
  • risk/position-size POST:
    - long BTC equity=50000 riskPct=1 entry=60000 stop=58000 →
      riskAmount=500, perUnitRisk=2000, positionSize=0.25,
      positionValue=15000 ✓
    - short ETH equity=50000 riskPct=2 entry=3000 stop=3100 →
      riskAmount=1000, perUnitRisk=100, positionSize=10,
      positionValue=30000 ✓
    - default side (omitted) → LONG ✓
    - stop==entry → 400 "Stop price cannot equal entry price" ✓
    - equity<=0 → 400 "equity must be > 0" ✓
    - missing field → 400 "{field} must be a finite number" ✓
    - numeric string coercion ("10000" → 10000) ✓

Stage Summary:
Files created (4 routes):
- src/app/api/v1/portfolio/route.ts                       (GET + POST)
- src/app/api/v1/portfolio/[id]/route.ts                  (PATCH + DELETE)
- src/app/api/v1/risk/summary/route.ts                    (GET RiskSummary)
- src/app/api/v1/risk/position-size/route.ts              (POST sizing)

Key decisions:
- Equity definition: totalEquity = costBasis + unrealizedPnl. This is
  the standard "what you put in + what the market gave you back" view.
  Cost basis always counts (even for positions whose live quote fails);
  unrealizedPnl skips nulls (treated as 0). Documented inline.
- totalExposure only counts mark-to-market-able positions (skip null
  marketValue). This means a portfolio with a large failed-quote
  position will show a low exposurePct — honest, and the frontend can
  cross-reference with /portfolio to show "Source unavailable" per row.
- perPosition.marketValue is number (not nullable) per the RiskSummary
  type in src/lib/types.ts. When a quote fails, marketValue=0,
  weightPct=0, pnlPct=0. The /portfolio GET endpoint carries the
  explicit null + error per position; the frontend should use that for
  per-row error display and use /risk/summary for the aggregated view.
- VaR requires ≥2 positions with return series (per spec example). With
  1 position only, VaR is null even if its own series is well-formed —
  this is a conservative choice the frontend should know about. Could
  be relaxed later if single-position VaR is desired.
- Correlation matrix only includes pairs where BOTH instruments have a
  return series (≥5 log-returns). Self-pairs (a==a) explicitly value=1
  (trivial, no helper call). Cross-pairs are time-aligned via
  two-pointer intersection before being passed to `correlation()`.
- Drawdown reconstructed from costBasis × cumprod(1+r) using log returns
  for the portfolio aggregate. Daily log returns are small (<0.05), so
  1+r ≈ exp(r) and the reconstructed equity curve shape is correct.
  drawdown is returned as a percentage (negative or zero).
- RiskSnapshot persistence is fire-and-forget with `.catch()` to never
  break the read path (matches the data-health log pattern).
- POST/PATCH responses intentionally return null market fields rather
  than re-fetching live quotes — keeps the write cheap & decoupled from
  rate-limited upstreams; the next GET /portfolio enriches live.
- All datetime fields returned as epoch ms at the API boundary (Prisma
  Date → .getTime()), matching the 2-a/2-b convention.

Response shapes the frontend agent should consume (TypeScript interfaces):

```ts
// GET /api/v1/portfolio
data: PositionWithMarket[]
type PositionWithMarket = {
  id: string;
  instrumentId: string;
  instrument: Instrument;        // { id, assetClass, ticker, symbol, name,
                                 //   exchange, currency, source, lotSize, metadata }
  side: "LONG" | "SHORT";
  entryPrice: number;
  size: number;
  openedAt: number;              // epoch ms
  note: string | null;
  createdAt: number;             // epoch ms
  updatedAt: number;             // epoch ms
  // Computed from live quote; ALL null when quote fetch failed (error set):
  lastPrice: number | null;
  marketValue: number | null;    // size × lastPrice (notional current value)
  unrealizedPnl: number | null;  // (last-entry)×size LONG | (entry-last)×size SHORT
  unrealizedPnlPct: number | null; // (pnl / cost) × 100
  error?: string;                // present only when live quote fetch failed
                                 // (e.g. "HTTP 429")
};

// POST /api/v1/portfolio            PATCH /api/v1/portfolio/[id]
// (both return a single object; market fields are null — caller refetches
//  via GET for live enrichment)
data: PositionWithMarket           // (market fields all null on write responses)

// Body (POST):  { instrumentId, side:"LONG"|"SHORT", entryPrice>0,
//                 size>0, openedAt?(epoch ms|ISO), note? }
// Body (PATCH): { entryPrice?, size?, side?, note? }   (any subset)

// DELETE /api/v1/portfolio/[id]
data: true

// GET /api/v1/risk/summary
data: RiskSummary
type RiskSummary = {
  totalEquity: number;            // costBasis + unrealizedPnl
  totalExposure: number;          // Σ marketValue (skip nulls)
  exposurePct: number;            // totalExposure / totalEquity × 100
  realizedPnl: number;            // 0 in this phase (no closed trades)
  unrealizedPnl: number;          // Σ per-position pnl (skip nulls)
  perAssetClass: {
    assetClass: "CRYPTO"|"EQUITY"|"FOREX"|"COMMODITY";
    exposure: number;             // Σ marketValue in class (0 if all failed)
    pct: number;                  // exposure / totalExposure × 100
    count: number;                // # positions in class
  }[];
  perPosition: {
    instrumentId: string;
    symbol: string;
    assetClass: "CRYPTO"|"EQUITY"|"FOREX"|"COMMODITY";
    marketValue: number;          // 0 when quote failed
    weightPct: number;            // marketValue / totalExposure × 100
    pnlPct: number;               // 0 when quote failed
  }[];
  varEstimate: number | null;     // 95% parametric VaR, USD; null if
                                  // <2 positions have returns OR n<10
                                  // OR std=0
  currentDrawdown: number | null; // % (negative or 0); null if
                                  // insufficient data
  maxDrawdown: number | null;     // % (most negative dd over series)
  correlation: CorrelationCell[]; // flat list, self-pairs value=1,
                                  // cross-pairs value|null
};
type CorrelationCell = {
  a: string;                      // symbol
  b: string;                      // symbol
  value: number | null;           // -1..1 ; null if <5 overlapping points
};
provenance: { source:"multi", sourceLabel:"Multi-source (live)",
              syncedAt: number }

// POST /api/v1/risk/position-size
// Body: { equity>0, riskPct, entryPrice>0, stopPrice>0, side?:"LONG"|"SHORT" }
data: {
  equity: number;
  riskPct: number;
  riskAmount: number;        // equity × riskPct/100
  entryPrice: number;
  stopPrice: number;
  perUnitRisk: number;       // |entryPrice - stopPrice|
  positionSize: number;      // riskAmount / perUnitRisk  (units to hold)
  positionValue: number;     // positionSize × entryPrice
  side: "LONG" | "SHORT";    // default "LONG"
}
// 400 if stopPrice == entryPrice ("Stop price cannot equal entry price")
// 400 if any numeric input is non-finite or ≤0
```

Lint issues: none. `bun run lint` exits 0.

Notes for the frontend agent:
- Polling strategy:
  • GET /api/v1/portfolio every 15–30s for the positions table — fast
    (concurrent quotes, no candles).
  • GET /api/v1/risk/summary every 30–60s — heavier (concurrent quotes
    + concurrent 3m candle fetches per position). On a 3-position crypto
    portfolio the end-to-end latency observed was ~1.3s; expect more with
    Yahoo instruments (HTTP 429 retries add ~6s per Yahoo instrument).
  • POST /api/v1/risk/position-size is on-demand (form submit).
- Integrity handling (CRITICAL):
  • A position row in GET /portfolio whose live quote failed will have
    lastPrice/marketValue/unrealizedPnl/unrealizedPnlPct all === null
    AND an `error` string field present (e.g. "HTTP 429"). Render that
    row with a "Source unavailable" badge and dim the PnL column — do
    NOT treat null as 0 or hide the row.
  • In GET /risk/summary, the same failed-quote position contributes 0
    (not null) to perPosition.marketValue/weightPct/pnlPct AND its cost
    basis still counts toward totalEquity. So a portfolio with a large
    failed-quote position will show a low exposurePct — that's correct
    and honest. Cross-reference /portfolio for per-row error display.
- Yahoo instruments (EQUITY/FOREX/COMMODITY) will frequently surface
  HTTP 429 in the per-position `error` field of /portfolio AND be
  excluded from the correlation matrix in /risk/summary (since they
  have no return series). Render them with a "Source unavailable"
  badge without hiding the successful crypto rows.
- VaR is null when fewer than 2 positions have a usable return series
  (e.g. only 1 crypto position) OR insufficient data points. Show
  "Insufficient data" rather than 0 in that case.
- Drawdown is returned as a percentage (negative or zero). The frontend
  should compare currentDrawdown against a user-configurable threshold
  (e.g. -10%) for the alert badge per FR-3.4 (alert UI logic is on the
  frontend in this phase; no server-side alert is raised).
- Correlation matrix is a flat list (not a 2D array). Self-pairs
  (a==a) are included with value 1. Cross-pairs may have value=null
  when overlap is <5 points — render as "—" in the matrix cell.
- RiskSnapshot rows are persisted on every /risk/summary call (fire-
  and-forget). The frontend can later add a GET /risk/snapshots route
  to chart the equity/drawdown/VaR time series — that route is not in
  this task's scope but the data is being collected.
- All epoch times are returned in milliseconds.
