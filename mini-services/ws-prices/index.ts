// MERIDIAN Terminal — WebSocket live price streaming mini-service.
// PRD FR-0.1: real-time price ticks for crypto (Binance trade stream) and
// non-crypto (Yahoo Finance chart polling).
//
// Self-contained bun project — imports ONLY `socket.io`. Does NOT import
// from the Next.js app. Aggregates subscriptions across all clients into a
// SINGLE upstream Binance combined WebSocket (the union of subscribed
// symbols) and a SINGLE Yahoo poller for non-crypto symbols.
//
// Connection (browser): io("/?XTransformPort=3001") — Caddy forwards the
// query to localhost:3001.

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Server, type Socket } from "socket.io";

// ─── protocol ────────────────────────────────────────────────────────────
interface PriceTick {
  ticker: string;
  price: number;
  time: number; // epoch ms
}
interface SubscribePayload {
  symbols?: string[];
}
type ClientStatus = "connecting" | "connected" | "disconnected";

// ─── runtime state ───────────────────────────────────────────────────────
// Map socket.id -> Set of ticker symbols the client is subscribed to.
const clientSubscriptions = new Map<string, Set<string>>();

// Per-symbol last price cache (so a newly-subscribed client immediately
// gets the latest tick after subscribing).
const lastPriceByTicker = new Map<string, PriceTick>();

// Yahoo rate-limit state — when 429 hits, switch to 60s polling for 5 min.
let yahooBackoffUntil = 0;
const YAHOO_BACKOFF_MS = 5 * 60 * 1000;
const YAHOO_NORMAL_INTERVAL_MS = 15_000;
const YAHOO_BACKOFF_INTERVAL_MS = 60_000;

// ─── symbol classification ──────────────────────────────────────────────
// Crypto = Binance trade-stream compatible (uppercase alnum, no `.JK`,
// no `=X`, not `GC=F`). Yahoo covers everything else (IDX .JK, forex =X,
// gold GC=F).
function isCryptoSymbol(sym: string): boolean {
  const upper = sym.toUpperCase();
  // Yahoo-style identifiers all carry a marker.
  if (upper.endsWith(".JK")) return false;
  if (upper.endsWith("=X")) return false;
  if (upper === "GC=F") return false;
  // Otherwise: Binance-style crypto pair like BTCUSDT, ETHUSDT.
  return /^[A-Z0-9]{4,20}$/.test(upper);
}

function cryptoStreamName(sym: string): string {
  return `${sym.toLowerCase()}@trade`;
}

// ─── Binance combined WebSocket upstream ────────────────────────────────
// One persistent connection to wss://stream.binance.com:9443/stream for the
// union of all crypto symbols currently subscribed by any client. We
// reconnect whenever the symbol set changes (Binance doesn't support
// dynamic stream subscription on the combined endpoint without a separate
// SUBSCRIBE message — simplest robust approach is reconnect).
let binanceWs: WebSocket | null = null;
let binanceReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let binanceBackoff = 1000; // ms, doubles on failure, capped at 30s
let binanceCurrentSymbols: string[] = [];
let binanceClosedIntentionally = false;

function aggregateCryptoSymbols(): string[] {
  const set = new Set<string>();
  for (const symSet of clientSubscriptions.values()) {
    for (const s of symSet) {
      if (isCryptoSymbol(s)) set.add(s.toUpperCase());
    }
  }
  return Array.from(set).sort();
}

function aggregateYahooSymbols(): string[] {
  const set = new Set<string>();
  for (const symSet of clientSubscriptions.values()) {
    for (const s of symSet) {
      if (!isCryptoSymbol(s)) set.add(s.toUpperCase());
    }
  }
  return Array.from(set).sort();
}

function disconnectBinance(reason: string): void {
  binanceClosedIntentionally = true;
  if (binanceReconnectTimer) {
    clearTimeout(binanceReconnectTimer);
    binanceReconnectTimer = null;
  }
  if (binanceWs) {
    try {
      binanceWs.close();
    } catch {
      /* ignore */
    }
    binanceWs = null;
  }
  if (binanceCurrentSymbols.length > 0) {
    console.log(`[binance] disconnect (${reason}); was watching ${binanceCurrentSymbols.length} symbols`);
  }
  binanceCurrentSymbols = [];
}

function connectBinance(symbols: string[]): void {
  // Tear down any existing connection first.
  if (binanceWs) {
    binanceClosedIntentionally = true;
    try {
      binanceWs.close();
    } catch {
      /* ignore */
    }
    binanceWs = null;
  }
  if (binanceReconnectTimer) {
    clearTimeout(binanceReconnectTimer);
    binanceReconnectTimer = null;
  }
  if (symbols.length === 0) {
    binanceCurrentSymbols = [];
    return;
  }

  binanceCurrentSymbols = symbols;
  binanceClosedIntentionally = false;

  const streams = symbols.map(cryptoStreamName).join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  console.log(`[binance] connecting (${symbols.length} symbols: ${symbols.slice(0, 6).join(",")}${symbols.length > 6 ? "…" : ""})`);

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.error(`[binance] WebSocket ctor failed: ${e instanceof Error ? e.message : String(e)}`);
    scheduleBinanceReconnect(symbols);
    return;
  }
  binanceWs = ws;

  ws.addEventListener("open", () => {
    console.log(`[binance] upstream connected (${symbols.length} streams)`);
    binanceBackoff = 1000; // reset backoff on success
  });

  ws.addEventListener("message", (ev: MessageEvent) => {
    let raw: unknown;
    try {
      raw = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    } catch {
      return;
    }
    if (!raw || typeof raw !== "object") return;
    const msg = raw as { stream?: string; data?: { s?: string; p?: string; T?: number } };
    const data = msg.data;
    if (!data || typeof data.p !== "string" || typeof data.s !== "string") return;
    const ticker = data.s.toUpperCase();
    const price = parseFloat(data.p);
    if (!Number.isFinite(price)) return;
    const time = typeof data.T === "number" ? data.T : Date.now();
    broadcastPrice({ ticker, price, time });
  });

  ws.addEventListener("error", (ev: Event) => {
    const detail = (ev as unknown as { message?: string }).message ?? "unknown";
    console.error(`[binance] upstream error: ${detail}`);
  });

  ws.addEventListener("close", (ev: CloseEvent) => {
    console.log(`[binance] upstream closed code=${ev.code} reason=${ev.reason || "<none>"} intentional=${binanceClosedIntentionally}`);
    binanceWs = null;
    if (!binanceClosedIntentionally && binanceCurrentSymbols.length > 0) {
      scheduleBinanceReconnect(binanceCurrentSymbols);
    }
  });
}

function scheduleBinanceReconnect(symbols: string[]): void {
  if (binanceReconnectTimer) clearTimeout(binanceReconnectTimer);
  const delay = binanceBackoff;
  binanceBackoff = Math.min(binanceBackoff * 2, 30_000);
  console.log(`[binance] reconnect in ${delay}ms (next backoff ${binanceBackoff}ms)`);
  binanceReconnectTimer = setTimeout(() => {
    binanceReconnectTimer = null;
    if (symbols.length > 0) connectBinance(symbols);
  }, delay);
}

// Reconcile the upstream Binance WS with the currently-aggregated symbol
// set. Only reconnect when the set actually changes.
function reconcileBinance(): void {
  const desired = aggregateCryptoSymbols();
  const a = desired.join(",");
  const b = binanceCurrentSymbols.join(",");
  if (a === b) return;
  if (desired.length === 0) {
    disconnectBinance("no crypto subscriptions");
    return;
  }
  connectBinance(desired);
}

// ─── Yahoo Finance polling upstream ─────────────────────────────────────
let yahooTimer: ReturnType<typeof setInterval> | null = null;
let yahooCurrentSymbols: string[] = [];
const YAHUA_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface YahooChartMeta {
  regularMarketPrice?: number;
  symbol?: string;
}
interface YahooChartResp {
  chart?: {
    result?: Array<{ meta?: YahooChartMeta }> | null;
    error?: { code?: string; description?: string };
  };
}

async function fetchYahooPrice(ticker: string): Promise<number | null> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { "User-Agent": YAHUA_UA },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 429) {
      console.warn(`[yahoo] 429 rate-limited on ${ticker} — entering 60s backoff for 5min`);
      yahooBackoffUntil = Date.now() + YAHOO_BACKOFF_MS;
      return null;
    }
    if (!res.ok) {
      console.warn(`[yahoo] ${ticker} HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as YahooChartResp;
    if (json.chart?.error) {
      console.warn(`[yahoo] ${ticker} error: ${json.chart.error.description ?? json.chart.error.code}`);
      return null;
    }
    const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" && Number.isFinite(price) ? price : null;
  } catch (e) {
    console.warn(`[yahoo] ${ticker} fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function pollYahooOnce(): Promise<void> {
  const symbols = yahooCurrentSymbols;
  if (symbols.length === 0) return;
  // Sequential to be gentle on Yahoo (parallel requests trigger 429).
  for (const sym of symbols) {
    const price = await fetchYahooPrice(sym);
    if (price !== null) {
      broadcastPrice({ ticker: sym, price, time: Date.now() });
    }
  }
}

function yahooIntervalMs(): number {
  return Date.now() < yahooBackoffUntil ? YAHOO_BACKOFF_INTERVAL_MS : YAHOO_NORMAL_INTERVAL_MS;
}

function reconcileYahoo(): void {
  const desired = aggregateYahooSymbols();
  const a = desired.join(",");
  const b = yahooCurrentSymbols.join(",");
  yahooCurrentSymbols = desired;
  if (desired.length === 0) {
    if (yahooTimer) {
      clearInterval(yahooTimer);
      yahooTimer = null;
    }
    return;
  }
  // Fire one immediate cycle on symbol set change so the UI doesn't wait up
  // to 15s for the first tick after subscribing.
  void pollYahooOnce().catch((e) =>
    console.error(`[yahoo] initial poll failed: ${e instanceof Error ? e.message : String(e)}`)
  );
  // Restart the interval so its cadence matches the current backoff state.
  if (yahooTimer) clearInterval(yahooTimer);
  yahooTimer = setInterval(() => {
    void pollYahooOnce().catch((e) =>
      console.error(`[yahoo] poll failed: ${e instanceof Error ? e.message : String(e)}`)
    );
    // If backoff state has expired (or just begun), adjust the interval on
    // the next tick by re-reconciling (cheap — same symbol set just
    // restarts the timer with the right cadence).
    const next = yahooIntervalMs();
    if (yahooTimer && next !== YAHOO_NORMAL_INTERVAL_MS) {
      // We're in backoff; restart timer to use the longer interval.
      clearInterval(yahooTimer);
      yahooTimer = setInterval(() => {
        void pollYahooOnce().catch(() => {});
      }, YAHOO_BACKOFF_INTERVAL_MS);
    }
  }, YAHOO_NORMAL_INTERVAL_MS);
}

// ─── broadcast helper ────────────────────────────────────────────────────
function broadcastPrice(tick: PriceTick): void {
  // Cache so new subscribers can immediately get the latest value.
  lastPriceByTicker.set(tick.ticker, tick);
  let delivered = 0;
  for (const [socketId, symSet] of clientSubscriptions) {
    if (!symSet.has(tick.ticker)) continue;
    const s = io.sockets.sockets.get(socketId);
    if (s) {
      s.emit("price", tick);
      delivered++;
    }
  }
  if (delivered === 0) {
    // No client is currently listening; the cached value still helps a
    // late subscriber.
  }
}

// ─── HTTP server (for /health) ───────────────────────────────────────────
const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        clients: clientSubscriptions.size,
        upstreamCrypto: binanceCurrentSymbols,
        pollingYahoo: yahooCurrentSymbols,
        yahooBackoff: yahooBackoffUntil > Date.now(),
      })
    );
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

// ─── socket.io server ────────────────────────────────────────────────────
// NOTE: we use the DEFAULT socket.io path `/socket.io/` rather than `path:'/'`
// because engine.io prefix-matches the path against every incoming URL —
// `path:'/'` would match `/health` too and clobber our HTTP response with
// `{"code":0,"message":"Transport unknown"}`. The Caddy gateway forwards
// purely on the `XTransformPort` query param, so it doesn't care which path
// socket.io uses internally.
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

io.on("connection", (socket: Socket) => {
  const sid = socket.id;
  clientSubscriptions.set(sid, new Set());
  console.log(`[ws] client connected id=${sid} (total ${clientSubscriptions.size})`);
  socket.emit("status", "connected" as ClientStatus);

  socket.on("subscribe", (payload: SubscribePayload) => {
    const syms = Array.isArray(payload?.symbols)
      ? payload.symbols.filter((s): s is string => typeof s === "string" && s.length > 0).map((s) => s.toUpperCase())
      : [];
    const set = clientSubscriptions.get(sid) ?? new Set<string>();
    for (const s of syms) set.add(s);
    clientSubscriptions.set(sid, set);
    console.log(`[ws] ${sid} subscribe +${syms.length} (now ${set.size})`);

    // Push cached last prices for any newly-subscribed symbols so the
    // client shows a value immediately rather than waiting for the next
    // tick.
    for (const s of syms) {
      const cached = lastPriceByTicker.get(s);
      if (cached) socket.emit("price", cached);
    }

    reconcileBinance();
    reconcileYahoo();
  });

  socket.on("unsubscribe", (payload: SubscribePayload) => {
    const syms = Array.isArray(payload?.symbols)
      ? payload.symbols.filter((s): s is string => typeof s === "string").map((s) => s.toUpperCase())
      : [];
    const set = clientSubscriptions.get(sid);
    if (set) {
      for (const s of syms) set.delete(s);
      console.log(`[ws] ${sid} unsubscribe -${syms.length} (now ${set.size})`);
    }
    reconcileBinance();
    reconcileYahoo();
  });

  socket.on("disconnect", (reason: string) => {
    clientSubscriptions.delete(sid);
    console.log(`[ws] client disconnected id=${sid} reason=${reason} (total ${clientSubscriptions.size})`);
    reconcileBinance();
    reconcileYahoo();
  });

  socket.on("error", (err: unknown) => {
    console.error(`[ws] socket error id=${sid}: ${err instanceof Error ? err.message : String(err)}`);
  });
});

// ─── lifecycle ──────────────────────────────────────────────────────────
const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`[ws-prices] listening on :${PORT} (socket.io path=/socket.io/, http /health)`);
});

// Ignore SIGHUP — when launched via `nohup ... &` from a shell that then
// exits, the kernel delivers SIGHUP to the child. `nohup` itself ignores
// SIGHUP for the immediate child, but Bun's runtime can re-assign handlers;
// an explicit ignore here keeps the daemon alive across parent-shell exit.
process.on("SIGHUP", () => {
  console.log("[ws-prices] SIGHUP received (ignored — daemon mode)");
});

process.on("SIGTERM", () => {
  console.log("[ws-prices] SIGTERM, shutting down");
  disconnectBinance("shutdown");
  if (yahooTimer) clearInterval(yahooTimer);
  io.close();
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("[ws-prices] SIGINT, shutting down");
  disconnectBinance("shutdown");
  if (yahooTimer) clearInterval(yahooTimer);
  io.close();
  httpServer.close(() => process.exit(0));
});

// Catch uncaught errors so the service never crashes (PRD: data integrity
// surface failures, but the streaming service should self-heal).
process.on("uncaughtException", (e: Error) => {
  console.error(`[ws-prices] uncaughtException: ${e.message}\n${e.stack ?? ""}`);
});
process.on("unhandledRejection", (e: unknown) => {
  console.error(`[ws-prices] unhandledRejection: ${e instanceof Error ? e.message : String(e)}`);
});

// Swallow SIGPIPE — writing to a closed socket (client disconnect mid-tick
// or Binance WS hiccup) would otherwise kill the daemon via SIGPIPE. We
// rely on the per-socket error/close handlers instead.
process.on("SIGPIPE", () => {
  /* swallow */
});
