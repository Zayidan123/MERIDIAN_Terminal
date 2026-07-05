// MERIDIAN Terminal — typed API client + React Query hooks.
// All market data is fetched via these hooks from the real-data API routes.

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type {
  Instrument,
  Candle,
  Quote,
  Fundamental,
  TechnicalSnapshot,
  Provenance,
  AlertRule,
  SignalEvent,
  Position,
  RiskSummary,
  Range,
  AssetClass,
} from "@/lib/types";

// ─── fetch helpers ──────────────────────────────────────────────────────
async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

async function postJSON<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

async function patchJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ─── response envelopes ─────────────────────────────────────────────────
interface ApiOk<T> {
  ok: true;
  data: T;
  provenance?: Provenance;
}

// ─── typed shapes returned by the API ───────────────────────────────────
export interface QuoteRow {
  ok: boolean;
  instrumentId: string;
  ticker: string;
  symbol: string;
  quote?: Quote;
  provenance?: Provenance;
  error?: string;
}

export interface QuotesResponse {
  ok: true;
  data: { quotes: QuoteRow[]; provenance: Provenance };
}

export interface MarketSummary {
  gainers: number;
  losers: number;
  unchanged: number;
  failed: number;
  avgChangePct: number | null;
  byAssetClass: Record<AssetClass, number | null>;
  asOf: number;
}

export interface WatchlistResponse {
  ok: true;
  data: {
    id: string;
    name: string;
    items: { id: string; addedAt: number; instrument: Instrument }[];
  };
}

export interface TechnicalsResponse {
  technicals: TechnicalSnapshot;
  volumeZScore: number | null;
  returnsStats: { mean: number; std: number; sample: number };
  lastClose: number;
  range: string;
  candleCount: number;
}

export interface AlertWithInstrument extends AlertRule {
  instrument: Instrument;
}

export interface SignalWithInstrument extends SignalEvent {
  instrument: Instrument;
}

export interface PositionWithMarket extends Position {
  instrument: Instrument;
  lastPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  error?: string;
}

export interface HealthRecord {
  source: string;
  endpoint: string;
  status: string;
  latencyMs: number | null;
  errorMessage: string | null;
  checkedAt: number;
}

export interface HealthResponse {
  latest: { source: string; status: string; latencyMs: number; checkedAt: number }[];
  recent: HealthRecord[];
}

// ─── hooks ──────────────────────────────────────────────────────────────
export function useInstruments(assetClass?: AssetClass) {
  return useQuery<Instrument[]>({
    queryKey: ["instruments", assetClass ?? "all"],
    queryFn: async () => {
      const qs = assetClass ? `?assetClass=${assetClass}` : "";
      const r = await getJSON<ApiOk<Instrument[]>>(`/api/v1/instruments${qs}`);
      return r.data;
    },
    staleTime: 60_000,
  });
}

export function useWatchlist() {
  return useQuery<WatchlistResponse["data"]>({
    queryKey: ["watchlist"],
    queryFn: async () => {
      const r = await getJSON<WatchlistResponse>("/api/v1/watchlist");
      return r.data;
    },
    staleTime: 30_000,
  });
}

export function useQuotes() {
  return useQuery<QuotesResponse["data"]>({
    queryKey: ["quotes"],
    queryFn: async () => {
      const r = await getJSON<QuotesResponse>("/api/v1/quotes");
      return r.data;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useMarketSummary() {
  return useQuery<MarketSummary>({
    queryKey: ["market-summary"],
    queryFn: async () => {
      const r = await getJSON<ApiOk<MarketSummary>>("/api/v1/market-summary");
      return r.data;
    },
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
}

export function useCandles(instrumentId: string | null, range: Range) {
  return useQuery<{ candles: Candle[]; instrument: Instrument; provenance?: Provenance }>({
    queryKey: ["candles", instrumentId, range],
    queryFn: async () => {
      const r = await getJSON<ApiOk<{ candles: Candle[]; instrument: Instrument }>>(
        `/api/v1/prices/${instrumentId}?range=${range}`
      );
      return { candles: r.data.candles, instrument: r.data.instrument, provenance: r.provenance };
    },
    enabled: !!instrumentId,
    staleTime: 30_000,
  });
}

export function useTechnicals(instrumentId: string | null, range: Range = "3m") {
  return useQuery<TechnicalsResponse>({
    queryKey: ["technicals", instrumentId, range],
    queryFn: async () => {
      const r = await getJSON<ApiOk<TechnicalsResponse>>(
        `/api/v1/technicals/${instrumentId}?range=${range}`
      );
      return r.data;
    },
    enabled: !!instrumentId,
    staleTime: 60_000,
  });
}

export function useFundamentals(instrumentId: string | null, enabled = true) {
  return useQuery<Fundamental | null>({
    queryKey: ["fundamentals", instrumentId],
    queryFn: async () => {
      try {
        const r = await getJSON<ApiOk<Fundamental>>(`/api/v1/fundamentals/${instrumentId}`);
        return r.data;
      } catch (e) {
        // Expected for non-equity or when Yahoo is rate-limited; surface as null
        return null;
      }
    },
    enabled: !!instrumentId && enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useAlerts() {
  return useQuery<AlertWithInstrument[]>({
    queryKey: ["alerts"],
    queryFn: async () => {
      const r = await getJSON<ApiOk<AlertWithInstrument[]>>("/api/v1/alerts");
      return r.data;
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      instrumentId: string;
      metric: string;
      operator: string;
      threshold: number;
      note?: string;
    }) => {
      const r = await postJSON<ApiOk<AlertWithInstrument>>("/api/v1/alerts", input);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

export function useUpdateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string } & Partial<{ status: string; threshold: number; operator: string; note: string }>) => {
      const r = await patchJSON<ApiOk<AlertWithInstrument>>(`/api/v1/alerts/${id}`, patch);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => del(`/api/v1/alerts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

export function useSignals(limit = 50) {
  return useQuery<SignalWithInstrument[]>({
    queryKey: ["signals", limit],
    queryFn: async () => {
      const r = await getJSON<ApiOk<SignalWithInstrument[]>>(`/api/v1/signals?limit=${limit}`);
      return r.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useEvaluateAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => postJSON<ApiOk<unknown>>("/api/v1/alerts/evaluate"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["signals"] });
    },
  });
}

export function useScanSignals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => postJSON<ApiOk<unknown>>("/api/v1/signals/scan"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signals"] }),
  });
}

export function usePortfolio() {
  return useQuery<PositionWithMarket[]>({
    queryKey: ["portfolio"],
    queryFn: async () => {
      const r = await getJSON<ApiOk<PositionWithMarket[]>>("/api/v1/portfolio");
      return r.data;
    },
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
}

export function useCreatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      instrumentId: string;
      side: string;
      entryPrice: number;
      size: number;
      note?: string;
    }) => {
      const r = await postJSON<ApiOk<PositionWithMarket>>("/api/v1/portfolio", input);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["risk-summary"] });
    },
  });
}

export function useUpdatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string } & Partial<{ entryPrice: number; size: number; side: string; note: string }>) => {
      const r = await patchJSON<ApiOk<PositionWithMarket>>(`/api/v1/portfolio/${id}`, patch);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["risk-summary"] });
    },
  });
}

export function useDeletePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => del(`/api/v1/portfolio/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["risk-summary"] });
    },
  });
}

export function useRiskSummary() {
  return useQuery<RiskSummary & { provenance?: Provenance }>({
    queryKey: ["risk-summary"],
    queryFn: async () => {
      const r = await getJSON<ApiOk<RiskSummary>>("/api/v1/risk/summary");
      return { ...r.data, provenance: r.provenance };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useHealth() {
  return useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: async () => {
      const r = await getJSON<ApiOk<HealthResponse>>("/api/v1/health");
      return r.data;
    },
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}

export function useSeed() {
  return useMutation({
    mutationFn: async () => postJSON<ApiOk<unknown>>("/api/v1/seed"),
  });
}

/// Periodic background poller for alert evaluation + signal scanning.
/// Fires evaluate every 60s, scan every 180s (staggered).
export function useSignalPoller(active: boolean) {
  const evaluate = useEvaluateAlerts();
  const scan = useScanSignals();
  const lastEval = useRef(0);
  const lastScan = useRef(0);
  const tick = useCallback(async () => {
    if (!active) return;
    const now = Date.now();
    if (now - lastEval.current > 60_000) {
      lastEval.current = now;
      evaluate.mutate(undefined, { onError: () => {} });
    }
    if (now - lastScan.current > 180_000) {
      lastScan.current = now;
      scan.mutate(undefined, { onError: () => {} });
    }
  }, [active, evaluate, scan]);

  useEffect(() => {
    if (!active) return;
    // initial fire shortly after mount
    const t1 = setTimeout(tick, 4000);
    const iv = setInterval(tick, 15_000);
    return () => {
      clearTimeout(t1);
      clearInterval(iv);
    };
  }, [active, tick]);
}
