"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Panel, PanelStat, EmptyState, LoadingState } from "@/components/panel";
import { AssetBadge } from "@/components/asset-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtPrice, fmtCompact, fmtPct, fmtDateTime } from "@/lib/format";
import { FlaskConical, Play, Download, Trash2, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── types ──────────────────────────────────────────────────────────────
interface Instrument {
  id: string;
  symbol: string;
  ticker: string;
  name: string;
  assetClass: string;
}

interface BacktestSummary {
  id: string;
  instrument: { id: string; symbol: string; ticker: string; assetClass: string };
  strategyType: string;
  paramsJson: string;
  timeframe: string;
  candleCount: number;
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  winRate: number;
  tradeCount: number;
  sharpeRatio: number | null;
  profitFactor: number | null;
  createdAt: string;
}

interface BacktestDetail {
  id: string;
  instrument: { id: string; symbol: string; ticker: string; assetClass: string; currency: string };
  strategyType: string;
  params: Record<string, number>;
  timeframe: string;
  period: { start: number; end: number };
  candleCount: number;
  createdAt: string;
  metrics: {
    initialCapital: number;
    finalEquity: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    winRate: number;
    tradeCount: number;
    sharpeRatio: number | null;
    profitFactor: number | null;
    avgWinPct: number;
    avgLossPct: number;
    largestWinPct: number;
    largestLossPct: number;
  };
  equityCurve: { time: number; equity: number; drawdown: number }[];
  signals: { index: number; action: string; reason: string; time: number; price: number }[];
  trades: {
    id: string;
    side: string;
    entryTime: number;
    exitTime: number;
    entryPrice: number;
    exitPrice: number;
    size: number;
    pnl: number;
    pnlPct: number;
    exitReason: string;
  }[];
}

const STRATEGIES = [
  { type: "MA_CROSS", label: "MA Crossover", desc: "Trend-following: fast MA crosses slow MA" },
  { type: "RSI_THRESHOLD", label: "RSI Mean Reversion", desc: "Contrarian: buy oversold, sell overbought" },
  { type: "BREAKOUT", label: "N-Period Breakout", desc: "Momentum: close > N-period high" },
  { type: "BUY_HOLD", label: "Buy & Hold (benchmark)", desc: "Baseline: buy first, hold to end" },
];

// ─── API helpers ────────────────────────────────────────────────────────
async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  const text = await res.text();
  let data: T | null = null;
  if (text) {
    try { data = JSON.parse(text) as T; } catch { /* leave null */ }
  }
  if (!res.ok) {
    const errMsg = data && typeof data === "object" && "error" in data
      ? String((data as { error?: unknown }).error) : `HTTP ${res.status}`;
    throw new Error(errMsg);
  }
  return (data as { data?: T }).data ?? (data as T);
}

export function BacktestView() {
  const qc = useQueryClient();
  const instruments = useQuery<Instrument[]>({
    queryKey: ["instruments-all"],
    queryFn: () => apiFetch<Instrument[]>("/api/v1/instruments"),
    staleTime: 60_000,
  });
  const backtests = useQuery<BacktestSummary[]>({
    queryKey: ["backtests"],
    queryFn: () => apiFetch<BacktestSummary[]>("/api/v1/backtest"),
    staleTime: 15_000,
  });

  const [form, setForm] = useState({
    instrumentId: "",
    strategyType: "MA_CROSS",
    fast: "20",
    slow: "50",
    period: "14",
    oversold: "30",
    overbought: "70",
    lookback: "20",
    capital: "10000",
    range: "1y",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const runMutation = useMutation({
    mutationFn: async () => {
      const params: Record<string, number> = {};
      if (form.strategyType === "MA_CROSS") {
        params.fast = parseInt(form.fast) || 20;
        params.slow = parseInt(form.slow) || 50;
      } else if (form.strategyType === "RSI_THRESHOLD") {
        params.period = parseInt(form.period) || 14;
        params.oversold = parseInt(form.oversold) || 30;
        params.overbought = parseInt(form.overbought) || 70;
      } else if (form.strategyType === "BREAKOUT") {
        params.lookback = parseInt(form.lookback) || 20;
      }
      return apiFetch<{ id: string }>("/api/v1/backtest/run", {
        method: "POST",
        body: JSON.stringify({
          instrumentId: form.instrumentId,
          strategyType: form.strategyType,
          params,
          initialCapital: parseFloat(form.capital) || 10000,
          range: form.range,
        }),
      });
    },
    onSuccess: (r) => {
      toast.success("Backtest complete");
      qc.invalidateQueries({ queryKey: ["backtests"] });
      setSelectedId(r.id);
    },
    onError: (e) => toast.error("Backtest failed: " + String(e)),
  });

  const importMutation = useMutation({
    mutationFn: async (instrumentId: string | undefined) => {
      const body = instrumentId ? { instrumentId } : { all: true };
      return apiFetch<{ imported: { ticker: string; count: number }[]; failed: { ticker: string; error: string }[] }>(
        "/api/v1/backtest/import",
        { method: "POST", body: JSON.stringify({ ...body, range: form.range }) }
      );
    },
    onSuccess: (r) => {
      toast.success(`Imported ${r.imported.length} instruments (${r.imported.reduce((s, i) => s + i.count, 0)} candles)${r.failed.length ? `, ${r.failed.length} failed` : ""}`);
      setImporting(false);
    },
    onError: (e) => { toast.error("Import failed: " + String(e)); setImporting(false); },
  });

  function runBacktest() {
    if (!form.instrumentId) return toast.error("Select an instrument");
    runMutation.mutate();
  }

  const selectedDetail = useQuery<BacktestDetail>({
    queryKey: ["backtest-detail", selectedId],
    queryFn: () => apiFetch<BacktestDetail>(`/api/v1/backtest/${selectedId}`),
    enabled: !!selectedId,
    staleTime: 60_000,
  });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 h-full overflow-hidden">
      {/* LEFT — config + run + past backtests */}
      <div className="xl:col-span-1 flex flex-col gap-3 min-h-0 overflow-y-auto pr-1">
        <Panel title="New Backtest" subtitle="Test a strategy on real historical data">
          <div className="flex flex-col gap-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Instrument</Label>
              <Select value={form.instrumentId} onValueChange={(v) => setForm({ ...form, instrumentId: v })}>
                <SelectTrigger className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] h-8">
                  <SelectValue placeholder="Select instrument" />
                </SelectTrigger>
                <SelectContent className="bg-[#151920] border-[#262b33] max-h-60">
                  {(instruments.data ?? []).map((i) => (
                    <SelectItem key={i.id} value={i.id} className="text-[11px]">
                      {i.symbol} · {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Strategy</Label>
              <Select value={form.strategyType} onValueChange={(v) => setForm({ ...form, strategyType: v })}>
                <SelectTrigger className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#151920] border-[#262b33]">
                  {STRATEGIES.map((s) => (
                    <SelectItem key={s.type} value={s.type} className="text-[11px]">
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[9px] text-[#4a525c] mt-1">
                {STRATEGIES.find((s) => s.type === form.strategyType)?.desc}
              </p>
            </div>

            {/* Strategy params */}
            {form.strategyType === "MA_CROSS" && (
              <div className="grid grid-cols-2 gap-2">
                <ParamInput label="Fast MA" value={form.fast} onChange={(v) => setForm({ ...form, fast: v })} />
                <ParamInput label="Slow MA" value={form.slow} onChange={(v) => setForm({ ...form, slow: v })} />
              </div>
            )}
            {form.strategyType === "RSI_THRESHOLD" && (
              <div className="grid grid-cols-3 gap-2">
                <ParamInput label="Period" value={form.period} onChange={(v) => setForm({ ...form, period: v })} />
                <ParamInput label="Oversold" value={form.oversold} onChange={(v) => setForm({ ...form, oversold: v })} />
                <ParamInput label="Overbought" value={form.overbought} onChange={(v) => setForm({ ...form, overbought: v })} />
              </div>
            )}
            {form.strategyType === "BREAKOUT" && (
              <ParamInput label="Lookback (periods)" value={form.lookback} onChange={(v) => setForm({ ...form, lookback: v })} />
            )}

            <div className="grid grid-cols-2 gap-2">
              <ParamInput label="Initial Capital ($)" value={form.capital} onChange={(v) => setForm({ ...form, capital: v })} />
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Date Range</Label>
                <Select value={form.range} onValueChange={(v) => setForm({ ...form, range: v })}>
                  <SelectTrigger className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#151920] border-[#262b33]">
                    <SelectItem value="1y" className="text-[11px]">1 Year</SelectItem>
                    <SelectItem value="3m" className="text-[11px]">3 Months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={runBacktest}
                disabled={runMutation.isPending}
                className="flex-1 h-8 text-[10px] uppercase tracking-wider bg-[#3b5fe0] hover:bg-[#2f4ec2]"
              >
                <Play className="h-3.5 w-3.5 mr-1" />
                {runMutation.isPending ? "Running…" : "Run Backtest"}
              </Button>
              <Button
                onClick={() => { setImporting(true); importMutation.mutate(form.instrumentId || undefined); }}
                disabled={importMutation.isPending}
                variant="outline"
                className="h-8 text-[10px] uppercase tracking-wider border-[#262b33]"
                title="Fetch & persist historical candles for backtesting"
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                {importMutation.isPending ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>
        </Panel>

        <Panel
          title="Past Backtests"
          subtitle={`${backtests.data?.length ?? 0} runs`}
          bodyClassName="p-0 overflow-y-auto max-h-[320px]"
        >
          {backtests.isLoading ? (
            <LoadingState rows={4} />
          ) : (backtests.data ?? []).length === 0 ? (
            <EmptyState
              title="No backtests yet"
              hint="Run your first backtest above. Results use real persisted historical data."
              icon={<FlaskConical className="h-5 w-5" />}
            />
          ) : (
            <ul className="divide-y divide-[#11151c]">
              {(backtests.data ?? []).map((b) => (
                <li
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  className={cn(
                    "px-2.5 py-2 cursor-pointer hover:bg-[#1b2029]",
                    selectedId === b.id && "bg-[#1b2029]"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[11px] font-medium text-[#e7e9ec]">{b.instrument.symbol}</span>
                      <span className="text-[9px] uppercase text-[#4a525c]">{b.strategyType}</span>
                    </div>
                    <span
                      className="text-[11px] tabular shrink-0"
                      style={{ color: b.totalReturnPct >= 0 ? "#2e9e6d" : "#c7484b" }}
                    >
                      {fmtPct(b.totalReturnPct)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[9px] text-[#4a525c]">
                      {b.tradeCount} trades · {b.candleCount} candles
                    </span>
                    <span className="text-[9px] text-[#4a525c]">
                      {new Date(b.createdAt).toLocaleDateString("en-GB")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* RIGHT — results detail */}
      <div className="xl:col-span-2 min-h-0 overflow-y-auto pr-1">
        {selectedId && selectedDetail.data ? (
          <BacktestResultView detail={selectedDetail.data} />
        ) : selectedId && selectedDetail.isLoading ? (
          <Panel title="Loading results…"><LoadingState rows={6} /></Panel>
        ) : (
          <Panel title="Backtest Results" bodyClassName="flex items-center justify-center min-h-[300px]">
            <EmptyState
              title="No backtest selected"
              hint="Configure a strategy on the left and click Run Backtest, or select a past run from the list."
              icon={<FlaskConical className="h-6 w-6" />}
            />
          </Panel>
        )}
      </div>
    </div>
  );
}

function ParamInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">{label}</Label>
      <Input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8"
      />
    </div>
  );
}

function BacktestResultView({ detail }: { detail: BacktestDetail }) {
  const m = detail.metrics;
  const winning = m.totalReturnPct >= 0;
  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="font-heading font-semibold text-base text-[#e7e9ec]">
            {detail.instrument.symbol}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-[#4a525c]">
            {detail.strategyType} · {detail.timeframe} · {detail.candleCount} candles
          </span>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-wider text-[#8891a0]">Total Return</div>
          <span className="text-lg font-semibold tabular" style={{ color: winning ? "#2e9e6d" : "#c7484b" }}>
            {fmtPct(m.totalReturnPct)}
          </span>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <PanelStat label="Final Equity" value={fmtCompact(m.finalEquity)} sub={`from ${fmtCompact(m.initialCapital)}`} valueColor={winning ? "#2e9e6d" : "#c7484b"} />
        <PanelStat label="Max Drawdown" value={fmtPct(m.maxDrawdownPct)} valueColor="#c7484b" />
        <PanelStat label="Win Rate" value={fmtPct(m.winRate, 1)} sub={`${m.tradeCount} trades`} />
        <PanelStat
          label="Sharpe Ratio"
          value={m.sharpeRatio != null ? m.sharpeRatio.toFixed(2) : "—"}
          valueColor={m.sharpeRatio != null && m.sharpeRatio > 1 ? "#2e9e6d" : m.sharpeRatio != null && m.sharpeRatio < 0 ? "#c7484b" : undefined}
        />
        <PanelStat label="Profit Factor" value={m.profitFactor != null ? m.profitFactor.toFixed(2) : "—"} valueColor={m.profitFactor != null && m.profitFactor > 1 ? "#2e9e6d" : "#c7484b"} />
        <PanelStat label="Avg Win" value={fmtPct(m.avgWinPct)} valueColor="#2e9e6d" />
        <PanelStat label="Avg Loss" value={fmtPct(m.avgLossPct)} valueColor="#c7484b" />
        <PanelStat label="Largest Win" value={fmtPct(m.largestWinPct)} valueColor="#2e9e6d" />
      </div>

      {/* Equity curve */}
      <Panel title="Equity Curve" subtitle="Mark-to-market equity over backtest period">
        <EquityCurveChart data={detail.equityCurve} initialCapital={m.initialCapital} />
      </Panel>

      {/* Trade log */}
      <Panel
        title="Trade Log"
        subtitle={`${detail.trades.length} trades`}
        bodyClassName="p-0 overflow-y-auto max-h-[280px]"
      >
        {detail.trades.length === 0 ? (
          <EmptyState title="No trades executed" hint="This strategy generated no entry/exit signals in the period." icon={<TrendingDown className="h-5 w-5" />} />
        ) : (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[#11151c]">
              <tr className="text-left text-[9px] uppercase tracking-wider text-[#8891a0] border-b border-[#262b33]">
                <th className="px-2 py-1.5 font-medium">Entry</th>
                <th className="px-2 py-1.5 font-medium">Exit</th>
                <th className="px-2 py-1.5 font-medium text-right">Entry Price</th>
                <th className="px-2 py-1.5 font-medium text-right">Exit Price</th>
                <th className="px-2 py-1.5 font-medium text-right">Size</th>
                <th className="px-2 py-1.5 font-medium text-right">PnL</th>
                <th className="px-2 py-1.5 font-medium text-right">%</th>
                <th className="px-2 py-1.5 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {detail.trades.map((t) => (
                <tr key={t.id} className="border-b border-[#11151c] hover:bg-[#1b2029]">
                  <td className="px-2 py-1.5 tabular text-[9px] text-[#4a525c]">{new Date(t.entryTime).toLocaleDateString("en-GB")}</td>
                  <td className="px-2 py-1.5 tabular text-[9px] text-[#4a525c]">{new Date(t.exitTime).toLocaleDateString("en-GB")}</td>
                  <td className="px-2 py-1.5 text-right tabular text-[#8891a0]">{fmtPrice(t.entryPrice)}</td>
                  <td className="px-2 py-1.5 text-right tabular text-[#8891a0]">{fmtPrice(t.exitPrice)}</td>
                  <td className="px-2 py-1.5 text-right tabular text-[#8891a0]">{t.size.toFixed(4)}</td>
                  <td className="px-2 py-1.5 text-right tabular" style={{ color: t.pnl >= 0 ? "#2e9e6d" : "#c7484b" }}>
                    {fmtCompact(t.pnl)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular" style={{ color: t.pnlPct >= 0 ? "#2e9e6d" : "#c7484b" }}>
                    {fmtPct(t.pnlPct)}
                  </td>
                  <td className="px-2 py-1.5 text-[9px] text-[#4a525c] truncate max-w-[120px]" title={t.exitReason}>{t.exitReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

/// Custom SVG equity curve + drawdown chart.
function EquityCurveChart({
  data,
  initialCapital,
}: {
  data: { time: number; equity: number; drawdown: number }[];
  initialCapital: number;
}) {
  if (data.length < 2) {
    return <div className="flex items-center justify-center h-32 text-xs text-[#4a525c]">No equity data</div>;
  }
  const W = 1000;
  const H = 200;
  const pad = { top: 10, right: 60, bottom: 10, left: 4 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const equities = data.map((d) => d.equity);
  let min = Math.min(...equities, initialCapital);
  let max = Math.max(...equities, initialCapital);
  const range = max - min || 1;
  min -= range * 0.05;
  max += range * 0.05;
  const r = max - min || 1;

  const xOf = (i: number) => pad.left + (i / (data.length - 1)) * plotW;
  const yOf = (v: number) => pad.top + (1 - (v - min) / r) * plotH;

  // equity line
  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(d.equity).toFixed(1)}`).join(" ");
  // area under equity
  const areaPath = `${linePath} L${xOf(data.length - 1).toFixed(1)},${(pad.top + plotH).toFixed(1)} L${xOf(0).toFixed(1)},${(pad.top + plotH).toFixed(1)} Z`;

  // initial capital reference line
  const capY = yOf(initialCapital);

  // gridlines
  const grid: { y: number; label: string }[] = [];
  for (let g = 0; g <= 4; g++) {
    const v = min + (r * g) / 4;
    grid.push({ y: yOf(v), label: fmtCompact(v) });
  }

  const lastEquity = data[data.length - 1].equity;
  const lastY = yOf(lastEquity);
  const lastColor = lastEquity >= initialCapital ? "#2e9e6d" : "#c7484b";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}>
      {grid.map((g, i) => (
        <g key={i}>
          <line x1={pad.left} x2={W - pad.right} y1={g.y} y2={g.y} stroke="#1b2029" strokeWidth={1} />
          <text x={W - pad.right + 4} y={g.y + 3} fontSize={10} fill="#4a525c" className="tabular">{g.label}</text>
        </g>
      ))}
      {/* initial capital line */}
      <line x1={pad.left} x2={W - pad.right} y1={capY} y2={capY} stroke="#8891a0" strokeWidth={1} strokeDasharray="4,4" opacity={0.5} />
      <text x={pad.left + 4} y={capY - 3} fontSize={9} fill="#8891a0" className="tabular">capital {fmtCompact(initialCapital)}</text>
      {/* area */}
      <path d={areaPath} fill={lastColor} opacity={0.08} />
      {/* equity line */}
      <path d={linePath} fill="none" stroke={lastColor} strokeWidth={1.8} />
      {/* last point tag */}
      <line x1={pad.left} x2={W - pad.right} y1={lastY} y2={lastY} stroke={lastColor} strokeWidth={1} strokeDasharray="3,3" opacity={0.7} />
      <rect x={W - pad.right} y={lastY - 8} width={pad.right} height={16} fill={lastColor} />
      <text x={W - pad.right + 3} y={lastY + 3} fontSize={10} fill="#0b0e13" fontWeight={600} className="tabular">{fmtCompact(lastEquity)}</text>
    </svg>
  );
}
