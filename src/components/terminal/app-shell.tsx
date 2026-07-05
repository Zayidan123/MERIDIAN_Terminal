"use client";

import { useEffect } from "react";
import { NavRail } from "@/components/terminal/nav-rail";
import { StatusBar } from "@/components/terminal/status-bar";
import { DashboardView } from "@/components/terminal/dashboard-view";
import { WatchlistView } from "@/components/terminal/watchlist-view";
import { SignalsView } from "@/components/terminal/signals-view";
import { RiskView } from "@/components/terminal/risk-view";
import { PortfolioView } from "@/components/terminal/portfolio-view";
import { SourcesView } from "@/components/terminal/sources-view";
import { useTerminal, type ModuleKey } from "@/lib/store";
import { useSeed, useSignalPoller } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";

const TITLES: Record<ModuleKey, { title: string; sub: string }> = {
  dashboard: { title: "Dashboard", sub: "Cross-asset market overview" },
  watchlist: { title: "Watchlist", sub: "Multi-asset monitoring & instrument detail" },
  signals: { title: "Signals & Alerts", sub: "Anomaly detection & custom alert rules" },
  risk: { title: "Risk Management", sub: "Exposure · VaR · drawdown · correlation" },
  portfolio: { title: "Portfolio", sub: "Positions & mark-to-market" },
  sources: { title: "Data Sources", sub: "Provenance & health monitoring" },
};

export function AppShell() {
  const { active } = useTerminal();
  const seed = useSeed();
  const qc = useQueryClient();

  // Ensure instruments + default watchlist exist on first load.
  useEffect(() => {
    seed.mutate(undefined, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["instruments"] });
        qc.invalidateQueries({ queryKey: ["watchlist"] });
      },
    });
  }, [seed, qc]);

  // Background signal polling (evaluate alerts + scan anomalies).
  useSignalPoller(true);

  const meta = TITLES[active];

  return (
    <div className="flex flex-col h-screen min-h-0 bg-[#0b0e13] text-[#e7e9ec]">
      <StatusBar />
      <div className="flex flex-1 min-h-0">
        <NavRail />
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Module header */}
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-[#262b33] bg-[#0b0e13] shrink-0">
            <div>
              <h1 className="font-heading font-semibold text-[15px] tracking-wide text-[#e7e9ec] leading-none">
                {meta.title}
              </h1>
              <p className="text-[10px] text-[#8891a0] mt-1">{meta.sub}</p>
            </div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[#4a525c]">
              <ShieldCheck className="h-3.5 w-3.5 text-[#2e9e6d]" />
              <span>100% real market data · zero simulation</span>
            </div>
          </div>

          {/* Active module */}
          <div className="flex-1 min-h-0 overflow-hidden p-3">
            {active === "dashboard" && <DashboardView />}
            {active === "watchlist" && <WatchlistView />}
            {active === "signals" && <SignalsView />}
            {active === "risk" && <RiskView />}
            {active === "portfolio" && <PortfolioView />}
            {active === "sources" && <SourcesView />}
          </div>

          {/* Sticky footer */}
          <footer className="flex items-center justify-between gap-3 px-4 py-1.5 border-t border-[#262b33] bg-[#0b0e13] shrink-0">
            <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-[#4a525c]">
              <span className="font-heading font-semibold text-[#8891a0]">MERIDIAN</span>
              <span>Terminal v1.0</span>
              <span>·</span>
              <span>Research · Signal · Risk</span>
            </div>
            <div className="flex items-center gap-3 text-[9px] uppercase tracking-wider text-[#4a525c]">
              <span>Crypto · IDX · Forex · Gold</span>
              <span>·</span>
              <span>Not financial advice — PRD §19</span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
