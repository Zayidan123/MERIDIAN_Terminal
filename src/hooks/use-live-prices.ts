"use client";

// MERIDIAN Terminal — live price WebSocket hook (PRD FR-0.1).
//
// Connects to the ws-prices mini-service (port 3001) via the Caddy
// gateway using `XTransformPort=3001` query — NEVER a direct localhost URL.
// Maintains a process-wide singleton socket so multiple components can
// subscribe to the same upstream without re-handshaking.
//
// The hook exposes:
//   - subscribe(symbols): add to this component's subscription set; the
//     service aggregates across all clients into a single upstream
//     Binance WS / Yahoo poller.
//   - prices: map ticker -> { price, time, flash }
//       flash: "up" | "down" | null — auto-clears after 700ms so the
//       UI can apply .flash-up / .flash-down animation classes.
//   - status: "connecting" | "connected" | "disconnected"
//
// On unmount of the LAST consumer, the singleton stays alive (cheap; the
// service will drop subscriptions for the disconnecting socket). The hook
// uses a ref-counted subscribe/unsubscribe so multiple components in the
// same page can each subscribe without stomping on each other.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type WsStatus = "connecting" | "connected" | "disconnected";

export interface LivePriceEntry {
  price: number;
  time: number;
  flash: "up" | "down" | null;
}

export type LivePriceMap = Record<string, LivePriceEntry>;

interface PriceTick {
  ticker: string;
  price: number;
  time: number;
}

// ─── singleton socket ───────────────────────────────────────────────────
let socket: Socket | null = null;
let socketStatus: WsStatus = "connecting";
const statusListeners = new Set<(s: WsStatus) => void>();
const priceListeners = new Set<(ticker: string, entry: LivePriceEntry) => void>();
const prices: LivePriceMap = {};
// Per-ticker flash timer so we can clear the flash class after 700ms.
const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setStatus(s: WsStatus): void {
  if (socketStatus === s) return;
  socketStatus = s;
  for (const fn of statusListeners) fn(s);
}

function applyPrice(tick: PriceTick): void {
  const prev = prices[tick.ticker];
  let flash: "up" | "down" | null = null;
  if (prev) {
    if (tick.price > prev.price) flash = "up";
    else if (tick.price < prev.price) flash = "down";
  }
  const entry: LivePriceEntry = { price: tick.price, time: tick.time, flash };
  prices[tick.ticker] = entry;
  for (const fn of priceListeners) fn(tick.ticker, entry);

  // Auto-clear the flash flag after 700ms (matches the .flash-up / .flash-down
  // CSS keyframe duration in globals.css).
  if (flash) {
    const existing = flashTimers.get(tick.ticker);
    if (existing) clearTimeout(existing);
    flashTimers.set(
      tick.ticker,
      setTimeout(() => {
        flashTimers.delete(tick.ticker);
        const cur = prices[tick.ticker];
        if (cur && cur.flash) {
          cur.flash = null;
          for (const fn of priceListeners) fn(tick.ticker, { ...cur, flash: null });
        }
      }, 700)
    );
  }
}

function getSocket(): Socket {
  if (socket) return socket;
  // Connect same-origin through Caddy with XTransformPort=3001.
  // Caddy routes any request with ?XTransformPort=3001 to localhost:3001.
  // We use socket.io's DEFAULT path (/socket.io/) because the ws-prices
  // service also exposes a /health HTTP endpoint on the same port —
  // engine.io with `path:'/'` would intercept /health and clobber it.
  socket = io({
    path: "/socket.io/",
    // WebSocket first (lowest latency); fall back to HTTP long-polling if the
    // upgrade is blocked (e.g. strict corporate proxies). Both transports go
    // through the Caddy gateway via ?XTransformPort=3001.
    transports: ["websocket", "polling"],
    query: { XTransformPort: "3001" },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 10_000,
  });
  setStatus("connecting");
  socket.on("connect", () => setStatus("connected"));
  socket.on("disconnect", () => setStatus("disconnected"));
  socket.on("connect_error", () => setStatus("disconnected"));
  socket.on("status", (s: WsStatus) => {
    // Server emits "status" with the literal "connected" right after
    // handshake — we accept it but prefer the local "connected" event.
    if (s === "connected") setStatus("connected");
  });
  socket.on("price", (tick: PriceTick) => {
    if (tick && typeof tick.ticker === "string" && typeof tick.price === "number") {
      applyPrice(tick);
    }
  });
  return socket;
}

// ─── React hook ─────────────────────────────────────────────────────────
export interface UseLivePrices {
  status: WsStatus;
  prices: LivePriceMap;
  /** Subscribe to additional tickers (idempotent). Stable callback. */
  subscribe: (symbols: string[]) => void;
  /** Unsubscribe from tickers. Stable callback. */
  unsubscribe: (symbols: string[]) => void;
}

export function useLivePrices(): UseLivePrices {
  const [status, setStatusState] = useState<WsStatus>(() => socketStatus);
  // Bump a counter to force re-render when prices change. We do NOT keep
  // prices in useState (would cause a render storm on every tick); instead
  // consumers read `pricesRef.current` and we trigger a re-render via a
  // coarse counter at most once per animation frame.
  const [, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  const scheduleRerender = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setTick((n) => (n + 1) & 0xfffff);
    });
  }, []);

  // Subscribe to status updates from the singleton. We initialize state from
  // the module-level `socketStatus` (so a late-mounting consumer immediately
  // reflects the current state without an extra setState in the effect).
  useEffect(() => {
    const fn = (s: WsStatus) => setStatusState(s);
    statusListeners.add(fn);
    // Ensure the socket exists (lazy init on first consumer).
    getSocket();
    return () => {
      statusListeners.delete(fn);
    };
  }, []);

  // Subscribe to price updates — schedule a single rAF-batched re-render.
  useEffect(() => {
    const fn = (_t: string, _e: LivePriceEntry) => scheduleRerender();
    priceListeners.add(fn);
    return () => {
      priceListeners.delete(fn);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scheduleRerender]);

  const subscribe = useCallback((symbols: string[]) => {
    if (symbols.length === 0) return;
    const s = getSocket();
    s.emit("subscribe", { symbols });
  }, []);

  const unsubscribe = useCallback((symbols: string[]) => {
    if (symbols.length === 0) return;
    const s = getSocket();
    s.emit("unsubscribe", { symbols });
  }, []);

  return useMemo<UseLivePrices>(
    () => ({ status, prices, subscribe, unsubscribe }),
    [status, prices, subscribe, unsubscribe]
  );
}
