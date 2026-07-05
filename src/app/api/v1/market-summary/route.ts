// MERIDIAN Terminal — cross-asset market summary for the dashboard header /
// top status bar. Honest aggregate: gainers/losers/unchanged/failed counts
// plus per-asset-class average changePct (null when no successful quotes).

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { getQuotes } from "@/lib/data-sources";
import type { AssetClass, Instrument } from "@/lib/types";

const REPRESENTATIVE_TICKERS = [
  "BTCUSDT",
  "ETHUSDT",
  "BBCA.JK",
  "GC=F",
  "EURUSD=X",
];

function toInstrument(row: {
  id: string;
  assetClass: string;
  ticker: string;
  symbol: string;
  name: string;
  exchange: string | null;
  currency: string;
  source: string;
  lotSize: number | null;
  metadata: string | null;
}): Instrument {
  return {
    id: row.id,
    assetClass: row.assetClass as AssetClass,
    ticker: row.ticker,
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    currency: row.currency,
    source: row.source as Instrument["source"],
    lotSize: row.lotSize,
    metadata: row.metadata,
  };
}

const ASSET_CLASSES: AssetClass[] = ["CRYPTO", "EQUITY", "FOREX", "COMMODITY"];

export async function GET() {
  try {
    const rows = await db.instrument.findMany({
      where: { ticker: { in: REPRESENTATIVE_TICKERS } },
    });
    const instruments = rows.map(toInstrument);
    const results = await getQuotes(instruments);

    let gainers = 0;
    let losers = 0;
    let unchanged = 0;
    let failed = 0;
    const pctByClass: Record<AssetClass, number[]> = {
      CRYPTO: [],
      EQUITY: [],
      FOREX: [],
      COMMODITY: [],
    };

    for (const { instrument, result } of results) {
      if (!result.ok || !result.data) {
        failed++;
        continue;
      }
      const q = result.data;
      const ac = instrument.assetClass;
      if (q.changePct24h == null) {
        unchanged++;
        continue;
      }
      if (q.changePct24h > 0.0001) gainers++;
      else if (q.changePct24h < -0.0001) losers++;
      else unchanged++;
      if (ac in pctByClass) pctByClass[ac].push(q.changePct24h);
    }

    const successfulPcts = ASSET_CLASSES.flatMap((ac) => pctByClass[ac]);
    const avgChangePct =
      successfulPcts.length > 0
        ? successfulPcts.reduce((a, b) => a + b, 0) / successfulPcts.length
        : null;

    const byAssetClass: Record<AssetClass, number | null> = {
      CRYPTO: pctByClass.CRYPTO.length ? avg(pctByClass.CRYPTO) : null,
      EQUITY: pctByClass.EQUITY.length ? avg(pctByClass.EQUITY) : null,
      FOREX: pctByClass.FOREX.length ? avg(pctByClass.FOREX) : null,
      COMMODITY: pctByClass.COMMODITY.length ? avg(pctByClass.COMMODITY) : null,
    };

    return ok({
      gainers,
      losers,
      unchanged,
      failed,
      avgChangePct,
      byAssetClass,
      asOf: Date.now(),
    });
  } catch (e) {
    console.error("[market-summary.GET]", e);
    return fail("Internal error", 500);
  }
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
