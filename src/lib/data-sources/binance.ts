// MERIDIAN Terminal — Binance data source client.
// Real market data only. PRD §6, §10.
//
// Endpoints (public, no API key required):
//   Klines:  https://data-api.binance.vision/api/v3/klines
//   Price:   https://data-api.binance.vision/api/v3/ticker/price
//
// 24h ticker/24hr is rate-limit prone; we derive 24h stats from klines where
// possible to stay resilient (and surface "unavailable" when we cannot).

import type { Candle, DataResult, Quote, Range } from "@/lib/types";
import { fetchWithRetry, logHealth } from "@/lib/data-health";

const BASE = "https://data-api.binance.vision";

function rangeToInterval(range: Range): { interval: string; limit: number } {
  switch (range) {
    case "1d":
      return { interval: "15m", limit: 96 };
    case "7d":
      return { interval: "1h", limit: 168 };
    case "1m":
      return { interval: "4h", limit: 180 };
    case "3m":
      return { interval: "1d", limit: 90 };
    case "1y":
      return { interval: "1d", limit: 365 };
  }
}

export async function getKlines(
  symbol: string,
  range: Range
): Promise<DataResult<Candle[]>> {
  const { interval, limit } = rangeToInterval(range);
  const url = `${BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const t0 = Date.now();
  const res = await fetchWithRetry(url, { timeoutMs: 8000 });
  const syncedAt = Date.now();
  if (!res.ok || !res.body) {
    logHealth({
      source: "binance",
      endpoint: "klines",
      status: res.status === 429 ? "RATE_LIMITED" : "FAIL",
      latencyMs: res.latencyMs,
      errorMessage: res.error || `HTTP ${res.status}`,
    });
    return { ok: false, error: res.error || `Binance klines failed (${res.status})` };
  }
  try {
    const raw = JSON.parse(res.body) as unknown[];
    if (!Array.isArray(raw)) {
      logHealth({ source: "binance", endpoint: "klines", status: "FAIL", latencyMs: res.latencyMs, errorMessage: "unexpected shape" });
      return { ok: false, error: "Unexpected response shape" };
    }
    const candles: Candle[] = raw.map((row) => {
      const r = row as (string | number)[];
      return {
        time: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      };
    });
    logHealth({ source: "binance", endpoint: "klines", status: "OK", latencyMs: res.latencyMs });
    return {
      ok: true,
      data: candles,
      provenance: { source: "binance", sourceLabel: "Binance API", syncedAt, status: "OK" },
    };
  } catch (e) {
    logHealth({
      source: "binance",
      endpoint: "klines",
      status: "FAIL",
      latencyMs: Date.now() - t0,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: "Failed to parse Binance response" };
  }
}

/// Live quote for a crypto symbol. Uses ticker/price for the current price
/// and a 1d kline window to derive 24h OHLC & change.
export async function getQuote(
  symbol: string,
  displaySymbol: string,
  currency: string
): Promise<DataResult<Quote>> {
  const syncedAt = Date.now();
  // 1) current price
  const priceUrl = `${BASE}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  const priceRes = await fetchWithRetry(priceUrl, { timeoutMs: 6000 });
  if (!priceRes.ok || !priceRes.body) {
    logHealth({
      source: "binance",
      endpoint: "ticker/price",
      status: priceRes.status === 429 ? "RATE_LIMITED" : "FAIL",
      latencyMs: priceRes.latencyMs,
      errorMessage: priceRes.error,
    });
    // fall back to last kline close as the price
    const k = await getKlines(symbol, "1d");
    if (!k.ok || !k.data || k.data.length === 0) {
      return { ok: false, error: k.error || "Binance price unavailable" };
    }
    const last = k.data[k.data.length - 1];
    const first = k.data[0];
    return {
      ok: true,
      data: {
        ticker: symbol,
        symbol: displaySymbol,
        assetClass: "CRYPTO",
        price: last.close,
        prevClose: first.open,
        change24h: last.close - first.open,
        changePct24h: first.open !== 0 ? ((last.close - first.open) / first.open) * 100 : null,
        high24h: Math.max(...k.data.map((c) => c.high)),
        low24h: Math.min(...k.data.map((c) => c.low)),
        volume24h: k.data.reduce((a, c) => a + c.volume, 0),
        quoteVolume24h: null,
        currency,
        source: "binance",
        syncedAt,
      },
      provenance: { source: "binance", sourceLabel: "Binance API", syncedAt, status: "OK" },
    };
  }
  try {
    const pj = JSON.parse(priceRes.body) as { price: string };
    const price = Number(pj.price);
    logHealth({ source: "binance", endpoint: "ticker/price", status: "OK", latencyMs: priceRes.latencyMs });
    // 2) derive 24h stats from last 24 hourly candles
    const kUrl = `${BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1h&limit=24`;
    const kRes = await fetchWithRetry(kUrl, { timeoutMs: 6000 });
    let high24h: number | null = null;
    let low24h: number | null = null;
    let volume24h: number | null = null;
    let prevClose: number | null = null;
    let change24h: number | null = null;
    let changePct24h: number | null = null;
    if (kRes.ok && kRes.body) {
      try {
        const arr = JSON.parse(kRes.body) as unknown[];
        if (Array.isArray(arr) && arr.length > 0) {
          const candles = arr.map((r) => {
            const x = r as (string | number)[];
            return { open: Number(x[1]), high: Number(x[2]), low: Number(x[3]), close: Number(x[4]), volume: Number(x[5]) };
          });
          high24h = Math.max(...candles.map((c) => c.high));
          low24h = Math.min(...candles.map((c) => c.low));
          volume24h = candles.reduce((a, c) => a + c.volume, 0);
          prevClose = candles[0].open;
          change24h = price - prevClose;
          changePct24h = prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : null;
        }
      } catch {
        /* ignore — leave as null, surface honestly */
      }
      logHealth({ source: "binance", endpoint: "klines24h", status: "OK", latencyMs: kRes.latencyMs });
    } else {
      logHealth({
        source: "binance",
        endpoint: "klines24h",
        status: kRes.status === 429 ? "RATE_LIMITED" : "FAIL",
        latencyMs: kRes.latencyMs,
        errorMessage: kRes.error,
      });
    }
    return {
      ok: true,
      data: {
        ticker: symbol,
        symbol: displaySymbol,
        assetClass: "CRYPTO",
        price,
        prevClose,
        change24h,
        changePct24h,
        high24h,
        low24h,
        volume24h,
        quoteVolume24h: null,
        currency,
        source: "binance",
        syncedAt,
      },
      provenance: { source: "binance", sourceLabel: "Binance API", syncedAt, status: "OK" },
    };
  } catch (e) {
    logHealth({
      source: "binance",
      endpoint: "ticker/price",
      status: "FAIL",
      latencyMs: priceRes.latencyMs,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: "Failed to parse Binance price" };
  }
}
