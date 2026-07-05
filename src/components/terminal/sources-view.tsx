"use client";

import { Panel, EmptyState, LoadingState } from "@/components/panel";
import { useHealth } from "@/lib/api-client";
import { fmtTimeAgo, SOURCE_LABELS } from "@/lib/format";
import { Database, CheckCircle2, XCircle, AlertTriangle, Clock, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_META: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
  OK: { icon: CheckCircle2, color: "#2e9e6d", bg: "rgba(46,158,109,0.12)", label: "Operational" },
  FAIL: { icon: XCircle, color: "#c7484b", bg: "rgba(199,72,75,0.12)", label: "Failed" },
  RATE_LIMITED: { icon: AlertTriangle, color: "#d4a02a", bg: "rgba(212,160,42,0.12)", label: "Rate-Limited" },
  TIMEOUT: { icon: Clock, color: "#d4a02a", bg: "rgba(212,160,42,0.12)", label: "Timed Out" },
};

const SOURCES = [
  {
    key: "binance",
    label: "Binance API",
    desc: "Crypto OHLCV klines + ticker (data-api.binance.vision)",
    endpoints: ["klines", "ticker/price", "klines24h"],
  },
  {
    key: "yahoo",
    label: "Yahoo Finance",
    desc: "IDX equities (.JK), forex (XXX=X), gold (GC=F) via query2",
    endpoints: ["chart"],
  },
  {
    key: "coingecko",
    label: "CoinGecko",
    desc: "Crypto market cap / FDV (reserved; not actively used)",
    endpoints: [],
  },
];

export function SourcesView() {
  const health = useHealth();
  const latest = health.data?.latest ?? [];
  const recent = health.data?.recent ?? [];

  const bySource: Record<string, { status: string; latencyMs: number; checkedAt: number }> = {};
  for (const l of latest) bySource[l.source] = { status: l.status, latencyMs: l.latencyMs, checkedAt: l.checkedAt };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 h-full overflow-y-auto pr-1">
      {/* Source status cards */}
      <div className="flex flex-col gap-3 min-h-0">
        <Panel title="Data Sources" subtitle="Real-market providers · live health" bodyClassName="flex flex-col gap-2">
          {SOURCES.map((s) => {
            const h = bySource[s.key];
            const meta = h ? STATUS_META[h.status] : null;
            const Icon = meta?.icon ?? Activity;
            return (
              <div key={s.key} className="border border-[#262b33] rounded-md p-3 bg-[#11151c]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Database className="h-3.5 w-3.5 text-[#8891a0]" />
                      <span className="text-[12px] font-semibold text-[#e7e9ec]">{s.label}</span>
                    </div>
                    <p className="text-[10px] text-[#8891a0] mt-1">{s.desc}</p>
                  </div>
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded shrink-0"
                    style={{ backgroundColor: meta?.bg ?? "#1b2029" }}
                  >
                    <Icon className="h-3 w-3" style={{ color: meta?.color ?? "#8891a0" }} />
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: meta?.color ?? "#8891a0" }}>
                      {h ? meta?.label : "Idle"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-2 text-[10px] text-[#4a525c] tabular">
                  {h ? (
                    <>
                      <span>latency <span style={{ color: "#8891a0" }}>{h.latencyMs}ms</span></span>
                      <span>last check <span style={{ color: "#8891a0" }}>{fmtTimeAgo(h.checkedAt)}</span></span>
                    </>
                  ) : (
                    <span>Awaiting first request…</span>
                  )}
                </div>
                {s.endpoints.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {s.endpoints.map((e) => (
                      <span key={e} className="text-[9px] uppercase tracking-wider text-[#4a525c] bg-[#0b0e13] border border-[#262b33] rounded px-1.5 py-0.5">
                        {e}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="mt-1 p-2 rounded bg-[#0b0e13] border border-[#262b33] text-[10px] text-[#8891a0]">
            <strong className="text-[#e7e9ec]">Data Integrity Policy (PRD §6):</strong> When a source
            is down or rate-limited, affected panels surface “Source unavailable” — never fabricated
            values. Every panel shows a provenance bar (source + sync time).
          </div>
        </Panel>
      </div>

      {/* Recent request log */}
      <div className="flex flex-col gap-3 min-h-0">
        <Panel
          title="Request Log"
          subtitle={`${recent.length} most recent external calls`}
          bodyClassName="p-0 overflow-y-auto max-h-[calc(100vh-200px)]"
        >
          {health.isLoading ? (
            <LoadingState rows={8} />
          ) : recent.length === 0 ? (
            <EmptyState
              title="No requests logged yet"
              hint="Health entries are written as the app fetches market data. Browse the dashboard to populate."
              icon={<Database className="h-6 w-6" />}
            />
          ) : (
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-[#11151c]">
                <tr className="text-left text-[9px] uppercase tracking-wider text-[#8891a0] border-b border-[#262b33]">
                  <th className="px-2 py-1.5 font-medium">Time</th>
                  <th className="px-2 py-1.5 font-medium">Source</th>
                  <th className="px-2 py-1.5 font-medium">Endpoint</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 font-medium text-right">Latency</th>
                  <th className="px-2 py-1.5 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => {
                  const meta = STATUS_META[r.status];
                  return (
                    <tr key={r.source + r.checkedAt + r.endpoint} className="border-b border-[#11151c]">
                      <td className="px-2 py-1.5 tabular text-[#4a525c]">{fmtTimeAgo(r.checkedAt)}</td>
                      <td className="px-2 py-1.5 text-[#8891a0]">{SOURCE_LABELS[r.source] ?? r.source}</td>
                      <td className="px-2 py-1.5 text-[#e7e9ec] tabular">{r.endpoint}</td>
                      <td className="px-2 py-1.5">
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider"
                          style={{ backgroundColor: meta?.bg ?? "#1b2029", color: meta?.color ?? "#8891a0" }}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular text-[#8891a0]">
                        {r.latencyMs != null ? r.latencyMs + "ms" : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-[#c7484b] truncate max-w-[180px]" title={r.errorMessage ?? ""}>
                        {r.errorMessage ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
