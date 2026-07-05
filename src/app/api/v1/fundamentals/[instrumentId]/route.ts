// MERIDIAN Terminal — fundamentals for an instrument.
// PRD §6: 100% real data. We only return fields we actually parsed from
// Yahoo's quoteSummary endpoint (EQUITY) or CoinGecko's /coins/{id}
// endpoint (CRYPTO); missing fields are null, never invented.
//
// EQUITY   → fetch quoteSummary modules (summaryDetail, defaultKeyStatistics,
//            financialData) from Yahoo and parse trailingPE, priceToBook,
//            returnOnEquity, revenue, earningsGrowth. Compute Graham number
//            when EPS + BVPS available; DCF fair value stays null unless we
//            have free-cash-flow proxies (we don't, reliably — leave null).
// CRYPTO   → fetch market_cap / FDV / circulating / total / max supply
//            from CoinGecko via getCryptoFundamentals (60s cache +
//            10s timeout + 2 retries). Equity-only fields are null.
// FOREX / COMMODITY → fundamentals not applicable.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { fetchWithRetry, logHealth } from "@/lib/data-health";
import { UA } from "@/lib/data-sources/yahoo";
import { getCryptoFundamentals } from "@/lib/data-sources/coingecko";
import type { AssetClass, DataSourceKey, Fundamental } from "@/lib/types";

const BASE = "https://query2.finance.yahoo.com";

interface ParsedFundamentals {
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  roe: number | null; // %
  per: number | null;
  pbv: number | null;
  graham: number | null;
  dcfFair: number | null;
}

/// Defensive field extraction from Yahoo quoteSummary modules.
/// Yahoo returns nested objects like { trailingPE: { raw: 12.3, fmt: "12.30" } }
/// or sometimes flat numbers. We tolerate both shapes.
function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj.raw === "number" && Number.isFinite(obj.raw)) return obj.raw;
  }
  return null;
}

/// Yahoo percentage fields are returned as decimal fractions (0.15 = 15%).
/// Normalize to percent for downstream display.
function numPct(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  return Math.abs(n) < 1 ? n * 100 : n;
}

function parseModules(modules: unknown): ParsedFundamentals {
  const m = (modules ?? {}) as Record<string, unknown>;
  const summaryDetail = (m.summaryDetail ?? {}) as Record<string, unknown>;
  const defaultKeyStatistics = (m.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const financialData = (m.financialData ?? {}) as Record<string, unknown>;

  const per = num(summaryDetail.trailingPE) ?? num(defaultKeyStatistics.forwardPE) ?? num(summaryDetail.forwardPE);
  const pbv = num(summaryDetail.priceToBook) ?? num(defaultKeyStatistics.priceToBook);
  const roe = numPct(financialData.returnOnEquity) ?? numPct(defaultKeyStatistics.returnOnEquity);
  const revenue = num(financialData.totalRevenue) ?? num(financialData.revenue);
  const netIncome = num(financialData.netIncomeToCommon);
  const eps = num(defaultKeyStatistics.trailingEps) ?? num(financialData.epsCurrentYear);

  // Graham number = sqrt(22.5 * EPS * bookValuePerShare).
  // Use a directly-reported BVPS when available — never fabricate one.
  const bvps = num(defaultKeyStatistics.bookValuePerShare) ?? num(financialData.bookValuePerShare);
  let graham: number | null = null;
  if (eps != null && bvps != null && eps > 0 && bvps > 0) {
    const g = Math.sqrt(22.5 * eps * bvps);
    graham = Number.isFinite(g) ? g : null;
  }

  return {
    revenue,
    netIncome,
    eps,
    roe,
    per,
    pbv,
    graham,
    // DCF fair value requires free cash flow + growth + discount + terminal.
    // We deliberately do NOT fabricate a proxy here.
    dcfFair: null,
  };
}

async function fetchQuoteSummary(ticker: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const url =
    `${BASE}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
    `?modules=summaryDetail,defaultKeyStatistics,financialData`;
  const res = await fetchWithRetry(
    url,
    { headers: { "User-Agent": UA }, timeoutMs: 8000 },
    2
  );
  if (!res.ok || !res.body) {
    logHealth({
      source: "yahoo",
      endpoint: "quoteSummary",
      status: res.status === 429 ? "RATE_LIMITED" : "FAIL",
      latencyMs: res.latencyMs,
      errorMessage: res.error || `HTTP ${res.status}`,
    });
    return { ok: false, error: res.error || `Yahoo quoteSummary failed (${res.status})` };
  }
  try {
    const parsed = JSON.parse(res.body) as { quoteSummary?: { result?: unknown[]; error?: { description?: string } } };
    if (!parsed.quoteSummary || !parsed.quoteSummary.result || parsed.quoteSummary.result.length === 0) {
      const desc = parsed.quoteSummary?.error?.description ?? "No quoteSummary result";
      logHealth({ source: "yahoo", endpoint: "quoteSummary", status: "FAIL", latencyMs: res.latencyMs, errorMessage: desc });
      return { ok: false, error: desc };
    }
    logHealth({ source: "yahoo", endpoint: "quoteSummary", status: "OK", latencyMs: res.latencyMs });
    return { ok: true, data: parsed.quoteSummary.result[0] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logHealth({ source: "yahoo", endpoint: "quoteSummary", status: "FAIL", latencyMs: res.latencyMs, errorMessage: msg });
    return { ok: false, error: "Failed to parse Yahoo quoteSummary" };
  }
}

function toStoredFundamental(row: {
  ticker: string;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  roe: number | null;
  per: number | null;
  pbv: number | null;
  graham: number | null;
  dcfFair: number | null;
  marketCap: number | null;
  fdv: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  source: string;
  fetchedAt: Date;
}): Fundamental {
  return {
    ticker: row.ticker,
    revenue: row.revenue,
    netIncome: row.netIncome,
    eps: row.eps,
    roe: row.roe,
    per: row.per,
    pbv: row.pbv,
    graham: row.graham,
    dcfFair: row.dcfFair,
    marketCap: row.marketCap,
    fdv: row.fdv,
    circulatingSupply: row.circulatingSupply,
    totalSupply: row.totalSupply,
    maxSupply: row.maxSupply,
    source: row.source as DataSourceKey,
    fetchedAt: row.fetchedAt.getTime(),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ instrumentId: string }> }
) {
  try {
    const { instrumentId } = await params;
    const row = await db.instrument.findUnique({ where: { id: instrumentId } });
    if (!row) return fail("Instrument not found", 404);

    const assetClass = row.assetClass as AssetClass;

    if (assetClass === "FOREX" || assetClass === "COMMODITY") {
      return fail("Fundamentals not applicable for this asset class", 400);
    }

    if (assetClass === "CRYPTO") {
      // Fetch real crypto fundamentals (market cap, FDV, supply) from CoinGecko.
      // CoinGecko public API is rate-limited; getCryptoFundamentals uses a
      // 60s cache + retries. Never fabricates — surfaces DataResult failures.
      const result = await getCryptoFundamentals(row.ticker);
      if (!result.ok || !result.data) {
        return fail(result.error ?? "CoinGecko fundamentals unavailable", 502);
      }
      const f = result.data;
      const fetchedAt = new Date(f.fetchedAt);
      const upserted = await db.fundamental.upsert({
        where: { ticker: row.ticker },
        update: {
          revenue: null,
          netIncome: null,
          eps: null,
          roe: null,
          per: null,
          pbv: null,
          graham: null,
          dcfFair: null,
          marketCap: f.marketCap ?? null,
          fdv: f.fdv ?? null,
          circulatingSupply: f.circulatingSupply ?? null,
          totalSupply: f.totalSupply ?? null,
          maxSupply: f.maxSupply ?? null,
          source: "coingecko",
          fetchedAt,
        },
        create: {
          ticker: row.ticker,
          revenue: null,
          netIncome: null,
          eps: null,
          roe: null,
          per: null,
          pbv: null,
          graham: null,
          dcfFair: null,
          marketCap: f.marketCap ?? null,
          fdv: f.fdv ?? null,
          circulatingSupply: f.circulatingSupply ?? null,
          totalSupply: f.totalSupply ?? null,
          maxSupply: f.maxSupply ?? null,
          source: "coingecko",
          fetchedAt,
        },
      });
      return ok(toStoredFundamental(upserted), {
        source: "coingecko",
        sourceLabel: "CoinGecko",
        syncedAt: upserted.fetchedAt.getTime(),
        status: "OK",
      });
    }

    // ── EQUITY ────────────────────────────────────────────────────────────
    const summary = await fetchQuoteSummary(row.ticker);
    if (!summary.ok) {
      return fail(summary.error ?? "Fundamentals source unavailable", 502);
    }
    const parsed = parseModules(summary.data);

    const upserted = await db.fundamental.upsert({
      where: { ticker: row.ticker },
      update: {
        revenue: parsed.revenue,
        netIncome: parsed.netIncome,
        eps: parsed.eps,
        roe: parsed.roe,
        per: parsed.per,
        pbv: parsed.pbv,
        graham: parsed.graham,
        dcfFair: parsed.dcfFair,
        // Equity rows have no crypto fields — clear any stale values.
        marketCap: null,
        fdv: null,
        circulatingSupply: null,
        totalSupply: null,
        maxSupply: null,
        source: "yahoo",
        fetchedAt: new Date(),
      },
      create: {
        ticker: row.ticker,
        revenue: parsed.revenue,
        netIncome: parsed.netIncome,
        eps: parsed.eps,
        roe: parsed.roe,
        per: parsed.per,
        pbv: parsed.pbv,
        graham: parsed.graham,
        dcfFair: parsed.dcfFair,
        marketCap: null,
        fdv: null,
        circulatingSupply: null,
        totalSupply: null,
        maxSupply: null,
        source: "yahoo",
        fetchedAt: new Date(),
      },
    });

    return ok(toStoredFundamental(upserted), {
      source: "yahoo",
      sourceLabel: "Yahoo Finance",
      syncedAt: upserted.fetchedAt.getTime(),
      status: "OK",
    });
  } catch (e) {
    console.error("[fundamentals.GET]", e);
    return fail("Internal error", 500);
  }
}
