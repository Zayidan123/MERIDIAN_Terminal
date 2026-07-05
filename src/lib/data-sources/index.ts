// MERIDIAN Terminal — unified data facade.
// Routes a request to the correct real data source based on the instrument's
// source field. Never fabricates data; surfaces DataResult failures honestly.

import type {
  Candle,
  DataResult,
  Quote,
  Range,
  Instrument,
} from "@/lib/types";
import * as binance from "@/lib/data-sources/binance";
import * as yahoo from "@/lib/data-sources/yahoo";

export async function getCandles(
  instrument: Instrument,
  range: Range
): Promise<DataResult<Candle[]>> {
  if (instrument.source === "binance") return binance.getKlines(instrument.ticker, range);
  if (instrument.source === "yahoo") {
    const r = await yahoo.getChart(instrument.ticker, range);
    if (!r.ok || !r.data) return { ok: false, error: r.error };
    return { ok: true, data: r.data.candles, provenance: r.provenance };
  }
  return { ok: false, error: `Unknown source: ${instrument.source}` };
}

export async function getQuote(instrument: Instrument): Promise<DataResult<Quote>> {
  if (instrument.source === "binance") {
    return binance.getQuote(instrument.ticker, instrument.symbol, instrument.currency);
  }
  if (instrument.source === "yahoo") {
    const ac = instrument.assetClass === "EQUITY" ? "EQUITY" : instrument.assetClass === "COMMODITY" ? "COMMODITY" : "FOREX";
    return yahoo.getQuote(instrument.ticker, instrument.symbol, ac, instrument.currency);
  }
  return { ok: false, error: `Unknown source: ${instrument.source}` };
}

/// Fetch many quotes concurrently, preserving input order.
export async function getQuotes(
  instruments: Instrument[]
): Promise<{ instrument: Instrument; result: DataResult<Quote> }[]> {
  const results = await Promise.all(
    instruments.map(async (i) => ({ instrument: i, result: await getQuote(i) }))
  );
  return results;
}
