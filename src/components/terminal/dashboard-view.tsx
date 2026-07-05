"use client";

import { Panel, EmptyState, LoadingState } from "@/components/panel";
import { QuoteTable } from "@/components/terminal/quote-table";
import { useSignals, usePortfolio, useMarketSummary } from "@/lib/api-client";
import { AssetBadge, ChangeText } from "@/components/asset-badge";
import { fmtPrice, fmtCompact, fmtPct, fmtTimeAgo, ASSET_CLASS_META } from "@/lib/format";
import { Siren, TrendingUp, TrendingDown, Activity, AlertCircle } from "lucide-react";
import { useTerminal } from "@/lib/store";
import { cn } from "@/lib/utils";

export function DashboardView() {
  const signals = useSignals(8);
  const portfolio = usePortfolio();
  const summary = useMarketSummary();
  const { setActive, selectInstrument } = useTerminal();

  const recentSignals = (signals.data ?? []).slice(0, 6);
  const positions = (portfolio.data ?? []).slice(0, 5);
  const totalPnl = (portfolio.data ?? []).reduce(
    (a, p) => a + (p.unrealizedPnl ?? 0),
    0
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 h-full overflow-y-auto pr-1">
      {/* LEFT — market overview */}
      <div className="xl:col-span-2 flex flex-col gap-3 min-h-0">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile
            label="Market Avg 24h"
            value={summary.data ? fmtPct(summary.data.avgChangePct) : "—"}
            color={
              summary.data?.avgChangePct == null
                ? "#8891a0"
                : summary.data.avgChangePct >= 0
                  ? "#2e9e6d"
                  : "#c7484b"
            }
            icon={summary.data?.avgChangePct == null ? Activity : summary.data.avgChangePct >= 0 ? TrendingUp : TrendingDown}
            sub={`${summary.data?.gainers ?? 0}▲ / ${summary.data?.losers ?? 0}▼`}
          />
          <KpiTile
            label="Active Positions"
            value={String(portfolio.data?.length ?? 0)}
            color="#e7e9ec"
            icon={Activity}
            sub={portfolio.data ? `unreal. ${fmtCompact(totalPnl)}` : "—"}
          />
          <KpiTile
            label="Open Alerts"
            value={String(recentSignals.length)}
            color="#d4a02a"
            icon={Siren}
            sub="recent 24h signals"
          />
          <KpiTile
            label="Sources Degraded"
            value={String(summary.data?.failed ?? 0)}
            color={summary.data && summary.data.failed > 0 ? "#c7484b" : "#2e9e6d"}
            icon={AlertCircle}
            sub={summary.data && summary.data.failed > 0 ? "see Data Sources" : "all healthy"}
          />
        </div>

        {/* Watchlist quotes */}
        <Panel
          title="Watchlist — Live Quotes"
          subtitle="Crypto · IDX · Forex · Gold — all real-time"
          className="flex-1 min-h-0"
          bodyClassName="p-0 overflow-y-auto max-h-[460px]"
          actions={
            <button
              onClick={() => setActive("watchlist")}
              className="text-[10px] uppercase tracking-wider text-[#8891a0] hover:text-[#e7e9ec]"
            >
              open →
            </button>
          }
        >
          <QuoteTable />
        </Panel>
      </div>

      {/* RIGHT — signals + portfolio snapshot */}
      <div className="flex flex-col gap-3 min-h-0">
        <Panel
          title="Recent Signals"
          subtitle="Anomaly & alert engine"
          className="flex-1 min-h-0"
          bodyClassName="p-0 overflow-y-auto max-h-[300px]"
          actions={
            <button
              onClick={() => setActive("signals")}
              className="text-[10px] uppercase tracking-wider text-[#8891a0] hover:text-[#e7e9ec]"
            >
              all →
            </button>
          }
        >
          {signals.isLoading ? (
            <LoadingState rows={4} />
          ) : recentSignals.length === 0 ? (
            <EmptyState
              title="No signals yet"
              hint="The scanner runs every few minutes. Detected volume spikes, breakouts & RSI extremes will appear here."
              icon={<Siren className="h-6 w-6" />}
            />
          ) : (
            <ul className="divide-y divide-[#11151c]">
              {recentSignals.map((s) => (
                <li
                  key={s.id}
                  onClick={() => selectInstrument(s.instrumentId)}
                  className="px-2.5 py-2 hover:bg-[#1b2029] cursor-pointer flex items-start gap-2"
                >
                  <SeverityDot severity={s.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <AssetBadge assetClass={s.instrument.assetClass} size="xs" />
                      <span className="text-[11px] font-medium text-[#e7e9ec]">{s.instrument.symbol}</span>
                      <span className="text-[9px] uppercase tracking-wider text-[#4a525c]">{s.signalType}</span>
                    </div>
                    <p className="text-[10px] text-[#8891a0] truncate mt-0.5">{s.message}</p>
                  </div>
                  <span className="text-[9px] text-[#4a525c] tabular shrink-0">{fmtTimeAgo(s.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Portfolio Snapshot"
          subtitle="Top open positions"
          className="flex-1 min-h-0"
          bodyClassName="p-0 overflow-y-auto max-h-[260px]"
          actions={
            <button
              onClick={() => setActive("portfolio")}
              className="text-[10px] uppercase tracking-wider text-[#8891a0] hover:text-[#e7e9ec]"
            >
              open →
            </button>
          }
        >
          {portfolio.isLoading ? (
            <LoadingState rows={3} />
          ) : positions.length === 0 ? (
            <EmptyState
              title="No open positions"
              hint="Add positions in the Portfolio module to track exposure & PnL."
              icon={<Activity className="h-6 w-6" />}
            />
          ) : (
            <ul className="divide-y divide-[#11151c]">
              {positions.map((p) => (
                <li
                  key={p.id}
                  onClick={() => selectInstrument(p.instrumentId)}
                  className="px-2.5 py-2 hover:bg-[#1b2029] cursor-pointer flex items-center gap-2"
                >
                  <AssetBadge assetClass={p.instrument.assetClass} size="xs" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-[#e7e9ec]">{p.instrument.symbol}</span>
                      <span className="text-[9px] uppercase text-[#4a525c]">{p.side}</span>
                    </div>
                    <span className="text-[9px] text-[#4a525c] tabular">
                      {p.size} @ {fmtPrice(p.entryPrice, p.instrument.currency)}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    {p.error ? (
                      <span className="text-[9px] text-[#c7484b]">SRC DOWN</span>
                    ) : (
                      <>
                        <div className="text-[11px] tabular">
                          {p.lastPrice != null ? fmtPrice(p.lastPrice, p.instrument.currency) : "—"}
                        </div>
                        <ChangeText value={p.unrealizedPnlPct} />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: typeof Activity;
}) {
  return (
    <div className="bg-[#151920] border border-[#262b33] rounded-md p-3 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wider text-[#8891a0]">{label}</span>
        <Icon className="h-3 w-3" style={{ color }} />
      </div>
      <span className="text-xl font-semibold tabular leading-none" style={{ color }}>
        {value}
      </span>
      {sub && <span className="text-[10px] text-[#4a525c] tabular">{sub}</span>}
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color =
    severity === "CRITICAL" ? "#c7484b" : severity === "WARN" ? "#d4a02a" : "#3b5fe0";
  return <span className={cn("mt-1 h-1.5 w-1.5 rounded-full shrink-0")} style={{ backgroundColor: color }} />;
}
