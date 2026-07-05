// MERIDIAN Terminal — default instrument universe (real tickers only).
// PRD §10 data sources. These are real, tradeable symbols.

import { db } from "@/lib/db";

export interface SeedInstrument {
  assetClass: "CRYPTO" | "EQUITY" | "FOREX" | "COMMODITY";
  ticker: string;
  symbol: string;
  name: string;
  exchange?: string;
  currency: string;
  source: "binance" | "yahoo";
}

export const SEED_INSTRUMENTS: SeedInstrument[] = [
  // ── Crypto (Binance) ────────────────────────────────────────────────
  { assetClass: "CRYPTO", ticker: "BTCUSDT", symbol: "BTC/USDT", name: "Bitcoin / Tether", exchange: "BINANCE", currency: "USDT", source: "binance" },
  { assetClass: "CRYPTO", ticker: "ETHUSDT", symbol: "ETH/USDT", name: "Ethereum / Tether", exchange: "BINANCE", currency: "USDT", source: "binance" },
  { assetClass: "CRYPTO", ticker: "SOLUSDT", symbol: "SOL/USDT", name: "Solana / Tether", exchange: "BINANCE", currency: "USDT", source: "binance" },
  { assetClass: "CRYPTO", ticker: "BNBUSDT", symbol: "BNB/USDT", name: "BNB / Tether", exchange: "BINANCE", currency: "USDT", source: "binance" },
  { assetClass: "CRYPTO", ticker: "XRPUSDT", symbol: "XRP/USDT", name: "XRP / Tether", exchange: "BINANCE", currency: "USDT", source: "binance" },
  { assetClass: "CRYPTO", ticker: "ADAUSDT", symbol: "ADA/USDT", name: "Cardano / Tether", exchange: "BINANCE", currency: "USDT", source: "binance" },
  { assetClass: "CRYPTO", ticker: "DOGEUSDT", symbol: "DOGE/USDT", name: "Dogecoin / Tether", exchange: "BINANCE", currency: "USDT", source: "binance" },

  // ── IDX Equities (Yahoo Finance .JK) ────────────────────────────────
  { assetClass: "EQUITY", ticker: "BBCA.JK", symbol: "BBCA", name: "Bank Central Asia Tbk", exchange: "IDX", currency: "IDR", source: "yahoo" },
  { assetClass: "EQUITY", ticker: "BBRI.JK", symbol: "BBRI", name: "Bank Rakyat Indonesia", exchange: "IDX", currency: "IDR", source: "yahoo" },
  { assetClass: "EQUITY", ticker: "TLKM.JK", symbol: "TLKM", name: "Telkom Indonesia Tbk", exchange: "IDX", currency: "IDR", source: "yahoo" },
  { assetClass: "EQUITY", ticker: "ASII.JK", symbol: "ASII", name: "Astra International Tbk", exchange: "IDX", currency: "IDR", source: "yahoo" },
  { assetClass: "EQUITY", ticker: "GOTO.JK", symbol: "GOTO", name: "GoTo Gojek Tokopedia", exchange: "IDX", currency: "IDR", source: "yahoo" },
  { assetClass: "EQUITY", ticker: "TPIA.JK", symbol: "TPIA", name: "Chandra Asri Pacific", exchange: "IDX", currency: "IDR", source: "yahoo" },
  { assetClass: "EQUITY", ticker: "ICBP.JK", symbol: "ICBP", name: "Indofood CBP Sukses Makmur", exchange: "IDX", currency: "IDR", source: "yahoo" },

  // ── Forex (Yahoo) ───────────────────────────────────────────────────
  { assetClass: "FOREX", ticker: "EURUSD=X", symbol: "EUR/USD", name: "Euro / US Dollar", exchange: "CCY", currency: "USD", source: "yahoo" },
  { assetClass: "FOREX", ticker: "GBPUSD=X", symbol: "GBP/USD", name: "British Pound / US Dollar", exchange: "CCY", currency: "USD", source: "yahoo" },
  { assetClass: "FOREX", ticker: "USDJPY=X", symbol: "USD/JPY", name: "US Dollar / Japanese Yen", exchange: "CCY", currency: "JPY", source: "yahoo" },
  { assetClass: "FOREX", ticker: "AUDUSD=X", symbol: "AUD/USD", name: "Australian Dollar / US Dollar", exchange: "CCY", currency: "USD", source: "yahoo" },

  // ── Commodity (Gold futures, Yahoo) ─────────────────────────────────
  { assetClass: "COMMODITY", ticker: "GC=F", symbol: "XAU/USD", name: "Gold (COMEX Futures)", exchange: "COMEX", currency: "USD", source: "yahoo" },
];

/// Idempotent seed: ensures instruments + a default watchlist exist.
/// Safe to call on every server start.
export async function ensureSeed(): Promise<void> {
  // watchlist
  let wl = await db.watchlist.findFirst({ where: { name: "Default" } });
  if (!wl) wl = await db.watchlist.create({ data: { name: "Default" } });

  for (const s of SEED_INSTRUMENTS) {
    const existing = await db.instrument.findUnique({ where: { ticker: s.ticker } });
    if (existing) {
      // keep on watchlist if not already
      const onWl = await db.watchlistItem.findUnique({
        where: { watchlistId_instrumentId: { watchlistId: wl.id, instrumentId: existing.id } },
      });
      if (!onWl) {
        await db.watchlistItem.create({ data: { watchlistId: wl.id, instrumentId: existing.id } });
      }
      continue;
    }
    const inst = await db.instrument.create({
      data: {
        assetClass: s.assetClass,
        ticker: s.ticker,
        symbol: s.symbol,
        name: s.name,
        exchange: s.exchange ?? null,
        currency: s.currency,
        source: s.source,
      },
    });
    await db.watchlistItem.create({ data: { watchlistId: wl.id, instrumentId: inst.id } });
  }
}
