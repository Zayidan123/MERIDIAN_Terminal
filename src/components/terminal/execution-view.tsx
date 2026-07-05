"use client";

import { useState } from "react";
import { Panel, PanelStat, EmptyState, LoadingState } from "@/components/panel";
import { AssetBadge } from "@/components/asset-badge";
import {
  useBotStatus,
  useBotOrders,
  useBotAudit,
  usePlaceOrder,
  useCancelOrder,
  useUpdateBotConfig,
  useInstruments,
} from "@/lib/api-client";
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
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { fmtPrice, fmtCompact, fmtDateTime, fmtTimeAgo } from "@/lib/format";
import {
  Zap,
  Power,
  ShieldAlert,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Ban,
  ScrollText,
  Bot,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function ExecutionView() {
  const status = useBotStatus();
  const orders = useBotOrders(100);
  const audit = useBotAudit(100);
  const instruments = useInstruments();
  const placeOrder = usePlaceOrder();
  const cancelOrder = useCancelOrder();
  const updateConfig = useUpdateBotConfig();

  const s = status.data;
  // crypto-only instruments for execution (PRD: forex/gold live deferred)
  const cryptoInstruments = (instruments.data ?? []).filter((i) => i.assetClass === "CRYPTO");

  const [orderForm, setOrderForm] = useState({
    instrumentId: "",
    side: "BUY" as "BUY" | "SELL",
    type: "MARKET" as "MARKET" | "LIMIT",
    size: "",
    price: "",
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  function submitOrder(confirm = false) {
    const size = parseFloat(orderForm.size);
    if (!orderForm.instrumentId) return toast.error("Select an instrument");
    if (!Number.isFinite(size) || size <= 0) return toast.error("Size must be > 0");
    const input: {
      instrumentId: string;
      side: "BUY" | "SELL";
      type: "MARKET" | "LIMIT";
      size: number;
      price?: number;
      confirm?: boolean;
      mode?: "PAPER" | "LIVE";
    } = {
      instrumentId: orderForm.instrumentId,
      side: orderForm.side,
      type: orderForm.type,
      size,
      confirm,
      mode: s?.mode ?? "PAPER",
    };
    if (orderForm.type === "LIMIT") {
      const p = parseFloat(orderForm.price);
      if (!Number.isFinite(p) || p <= 0) return toast.error("Limit price must be > 0");
      input.price = p;
    }
    placeOrder.mutate(input, {
      onSuccess: (r) => {
        if (r.needsConfirm) {
          setConfirmOpen(true);
          return;
        }
        if (r.error && !r.ok) {
          toast.error(r.error);
          return;
        }
        if (r.ok && r.order) {
          toast.success(
            `${r.order.side} ${r.order.size} ${r.order.instrumentSymbol ?? ""} ${r.order.status} @ ${r.order.avgFillPrice ?? r.order.price ?? "—"} [${r.order.mode}]`
          );
          setOrderForm({ ...orderForm, size: "", price: "" });
        }
      },
      onError: (e) => toast.error("Order failed: " + String(e)),
    });
  }

  function toggleKillSwitch() {
    if (!s) return;
    const next = !s.killSwitch;
    updateConfig.mutate(
      { killSwitch: next },
      {
        onSuccess: () => toast.success(next ? "Kill-switch ACTIVATED — execution halted" : "Kill-switch released — execution resumed"),
        onError: (e) => toast.error("Failed: " + String(e)),
      }
    );
  }

  function switchToLive() {
    setLiveOpen(false);
    updateConfig.mutate(
      { mode: "LIVE" },
      {
        onSuccess: () => toast.success("Bot switched to LIVE mode — real orders will execute"),
        onError: (e) => toast.error("Cannot switch to LIVE: " + String(e)),
      }
    );
  }

  function switchToPaper() {
    updateConfig.mutate(
      { mode: "PAPER" },
      {
        onSuccess: () => toast.success("Bot switched to PAPER mode"),
        onError: (e) => toast.error("Failed: " + String(e)),
      }
    );
  }

  const dailyPct = s && s.maxDailyUsd > 0 ? Math.min(100, (s.dailyNotionalUsd / s.maxDailyUsd) * 100) : 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 h-full overflow-y-auto pr-1">
      {/* LEFT — status + order form + config */}
      <div className="xl:col-span-2 flex flex-col gap-3 min-h-0">
        {/* Security notice banner */}
        <div className="flex items-start gap-2 px-3 py-2 border border-[#d4a02a]/40 bg-[#d4a02a]/8 rounded-md">
          <AlertTriangle className="h-4 w-4 text-[#d4a02a] shrink-0 mt-0.5" />
          <div className="text-[10px] text-[#e7e9ec] leading-relaxed">
            <strong className="text-[#d4a02a]">Fase 4 — Execution.</strong>{" "}
            Paper mode by default. Live mode requires a <strong>trade-only API key</strong> (withdrawal disabled, IP-whitelisted).
            Forex/gold live execution (MT5) is <strong>deferred</strong> — Python-only API. Not financial advice (PRD §19).
          </div>
        </div>

        {/* Status bar */}
        <Panel
          title="Bot Status"
          subtitle="Mode · kill-switch · daily notional usage"
          bodyClassName="flex flex-col gap-3"
          actions={
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] uppercase tracking-wider border-[#262b33]"
                onClick={() => setConfigOpen(true)}
              >
                <ShieldAlert className="h-3 w-3 mr-1" /> Limits
              </Button>
            </div>
          }
        >
          {status.isLoading ? (
            <LoadingState rows={2} />
          ) : s ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <PanelStat
                  label="Mode"
                  value={
                    <span className="flex items-center gap-1.5">
                      <span className={cn("h-2 w-2 rounded-full", s.mode === "LIVE" ? "bg-[#c7484b] animate-live-pulse" : "bg-[#d4a02a]")} />
                      {s.mode}
                    </span>
                  }
                  valueColor={s.mode === "LIVE" ? "#c7484b" : "#d4a02a"}
                />
                <PanelStat
                  label="Kill-Switch"
                  value={
                    <span className="flex items-center gap-1.5">
                      {s.killSwitch ? <Lock className="h-3 w-3 text-[#c7484b]" /> : <Unlock className="h-3 w-3 text-[#2e9e6d]" />}
                      {s.killSwitch ? "HALTED" : "ARMED"}
                    </span>
                  }
                  valueColor={s.killSwitch ? "#c7484b" : "#2e9e6d"}
                />
                <PanelStat label="Orders 24h" value={String(s.orderCount24h)} />
                <PanelStat
                  label="Exchange Keys"
                  value={s.exchangeKeysConfigured ? "configured" : "missing"}
                  valueColor={s.exchangeKeysConfigured ? "#2e9e6d" : "#c7484b"}
                />
              </div>

              {/* Daily notional usage bar */}
              <div>
                <div className="flex justify-between text-[10px] uppercase tracking-wider text-[#8891a0] mb-1">
                  <span>Daily Notional</span>
                  <span className="tabular">
                    {fmtCompact(s.dailyNotionalUsd)} / {fmtCompact(s.maxDailyUsd)} USD
                  </span>
                </div>
                <div className="h-2 rounded bg-[#1b2029] overflow-hidden">
                  <div
                    className={cn("h-full rounded transition-all", dailyPct > 80 ? "bg-[#c7484b]" : dailyPct > 50 ? "bg-[#d4a02a]" : "bg-[#2e9e6d]")}
                    style={{ width: `${dailyPct}%` }}
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  className={cn(
                    "h-8 text-[10px] uppercase tracking-wider",
                    s.killSwitch
                      ? "bg-[#2e9e6d] hover:bg-[#258559]"
                      : "bg-[#c7484b] hover:bg-[#a93a3d]"
                  )}
                  onClick={toggleKillSwitch}
                  disabled={updateConfig.isPending}
                >
                  <Power className="h-3.5 w-3.5 mr-1" />
                  {s.killSwitch ? "Resume Execution" : "Activate Kill-Switch"}
                </Button>
                {s.mode === "PAPER" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-[10px] uppercase tracking-wider border-[#c7484b] text-[#c7484b] hover:bg-[#c7484b] hover:text-white"
                    onClick={() => setLiveOpen(true)}
                    disabled={s.killSwitch}
                  >
                    <Zap className="h-3.5 w-3.5 mr-1" /> Switch to LIVE
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-[10px] uppercase tracking-wider border-[#d4a02a] text-[#d4a02a] hover:bg-[#d4a02a] hover:text-[#0b0e13]"
                    onClick={switchToPaper}
                    disabled={updateConfig.isPending}
                  >
                    Switch to PAPER
                  </Button>
                )}
                {s.mt5LiveDeferred && (
                  <span className="text-[9px] uppercase tracking-wider text-[#4a525c] px-2 py-1 border border-[#262b33] rounded">
                    MT5 (forex/gold) deferred
                  </span>
                )}
              </div>
            </>
          ) : (
            <EmptyState title="Bot unreachable" hint="Is the execution-bot mini-service running on port 3002?" icon={<Bot className="h-5 w-5" />} />
          )}
        </Panel>

        {/* Order form */}
        <Panel
          title="Place Order"
          subtitle={s?.mode === "LIVE" ? "LIVE — real orders" : "PAPER — simulated fills at live prices"}
          actions={s?.killSwitch ? <span className="text-[9px] uppercase text-[#c7484b]">Kill-switch active</span> : undefined}
        >
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div className="col-span-2 md:col-span-1">
              <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Instrument (crypto) (crypto)</Label>
              <Select value={orderForm.instrumentId} onValueChange={(v) => setOrderForm({ ...orderForm, instrumentId: v })}>
                <SelectTrigger className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] h-8">
                  <SelectValue placeholder="Select crypto" />
                </SelectTrigger>
                <SelectContent className="bg-[#151920] border-[#262b33] max-h-60">
                  {cryptoInstruments.map((i) => (
                    <SelectItem key={i.id} value={i.id} className="text-[11px]">
                      {i.symbol} · {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Side</Label>
              <div className="flex mt-1 h-8 rounded border border-[#262b33] overflow-hidden">
                <button
                  onClick={() => setOrderForm({ ...orderForm, side: "BUY" })}
                  className={cn("flex-1 text-[10px] uppercase tracking-wider", orderForm.side === "BUY" ? "bg-[#2e9e6d]/20 text-[#2e9e6d]" : "text-[#8891a0]")}
                >
                  Buy
                </button>
                <button
                  onClick={() => setOrderForm({ ...orderForm, side: "SELL" })}
                  className={cn("flex-1 text-[10px] uppercase tracking-wider", orderForm.side === "SELL" ? "bg-[#c7484b]/20 text-[#c7484b]" : "text-[#8891a0]")}
                >
                  Sell
                </button>
              </div>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Type</Label>
              <div className="flex mt-1 h-8 rounded border border-[#262b33] overflow-hidden">
                <button
                  onClick={() => setOrderForm({ ...orderForm, type: "MARKET" })}
                  className={cn("flex-1 text-[10px] uppercase tracking-wider", orderForm.type === "MARKET" ? "bg-[#3b5fe0]/20 text-[#3b5fe0]" : "text-[#8891a0]")}
                >
                  Market
                </button>
                <button
                  onClick={() => setOrderForm({ ...orderForm, type: "LIMIT" })}
                  className={cn("flex-1 text-[10px] uppercase tracking-wider", orderForm.type === "LIMIT" ? "bg-[#3b5fe0]/20 text-[#3b5fe0]" : "text-[#8891a0]")}
                >
                  Limit
                </button>
              </div>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Size</Label>
              <Input
                type="number"
                step="any"
                value={orderForm.size}
                onChange={(e) => setOrderForm({ ...orderForm, size: e.target.value })}
                placeholder="0.00"
                className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8"
              />
            </div>
            {orderForm.type === "LIMIT" && (
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Limit Price</Label>
                <Input
                  type="number"
                  step="any"
                  value={orderForm.price}
                  onChange={(e) => setOrderForm({ ...orderForm, price: e.target.value })}
                  placeholder="0.00"
                  className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8"
                />
              </div>
            )}
            <div className="flex items-end">
              <Button
                onClick={() => submitOrder(false)}
                disabled={placeOrder.isPending || !!s?.killSwitch}
                className="w-full h-8 text-[10px] uppercase tracking-wider bg-[#3b5fe0] hover:bg-[#2f4ec2]"
              >
                {placeOrder.isPending ? "Submitting…" : `Submit ${orderForm.side} ${orderForm.type}`}
              </Button>
            </div>
          </div>
          {s && (
            <p className="text-[9px] text-[#4a525c] mt-2">
              Hard caps: max {fmtCompact(s.maxOrderUsd)} USD/order · {fmtCompact(s.maxDailyUsd)} USD/day.
              Orders &gt;80% of per-order cap require manual confirm.
            </p>
          )}
        </Panel>

        {/* Orders table */}
        <Panel
          title="Order History"
          subtitle={`${orders.data?.length ?? 0} recent orders`}
          bodyClassName="p-0 overflow-y-auto max-h-[280px]"
        >
          {orders.isLoading ? (
            <LoadingState rows={4} />
          ) : (orders.data ?? []).length === 0 ? (
            <EmptyState title="No orders yet" hint="Place a paper order above to see it here." icon={<Zap className="h-5 w-5" />} />
          ) : (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-[#11151c]">
                <tr className="text-left text-[9px] uppercase tracking-wider text-[#8891a0] border-b border-[#262b33]">
                  <th className="px-2 py-1.5 font-medium">Time</th>
                  <th className="px-2 py-1.5 font-medium">Symbol</th>
                  <th className="px-2 py-1.5 font-medium">Side</th>
                  <th className="px-2 py-1.5 font-medium text-right">Size</th>
                  <th className="px-2 py-1.5 font-medium text-right">Fill</th>
                  <th className="px-2 py-1.5 font-medium text-right">USD</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 font-medium">Mode</th>
                  <th className="px-2 py-1.5 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {(orders.data ?? []).map((o) => (
                  <tr key={o.id} className="border-b border-[#11151c] hover:bg-[#1b2029]">
                    <td className="px-2 py-1.5 tabular text-[9px] text-[#4a525c]">{fmtTimeAgo(new Date(o.createdAt).getTime())}</td>
                    <td className="px-2 py-1.5 text-[#e7e9ec]">{o.instrumentSymbol ?? o.instrumentTicker ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <span className={cn("text-[9px] uppercase px-1 py-0.5 rounded", o.side === "BUY" ? "bg-[#2e9e6d]/15 text-[#2e9e6d]" : "bg-[#c7484b]/15 text-[#c7484b]")}>
                        {o.side}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular text-[#e7e9ec]">{o.size}</td>
                    <td className="px-2 py-1.5 text-right tabular text-[#8891a0]">
                      {o.avgFillPrice != null ? fmtPrice(o.avgFillPrice) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular text-[#8891a0]">{fmtCompact(o.valueUsd)}</td>
                    <td className="px-2 py-1.5">
                      <StatusPill status={o.status} />
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={cn("text-[9px] uppercase", o.mode === "LIVE" ? "text-[#c7484b]" : "text-[#d4a02a]")}>{o.mode}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      {o.status === "PENDING" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-[#c7484b]"
                          onClick={() =>
                            cancelOrder.mutate(o.id, {
                              onSuccess: () => toast.success("Order cancelled"),
                              onError: (e) => toast.error("Cancel failed: " + String(e)),
                            })
                          }
                        >
                          <Ban className="h-3 w-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {/* RIGHT — audit log */}
      <div className="flex flex-col gap-3 min-h-0">
        <Panel
          title="Audit Log"
          subtitle="Tamper-evident hash chain"
          bodyClassName="p-0 overflow-y-auto max-h-[calc(100vh-200px)]"
          actions={
            audit.data?.chainIntact ? (
              <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-[#2e9e6d]">
                <Lock className="h-3 w-3" /> Chain intact
              </span>
            ) : audit.data ? (
              <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-[#c7484b]">
                <AlertTriangle className="h-3 w-3" /> Chain broken
              </span>
            ) : null
          }
        >
          {audit.isLoading ? (
            <LoadingState rows={6} />
          ) : (audit.data?.audit ?? []).length === 0 ? (
            <EmptyState title="No audit entries" hint="Bot actions (orders, config changes, kill-switch) are logged here." icon={<ScrollText className="h-5 w-5" />} />
          ) : (
            <ul className="divide-y divide-[#11151c]">
              {(audit.data?.audit ?? []).map((a) => (
                <li key={a.id} className="px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <SeverityDot severity={a.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wider text-[#e7e9ec] font-medium">{a.action}</span>
                        <span
                          className={cn(
                            "text-[9px] uppercase px-1 py-0.5 rounded",
                            a.severity === "CRITICAL" ? "bg-[#c7484b]/15 text-[#c7484b]" : a.severity === "WARN" ? "bg-[#d4a02a]/15 text-[#d4a02a]" : "bg-[#1b2029] text-[#8891a0]"
                          )}
                        >
                          {a.severity}
                        </span>
                      </div>
                      <p className="text-[10px] text-[#8891a0] mt-0.5 break-words">{a.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] tabular text-[#4a525c]">{fmtTimeAgo(new Date(a.createdAt).getTime())}</span>
                        <span className="text-[8px] tabular text-[#2a3038] truncate" title={a.hash}>
                          {a.hash.slice(0, 12)}…
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Large-order confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-[#151920] border-[#262b33] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#e7e9ec] text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[#d4a02a]" /> Confirm Large Order
            </DialogTitle>
          </DialogHeader>
          <p className="text-[11px] text-[#8891a0] py-2">
            This order exceeds 80% of the per-order cap. Confirm to proceed with execution.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button size="sm" variant="ghost" className="text-[10px] uppercase">Cancel</Button>
            </DialogClose>
            <Button
              size="sm"
              className="text-[10px] uppercase bg-[#d4a02a] hover:bg-[#b88a23] text-[#0b0e13]"
              onClick={() => {
                setConfirmOpen(false);
                submitOrder(true);
              }}
            >
              Confirm &amp; Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LIVE mode confirmation dialog with security checklist */}
      <Dialog open={liveOpen} onOpenChange={setLiveOpen}>
        <DialogContent className="bg-[#151920] border-[#c7484b]/50 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#c7484b] text-sm flex items-center gap-2">
              <Zap className="h-4 w-4" /> Switch to LIVE Mode
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2 text-[11px] text-[#8891a0]">
            <p className="text-[#e7e9ec] font-medium">Security checklist (PRD §16.7) — you must confirm each:</p>
            <ChecklistItem text="API key is trade-only, withdrawal permission DISABLED on the exchange" />
            <ChecklistItem text="API key is IP-whitelisted to this server" />
            <ChecklistItem text="Paper trading has been validated with live data" />
            <ChecklistItem text="Kill-switch + hard caps are configured and understood" />
            <ChecklistItem text="I accept full responsibility — this moves real capital" />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button size="sm" variant="ghost" className="text-[10px] uppercase">Cancel</Button>
            </DialogClose>
            <Button size="sm" className="text-[10px] uppercase bg-[#c7484b] hover:bg-[#a93a3d]" onClick={switchToLive}>
              Switch to LIVE
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Config dialog */}
      <ConfigDialog open={configOpen} onOpenChange={setConfigOpen} status={s} />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string }> = {
    FILLED: { color: "#2e9e6d", bg: "rgba(46,158,109,0.15)" },
    PARTIAL: { color: "#d4a02a", bg: "rgba(212,160,42,0.15)" },
    PENDING: { color: "#8891a0", bg: "#1b2029" },
    CANCELLED: { color: "#8891a0", bg: "#1b2029" },
    REJECTED: { color: "#c7484b", bg: "rgba(199,72,75,0.15)" },
  };
  const m = map[status] ?? map.PENDING;
  return (
    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: m.color, backgroundColor: m.bg }}>
      {status}
    </span>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color = severity === "CRITICAL" ? "#c7484b" : severity === "WARN" ? "#d4a02a" : "#3b5fe0";
  return <span className="mt-1 h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />;
}

function ChecklistItem({ text }: { text: string }) {
  const [checked, setChecked] = useState(false);
  return (
    <button
      onClick={() => setChecked(!checked)}
      className="flex items-start gap-2 w-full text-left hover:bg-[#1b2029] rounded p-1"
    >
      <span
        className={cn(
          "mt-0.5 h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
          checked ? "bg-[#2e9e6d] border-[#2e9e6d]" : "border-[#262b33]"
        )}
      >
        {checked && <CheckCircle2 className="h-2.5 w-2.5 text-[#0b0e13]" />}
      </span>
      <span className={cn("leading-snug", checked ? "text-[#4a525c] line-through" : "text-[#8891a0]")}>{text}</span>
    </button>
  );
}

function ConfigDialog({
  open,
  onOpenChange,
  status,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  status: { maxOrderUsd: number; maxDailyUsd: number; autoKillDd: number } | undefined;
}) {
  const updateConfig = useUpdateBotConfig();
  const [maxOrder, setMaxOrder] = useState("");
  const [maxDaily, setMaxDaily] = useState("");
  const [autoKillDd, setAutoKillDd] = useState("");

  // sync from status when opening
  const [synced, setSynced] = useState(false);
  if (open && !synced && status) {
    setMaxOrder(String(status.maxOrderUsd));
    setMaxDaily(String(status.maxDailyUsd));
    setAutoKillDd(String(status.autoKillDd));
    setSynced(true);
  }
  if (!open && synced) setSynced(false);

  function save() {
    const mo = parseFloat(maxOrder);
    const md = parseFloat(maxDaily);
    const dd = parseFloat(autoKillDd);
    if (!Number.isFinite(mo) || mo <= 0) return toast.error("Max/order must be > 0");
    if (!Number.isFinite(md) || md <= 0) return toast.error("Max/day must be > 0");
    if (!Number.isFinite(dd) || dd < 0) return toast.error("Auto kill DD must be ≥ 0");
    updateConfig.mutate(
      { maxOrderUsd: mo, maxDailyUsd: md, autoKillDd: dd },
      {
        onSuccess: () => {
          toast.success("Limits updated");
          onOpenChange(false);
        },
        onError: (e) => toast.error("Failed: " + String(e)),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#151920] border-[#262b33] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#e7e9ec] text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#8891a0]" /> Execution Limits
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Max per order (USD notional)</Label>
            <Input type="number" step="any" value={maxOrder} onChange={(e) => setMaxOrder(e.target.value)} className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Max per day (USD notional)</Label>
            <Input type="number" step="any" value={maxDaily} onChange={(e) => setMaxDaily(e.target.value)} className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Auto kill-switch at drawdown (%)</Label>
            <Input type="number" step="any" value={autoKillDd} onChange={(e) => setAutoKillDd(e.target.value)} className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8" />
            <p className="text-[9px] text-[#4a525c] mt-1">0 disables the auto kill-switch. Typical: 10–20.</p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button size="sm" variant="ghost" className="text-[10px] uppercase">Cancel</Button>
          </DialogClose>
          <Button size="sm" className="text-[10px] uppercase bg-[#3b5fe0] hover:bg-[#2f4ec2]" onClick={save} disabled={updateConfig.isPending}>
            Save Limits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
