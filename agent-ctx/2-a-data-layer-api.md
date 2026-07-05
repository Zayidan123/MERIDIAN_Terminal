# Task 2-a — Data Layer API Routes

**Agent:** full-stack-developer (data layer API)
**Task:** Build the 12 App-Router API routes under `src/app/api/v1/...` for MERIDIAN Terminal.

## Files created
- `src/lib/data-sources/yahoo.ts` (modified — exported `UA` constant)
- `src/app/api/v1/instruments/route.ts` — GET (list, optional `?assetClass=` filter, runs `ensureSeed`) + POST (custom add → 201, unique constraint → 409)
- `src/app/api/v1/instruments/[id]/route.ts` — GET (404 if missing) + DELETE (cascade)
- `src/app/api/v1/watchlist/route.ts` — GET Default watchlist with instruments sorted by symbol
- `src/app/api/v1/watchlist/[instrumentId]/route.ts` — POST (idempotent upsert) + DELETE
- `src/app/api/v1/prices/[instrumentId]/route.ts` — GET `?range=1d|7d|1m|3m|1y` (default 7d) via `getCandles`
- `src/app/api/v1/quotes/route.ts` — GET concurrent quotes for all watchlist instruments (per-row discriminated union ok|error)
- `src/app/api/v1/quotes/[instrumentId]/route.ts` — GET single quote via `fromResult(getQuote(...))`
- `src/app/api/v1/technicals/[instrumentId]/route.ts` — GET `?range=...` (default 3m) → `snapshot` + `volumeZScore` + `returnsStats` + `lastClose`
- `src/app/api/v1/fundamentals/[instrumentId]/route.ts` — GET real Yahoo quoteSummary for EQUITY (defensive parsing, Graham number when EPS+BVPS available, dcfFair always null); CRYPTO/FOREX/COMMODITY surface explicit failures
- `src/app/api/v1/market-summary/route.ts` — GET cross-asset snapshot (gainers/losers/unchanged/failed + per-asset-class avg pct)
- `src/app/api/v1/health/route.ts` — GET latest per-source health + 30 most recent log rows
- `src/app/api/v1/seed/route.ts` — POST explicitly runs `ensureSeed`

## Key decisions
- `ensureSeed()` only on GET `/instruments` and POST `/seed` (per spec).
- All datetimes at the API boundary are epoch ms (number).
- All handlers: Next.js 16 async `params: Promise<{...}>` awaited; whole body in try/catch → `fail("Internal error", 500)`; no `any` (use `unknown` + guards).
- `/quotes` returns per-row `{ ok:true, quote, provenance } | { ok:false, error, ticker, symbol }` so the frontend can show per-row "Source unavailable" without hiding successful rows.
- Yahoo quoteSummary wrapped in `fetchWithRetry` + `logHealth` (matches chart/price paths).
- Lint: `bun run lint` exit 0 — no errors.

## Smoke test results
- BTCUSDT prices/quotes/technicals: real Binance data, 200 OK
- /quotes (19 watchlist rows): Yahoo rows surface HTTP 429 per-row with `ok:false` (integrity policy working)
- /fundamentals for FOREX → 400, CRYPTO → 502, EQUITY BBCA.JK → 502 HTTP 429 (rate-limited, surfaced honestly)
- /market-summary: 2 gainers, 3 failed, byAssetClass CRYPTO has avg, others null
- /health: latest empty until first external call (expected — uses in-memory ring buffer)
- POST custom instrument + duplicate (409) + invalid source (400) + DELETE: all OK
- Watchlist add/remove idempotent: OK
- 404 for unknown instrument id; invalid range falls back to default: OK

## Response shapes (TypeScript interfaces)
See `/home/z/my-project/worklog.md` Task 2-a section for the full list.
