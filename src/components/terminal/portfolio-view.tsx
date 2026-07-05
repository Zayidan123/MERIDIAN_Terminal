"use client";

import { useState } from "react";
import { Panel, EmptyState, LoadingState } from "@/components/panel";
import { AssetBadge, ChangeText } from "@/components/asset-badge";
import {
  usePortfolio,
  useCreatePosition,
  useUpdatePosition,
  useDeletePosition,
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
import { fmtPrice, fmtCompact, fmtPct, fmtDateTime } from "@/lib/format";
import { Plus, Briefcase, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function PortfolioView() {
  const portfolio = usePortfolio();
  const create = useCreatePosition();
  const update = useUpdatePosition();
  const del = useDeletePosition();
  const watchlist = useWatchlist();
  const { selectInstrument } = useTerminal();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    instrumentId: "",
    side: "LONG",
    entryPrice: "",
    size: "",
    note: "",
  });

  const instruments = (watchlist.data?.items ?? []).map((i) => i.instrument);
  const positions = portfolio.data ?? [];
  const totalCost = positions.reduce((a, p) => a + p.entryPrice * p.size, 0);
  const totalValue = positions.reduce((a, p) => a + (p.marketValue ?? 0), 0);
  const totalPnl = positions.reduce((a, p) => a + (p.unrealizedPnl ?? 0), 0);

  function reset() {
    setForm({ instrumentId: "", side: "LONG", entryPrice: "", size: "", note: "" });
    setEditId(null);
  }

  function openCreate() {
    reset();
    setOpen(true);
  }

  function openEdit(id: string) {
    const p = positions.find((x) => x.id === id);
    if (!p) return;
    setForm({
      instrumentId: p.instrumentId,
      side: p.side,
      entryPrice: String(p.entryPrice),
      size: String(p.size),
      note: p.note ?? "",
    });
    setEditId(id);
    setOpen(true);
  }

  function submit() {
    const ep = parseFloat(form.entryPrice);
    const sz = parseFloat(form.size);
    if (!form.instrumentId) return toast.error("Select an instrument");
    if (!Number.isFinite(ep) || ep <= 0) return toast.error("Entry price must be > 0");
    if (!Number.isFinite(sz) || sz <= 0) return toast.error("Size must be > 0");
    const payload = {
      instrumentId: form.instrumentId,
      side: form.side,
      entryPrice: ep,
      size: sz,
      note: form.note || undefined,
    };
    if (editId) {
      update.mutate(
        { id: editId, entryPrice: ep, size: sz, side: form.side, note: form.note || undefined },
        {
          onSuccess: () => {
            toast.success("Position updated");
            setOpen(false);
            reset();
          },
          onError: (e) => toast.error("Failed: " + String(e)),
        }
      );
    } else {
      create.mutate(payload, {
        onSuccess: () => {
          toast.success("Position added");
          setOpen(false);
          reset();
        },
        onError: (e) => toast.error("Failed: " + String(e)),
      });
    }
  }

  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        <SummaryTile label="Open Positions" value={String(positions.length)} color="#e7e9ec" />
        <SummaryTile label="Cost Basis" value={fmtCompact(totalCost)} color="#8891a0" />
        <SummaryTile label="Market Value" value={fmtCompact(totalValue)} color="#3b5fe0" />
        <SummaryTile
          label="Unrealized PnL"
          value={fmtCompact(totalPnl)}
          color={totalPnl >= 0 ? "#2e9e6d" : "#c7484b"}
        />
      </div>

      <Panel
        title="Positions"
        subtitle="Cross-asset · live mark-to-market"
        bodyClassName="p-0 overflow-y-auto max-h-[calc(100vh-260px)]"
        actions={
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-7 text-[10px] uppercase tracking-wider bg-[#3b5fe0] hover:bg-[#2f4ec2]" onClick={openCreate}>
                <Plus className="h-3 w-3 mr-1" /> Add Position
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#151920] border-[#262b33] max-w-md">
              <DialogHeader>
                <DialogTitle className="text-[#e7e9ec] text-sm">
                  {editId ? "Edit Position" : "New Position"}
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3 py-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Instrument</Label>
                  <Select
                    value={form.instrumentId}
                    onValueChange={(v) => setForm({ ...form, instrumentId: v })}
                    disabled={!!editId}
                  >
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
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Side</Label>
                  <div className="flex mt-1 h-8 rounded border border-[#262b33] overflow-hidden">
                    <button
                      onClick={() => setForm({ ...form, side: "LONG" })}
                      className={cn("flex-1 text-[10px] uppercase tracking-wider", form.side === "LONG" ? "bg-[#2e9e6d]/20 text-[#2e9e6d]" : "text-[#8891a0]")}
                    >
                      Long
                    </button>
                    <button
                      onClick={() => setForm({ ...form, side: "SHORT" })}
                      className={cn("flex-1 text-[10px] uppercase tracking-wider", form.side === "SHORT" ? "bg-[#c7484b]/20 text-[#c7484b]" : "text-[#8891a0]")}
                    >
                      Short
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Entry Price</Label>
                    <Input value={form.entryPrice} onChange={(e) => setForm({ ...form, entryPrice: e.target.value })} type="number" step="any" className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8" />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Size (qty)</Label>
                    <Input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} type="number" step="any" className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8" />
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Note (optional)</Label>
                  <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-1 bg-[#0b0e13] border-[#262b33] text-[11px] h-8" />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button size="sm" variant="ghost" className="text-[10px] uppercase">Cancel</Button>
                </DialogClose>
                <Button
                  size="sm"
                  className="text-[10px] uppercase bg-[#3b5fe0] hover:bg-[#2f4ec2]"
                  onClick={submit}
                  disabled={create.isPending || update.isPending}
                >
                  {(create.isPending || update.isPending) ? "Saving…" : editId ? "Save Changes" : "Add Position"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      >
        {portfolio.isLoading ? (
          <LoadingState rows={4} />
        ) : positions.length === 0 ? (
          <EmptyState
            title="No open positions"
            hint="Add a position to start tracking exposure, PnL & risk across crypto, IDX, forex and gold."
            icon={<Briefcase className="h-6 w-6" />}
          />
        ) : (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[#11151c]">
              <tr className="text-left text-[9px] uppercase tracking-wider text-[#8891a0] border-b border-[#262b33]">
                <th className="px-2 py-1.5 font-medium">Asset</th>
                <th className="px-2 py-1.5 font-medium">Symbol</th>
                <th className="px-2 py-1.5 font-medium">Side</th>
                <th className="px-2 py-1.5 font-medium text-right">Size</th>
                <th className="px-2 py-1.5 font-medium text-right">Entry</th>
                <th className="px-2 py-1.5 font-medium text-right">Last</th>
                <th className="px-2 py-1.5 font-medium text-right">Mkt Value</th>
                <th className="px-2 py-1.5 font-medium text-right">Unreal. PnL</th>
                <th className="px-2 py-1.5 font-medium text-right">%</th>
                <th className="px-2 py-1.5 font-medium">Opened</th>
                <th className="px-2 py-1.5 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id} className="border-b border-[#11151c] hover:bg-[#1b2029]">
                  <td className="px-2 py-1.5"><AssetBadge assetClass={p.instrument.assetClass} size="xs" /></td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => selectInstrument(p.instrumentId)} className="font-medium text-[#e7e9ec] hover:underline">
                      {p.instrument.symbol}
                    </button>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={cn("text-[9px] uppercase px-1 py-0.5 rounded", p.side === "LONG" ? "bg-[#2e9e6d]/15 text-[#2e9e6d]" : "bg-[#c7484b]/15 text-[#c7484b]")}>
                      {p.side}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular text-[#e7e9ec]">{p.size}</td>
                  <td className="px-2 py-1.5 text-right tabular text-[#8891a0]">{fmtPrice(p.entryPrice, p.instrument.currency)}</td>
                  <td className="px-2 py-1.5 text-right tabular">
                    {p.lastPrice != null ? fmtPrice(p.lastPrice, p.instrument.currency) : <span className="text-[#c7484b] text-[9px]">SRC DOWN</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular text-[#e7e9ec]">{p.marketValue != null ? fmtCompact(p.marketValue) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular" style={{ color: (p.unrealizedPnl ?? 0) >= 0 ? "#2e9e6d" : "#c7484b" }}>
                    {p.unrealizedPnl != null ? fmtCompact(p.unrealizedPnl) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right"><ChangeText value={p.unrealizedPnlPct} /></td>
                  <td className="px-2 py-1.5 text-[9px] tabular text-[#4a525c]">{fmtDateTime(p.openedAt)}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-0.5 justify-end">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => openEdit(p.id)} title="Edit">
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-[#c7484b] hover:text-[#e7e9ec]"
                        onClick={() => del.mutate(p.id, { onSuccess: () => toast.success("Position closed") })}
                        title="Close"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function SummaryTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#151920] border border-[#262b33] rounded-md p-3 flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-wider text-[#8891a0]">{label}</span>
      <span className="text-xl font-semibold tabular leading-none" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
