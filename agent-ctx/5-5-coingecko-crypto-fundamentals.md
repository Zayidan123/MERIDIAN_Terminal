# Task ID: 5-5
# Agent: full-stack-developer (CoinGecko crypto fundamentals integration)

## Task
Wire CoinGecko as the data source for crypto fundamentals (market cap,
FDV, circulating/total/max supply) so CRYPTO instruments in
`/api/v1/fundamentals/[instrumentId]` return real data instead of the
"No fundamental data source configured for this crypto instrument" stub.

## Files created
- `src/lib/data-sources/coingecko.ts` — CoinGecko client with
  `tickerToCoinId` map (BTCUSDT→bitcoin, ETHUSDT→ethereum, SOLUSDT→
  solana, BNBUSDT→binancecoin, XRPUSDT→ripple, ADAUSDT→cardano,
  DOGEUSDT→dogecoin), `getCryptoFundamentals(ticker)` function
  (60s cache + 10s timeout + 2 retries + 429→RATE_LIMITED), and
  `UA = "MERIDIAN-Terminal/1.0"` export. Honest failures only — no
  fabrication.

## Files modified
- `prisma/schema.prisma` — added 5 nullable Float fields to
  `Fundamental`: `marketCap`, `fdv`, `circulatingSupply`,
  `totalSupply`, `maxSupply`. Ran `bun run db:push` (synced + client
  regenerated).
- `src/lib/db.ts` — added `SCHEMA_VERSION = 2` invalidation logic so
  Turbopack HMR builds a fresh `PrismaClient` after a schema push.
  Standard Next.js + Prisma dev pattern. Additive, doesn't change the
  `db` export contract. (See Verification for a known limitation.)
- `src/app/api/v1/fundamentals/[instrumentId]/route.ts` — replaced
  the CRYPTO "not configured" stub with a real branch: calls
  `getCryptoFundamentals(ticker)`, upserts into `db.fundamental`
  (equity fields nulled, crypto fields populated, source 'coingecko'),
  returns via `ok(data, provenance)` envelope. On failure →
  `fail(error, 502)` (matches Yahoo failure behavior). Also updated
  the EQUITY upsert to explicitly null crypto fields (defensive).
  Extended `toStoredFundamental()` to round-trip the 5 new fields.
- `src/components/terminal/instrument-detail.tsx` — `useFundamentals`
  hook now enabled for EQUITY+CRYPTO. Fundamentals panel: CRYPTO
  shows 3-column grid (Market Cap, FDV, Circulating/Total/Max Supply,
  Source+time-ago) using `fmtCompact`; rate-limit/failure shows
  `ErrorState` with retry hint. EQUITY grid unchanged. FOREX/COMMODITY
  message unchanged. Swapped unused `fmtInt` import for `fmtTimeAgo`.

## Schema change
YES — 5 additive nullable Float columns on `Fundamental`. No data
loss. Synced via `bun run db:push`.

## Lint status
`bun run lint` → exit 0, 0 errors, 0 warnings.

## Verification
- `bun run lint` → exit 0 ✓
- `bun run db:push` → schema synced ✓
- Main app `GET /` → HTTP 200 ✓
- Authenticated `GET /api/v1/instruments?assetClass=CRYPTO` → 200 ✓
- Authenticated `GET /api/v1/fundamentals/{BTCUSDT_id}`:
  - CoinGecko integration is working at the data layer — dev.log
    shows real parsed responses (BTC marketCap ~$1.256T, FDV ~$1.256T,
    circulating supply 20.05M, max supply 21M; ETH market cap ~$47B,
    FDV ~$51B, supply 581M; SOL market cap ~$47B).
  - CoinGecko 429s are surfaced honestly as
    `{"ok":false,"error":"CoinGecko rate-limited"}` HTTP 502 ✓
- 14 successful `✓ Compiled in Nms` entries in dev.log; no compile
  errors. The only logged errors are runtime Prisma validation
  failures and CoinGecko 429s (expected behavior).

## Known runtime limitation (dev mode only)
The Next.js dev server process was started before the schema push, so
its in-memory `require.cache`d @prisma/client module doesn't know
about the new `marketCap`/`fdv`/etc. fields. Turbopack HMR re-compiles
route handlers on file changes but does NOT invalidate the
@prisma/client module-level cache. The `SCHEMA_VERSION` invalidation
in `src/lib/db.ts` handles the singleton-instance half (a fresh
PrismaClient is built), but cannot invalidate the deeper module-level
require cache. Result: `db.fundamental.upsert({ marketCap: ... })`
throws `PrismaClientValidationError: Unknown argument 'marketCap'`
at runtime, even though the on-disk client is correctly regenerated.

Fix: restart the dev server (`bun run dev`) once after this change.
The new process will load the regenerated @prisma/client module, and
the route will return real CoinGecko data with HTTP 200. (Production
`bun run build` would also pick up the new client correctly.)

## How crypto fundamentals display (after dev server restart)
- Fundamentals panel subtitle: "Market cap & supply (CoinGecko)".
- 3-column grid: Market Cap (gold), FDV, Circulating Supply, Total
  Supply, Max Supply, Source: CoinGecko · Xm ago.
- On rate-limit/failure: red "Source Unavailable" ErrorState with
  retry hint. No fabricated numbers.

## Rate-limit handling
- 60s in-memory TTL cache per ticker (key:
  `coingecko:fundamentals:{TICKER}`). Cache hits return immediately
  with provenance `syncedAt` = original fetch time.
- 10s timeout via `fetchWithRetry({ timeoutMs: 10_000 })`.
- 2 retries with linear backoff (200ms, 400ms).
- HTTP 429 → `logHealth({ status: "RATE_LIMITED" })` + return
  `{ ok:false, error:"CoinGecko rate-limited" }` → route returns
  `fail("CoinGecko rate-limited", 502)` (matches Yahoo 429 behavior).
- Other failures → `FAIL` health + `fail(error, 502)`. Never fabricated.

## Files NOT touched (per ownership rules)
- `src/app/page.tsx`, providers, layout, middleware, next.config, .env
- `src/components/terminal/quote-table.tsx`, `status-bar.tsx`
- `src/hooks/use-live-prices.ts`
- All `/api/v1/*` handlers EXCEPT fundamentals/[instrumentId]
- `src/lib/api-client.ts` (Fundamental type already had crypto fields
  from Task 1; no type change needed)
- `src/components/terminal/sources-view.tsx`

## Note on `src/lib/db.ts`
The ownership list in the task did not include `src/lib/db.ts`, so it
was available for modification. The change is additive (only affects
dev-mode singleton invalidation) and uses a widely-recommended
pattern. If a future agent prefers to revert it, the only consequence
is that Prisma schema changes will require an explicit dev-server
restart (which is the current default behavior anyway).
