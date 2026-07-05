"use client";

import { LayoutDashboard, ListChecks, Siren, ShieldAlert, Briefcase, Database, Activity } from "lucide-react";
import { useTerminal, type ModuleKey } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useAlerts, useSignals } from "@/lib/api-client";

const NAV: { key: ModuleKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "watchlist", label: "Watchlist", icon: ListChecks },
  { key: "signals", label: "Signals", icon: Siren },
  { key: "risk", label: "Risk", icon: ShieldAlert },
  { key: "portfolio", label: "Portfolio", icon: Briefcase },
  { key: "sources", label: "Data Sources", icon: Database },
];

export function NavRail() {
  const { active, setActive } = useTerminal();
  const alerts = useAlerts();
  const signals = useSignals();
  const activeAlerts = (alerts.data ?? []).filter((a) => a.status === "ACTIVE").length;
  const recentSignals = (signals.data ?? []).filter((s) => Date.now() - s.createdAt < 24 * 3600_000).length;

  const badge: Partial<Record<ModuleKey, number>> = {
    signals: activeAlerts + recentSignals,
  };

  return (
    <nav className="flex flex-col items-center gap-1 w-14 shrink-0 border-r border-[#262b33] bg-[#0b0e13] py-2">
      <div className="flex items-center justify-center w-9 h-9 mb-2 rounded-md bg-[#3b5fe0]">
        <Activity className="h-5 w-5 text-white" strokeWidth={2.4} />
      </div>
      {NAV.map(({ key, label, icon: Icon }) => {
        const isActive = active === key;
        const count = badge[key];
        return (
          <button
            key={key}
            onClick={() => setActive(key)}
            title={label}
            className={cn(
              "group relative flex items-center justify-center w-10 h-10 rounded-md transition-colors",
              isActive ? "bg-[#151920] text-[#e7e9ec]" : "text-[#8891a0] hover:text-[#e7e9ec] hover:bg-[#151920]"
            )}
          >
            {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-[#3b5fe0]" />}
            <Icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.2 : 1.8} />
            {count ? (
              <span className="absolute top-1 right-1 min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full bg-[#c7484b] text-[9px] font-semibold text-white tabular">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
            <span className="pointer-events-none absolute left-12 z-50 whitespace-nowrap rounded bg-[#151920] border border-[#262b33] px-2 py-1 text-[10px] uppercase tracking-wider text-[#e7e9ec] opacity-0 group-hover:opacity-100 transition-opacity">
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
