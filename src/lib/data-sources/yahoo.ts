// MERIDIAN Terminal — Yahoo Finance data source client.
// Real market data for IDX equities (.JK), forex (XXX=X) and gold futures
// (GC=F). PRD §6, §10. No API key. Requires a User-Agent header.

import type { Candle, DataResult, Quote, Range } from "@/lib/types";
import { fetchWithRetry, logHealth } from "@/lib/data-health";

const BASE = "https://query2.finance.yahoo.com";

/// Shared browser-like User-Agent — Yahoo rejects requests without one.
/// Exported so other routes (e.g. fundamentals/quoteSummary) can reuse it.
export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function rangeParams(range: Range): { range: string; interval: string } {
  switch (range) {
    case "1d":
      return { range: "1d", interval: "5m" };
    case "7d":
      return { range: "7d", interval: "30m" };
    case "1m":
      return { range: "1mo", interval: "1d" };
    case "3m":
      return { range: "3mo", interval: "1d" };
    case "1y":
      return { range: "1y", interval: "1d" };
  }
}

interface YahooChart {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number;
        previousClose?: number;
        chartPreviousClose?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketVolume?: number;
        currency: string;
        symbol: string;
        exchangeName?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: number[];
          high?: number[];
          low?: number[];
          close?: number[];
          volume?: number[];
        }>;
      };
    }> | null;
    error?: { code: string; description: string };
  };
}

export async function getChart(
  ticker: string,
  range: Range
): Promise<DataResult<{ candles: Candle[]; meta: YahooChart["chart"]["result"] extends (infer T)[] | null ? T : never }>> {
  const { range: r, interval } = rangeParams(range);
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${r}&interval=${interval}`;
  const t0 = Date.now();
  const res = await fetchWithRetry(url, { headers: { "User-Agent": UA }, timeoutMs: 8000 }, 2);
  const syncedAt = Date.now();
  if (!res.ok || !res.body) {
    logHealth({
      source: "yahoo",
      endpoint: "chart",
      status: res.status === 429 ? "RATE_LIMITED" : "FAIL",
      latencyMs: res.latencyMs,
      errorMessage: res.error || `HTTP ${res.status}`,
    });
    return { ok: false, error: res.error || `Yahoo Finance failed (${res.status})` };
  }
  try {
    const parsed = JSON.parse(res.body) as YahooChart;
    const result = parsed.chart?.result;
    if (!result || result.length === 0) {
      const desc = parsed.chart?.error?.description || "No data found";
      logHealth({ source: "yahoo", endpoint: "chart", status: "FAIL", latencyMs: res.latencyMs, errorMessage: desc });
      return { ok: false, error: desc };
    }
    const item = result[0];
    const ts = item.timestamp ?? [];
    const q = item.indicators?.quote?.[0];
    const candles: Candle[] = [];
    if (q) {
      for (let i = 0; i < ts.length; i++) {
        const open = q.open?.[i];
        const high = q.high?.[i];
        const low = q.low?.[i];
        const close = q.close?.[i];
        const volume = q.volume?.[i];
        if (open == null || high == null || low == null || close == null) continue;
        candles.push({
          time: ts[i] * 1000,
          open,
          high,
          low,
          close,
          volume: volume ?? 0,
        });
      }
    }
    logHealth({ source: "yahoo", endpoint: "chart", status: "OK", latencyMs: res.latencyMs });
    return {
      ok: true,
      data: { candles, meta: item },
      provenance: { source: "yahoo", sourceLabel: "Yahoo Finance", syncedAt, status: "OK" },
    };
  } catch (e) {
    logHealth({
      source: "yahoo",
      endpoint: "chart",
      status: "FAIL",
      latencyMs: Date.now() - t0,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: "Failed to parse Yahoo Finance response" };
  }
}

/// Quote derived from Yahoo chart meta + a 1d window for 24h stats.
export async function getQuote(
  ticker: string,
  displaySymbol: string,
  assetClass: "EQUITY" | "FOREX" | "COMMODITY",
  currency: string
): Promise<DataResult<Quote>> {
  const syncedAt = Date.now();
  const chart = await getChart(ticker, "1d");
  if (!chart.ok || !chart.data) {
    return { ok: false, error: chart.error || "Yahoo quote unavailable" };
  }
  const { candles, meta } = chart.data;
  const price = meta.meta.regularMarketPrice ?? candles.at(-1)?.close ?? null;
  if (price == null) {
    return { ok: false, error: "No price available from Yahoo" };
  }
  const prevClose = meta.meta.chartPreviousClose ?? meta.meta.previousClose ?? candles[0]?.open ?? null;
  const change24h = prevClose != null ? price - prevClose : null;
  const changePct24h = prevClose && prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : null;
  return {
    ok: true,
    data: {
      ticker,
      symbol: displaySymbol,
      assetClass,
      price,
      prevClose,
      change24h,
      changePct24h,
      high24h: meta.meta.regularMarketDayHigh ?? (candles.length ? Math.max(...candles.map((c) => c.high)) : null),
      low24h: meta.meta.regularMarketDayLow ?? (candles.length ? Math.min(...candles.map((c) => c.low)) : null),
      volume24h: meta.meta.regularMarketVolume ?? (candles.length ? candles.reduce((a, c) => a + c.volume, 0) : null),
      quoteVolume24h: null,
      currency: meta.meta.currency || currency,
      source: "yahoo",
      syncedAt,
    },
    provenance: chart.provenance,
  };
}
