"use client";

import { useState } from "react";
import { Panel, EmptyState } from "@/components/panel";
import { QuoteTable } from "@/components/terminal/quote-table";
import { InstrumentDetail } from "@/components/terminal/instrument-detail";
import { useWatchlist, useInstruments, useSeed } from "@/lib/api-client";
import { useTerminal } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, ListChecks, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AssetClass } from "@/lib/types";

export function WatchlistView() {
  const watchlist = useWatchlist();
  const instruments = useInstruments();
  const seed = useSeed();
  const qc = useQueryClient();
  const { selectedInstrumentId, selectInstrument } = useTerminal();

  const selected = (watchlist.data?.items ?? [])
    .map((i) => i.instrument)
    .find((i) => i.id === selectedInstrumentId);

  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterClass, setFilterClass] = useState<string>("ALL");

  const allInstruments = instruments.data ?? [];
  const wlIds = new Set((watchlist.data?.items ?? []).map((i) => i.instrumentId));
  const availableToAdd = allInstruments.filter((i) => !wlIds.has(i.id)).filter((i) => {
    if (filterClass !== "ALL" && i.assetClass !== filterClass) return false;
    if (search) {
      const s = search.toLowerCase();
      return i.symbol.toLowerCase().includes(s) || i.name.toLowerCase().includes(s) || i.ticker.toLowerCase().includes(s);
    }
    return true;
  });

  async function addInstrument(id: string) {
    try {
      await fetch(`/api/v1/watchlist/${id}`, { method: "POST" });
      toast.success("Added to watchlist");
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
    } catch (e) {
      toast.error("Failed: " + String(e));
    }
  }

  async function removeInstrument(id: string) {
    try {
      await fetch(`/api/v1/watchlist/${id}`, { method: "DELETE" });
      toast.success("Removed from watchlist");
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      if (selectedInstrumentId === id) selectInstrument(null);
    } catch (e) {
      toast.error("Failed: " + String(e));
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-3 h-full overflow-hidden">
      {/* Left: watchlist table */}
      <div className="xl:col-span-3 flex flex-col gap-3 min-h-0 overflow-hidden">
        <Panel
          title="Watchlist"
          subtitle={`${watchlist.data?.items.length ?? 0} instruments · multi-asset`}
          bodyClassName="p-0 overflow-y-auto max-h-[calc(100vh-220px)]"
          actions={
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[10px] uppercase tracking-wider"
                onClick={() => {
                  seed.mutate();
                  qc.invalidateQueries({ queryKey: ["watchlist"] });
                  qc.invalidateQueries({ queryKey: ["instruments"] });
                }}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Re-seed
              </Button>
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-7 text-[10px] uppercase tracking-wider bg-[#3b5fe0] hover:bg-[#2f4ec2]">
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-[#151920] border-[#262b33] max-w-lg">
                  <DialogHeader>
                    <DialogTitle className="text-[#e7e9ec] text-sm">Add instrument to watchlist</DialogTitle>
                  </DialogHeader>
                  <div className="flex items-center gap-2 py-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#4a525c]" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search symbol or name…"
                        className="pl-7 h-8 bg-[#0b0e13] border-[#262b33] text-[11px]"
                      />
                    </div>
                    <Select value={filterClass} onValueChange={setFilterClass}>
                      <SelectTrigger className="h-8 w-[120px] bg-[#0b0e13] border-[#262b33] text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#151920] border-[#262b33]">
                        <SelectItem value="ALL">All classes</SelectItem>
                        <SelectItem value="CRYPTO">Crypto</SelectItem>
                        <SelectItem value="EQUITY">IDX Equity</SelectItem>
                        <SelectItem value="FOREX">Forex</SelectItem>
                        <SelectItem value="COMMODITY">Commodity</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto border border-[#262b33] rounded">
                    {availableToAdd.length === 0 ? (
                      <p className="p-3 text-[11px] text-[#8891a0] text-center">No instruments match.</p>
                    ) : (
                      <ul className="divide-y divide-[#11151c]">
                        {availableToAdd.map((i) => (
                          <li key={i.id} className="flex items-center justify-between px-2.5 py-1.5 hover:bg-[#1b2029]">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-medium text-[#e7e9ec]">{i.symbol}</span>
                                <span className="text-[9px] uppercase text-[#4a525c]">{i.assetClass}</span>
                              </div>
                              <p className="text-[9px] text-[#4a525c] truncate">{i.name}</p>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px]"
                              onClick={() => addInstrument(i.id)}
                            >
                              <Plus className="h-3 w-3 mr-1" /> Add
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button size="sm" variant="ghost" className="text-[10px] uppercase">Close</Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          }
        >
          {watchlist.data && watchlist.data.items.length === 0 ? (
            <EmptyState
              title="Watchlist is empty"
              hint="Add instruments using the Add button, or re-seed the default universe."
              icon={<ListChecks className="h-6 w-6" />}
            />
          ) : (
            <QuoteTable />
          )}
        </Panel>

        {selected && (
          <Panel title="Manage" bodyClassName="p-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#8891a0]">
                <span className="text-[#e7e9ec] font-medium">{selected.symbol}</span> selected
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] border-[#c7484b] text-[#c7484b] hover:bg-[#c7484b] hover:text-white"
                onClick={() => removeInstrument(selected.id)}
              >
                Remove from watchlist
              </Button>
            </div>
          </Panel>
        )}
      </div>

      {/* Right: instrument detail */}
      <div className="xl:col-span-2 min-h-0 overflow-hidden">
        {selected ? (
          <Panel
            title="Instrument Detail"
            noPadding
            bodyClassName="p-3 overflow-y-auto max-h-[calc(100vh-160px)]"
            actions={
              <button
                onClick={() => selectInstrument(null)}
                className="text-[10px] uppercase tracking-wider text-[#8891a0] hover:text-[#e7e9ec]"
              >
                close ✕
              </button>
            }
          >
            <InstrumentDetail instrument={selected} />
          </Panel>
        ) : (
          <Panel title="Instrument Detail" bodyClassName="flex items-center justify-center">
            <EmptyState
              title="Select an instrument"
              hint="Click any row in the watchlist to view chart, technicals & fundamentals."
              icon={<Search className="h-6 w-6" />}
            />
          </Panel>
        )}
      </div>
    </div>
  );
}
