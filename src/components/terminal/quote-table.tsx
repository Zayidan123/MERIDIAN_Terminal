"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuotes, useWatchlist } from "@/lib/api-client";
import { AssetBadge, ChangeText } from "@/components/asset-badge";
import { Sparkline } from "@/components/candlestick-chart";
import { fmtPrice, fmtCompact } from "@/lib/format";
import { useTerminal } from "@/lib/store";
import { useLivePrices } from "@/hooks/use-live-prices";
import { cn } from "@/lib/utils";
import { Loader2, ChevronRight } from "lucide-react";

export function QuoteTable({
  compact = false,
  filterClass,
}: {
  compact?: boolean;
  filterClass?: string;
}) {
  const quotes = useQuotes();
  const watchlist = useWatchlist();
  const { selectInstrument } = useTerminal();
  const live = useLivePrices();

  const rows = useMemo(() => {
    const wlMap = new Map((watchlist.data?.items ?? []).map((i) => [i.instrument.id, i.instrument]));
    let qs = quotes.data?.quotes ?? [];
    if (filterClass) qs = qs.filter((q) => wlMap.get(q.instrumentId)?.assetClass === filterClass);
    return qs.map((q) => ({ ...q, instrument: wlMap.get(q.instrumentId) }));
  }, [quotes.data, watchlist.data, filterClass]);

  // Union of tickers visible in this table — (re)subscribed to the
  // ws-prices service on change. The service aggregates across all clients
  // into a single upstream Binance WS + Yahoo poller, so re-subscribing
  // with the same set is a cheap idempotent operation.
  const tickers = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .map((r) => r.ticker)
            .filter((t): t is string => typeof t === "string" && t.length > 0)
        )
      ),
    [rows]
  );
  const tickerKey = tickers.join(",");
  useEffect(() => {
    if (tickers.length === 0) return;
    live.subscribe(tickers);
    const previous = tickers;
    return () => {
      live.unsubscribe(previous);
    };
  }, [tickerKey, live]);

  if (quotes.isLoading || watchlist.isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-[#8891a0]">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading live quotes…
      </div>
    );
  }

  if (quotes.isError) {
    return (
      <div className="py-6 text-center text-xs text-[#c7484b]">
        Failed to load quotes: {String(quotes.error?.message ?? "unknown")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-wider text-[#8891a0] border-b border-[#262b33]">
            <th className="px-2 py-1.5 font-medium">Asset</th>
            <th className="px-2 py-1.5 font-medium">Symbol</th>
            {!compact && <th className="px-2 py-1.5 font-medium text-right">Last</th>}
            <th className="px-2 py-1.5 font-medium text-right">Chg 24h</th>
            {!compact && <th className="px-2 py-1.5 font-medium text-right">High</th>}
            {!compact && <th className="px-2 py-1.5 font-medium text-right">Low</th>}
            {!compact && <th className="px-2 py-1.5 font-medium text-right">Vol 24h</th>}
            <th className="px-2 py-1.5 font-medium text-right">7d Trend</th>
            <th className="px-2 py-1.5 font-medium w-6"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const inst = r.instrument;
            if (!inst) return null;
            const q = r.quote;
            const cur = q?.currency ?? inst.currency;
            // Live price overlay — if the ws-prices service has a fresh tick
            // for this ticker, prefer it over the polled quote. The polled
            // quote still supplies changePct24h/high24h/low24h/volume24h.
            const liveEntry = live.prices[r.ticker];
            const displayPrice = liveEntry?.price ?? q?.price ?? null;
            const flashClass =
              liveEntry?.flash === "up"
                ? "flash-up"
                : liveEntry?.flash === "down"
                  ? "flash-down"
                  : "";
            // Use the live tick's `time` as the React key so the flash
            // animation re-runs on every fresh tick (CSS animations only
            // fire on class application; without a key change, back-to-back
            // up-ticks would not retrigger the animation).
            const liveKey = liveEntry ? `live-${liveEntry.time}` : "static";
            return (
              <tr
                key={r.instrumentId}
                onClick={() => selectInstrument(r.instrumentId)}
                className="border-b border-[#11151c] hover:bg-[#1b2029] cursor-pointer transition-colors"
              >
                <td className="px-2 py-1.5">
                  <AssetBadge assetClass={inst.assetClass} size="xs" />
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-[#e7e9ec]">{inst.symbol}</span>
                    {liveEntry && live.status === "connected" && (
                      <span
                        className="h-1 w-1 rounded-full bg-[#2e9e6d] animate-live-pulse"
                        title="Live price stream"
                        aria-label="Live price stream active"
                      />
                    )}
                  </div>
                  <div className="text-[9px] text-[#4a525c] truncate max-w-[120px]">{inst.name}</div>
                </td>
                {!compact && (
                  <td className="px-2 py-1.5 text-right tabular">
                    {displayPrice !== null ? (
                      <span
                        key={liveKey}
                        className={cn(
                          "inline-block px-1 -mx-1 rounded-sm",
                          flashClass
                        )}
                      >
                        {fmtPrice(displayPrice, cur)}
                      </span>
                    ) : (
                      <span className="text-[#4a525c]">&mdash;</span>
                    )}
                  </td>
                )}
                <td className="px-2 py-1.5 text-right">
                  {q ? <ChangeText value={q.changePct24h} /> : <span className="text-[#c7484b] text-[10px]">SRC DOWN</span>}
                </td>
                {!compact && (
                  <td className="px-2 py-1.5 text-right tabular text-[#2e9e6d]">
                    {q ? fmtPrice(q.high24h, cur) : "—"}
                  </td>
                )}
                {!compact && (
                  <td className="px-2 py-1.5 text-right tabular text-[#c7484b]">
                    {q ? fmtPrice(q.low24h, cur) : "—"}
                  </td>
                )}
                {!compact && (
                  <td className="px-2 py-1.5 text-right tabular text-[#8891a0]">
                    {q ? fmtCompact(q.volume24h) : "—"}
                  </td>
                )}
                <td className="px-2 py-1.5">
                  <SparklineTrend instrumentId={r.instrumentId} />
                </td>
                <td className="px-2 py-1.5 text-right text-[#4a525c]">
                  <ChevronRight className="h-3 w-3 inline" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/// Fetches a 7d candle series for the sparkline. Uses a tiny inline fetch to
/// avoid hook rules issues inside a table cell.
import type { Candle } from "@/lib/types";

function SparklineTrend({ instrumentId }: { instrumentId: string }) {
  const [closes, setCloses] = useState<number[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/prices/${instrumentId}?range=7d`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const candles = (j?.data?.candles ?? []) as Candle[];
        setCloses(candles.map((c) => c.close));
      })
      .catch(() => alive && setCloses(null));
    return () => {
      alive = false;
    };
  }, [instrumentId]);
  if (closes === null) return <span className="text-[#4a525c] text-[10px]">…</span>;
  if (closes.length < 2) return <span className="text-[#4a525c] text-[10px]">—</span>;
  return (
    <div className="flex justify-end">
      <Sparkline data={closes} width={70} height={20} />
    </div>
  );
}
