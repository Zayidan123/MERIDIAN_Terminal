"use client";

import { useState } from "react";
import { Panel, EmptyState, LoadingState } from "@/components/panel";
import { AssetBadge } from "@/components/asset-badge";
import {
  useAlerts,
  useSignals,
  useCreateAlert,
  useUpdateAlert,
  useDeleteAlert,
  useEvaluateAlerts,
  useScanSignals,
  useWatchlist,
} from "@/lib/api-client";
import { useTerminal } from "@/lib/store";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { fmtPrice, fmtTimeAgo } from "@/lib/format";
import { Siren, Plus, Play, Radar, Trash2, Pause, PlayCircle, Bell } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const METRICS = [
  { value: "price", label: "Price" },
  { value: "pct_change_24h", label: "24h % Change" },
  { value: "volume_spike", label: "Volume Spike (z-score)" },
  { value: "rsi", label: "RSI (14)" },
  { value: "price_above_ma", label: "Price vs MA20" },
];
const OPERATORS = [
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "cross_up", label: "crosses above" },
  { value: "cross_down", label: "crosses below" },
];

export function SignalsView() {
  const alerts = useAlerts();
  const signals = useSignals(100);
  const watchlist = useWatchlist();
  const createAlert = useCreateAlert();
  const updateAlert = useUpdateAlert();
  const deleteAlert = useDeleteAlert();
  const evaluate = useEvaluateAlerts();
  const scan = useScanSignals();
  const { selectInstrument } = useTerminal();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    instrumentId: "",
    metric: "price",
    operator: "gt",
    threshold: "",
    note: "",
  });

  const instruments = (watchlist.data?.items ?? []).map((i) => i.instrument);

  function handleCreate() {
    const t = parseFloat(form.threshold);
    if (!form.instrumentId) return toast.error("Select an instrument");
    if (Number.isNaN(t)) return toast.error("Threshold must be a number");
    createAlert.mutate(
      { instrumentId: form.instrumentId, metric: form.metric, operator: form.operator, threshold: t, note: form.note || undefined },
      {
        onSuccess: () => {
          toast.success("Alert created");
          setCreateOpen(false);
          setForm({ instrumentId: "", metric: "price", operator: "gt", threshold: "", note: "" });
        },
        onError: (e) => toast.error("Failed: " + String(e)),
      }
    );
  }

  function runEvaluate() {
    evaluate.mutate(undefined, {
      onSuccess: (r: unknown) => {
        const d = (r as { data?: { evaluated?: number; triggered?: unknown[]; skipped?: unknown[] } }).data;
        toast.success(
          `Evaluated ${d?.evaluated ?? 0} alerts · ${d?.triggered?.length ?? 0} triggered`
        );
      },
      onError: (e) => toast.error("Evaluate failed: " + String(e)),
    });
  }

  function runScan() {
    scan.mutate(undefined, {
      onSuccess: (r: unknown) => {
        const d = (r as { data?: { scanned?: number; detected?: unknown[]; skipped?: unknown[] } }).data;
        toast.success(`Scanned ${d?.scanned ?? 0} instruments · ${d?.detected?.length ?? 0} signals`);
      },
      onError: (e) => toast.error("Scan failed: " + String(e)),
    });
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 h-full overflow-hidden">
      {/* LEFT — alerts */}
      <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
        <Panel
          title="Alert Rules"
          subtitle={`${(alerts.data ?? []).filter((a) => a.status !== "DELETED").length} configured`}
          bodyClassName="p-0 overflow-y-auto max-h-[calc(100vh-220px)]"
          actions={
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] uppercase tracking-wider border-[#262b33]"
                onClick={runEvaluate}
                disabled={evaluate.isPending}
              >
                <Play className="h-3 w-3 mr-1" />
                {evaluate.isPending ? "Running" : "Evaluate"}
              </Button>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-7 text-[10px] uppercase tracking-wider bg-[#3b5fe0] hover:bg-[#2f4ec2]">
                    <Plus className="h-3 w-3 mr-1" /> New
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-[#151920] border-[#262b33] max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-[#e7e9ec] text-sm">New Alert Rule</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-3 py-2">
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Instrument</Label>
                      <Select value={form.instrumentId} onValueChange={(v) => setForm({ ...form, instrumentId: v })}>
                        <SelectTrigger className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px]">
                          <SelectValue placeholder="Select instrument" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#151920] border-[#262b33] max-h-60">
                          {instruments.map((i) => (
                            <SelectItem key={i.id} value={i.id} className="text-[11px]">
                              {i.symbol} · {i.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Metric</Label>
                        <Select value={form.metric} onValueChange={(v) => setForm({ ...form, metric: v })}>
                          <SelectTrigger className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#151920] border-[#262b33]">
                            {METRICS.map((m) => (
                              <SelectItem key={m.value} value={m.value} className="text-[11px]">
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Operator</Label>
                        <Select value={form.operator} onValueChange={(v) => setForm({ ...form, operator: v })}>
                          <SelectTrigger className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#151920] border-[#262b33]">
                            {OPERATORS.map((o) => (
                              <SelectItem key={o.value} value={o.value} className="text-[11px]">
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Threshold</Label>
                      <Input
                        type="number"
                        step="any"
                        value={form.threshold}
                        onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                        placeholder="e.g. 65000"
                        className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Note (optional)</Label>
                      <Input
                        value={form.note}
                        onChange={(e) => setForm({ ...form, note: e.target.value })}
                        placeholder="memo"
                        className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px]"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button size="sm" variant="ghost" className="text-[10px] uppercase">Cancel</Button>
                    </DialogClose>
                    <Button
                      size="sm"
                      className="text-[10px] uppercase bg-[#3b5fe0] hover:bg-[#2f4ec2]"
                      onClick={handleCreate}
                      disabled={createAlert.isPending}
                    >
                      {createAlert.isPending ? "Creating…" : "Create Alert"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          }
        >
          {alerts.isLoading ? (
            <LoadingState rows={4} />
          ) : (alerts.data ?? []).filter((a) => a.status !== "DELETED").length === 0 ? (
            <EmptyState
              title="No alert rules"
              hint="Create price / volume / RSI / MA alerts. The engine evaluates against real market data."
              icon={<Bell className="h-6 w-6" />}
            />
          ) : (
            <ul className="divide-y divide-[#11151c]">
              {(alerts.data ?? [])
                .filter((a) => a.status !== "DELETED")
                .map((a) => (
                  <li key={a.id} className="px-2.5 py-2 hover:bg-[#1b2029]">
                    <div className="flex items-center gap-2">
                      <AssetBadge assetClass={a.instrument.assetClass} size="xs" />
                      <button
                        onClick={() => selectInstrument(a.instrumentId)}
                        className="text-[11px] font-medium text-[#e7e9ec] hover:underline"
                      >
                        {a.instrument.symbol}
                      </button>
                      <span className="text-[10px] text-[#8891a0]">
                        {a.metric} {OPERATORS.find((o) => o.value === a.operator)?.label}{" "}
                        <span className="tabular text-[#e7e9ec]">{a.threshold}</span>
                      </span>
                      <StatusBadge status={a.status} />
                      <div className="ml-auto flex items-center gap-1">
                        {a.status === "ACTIVE" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            title="Pause"
                            onClick={() => updateAlert.mutate({ id: a.id, status: "PAUSED" })}
                          >
                            <Pause className="h-3 w-3" />
                          </Button>
                        )}
                        {a.status === "PAUSED" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            title="Resume"
                            onClick={() => updateAlert.mutate({ id: a.id, status: "ACTIVE" })}
                          >
                            <PlayCircle className="h-3 w-3" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-[#c7484b] hover:text-[#e7e9ec]"
                          title="Delete"
                          onClick={() => deleteAlert.mutate(a.id, { onSuccess: () => toast.success("Alert deleted") })}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {(a.note || a.triggeredAt) && (
                      <div className="mt-1 flex items-center gap-2 text-[9px] text-[#4a525c]">
                        {a.note && <span className="truncate">“{a.note}”</span>}
                        {a.triggeredAt && <span>· triggered {fmtTimeAgo(a.triggeredAt)}</span>}
                        <span>· created {fmtTimeAgo(a.createdAt)}</span>
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* RIGHT — signal events */}
      <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
        <Panel
          title="Signal Feed"
          subtitle="Detected anomalies & triggered alerts"
          bodyClassName="p-0 overflow-y-auto max-h-[calc(100vh-220px)]"
          actions={
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] uppercase tracking-wider border-[#262b33]"
              onClick={runScan}
              disabled={scan.isPending}
            >
              <Radar className="h-3 w-3 mr-1" />
              {scan.isPending ? "Scanning" : "Scan Now"}
            </Button>
          }
        >
          {signals.isLoading ? (
            <LoadingState rows={6} />
          ) : (signals.data ?? []).length === 0 ? (
            <EmptyState
              title="No signals detected"
              hint="Run a scan to detect volume spikes, breakouts, RSI extremes & return anomalies from real historical data."
              icon={<Siren className="h-6 w-6" />}
            />
          ) : (
            <ul className="divide-y divide-[#11151c]">
              {(signals.data ?? []).map((s) => (
                <li
                  key={s.id}
                  onClick={() => selectInstrument(s.instrumentId)}
                  className="px-2.5 py-2 hover:bg-[#1b2029] cursor-pointer"
                >
                  <div className="flex items-start gap-2">
                    <SeverityDot severity={s.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <AssetBadge assetClass={s.instrument.assetClass} size="xs" />
                        <span className="text-[11px] font-medium text-[#e7e9ec]">{s.instrument.symbol}</span>
                        <span
                          className={cn(
                            "text-[9px] uppercase tracking-wider px-1 py-0.5 rounded",
                            s.signalType === "ANOMALY"
                              ? "bg-[#c7484b]/15 text-[#c7484b]"
                              : s.signalType === "VOLUME_SPIKE"
                                ? "bg-[#d4a02a]/15 text-[#d4a02a]"
                                : s.signalType === "BREAKOUT"
                                  ? "bg-[#3b5fe0]/15 text-[#3b5fe0]"
                                  : "bg-[#1b2029] text-[#8891a0]"
                          )}
                        >
                          {s.signalType}
                        </span>
                        <span className="text-[9px] uppercase text-[#4a525c]">{s.severity}</span>
                      </div>
                      <p className="text-[10px] text-[#8891a0] mt-0.5">{s.message}</p>
                      {s.priceAtEvent != null && (
                        <p className="text-[9px] tabular text-[#4a525c] mt-0.5">
                          @ {fmtPrice(s.priceAtEvent, s.instrument.currency)}
                        </p>
                      )}
                    </div>
                    <span className="text-[9px] text-[#4a525c] tabular shrink-0">{fmtTimeAgo(s.createdAt)}</span>
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: "bg-[#2e9e6d]/15 text-[#2e9e6d]",
    TRIGGERED: "bg-[#d4a02a]/15 text-[#d4a02a]",
    PAUSED: "bg-[#1b2029] text-[#8891a0]",
  };
  return (
    <span className={cn("text-[9px] uppercase tracking-wider px-1 py-0.5 rounded", map[status] ?? "bg-[#1b2029] text-[#8891a0]")}>
      {status}
    </span>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color = severity === "CRITICAL" ? "#c7484b" : severity === "WARN" ? "#d4a02a" : "#3b5fe0";
  return <span className="mt-1 h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />;
}
