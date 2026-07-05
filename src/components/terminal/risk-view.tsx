"use client";

import { useState } from "react";
import { Panel, PanelStat, EmptyState, LoadingState } from "@/components/panel";
import { AssetBadge } from "@/components/asset-badge";
import { useRiskSummary, usePortfolio } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtPrice, fmtCompact, fmtPct, fmtTimeAgo, ASSET_CLASS_META } from "@/lib/format";
import { Calculator, ShieldAlert, Grid3x3, TrendingDown, Activity, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AssetClass } from "@/lib/types";

export function RiskView() {
  const risk = useRiskSummary();
  const portfolio = usePortfolio();
  const r = risk.data;

  const ddWarn = r?.currentDrawdown != null && r.currentDrawdown < -10;
  const ddCritical = r?.currentDrawdown != null && r.currentDrawdown < -20;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 h-full overflow-y-auto pr-1">
      {/* LEFT — summary tiles + exposure */}
      <div className="xl:col-span-2 flex flex-col gap-3 min-h-0">
        {/* Top KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile
            label="Total Equity"
            value={r ? fmtCompact(r.totalEquity) : "—"}
            sub="cost basis + unreal. PnL"
            color="#e7e9ec"
            icon={Activity}
          />
          <KpiTile
            label="Total Exposure"
            value={r ? fmtCompact(r.totalExposure) : "—"}
            sub={r ? fmtPct(r.exposurePct) + " of equity" : "—"}
            color="#3b5fe0"
            icon={ShieldAlert}
          />
          <KpiTile
            label="Unrealized PnL"
            value={r ? fmtCompact(r.unrealizedPnl) : "—"}
            sub={r ? fmtPct((r.unrealizedPnl / Math.max(1, r.totalEquity - r.unrealizedPnl)) * 100) + " on cost" : "—"}
            color={r && r.unrealizedPnl >= 0 ? "#2e9e6d" : "#c7484b"}
            icon={r && r.unrealizedPnl >= 0 ? Activity : TrendingDown}
          />
          <KpiTile
            label="VaR (95%)"
            value={r && r.varEstimate != null ? fmtCompact(r.varEstimate) : "—"}
            sub="parametric, 1-day"
            color="#d4a02a"
            icon={AlertTriangle}
          />
        </div>

        {/* Drawdown + Exposure by class */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Panel title="Drawdown Monitor" subtitle="From reconstructed equity curve">
            {r ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <PanelStat
                    label="Current DD"
                    value={r.currentDrawdown != null ? fmtPct(r.currentDrawdown) : "—"}
                    valueColor={ddCritical ? "#c7484b" : ddWarn ? "#d4a02a" : "#2e9e6d"}
                  />
                  <PanelStat
                    label="Max DD (hist)"
                    value={r.maxDrawdown != null ? fmtPct(r.maxDrawdown) : "—"}
                    valueColor="#c7484b"
                  />
                </div>
                {/* drawdown bar */}
                {r.currentDrawdown != null && (
                  <div>
                    <div className="flex justify-between text-[9px] uppercase tracking-wider text-[#8891a0] mb-1">
                      <span>0%</span>
                      <span className={ddCritical ? "text-[#c7484b]" : ddWarn ? "text-[#d4a02a]" : ""}>
                        {ddCritical ? "CRITICAL (-20%)" : ddWarn ? "WARN (-10%)" : "Healthy"}
                      </span>
                      <span>-30%</span>
                    </div>
                    <div className="relative h-2 rounded bg-[#1b2029] overflow-hidden">
                      <div
                        className="absolute top-0 bottom-0 left-1/2"
                        style={{
                          width: `${Math.min(50, Math.abs(r.currentDrawdown) / 30 * 50)}%`,
                          right: "auto",
                          backgroundColor: ddCritical ? "#c7484b" : ddWarn ? "#d4a02a" : "#2e9e6d",
                        }}
                      />
                      <span className="absolute top-0 bottom-0 left-1/2 w-px bg-[#4a525c]" />
                    </div>
                  </div>
                )}
                {r.currentDrawdown == null && (
                  <p className="text-[10px] text-[#4a525c]">
                    Insufficient historical data to compute drawdown. Add positions across multiple assets.
                  </p>
                )}
              </div>
            ) : (
              <LoadingState rows={2} />
            )}
          </Panel>

          <Panel title="Exposure by Asset Class" subtitle="% of total exposure">
            {r && r.perAssetClass.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {r.perAssetClass.map((c) => {
                  const meta = ASSET_CLASS_META[c.assetClass];
                  return (
                    <li key={c.assetClass} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <AssetBadge assetClass={c.assetClass as AssetClass} size="xs" />
                          <span className="text-[#8891a0]">{meta?.label}</span>
                          <span className="text-[9px] text-[#4a525c]">({c.count})</span>
                        </div>
                        <span className="tabular text-[#e7e9ec]">
                          {fmtCompact(c.exposure)} · {fmtPct(c.pct)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded bg-[#1b2029] overflow-hidden">
                        <div
                          className="h-full rounded"
                          style={{ width: `${Math.min(100, c.pct)}%`, backgroundColor: meta?.color }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No exposure data" hint="Add positions to see exposure breakdown." icon={<ShieldAlert className="h-5 w-5" />} />
            )}
          </Panel>
        </div>

        {/* Position sizing calculator */}
        <PositionSizeCalc />
      </div>

      {/* RIGHT — per-position + correlation */}
      <div className="flex flex-col gap-3 min-h-0">
        <Panel
          title="Per-Position Weight"
          subtitle="Market value & weight"
          bodyClassName="p-0 overflow-y-auto max-h-[260px]"
        >
          {r && r.perPosition.length > 0 ? (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-wider text-[#8891a0] border-b border-[#262b33]">
                  <th className="px-2 py-1.5 font-medium">Pos</th>
                  <th className="px-2 py-1.5 font-medium text-right">Value</th>
                  <th className="px-2 py-1.5 font-medium text-right">Weight</th>
                  <th className="px-2 py-1.5 font-medium text-right">PnL%</th>
                </tr>
              </thead>
              <tbody>
                {r.perPosition.map((p) => (
                  <tr key={p.instrumentId} className="border-b border-[#11151c]">
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <AssetBadge assetClass={p.assetClass as AssetClass} size="xs" />
                        <span className="text-[#e7e9ec]">{p.symbol}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular text-[#8891a0]">{fmtCompact(p.marketValue)}</td>
                    <td className="px-2 py-1.5 text-right tabular text-[#e7e9ec]">{fmtPct(p.weightPct)}</td>
                    <td className="px-2 py-1.5 text-right tabular" style={{ color: p.pnlPct >= 0 ? "#2e9e6d" : "#c7484b" }}>
                      {fmtPct(p.pnlPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No positions" icon={<Activity className="h-5 w-5" />} />
          )}
        </Panel>

        <Panel
          title="Correlation Matrix"
          subtitle="Pairwise, daily log-returns (3m)"
          bodyClassName="overflow-x-auto"
        >
          <CorrelationMatrix />
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

function CorrelationMatrix() {
  const risk = useRiskSummary();
  const cells = risk.data?.correlation ?? [];
  // build symbol list (unique, ordered)
  const symbols: string[] = [];
  for (const c of cells) {
    if (!symbols.includes(c.a)) symbols.push(c.a);
  }
  if (symbols.length === 0) {
    return <EmptyState title="No correlation data" hint="Add ≥2 positions with overlapping price history." icon={<Grid3x3 className="h-5 w-5" />} />;
  }
  const lookup = new Map(cells.map((c) => [`${c.a}|${c.b}`, c.value]));
  const colorFor = (v: number | null) => {
    if (v === null) return "#1b2029";
    if (v >= 0.7) return "#c7484b";
    if (v >= 0.3) return "rgba(199,72,75,0.5)";
    if (v > -0.3) return "#262b33";
    if (v > -0.7) return "rgba(46,158,109,0.5)";
    return "#2e9e6d";
  };
  return (
    <table className="text-[10px] border-collapse">
      <thead>
        <tr>
          <th className="p-1"></th>
          {symbols.map((s) => (
            <th key={s} className="p-1 text-[9px] uppercase text-[#8891a0] font-medium text-center max-w-[44px] truncate" title={s}>
              {s.length > 5 ? s.slice(0, 5) : s}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {symbols.map((a) => (
          <tr key={a}>
            <td className="p-1 text-[9px] uppercase text-[#8891a0] font-medium text-right max-w-[60px] truncate" title={a}>
              {a.length > 6 ? a.slice(0, 6) : a}
            </td>
            {symbols.map((b) => {
              const v = lookup.get(`${a}|${b}`) ?? null;
              return (
                <td
                  key={b}
                  className="p-0.5 text-center tabular"
                  style={{ backgroundColor: colorFor(v), color: v !== null && Math.abs(v) > 0.5 ? "#0b0e13" : "#e7e9ec" }}
                  title={`${a} / ${b}: ${v !== null ? v.toFixed(2) : "n/a"}`}
                >
                  {v !== null ? v.toFixed(2) : "·"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PositionSizeCalc() {
  const [equity, setEquity] = useState("10000");
  const [riskPct, setRiskPct] = useState("1");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [side, setSide] = useState("LONG");
  const [result, setResult] = useState<null | {
    riskAmount: number;
    perUnitRisk: number;
    positionSize: number;
    positionValue: number;
  }>(null);

  function compute() {
    const eq = parseFloat(equity);
    const rp = parseFloat(riskPct);
    const e = parseFloat(entry);
    const s = parseFloat(stop);
    if (!Number.isFinite(eq) || eq <= 0) return toast.error("Equity must be > 0");
    if (!Number.isFinite(rp) || rp <= 0) return toast.error("Risk % must be > 0");
    if (!Number.isFinite(e) || e <= 0) return toast.error("Entry price must be > 0");
    if (!Number.isFinite(s) || s <= 0) return toast.error("Stop price must be > 0");
    if (e === s) return toast.error("Stop cannot equal entry");
    const riskAmount = (eq * rp) / 100;
    const perUnitRisk = Math.abs(e - s);
    const positionSize = riskAmount / perUnitRisk;
    const positionValue = positionSize * e;
    setResult({ riskAmount, perUnitRisk, positionSize, positionValue });
  }

  return (
    <Panel
      title="Position Sizing Calculator"
      subtitle="Risk-based sizing (PRD FR-3.3)"
      actions={<Calculator className="h-3.5 w-3.5 text-[#8891a0]" />}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Account Equity</Label>
          <Input value={equity} onChange={(e) => setEquity(e.target.value)} type="number" step="any" className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8" />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Risk % / trade</Label>
          <Input value={riskPct} onChange={(e) => setRiskPct(e.target.value)} type="number" step="any" className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8" />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Side</Label>
          <div className="flex mt-1 h-8 rounded border border-[#262b33] overflow-hidden">
            <button
              onClick={() => setSide("LONG")}
              className={cn("flex-1 text-[10px] uppercase tracking-wider", side === "LONG" ? "bg-[#2e9e6d]/20 text-[#2e9e6d]" : "text-[#8891a0]")}
            >
              Long
            </button>
            <button
              onClick={() => setSide("SHORT")}
              className={cn("flex-1 text-[10px] uppercase tracking-wider", side === "SHORT" ? "bg-[#c7484b]/20 text-[#c7484b]" : "text-[#8891a0]")}
            >
              Short
            </button>
          </div>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Entry Price</Label>
          <Input value={entry} onChange={(e) => setEntry(e.target.value)} type="number" step="any" placeholder="0.00" className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8" />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Stop Price</Label>
          <Input value={stop} onChange={(e) => setStop(e.target.value)} type="number" step="any" placeholder="0.00" className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8" />
        </div>
        <div className="flex items-end">
          <Button onClick={compute} className="w-full h-8 text-[10px] uppercase tracking-wider bg-[#3b5fe0] hover:bg-[#2f4ec2]">
            Calculate
          </Button>
        </div>
      </div>
      {result && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          <PanelStat label="Risk Amount" value={fmtCompact(result.riskAmount)} sub="capital at risk" valueColor="#c7484b" />
          <PanelStat label="Per-Unit Risk" value={fmtPrice(result.perUnitRisk)} sub="|entry − stop|" />
          <PanelStat label="Position Size" value={fmtCompact(result.positionSize)} sub="units" valueColor="#3b5fe0" />
          <PanelStat label="Position Value" value={fmtCompact(result.positionValue)} sub="notional" />
        </div>
      )}
    </Panel>
  );
}
