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

// ─── Fase 4 — Execution Bot (PRD §8.5, §16.7) ────────────────────────────
// The execution bot runs as a SEPARATE bun process on port 3002 (process
// isolation per §16.7). Frontend reaches it via the Caddy gateway: every
// fetch URL includes `?XTransformPort=3002` and uses a RELATIVE path so
// Caddy routes to the right backend. We DO NOT call localhost:3002
// directly (per system rules — no absolute URLs / direct port refs in
// the browser). The bot's HTTP API is documented in
// `mini-services/execution-bot/index.ts`.

/// Append `XTransformPort=3002` to a path, preserving any existing query.
/// `path` is a relative path like `/status` or `/order?foo=bar`.
function botUrl(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}XTransformPort=3002`;
}

/// Typed response shapes returned by the mini-service.
export interface BotStatus {
  ok: boolean;
  mode: "PAPER" | "LIVE";
  killSwitch: boolean;
  autoKillDd: number;
  maxOrderUsd: number;
  maxDailyUsd: number;
  dailyNotionalUsd: number;
  orderCount24h: number;
  mt5LiveDeferred: boolean;
  liveSupported: string[];
  exchangeName: string | null;
  exchangeKeysConfigured: boolean;
  updatedAt: string;
}

export interface BotOrder {
  id: string;
  instrumentId: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  size: number;
  price: number | null;
  avgFillPrice: number | null;
  status: "PENDING" | "FILLED" | "PARTIAL" | "CANCELLED" | "REJECTED";
  mode: "PAPER" | "LIVE";
  exchange: string | null;
  exchangeOrderId: string | null;
  reason: string | null;
  valueUsd: number;
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
  // joined from Instrument
  instrumentTicker: string | null;
  instrumentSymbol: string | null;
  instrumentAssetClass: string | null;
  instrumentCurrency: string | null;
}

export interface BotAuditEntry {
  id: string;
  action: string;
  message: string;
  contextJson: string | null;
  severity: "INFO" | "WARN" | "CRITICAL";
  prevHash: string;
  hash: string;
  createdAt: string;
}

export interface BotAuditResponse {
  ok: boolean;
  audit: BotAuditEntry[];
  chainIntact: boolean;
  firstBrokenId: string | null;
  count: number;
  chainLength: number;
}

export interface BotConfigUpdate {
  mode?: "PAPER" | "LIVE";
  killSwitch?: boolean;
  autoKillDd?: number;
  maxOrderUsd?: number;
  maxDailyUsd?: number;
}

export interface BotConfigResponse {
  ok: boolean;
  mode: "PAPER" | "LIVE";
  killSwitch: boolean;
  autoKillDd: number;
  maxOrderUsd: number;
  maxDailyUsd: number;
  updatedAt: string;
}

export interface PlaceOrderInput {
  instrumentId: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  size: number;
  price?: number;
  mode?: "PAPER" | "LIVE";
  confirm?: boolean;
}

export interface PlaceOrderResponse {
  ok: boolean;
  order?: BotOrder;
  // 409 large-order confirm response
  needsConfirm?: boolean;
  message?: string;
  valueUsd?: number;
  cap?: number;
  error?: string;
}

/// `fetch` wrapper for the bot that injects the gateway port + JSON
/// headers, parses errors uniformly, and surfaces the raw Response for
/// status-code handling (e.g. 409 needsConfirm).
async function botFetch<T>(
  path: string,
  opts: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<{ status: number; data: T | null; error: string | null }> {
  const url = botUrl(path);
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    return {
      status: 0,
      data: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const text = await res.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      /* leave data null */
    }
  }
  if (!res.ok) {
    const errMsg =
      (data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : null) ?? `HTTP ${res.status}`;
    return { status: res.status, data, error: errMsg };
  }
  return { status: res.status, data, error: null };
}

export function useBotStatus() {
  return useQuery<BotStatus>({
    queryKey: ["bot-status"],
    queryFn: async () => {
      const r = await botFetch<BotStatus>("/status");
      if (!r.data) throw new Error(r.error ?? "Failed to load bot status");
      return r.data;
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: 1,
  });
}

export function useBotOrders(limit = 100, mode?: "PAPER" | "LIVE") {
  const qs = mode ? `?limit=${limit}&mode=${mode}` : `?limit=${limit}`;
  return useQuery<BotOrder[]>({
    queryKey: ["bot-orders", limit, mode],
    queryFn: async () => {
      const r = await botFetch<{ ok: boolean; orders: BotOrder[] }>(`/orders${qs}`);
      if (!r.data) throw new Error(r.error ?? "Failed to load orders");
      return r.data.orders;
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: 1,
  });
}

export function useBotAudit(limit = 200) {
  return useQuery<BotAuditResponse>({
    queryKey: ["bot-audit", limit],
    queryFn: async () => {
      const r = await botFetch<BotAuditResponse>(`/audit?limit=${limit}`);
      if (!r.data) throw new Error(r.error ?? "Failed to load audit log");
      return r.data;
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useUpdateBotConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BotConfigUpdate): Promise<BotConfigResponse> => {
      const r = await botFetch<BotConfigResponse>("/config", { method: "POST", body: input });
      if (!r.data) throw new Error(r.error ?? "Failed to update bot config");
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-status"] });
      qc.invalidateQueries({ queryKey: ["bot-audit"] });
    },
  });
}

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PlaceOrderInput): Promise<PlaceOrderResponse> => {
      const r = await botFetch<PlaceOrderResponse>("/order", { method: "POST", body: input });
      // 409 with needsConfirm is a *successful* protocol outcome — we want
      // the caller to see the needsConfirm payload, not throw. So only
      // throw on hard errors (network/5xx). 4xx with a parsed body are
      // returned as data so the UI can react.
      if (r.status === 0) throw new Error(r.error ?? "Network error");
      if (!r.data) throw new Error(r.error ?? `HTTP ${r.status}`);
      // Surface needsConfirm + cap-breach errors via the returned data
      // (caller handles 409/400). Throw on 5xx so React Query sees a fail.
      if (r.status >= 500) throw new Error(r.error ?? `HTTP ${r.status}`);
      return { ...r.data, error: r.error ?? undefined };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-status"] });
      qc.invalidateQueries({ queryKey: ["bot-orders"] });
      qc.invalidateQueries({ queryKey: ["bot-audit"] });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string): Promise<BotOrder> => {
      const r = await botFetch<{ ok: boolean; order: BotOrder }>(`/order/${encodeURIComponent(orderId)}/cancel`, {
        method: "POST",
      });
      if (!r.data) throw new Error(r.error ?? "Failed to cancel order");
      return r.data.order;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-status"] });
      qc.invalidateQueries({ queryKey: ["bot-orders"] });
      qc.invalidateQueries({ queryKey: ["bot-audit"] });
    },
  });
}
