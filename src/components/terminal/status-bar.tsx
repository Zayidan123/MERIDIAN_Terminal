"use client";

import { useEffect, useState } from "react";
import { useMarketSummary, useHealth } from "@/lib/api-client";
import { useLivePrices } from "@/hooks/use-live-prices";
import { fmtClock, fmtPct, SOURCE_LABELS } from "@/lib/format";
import { Wifi, WifiOff, Loader2, TrendingUp, TrendingDown, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

const SOURCE_ORDER = ["binance", "yahoo", "coingecko"] as const;

export function StatusBar() {
  const summary = useMarketSummary();
  const health = useHealth();
  const live = useLivePrices();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const latest = health.data?.latest ?? [];
  const bySource: Record<string, { status: string; latencyMs: number }> = {};
  for (const l of latest) bySource[l.source] = { status: l.status, latencyMs: l.latencyMs };

  const avg = summary.data?.avgChangePct ?? null;
  const byClass = summary.data?.byAssetClass ?? ({} as Record<string, number | null>);

  return (
    <header className="flex items-stretch gap-3 h-12 px-3 border-b border-[#262b33] bg-[#0b0e13] shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2 pr-3 border-r border-[#262b33]">
        <span className="font-heading font-semibold text-[13px] tracking-[0.18em] text-[#e7e9ec]">
          MERIDIAN
        </span>
        <span className="text-[9px] uppercase tracking-[0.2em] text-[#4a525c] border border-[#262b33] rounded px-1 py-0.5">
          Terminal
        </span>
      </div>

      {/* Market summary strip */}
      <div className="flex items-center gap-3 overflow-x-auto scrollbar-none flex-1 min-w-0">
        <div className="flex items-center gap-1.5 shrink-0">
          {avg === null ? (
            <Loader2 className="h-3 w-3 animate-spin text-[#8891a0]" />
          ) : avg >= 0 ? (
            <TrendingUp className="h-3 w-3 text-[#2e9e6d]" />
          ) : (
            <TrendingDown className="h-3 w-3 text-[#c7484b]" />
          )}
          <span className="text-[10px] uppercase tracking-wider text-[#8891a0]">Mkt Avg</span>
          <span className={cn("text-xs font-medium tabular", avg != null && avg >= 0 ? "text-[#2e9e6d]" : avg != null ? "text-[#c7484b]" : "text-[#8891a0]")}>
            {fmtPct(avg)}
          </span>
        </div>
        <Divider />
        <ClassChip label="CRY" value={byClass.CRYPTO} />
        <Divider />
        <ClassChip label="EQ" value={byClass.EQUITY} />
        <Divider />
        <ClassChip label="FX" value={byClass.FOREX} />
        <Divider />
        <ClassChip label="COM" value={byClass.COMMODITY} />
        <Divider />
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-[#8891a0]">G/L</span>
          <span className="text-xs tabular text-[#2e9e6d]">{summary.data?.gainers ?? 0}</span>
          <span className="text-[10px] text-[#4a525c]">/</span>
          <span className="text-xs tabular text-[#c7484b]">{summary.data?.losers ?? 0}</span>
        </div>
        {summary.data && summary.data.failed > 0 && (
          <>
            <Divider />
            <span className="text-[10px] uppercase tracking-wider text-[#d4a02a] shrink-0">
              {summary.data.failed} src down
            </span>
          </>
        )}
      </div>

      {/* Source health */}
      <div className="flex items-center gap-3 px-3 border-l border-r border-[#262b33] shrink-0">
        {SOURCE_ORDER.map((s) => {
          const h = bySource[s];
          const ok = h?.status === "OK";
          const warn = h?.status === "RATE_LIMITED" || h?.status === "TIMEOUT";
          const down = h?.status === "FAIL";
          return (
            <div key={s} className="flex items-center gap-1.5" title={h ? `${h.status} · ${h.latencyMs}ms` : "no data yet"}>
              {ok ? (
                <Wifi className="h-3 w-3 text-[#2e9e6d]" />
              ) : down ? (
                <WifiOff className="h-3 w-3 text-[#c7484b]" />
              ) : warn ? (
                <Loader2 className="h-3 w-3 text-[#d4a02a]" />
              ) : (
                <span className="h-3 w-3 rounded-full border border-[#262b33]" />
              )}
              <span className="text-[10px] uppercase tracking-wider text-[#8891a0]">
                {SOURCE_LABELS[s]?.split(" ")[0] ?? s}
              </span>
              {h && <span className="text-[9px] tabular text-[#4a525c]">{h.latencyMs}ms</span>}
            </div>
          );
        })}
      </div>

      {/* Clock + WS status */}
      <div className="flex items-center gap-3 shrink-0">
        <WsIndicator status={live.status} />
        <Divider />
        <span className="text-[10px] uppercase tracking-wider text-[#8891a0]">WIB</span>
        <span className="text-xs tabular text-[#e7e9ec]">{fmtClock(now)}</span>
        <span className="h-1.5 w-1.5 rounded-full bg-[#2e9e6d] animate-live-pulse" />
      </div>
    </header>
  );
}

function WsIndicator({ status }: { status: "connecting" | "connected" | "disconnected" }) {
  const cfg =
    status === "connected"
      ? { color: "text-[#2e9e6d]", bg: "bg-[#2e9e6d]", label: "WS LIVE" }
      : status === "connecting"
        ? { color: "text-[#d4a02a]", bg: "bg-[#d4a02a]", label: "WS …" }
        : { color: "text-[#c7484b]", bg: "bg-[#c7484b]", label: "WS OFF" };
  return (
    <div className="flex items-center gap-1.5" title={`WebSocket: ${status}`}>
      {status === "connecting" ? (
        <Loader2 className={cn("h-3 w-3 animate-spin", cfg.color)} />
      ) : status === "connected" ? (
        <Radio className={cn("h-3 w-3", cfg.color)} />
      ) : (
        <WifiOff className={cn("h-3 w-3", cfg.color)} />
      )}
      <span className={cn("text-[10px] uppercase tracking-wider", cfg.color)}>{cfg.label}</span>
    </div>
  );
}

function Divider() {
  return <span className="h-4 w-px bg-[#262b33] shrink-0" />;
}

function ClassChip({ label, value }: { label: string; value: number | null | undefined }) {
  const color = value == null ? "#8891a0" : value >= 0 ? "#2e9e6d" : "#c7484b";
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-[10px] uppercase tracking-wider text-[#8891a0]">{label}</span>
      <span className="text-xs tabular" style={{ color }}>
        {fmtPct(value)}
      </span>
    </div>
  );
}
