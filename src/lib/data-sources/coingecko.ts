// MERIDIAN Terminal — CoinGecko data source client.
// Real crypto fundamentals only (PRD FR-1.4, gap item #4). PRD §6: no
// fabricated numbers — every failure surfaces explicitly.
//
// Public API: https://api.coingecko.com/api/v3
//   - No API key required for the free tier, but heavily rate-limited
//     (~10–30 calls/min). We mitigate with a 60s in-memory cache and
//     a 10s timeout + 2 retries + backoff via fetchWithRetry.
//
// Endpoint used:
//   GET /coins/{id}?localization=false&tickers=false&market_data=true
//                &community_data=false&developer_data=false&sparkline=false
//
// Returns market_cap, fully_diluted_valuation, circulating_supply,
// total_supply, max_supply (all in USD where applicable).

import type { DataResult, Fundamental, HealthStatus } from "@/lib/types";
import { fetchWithRetry, logHealth, cacheGet, cacheSet } from "@/lib/data-health";

const BASE = "https://api.coingecko.com/api/v3";

/// CoinGecko doesn't need a browser UA but a descriptive one helps when
/// diagnosing logs / bot detection on their side.
export const UA = "MERIDIAN-Terminal/1.0";

/// Mapping of MERIDIAN crypto tickers (Binance-style, quote=USDT) →
/// CoinGecko coin IDs. Extend this table when adding new crypto instruments.
/// Unknown tickers fail honestly — no fuzzy guessing.
export const tickerToCoinId: Record<string, string> = {
  BTCUSDT: "bitcoin",
  ETHUSDT: "ethereum",
  SOLUSDT: "solana",
  BNBUSDT: "binancecoin",
  XRPUSDT: "ripple",
  ADAUSDT: "cardano",
  DOGEUSDT: "dogecoin",
};

/// 60s cache TTL — CoinGecko free tier is rate-limited and market cap /
/// supply figures do not move meaningfully second-by-second.
const CACHE_TTL_MS = 60_000;

function cacheKey(ticker: string): string {
  return `coingecko:fundamentals:${ticker}`;
}

/// Expected shape of the CoinGecko /coins/{id} response. We only declare
/// the fields we read; everything else is ignored.
interface CoinGeckoCoinResponse {
  market_data?: {
    market_cap?: { usd?: number | null } | null;
    fully_diluted_valuation?: { usd?: number | null } | null;
    circulating_supply?: number | null;
    total_supply?: number | null;
    max_supply?: number | null;
  } | null;
}

/// Defensive number extraction: tolerate both raw numbers and the rare
/// nested `{ usd: number }` shape for supply fields.
function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function fromUsd(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const usd = obj.usd;
    if (typeof usd === "number" && Number.isFinite(usd)) return usd;
  }
  return null;
}

/// Fetch crypto fundamentals for a Binance-style ticker (BTCUSDT, ETHUSDT, …).
/// Returns a DataResult<Fundamental>; never throws on the data path.
export async function getCryptoFundamentals(
  ticker: string
): Promise<DataResult<Fundamental>> {
  // 1) Resolve ticker → CoinGecko coin ID.
  const coinId = tickerToCoinId[ticker];
  if (!coinId) {
    logHealth({
      source: "coingecko",
      endpoint: "coins/{id}",
      status: "FAIL",
      latencyMs: 0,
      errorMessage: `No CoinGecko mapping for ticker ${ticker}`,
    });
    return { ok: false, error: `No CoinGecko mapping for ticker ${ticker}` };
  }

  // 2) Short cache — respects CoinGecko rate limits.
  const cached = await cacheGet<Fundamental>(cacheKey(ticker));
  if (cached) {
    return {
      ok: true,
      data: cached,
      provenance: {
        source: "coingecko",
        sourceLabel: "CoinGecko",
        syncedAt: cached.fetchedAt,
        status: "OK",
      },
    };
  }

  // 3) Fetch from CoinGecko.
  const url =
    `${BASE}/coins/${encodeURIComponent(coinId)}` +
    `?localization=false&tickers=false&market_data=true` +
    `&community_data=false&developer_data=false&sparkline=false`;

  const res = await fetchWithRetry(
    url,
    { headers: { "User-Agent": UA, Accept: "application/json" }, timeoutMs: 10_000 },
    2
  );

  // 4) Handle failure honestly.
  if (!res.ok || !res.body) {
    const status: HealthStatus = res.status === 429 ? "RATE_LIMITED" : "FAIL";
    logHealth({
      source: "coingecko",
      endpoint: "coins/{id}",
      status,
      latencyMs: res.latencyMs,
      errorMessage: res.error || `HTTP ${res.status}`,
    });
    if (res.status === 429) {
      return { ok: false, error: "CoinGecko rate-limited" };
    }
    return { ok: false, error: res.error || `CoinGecko failed (${res.status})` };
  }

  // 5) Parse the response.
  let parsed: CoinGeckoCoinResponse;
  try {
    parsed = JSON.parse(res.body) as CoinGeckoCoinResponse;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logHealth({
      source: "coingecko",
      endpoint: "coins/{id}",
      status: "FAIL",
      latencyMs: res.latencyMs,
      errorMessage: msg,
    });
    return { ok: false, error: "Failed to parse CoinGecko response" };
  }

  const md = parsed.market_data ?? {};
  const marketCap = fromUsd(md.market_cap);
  const fdv = fromUsd(md.fully_diluted_valuation);
  const circulatingSupply = toNum(md.circulating_supply);
  const totalSupply = toNum(md.total_supply);
  const maxSupply = toNum(md.max_supply);

  // Sanity: market_cap is the load-bearing field for crypto fundamentals;
  // if CoinGecko returned nothing usable, surface it as a failure rather
  // than emit a hollow row of nulls.
  if (marketCap == null && circulatingSupply == null) {
    logHealth({
      source: "coingecko",
      endpoint: "coins/{id}",
      status: "FAIL",
      latencyMs: res.latencyMs,
      errorMessage: `No market_cap or circulating_supply for ${ticker} (coin id ${coinId})`,
    });
    return { ok: false, error: `CoinGecko returned no usable fundamentals for ${ticker}` };
  }

  logHealth({
    source: "coingecko",
    endpoint: "coins/{id}",
    status: "OK",
    latencyMs: res.latencyMs,
  });

  const fetchedAt = Date.now();
  const fundamental: Fundamental = {
    ticker,
    // Equity fields — not applicable to crypto; honestly null.
    revenue: null,
    netIncome: null,
    eps: null,
    roe: null,
    per: null,
    pbv: null,
    graham: null,
    dcfFair: null,
    // Crypto fields — from CoinGecko market_data.
    marketCap,
    fdv,
    circulatingSupply,
    totalSupply,
    maxSupply,
    source: "coingecko",
    fetchedAt,
  };

  cacheSet(cacheKey(ticker), fundamental, CACHE_TTL_MS);

  return {
    ok: true,
    data: fundamental,
    provenance: {
      source: "coingecko",
      sourceLabel: "CoinGecko",
      syncedAt: fetchedAt,
      status: "OK",
    },
  };
}
