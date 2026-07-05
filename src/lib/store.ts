"use client";

import { create } from "zustand";

export type ModuleKey =
  | "dashboard"
  | "watchlist"
  | "signals"
  | "risk"
  | "portfolio"
  | "execution"
  | "sources";

interface TerminalState {
  active: ModuleKey;
  selectedInstrumentId: string | null;
  setActive: (m: ModuleKey) => void;
  selectInstrument: (id: string | null) => void;
}

export const useTerminal = create<TerminalState>((set) => ({
  active: "dashboard",
  selectedInstrumentId: null,
  setActive: (m) => set({ active: m }),
  selectInstrument: (id) => set({ selectedInstrumentId: id }),
}));
