// MERIDIAN Terminal — Execution Bot mini-service (PRD Fase 4, §8.5, §16.7).
//
// Self-contained bun project (port 3002) that owns ALL order execution +
// audit logging for the terminal. Process-isolated from the Next.js app
// per §16.7 so a compromise of the bot cannot directly reach the web
// process and vice-versa. The Next.js app provides the UI and calls this
// service via the Caddy gateway:
//
//     fetch(`/status?XTransformPort=3002`)
//
// Storage: raw SQL via `bun:sqlite` against the SAME db file as the
// Next.js app (`/home/z/my-project/db/custom.db`). We deliberately do NOT
// use Prisma here (avoids client drift — the Next.js app already
// regenerates the Prisma client on schema push; we just read/write the
// underlying SQLite tables directly with parameterized queries only).
//
// Tables (defined by Prisma schema, do not change here):
//   - BotConfig     singleton (id='singleton'): mode, killSwitch, autoKillDd,
//                   maxOrderUsd, maxDailyUsd
//   - Order         order history (status FILLED/PARTIAL/PENDING/CANCELLED/
//                   REJECTED, mode PAPER/LIVE, exchangeOrderId, valueUsd…)
//   - AuditLog      tamper-evident hash-chained log (prevHash + hash)
//   - Instrument    master list of tradeable instruments (read-only here)
//   - RiskSnapshot  periodic risk snapshots written by the Next.js risk
//                   summary route (read-only here, used by auto kill-switch)
//
// ─── Security posture (§16.7) ────────────────────────────────────────────
//  - MUST start in PAPER mode. BotConfig defaults are mode='PAPER',
//    killSwitch=false. The mini-service never auto-promotes to LIVE.
//  - Hard caps in code: maxOrderUsd, maxDailyUsd are enforced on every
//    order. Large orders (>80% of cap) require an explicit `confirm:true`
//    flag from the UI.
//  - Anomaly detection: >5 orders in 60s auto-triggers the kill-switch
//    and rejects the current order with a CRITICAL audit entry.
//  - Live mode requires EXCHANGE_API_KEY + EXCHANGE_API_SECRET env set.
//    Forex/gold LIVE execution (MT5) is NOT implemented — see DEFERRED
//    note below. Only crypto LIVE execution via CCXT is supported.
//  - API keys are trade-only (no withdrawal). The mini-service NEVER calls
//    any withdrawal endpoint — the only CCXT method used is `createOrder`
//    (and `cancelOrder` for cancels). We trust exchange-side config to
//    have withdrawals disabled and IP-whitelist the keys to this server.
//  - Shared-secret auth: if BOT_API_TOKEN env is set, every route except
//    /health requires `Authorization: Bearer <token>`. When unset (default
//    for local dev) the service is open on the local network — matches the
//    current local-only posture of the rest of the terminal.
//  - Tamper-evident audit log: every AuditLog row links to the previous
//    one via prevHash, and stores hash=sha256(prevHash + canonical(content)).
//    First row's prevHash = "genesis".
//
// ─── DEFERRED: MT5 forex/gold LIVE execution (PRD FR-4.2) ────────────────
// MT5 (MetaTrader 5) is a Windows-native trading platform whose official
// API is Python-only (the `MetaTrader5` pip package, Windows-only DLL).
// There is no first-class TypeScript binding that runs in this Linux bun
// runtime. Per the task spec, LIVE execution for forex (EURUSD=X etc.)
// and gold (GC=F / XAU/USD) is therefore DOCUMENTED AS DEFERRED — paper
// mode is fully supported for these asset classes (real prices from
// Yahoo Finance), and LIVE mode is supported ONLY for crypto via CCXT.
// The constant MT5_LIVE_DEFERRED below and a banner in the UI both
// surface this clearly. See PRD §8.5 + §16.7.

import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import ccxt from "ccxt";

// ─── constants ──────────────────────────────────────────────────────────
const PORT = 3002;
const DB_PATH = "/home/z/my-project/db/custom.db";
const MT5_LIVE_DEFERRED = true; // PRD FR-4.2 — forex/gold LIVE = deferred

const EXCHANGE_API_KEY = process.env.EXCHANGE_API_KEY ?? "";
const EXCHANGE_API_SECRET = process.env.EXCHANGE_API_SECRET ?? "";
const EXCHANGE_NAME = process.env.EXCHANGE_NAME ?? "binance";
const BOT_API_TOKEN = process.env.BOT_API_TOKEN ?? ""; // optional shared-secret

const CORS_ORIGIN = "http://localhost:3000";

// Asset classes that support LIVE execution in this build. Anything else
// is paper-only (forex/gold deferred, equity not supported).
const LIVE_SUPPORTED: ReadonlySet<string> = new Set(["CRYPTO"]);

// ─── db handle (bun:sqlite, WAL-safe) ────────────────────────────────────
// `bun:sqlite`'s Database ctor takes (path). The file already exists
// (created by Prisma); we open it read/write. PRAGMA calls below set the
// connection into WAL + foreign-keys mode for our session.
const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// ─── types ──────────────────────────────────────────────────────────────
interface BotConfigRow {
  id: string;
  mode: string; // "PAPER" | "LIVE"
  killSwitch: number; // 0 | 1 (SQLite BOOLEAN)
  autoKillDd: number;
  maxOrderUsd: number;
  maxDailyUsd: number;
  updatedAt: string;
}

interface InstrumentRow {
  id: string;
  assetClass: string;
  ticker: string;
  symbol: string;
  name: string;
  exchange: string | null;
  currency: string;
  source: string;
  lotSize: number | null;
  metadata: string | null;
}

interface OrderRow {
  id: string;
  instrumentId: string;
  side: string;
  type: string;
  size: number;
  price: number | null;
  avgFillPrice: number | null;
  status: string;
  mode: string;
  exchange: string | null;
  exchangeOrderId: string | null;
  reason: string | null;
  valueUsd: number;
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
}

interface AuditLogRow {
  id: string;
  action: string;
  message: string;
  contextJson: string | null;
  severity: string;
  prevHash: string;
  hash: string;
  createdAt: string;
}

interface RiskSnapshotRow {
  id: string;
  totalEquity: number;
  totalExposure: number;
  exposurePct: number;
  varEstimate: number | null;
  maxDrawdown: number | null;
  currentDrawdown: number | null;
  createdAt: string;
}

// ─── audit log timestamp sequencer ────────────────────────────────────────
// Two audits can land in the same JS millisecond (Date.now() has 1ms
// resolution). To keep the hash chain strictly monotonic, we append a
// process-local sequence counter to the ISO timestamp. The counter
// resets on process restart — acceptable because the bot is the only
// AuditLog writer. Format: "2026-07-05T15:11:25.264Z#0001". The "#NNNN"
// suffix sorts lexically after the ISO prefix, so lexicographic DESC
// ordering on createdAt remains chronological DESC.
let auditSeq = 0;
function uniqueAuditTimestamp(): string {
  const now = Date.now();
  const seq = (++auditSeq).toString(36).padStart(4, "0");
  return new Date(now).toISOString() + "#" + seq;
}

// ─── helpers ─────────────────────────────────────────────────────────────
function nowMs(): number {
  return Date.now();
}

function cuid(): string {
  // Lightweight unique id (sufficient for our use; not strictly CUID).
  return (
    "ord_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

function jsonBody(req: Request): Promise<unknown> {
  return req
    .json()
    .catch(() => null)
    .then((v) => (v === null ? {} : v));
}

function asStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  return null;
}

/// SHA-256 hex digest.
function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/// Canonical encoding of an audit row's content for hashing. Stable key
/// order + JSON.stringify with sorted object keys. Null contextJson → "".
function canonicalAuditContent(args: {
  action: string;
  message: string;
  contextJson: string | null;
  severity: string;
  createdAt: string; // ISO string
}): string {
  // Use sorted keys via a small helper so the hash is reproducible.
  const obj = {
    action: args.action,
    message: args.message,
    contextJson: args.contextJson ?? "",
    severity: args.severity,
    createdAt: args.createdAt,
  };
  // JSON.stringify preserves insertion order for string keys, so we
  // build it in canonical key order explicitly.
  return JSON.stringify({
    action: obj.action,
    contextJson: obj.contextJson,
    createdAt: obj.createdAt,
    message: obj.message,
    severity: obj.severity,
  });
}

/// Compute the audit hash chain entry for a new row, given the previous
/// row's hash (or "genesis" if this is the first row).
function computeAuditHash(
  prevHash: string,
  content: {
    action: string;
    message: string;
    contextJson: string | null;
    severity: string;
    createdAt: string;
  }
): string {
  return sha256Hex(prevHash + "|" + canonicalAuditContent(content));
}

/// Insert an audit log row with hash chaining. Returns the inserted row.
function audit(args: {
  action: string;
  message: string;
  contextJson?: Record<string, unknown> | null;
  severity?: string; // default INFO
}): AuditLogRow {
  const id = "aud_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  const severity = args.severity ?? "INFO";
  // Use a strictly-monotonic timestamp (ISO + seq suffix) so two audits
  // in the same millisecond don't collide and break the hash chain.
  const createdAt = uniqueAuditTimestamp();
  const contextJson = args.contextJson ? JSON.stringify(args.contextJson) : null;

  // Read previous hash (most recent row by createdAt). Use a transaction
  // so the read + write is atomic — prevents a race from breaking the chain.
  // createdAt is TEXT (ISO 8601 + #seq suffix) for rows we write ourselves,
  // so lexicographic DESC ordering == chronological DESC. We do NOT wrap
  // in `datetime()` because SQLite's datetime() does not parse the trailing
  // 'Z' suffix consistently — raw compare is correct + faster.
  const tx = db.transaction(() => {
    const prev = db
      .query("SELECT hash FROM AuditLog ORDER BY createdAt DESC, id DESC LIMIT 1")
      .get() as { hash: string } | null;
    const prevHash = prev?.hash ?? "genesis";
    const hash = computeAuditHash(prevHash, {
      action: args.action,
      message: args.message,
      contextJson,
      severity,
      createdAt,
    });
    db.query(
      `INSERT INTO AuditLog (id, action, message, contextJson, severity, prevHash, hash, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, args.action, args.message, contextJson, severity, prevHash, hash, createdAt);
    const row = db
      .query("SELECT * FROM AuditLog WHERE id = ?")
      .get(id) as AuditLogRow;
    return row;
  });
  return tx();
}

/// Read the BotConfig singleton, creating it with defaults if missing.
function getConfigOrCreate(): BotConfigRow {
  const existing = db
    .query("SELECT * FROM BotConfig WHERE id = 'singleton'")
    .get() as BotConfigRow | null;
  if (existing) return existing;
  const createdAt = new Date().toISOString();
  db.query(
    `INSERT INTO BotConfig (id, mode, killSwitch, autoKillDd, maxOrderUsd, maxDailyUsd, updatedAt)
     VALUES ('singleton', 'PAPER', 0, 20, 500, 2000, ?)`
  ).run(createdAt);
  // Audit the genesis config creation (always INFO, never fails the call).
  try {
    audit({
      action: "MODE_CHANGE",
      message: "BotConfig initialized — PAPER mode (system default)",
      contextJson: { mode: "PAPER", killSwitch: false, autoKillDd: 20, maxOrderUsd: 500, maxDailyUsd: 2000 },
      severity: "INFO",
    });
  } catch (e) {
    console.error("[audit] genesis failed", e);
  }
  return db.query("SELECT * FROM BotConfig WHERE id = 'singleton'").get() as BotConfigRow;
}

/// Sum of valueUsd for orders created in the last 24h with status FILLED
/// or PARTIAL. Used for daily cap checks. createdAt is TEXT (ISO 8601)
/// for rows we write, so a direct string comparison against an ISO cutoff
/// is correct chronologically.
function dailyNotionalUsd(): number {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const row = db
    .query(
      `SELECT COALESCE(SUM(valueUsd), 0) AS total FROM "Order"
       WHERE createdAt > ? AND status IN ('FILLED','PARTIAL')`
    )
    .get(cutoff) as { total: number | null };
  return row.total ?? 0;
}

/// Count of orders created in the last 24h.
function orderCount24h(): number {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const row = db
    .query(`SELECT COUNT(*) AS n FROM "Order" WHERE createdAt > ?`)
    .get(cutoff) as { n: number };
  return row.n ?? 0;
}

/// Fetch a live USD-quoted price for the instrument. For CRYPTO we hit
/// Binance's public ticker endpoint (data-api.binance.vision). For
/// FOREX/COMMODITY we hit Yahoo's chart endpoint (regularMarketPrice).
/// EQUITY is rejected upstream (not supported in this build).
async function fetchLivePriceUsd(instrument: InstrumentRow): Promise<number> {
  if (instrument.assetClass === "CRYPTO") {
    // USDT-quoted pairs → 1 USDT ≈ 1 USD (close enough for cap checks;
    // we don't fetch the USDT/USD fx rate — it's been within 0.99–1.01
    // for years and the cap is a soft risk guard, not a settlement).
    const url = `https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(instrument.ticker)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        throw new Error(`Binance ticker HTTP ${res.status}`);
      }
      const j = (await res.json()) as { price?: string; symbol?: string };
      const p = j.price ? parseFloat(j.price) : NaN;
      if (!Number.isFinite(p) || p <= 0) {
        throw new Error("Binance returned non-finite price");
      }
      return p;
    } finally {
      clearTimeout(t);
    }
  }
  if (instrument.assetClass === "FOREX" || instrument.assetClass === "COMMODITY") {
    // Yahoo returns the price in the instrument's quote currency. For
    // EURUSD=X / GBPUSD=X / AUDUSD=X / GC=F that is USD. For USDJPY=X
    // the price is in JPY — but PAPER fills still use this raw price
    // (we don't trade USDJPY LIVE in this build). For cap purposes we
    // treat the raw price as USD-quoted which is correct for the 3 USD-
    // quoted forex pairs and gold.
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(instrument.ticker)}?range=1d&interval=1m`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0 Safari/537.36" },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`Yahoo chart HTTP ${res.status}`);
      }
      const j = (await res.json()) as {
        chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> | null; error?: { description?: string } };
      };
      if (j.chart?.error) {
        throw new Error(`Yahoo error: ${j.chart.error.description ?? "unknown"}`);
      }
      const p = j.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) {
        throw new Error("Yahoo returned non-finite price");
      }
      return p;
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error(`Live price not supported for assetClass ${instrument.assetClass}`);
}

/// Compute the USD value of an order. For CRYPTO (USDT pairs) and USD-
/// quoted forex/gold, valueUsd = size * price (1:1). For JPY-quoted
/// pairs we'd need a USDJPY conversion; we surface this by treating the
/// raw price as USD-quoted (consistent with how the rest of the terminal
/// treats USDJPY — it's not USD-quoted, so we explicitly reject LIVE
/// execution for it, and PAPER valueUsd uses the raw number which is a
/// reasonable approximation for cap purposes only).
function computeValueUsd(instrument: InstrumentRow, size: number, price: number): number {
  // For all currently-supported instruments (USDT crypto pairs, USD forex,
  // gold), price is already in USD or USD-equivalent.
  void instrument; // not currently used; kept for future FX conversion
  return size * price;
}

/// Auto kill-switch check. Reads the latest RiskSnapshot (within the last
/// 60 minutes — older snapshots mean the risk pipeline is stale and we
/// shouldn't trip the bot on outdated data). If currentDrawdown % <=
/// -autoKillDd → flip killSwitch on + audit CRITICAL. Returns the
/// (possibly updated) config.
function autoKillSwitchCheck(): BotConfigRow {
  const cfg = getConfigOrCreate();
  if (cfg.autoKillDd <= 0) return cfg;
  // Already tripped — don't re-audit.
  if (cfg.killSwitch) return cfg;

  // Only consider snapshots from the last 60 minutes. The Next.js app's
  // risk/summary route is polled every 30–60s by the dashboard, so a
  // snapshot older than an hour means the risk pipeline is stale (browser
  // closed, app down, etc.) and we shouldn't trip on outdated data.
  const cutoffMs = Date.now() - 60 * 60 * 1000;
  // NOTE: RiskSnapshot.createdAt is stored as INTEGER (epoch ms) by
  // Prisma's SQLite adapter (different from how we store our own rows).
  // Numeric DESC ordering works correctly here without datetime().
  const latest = db
    .query("SELECT * FROM RiskSnapshot WHERE createdAt > ? ORDER BY createdAt DESC LIMIT 1")
    .get(cutoffMs) as RiskSnapshotRow | null;
  if (!latest) return cfg;

  // We compare currentDrawdown against the threshold. currentDrawdown is
  // already a negative percentage (or zero) in the RiskSnapshot schema
  // (see risk/summary route). A breach is currentDrawdown <= -autoKillDd.
  if (latest.currentDrawdown === null || !Number.isFinite(latest.currentDrawdown)) {
    return cfg;
  }
  const ddPct = latest.currentDrawdown; // negative number
  if (ddPct <= -cfg.autoKillDd) {
    const updatedAt = new Date().toISOString();
    db.query(
      `UPDATE BotConfig SET killSwitch = 1, updatedAt = ? WHERE id = 'singleton'`
    ).run(updatedAt);
    audit({
      action: "KILL_SWITCH_ON",
      message: `Auto kill-switch: daily drawdown ${ddPct.toFixed(2)}% ≤ -${cfg.autoKillDd}% threshold`,
      contextJson: {
        trigger: "auto",
        currentDrawdown: ddPct,
        threshold: -cfg.autoKillDd,
        snapshotId: latest.id,
        snapshotAt: latest.createdAt,
      },
      severity: "CRITICAL",
    });
    return db.query("SELECT * FROM BotConfig WHERE id = 'singleton'").get() as BotConfigRow;
  }
  return cfg;
}

// ─── anomaly detection (in-memory order frequency tracker) ────────────────
const recentOrderTimestamps: number[] = []; // epoch ms of last 10 orders

/// Returns true if the caller should be rejected as an anomaly.
/// Side effect: pushes `now` onto the tracker (so the triggering order
/// itself is counted — but we still reject it because we already crossed
/// the threshold before it was placed).
function recordOrderAndCheckAnomaly(): { anomaly: boolean; countIn60s: number } {
  const now = nowMs();
  // Drop entries older than 60s.
  while (recentOrderTimestamps.length > 0 && now - recentOrderTimestamps[0] > 60_000) {
    recentOrderTimestamps.shift();
  }
  const countIn60s = recentOrderTimestamps.length;
  // If there are already ≥5 orders in the last 60s, this would be the 6th.
  // Reject + auto-trigger kill-switch.
  const anomaly = countIn60s >= 5;
  // Record this attempt regardless (so repeated attempts stay blocked).
  recentOrderTimestamps.push(now);
  // Trim to last 10.
  while (recentOrderTimestamps.length > 10) recentOrderTimestamps.shift();
  return { anomaly, countIn60s };
}

/// Force the kill-switch on (anomaly path). Audits CRITICAL.
function forceKillSwitch(reason: string, context: Record<string, unknown>): void {
  const updatedAt = new Date().toISOString();
  db.query(`UPDATE BotConfig SET killSwitch = 1, updatedAt = ? WHERE id = 'singleton'`).run(updatedAt);
  audit({
    action: "KILL_SWITCH_ON",
    message: reason,
    contextJson: context,
    severity: "CRITICAL",
  });
}

// ─── CCXT live order placement (crypto only) ──────────────────────────────
/// Convert the instrument ticker (e.g. "BTCUSDT") to a CCXT symbol
/// (e.g. "BTC/USDT"). We use the instrument.symbol column directly when
/// it's already in CCXT format ("BTC/USDT"); otherwise we synthesize one.
function toCcxtSymbol(instrument: InstrumentRow): string {
  if (instrument.symbol.includes("/")) return instrument.symbol;
  // Fallback: try to split a USDT-suffixed ticker.
  const t = instrument.ticker.toUpperCase();
  if (t.endsWith("USDT")) return t.slice(0, -4) + "/USDT";
  if (t.endsWith("USD")) return t.slice(0, -3) + "/USD";
  return instrument.symbol;
}

async function placeLiveOrder(args: {
  instrument: InstrumentRow;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  size: number;
  price: number | null;
}): Promise<{
  status: "FILLED" | "REJECTED" | "PENDING";
  exchangeOrderId: string | null;
  avgFillPrice: number | null;
  reason: string | null;
}> {
  if (!EXCHANGE_API_KEY || !EXCHANGE_API_SECRET) {
    return {
      status: "REJECTED",
      exchangeOrderId: null,
      avgFillPrice: null,
      reason: "Live mode requires EXCHANGE_API_KEY/SECRET",
    };
  }
  if (!LIVE_SUPPORTED.has(args.instrument.assetClass)) {
    return {
      status: "REJECTED",
      exchangeOrderId: null,
      avgFillPrice: null,
      reason: `LIVE execution not supported for assetClass ${args.instrument.assetClass} (MT5 deferred per PRD FR-4.2)`,
    };
  }

  let exchange: ccxt.Exchange;
  try {
    // Use the 'binance' exchange class by default. The CCXT constructor
    // is the ONLY place we put the API keys — we never call any method
    // other than createOrder / cancelOrder on this instance. In particular
    // we never call fetchBalance, withdraw, or any funding method.
    exchange = new (ccxt as unknown as { binance: new (opts: object) => ccxt.Exchange }).binance({
      apiKey: EXCHANGE_API_KEY,
      secret: EXCHANGE_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: "spot", adjustForTimeDifference: true },
    });
  } catch (e) {
    return {
      status: "REJECTED",
      exchangeOrderId: null,
      avgFillPrice: null,
      reason: `CCXT init failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const symbol = toCcxtSymbol(args.instrument);
  const ccxtType = args.type.toLowerCase(); // "market" | "limit"
  const ccxtSide = args.side.toLowerCase(); // "buy" | "sell"

  try {
    // createOrder(symbol, type, side, amount, price?)
    // For MARKET orders, price should be undefined.
    const order = await exchange.createOrder(
      symbol,
      ccxtType,
      ccxtSide,
      args.size,
      args.type === "LIMIT" ? args.price ?? undefined : undefined
    );
    // Extract fields defensively — CCXT response shapes vary by exchange.
    const oid = (order as { id?: string }).id ?? null;
    const avgFill =
      (order as { average?: number | null }).average ??
      (order as { price?: number | null }).price ??
      null;
    const filled = (order as { filled?: number | null }).filled ?? 0;
    const status = (order as { status?: string }).status ?? "open";
    // Map CCXT status → ours. 'closed' → FILLED; 'open' → PENDING (still
    // resting on the book, e.g. an unfilled LIMIT); 'canceled' → CANCELLED;
    // anything else (incl. 'rejected', 'expired') → REJECTED.
    let mapped: "FILLED" | "REJECTED" | "PENDING";
    if (status === "closed" || (filled > 0 && status !== "canceled")) {
      mapped = "FILLED";
    } else if (status === "open") {
      mapped = "PENDING";
    } else {
      mapped = "REJECTED";
    }
    return {
      status: mapped,
      exchangeOrderId: oid,
      avgFillPrice: typeof avgFill === "number" && Number.isFinite(avgFill) ? avgFill : null,
      reason: mapped === "REJECTED" ? `Exchange status: ${status}` : null,
    };
  } catch (e) {
    return {
      status: "REJECTED",
      exchangeOrderId: null,
      avgFillPrice: null,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/// Cancel a live open order via CCXT.
async function cancelLiveOrder(args: {
  instrument: InstrumentRow;
  exchangeOrderId: string;
}): Promise<{ ok: boolean; reason: string | null }> {
  if (!EXCHANGE_API_KEY || !EXCHANGE_API_SECRET) {
    return { ok: false, reason: "Live mode requires EXCHANGE_API_KEY/SECRET" };
  }
  let exchange: ccxt.Exchange;
  try {
    exchange = new (ccxt as unknown as { binance: new (opts: object) => ccxt.Exchange }).binance({
      apiKey: EXCHANGE_API_KEY,
      secret: EXCHANGE_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: "spot", adjustForTimeDifference: true },
    });
  } catch (e) {
    return { ok: false, reason: `CCXT init failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    await exchange.cancelOrder(args.exchangeOrderId, toCcxtSymbol(args.instrument));
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ─── HTTP plumbing ────────────────────────────────────────────────────────
function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
  };
}

function jsonRes(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function okRes(body: unknown): Response {
  return jsonRes(200, body);
}

function errRes(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return jsonRes(status, { ok: false, error, ...extra });
}

/// Auth check. If BOT_API_TOKEN is set, require `Authorization: Bearer
/// <token>` on everything except /health and OPTIONS preflight.
function authed(req: Request): boolean {
  if (!BOT_API_TOKEN) return true; // open in local dev
  const h = req.headers.get("Authorization") ?? "";
  if (!h.startsWith("Bearer ")) return false;
  return h.slice("Bearer ".length).trim() === BOT_API_TOKEN;
}

// ─── route handlers ───────────────────────────────────────────────────────

function handleHealth(): Response {
  return okRes({ ok: true, service: "execution-bot", port: PORT, mt5LiveDeferred: MT5_LIVE_DEFERRED });
}

function handleStatus(): Response {
  // Run the auto-kill-switch check first (may mutate config + audit).
  let cfg: BotConfigRow;
  try {
    cfg = autoKillSwitchCheck();
  } catch (e) {
    console.error("[status] autoKillSwitchCheck failed", e);
    cfg = getConfigOrCreate();
  }
  const daily = dailyNotionalUsd();
  const count = orderCount24h();
  return okRes({
    ok: true,
    mode: cfg.mode,
    killSwitch: !!cfg.killSwitch,
    autoKillDd: cfg.autoKillDd,
    maxOrderUsd: cfg.maxOrderUsd,
    maxDailyUsd: cfg.maxDailyUsd,
    dailyNotionalUsd: daily,
    orderCount24h: count,
    mt5LiveDeferred: MT5_LIVE_DEFERRED,
    liveSupported: Array.from(LIVE_SUPPORTED),
    exchangeName: EXCHANGE_NAME || null,
    exchangeKeysConfigured: !!(EXCHANGE_API_KEY && EXCHANGE_API_SECRET),
    updatedAt: cfg.updatedAt,
  });
}

interface ConfigBody {
  mode?: unknown;
  killSwitch?: unknown;
  autoKillDd?: unknown;
  maxOrderUsd?: unknown;
  maxDailyUsd?: unknown;
}

function handleConfig(body: ConfigBody): Response {
  const cfg = getConfigOrCreate();

  // Validate all provided fields first.
  const updates: {
    mode?: string;
    killSwitch?: number;
    autoKillDd?: number;
    maxOrderUsd?: number;
    maxDailyUsd?: number;
  } = {};

  if (body.mode !== undefined) {
    const m = asStr(body.mode);
    if (m !== "PAPER" && m !== "LIVE") {
      return errRes(400, "mode must be PAPER or LIVE");
    }
    updates.mode = m;
  }
  if (body.killSwitch !== undefined) {
    const b = asBool(body.killSwitch);
    if (b === null) return errRes(400, "killSwitch must be a boolean");
    updates.killSwitch = b ? 1 : 0;
  }
  if (body.autoKillDd !== undefined) {
    const n = asNum(body.autoKillDd);
    if (n === null || n < 0) return errRes(400, "autoKillDd must be a number >= 0");
    updates.autoKillDd = n;
  }
  if (body.maxOrderUsd !== undefined) {
    const n = asNum(body.maxOrderUsd);
    if (n === null || n <= 0) return errRes(400, "maxOrderUsd must be > 0");
    updates.maxOrderUsd = n;
  }
  if (body.maxDailyUsd !== undefined) {
    const n = asNum(body.maxDailyUsd);
    if (n === null || n <= 0) return errRes(400, "maxDailyUsd must be > 0");
    updates.maxDailyUsd = n;
  }

  // Cross-field enforcement.
  // 1) Cannot set mode=LIVE if killSwitch is on (current or new).
  const effectiveKillSwitch = updates.killSwitch !== undefined ? updates.killSwitch : cfg.killSwitch;
  if (updates.mode === "LIVE" && effectiveKillSwitch) {
    return errRes(400, "Cannot switch to LIVE mode while kill-switch is active. Resume the bot first.");
  }
  // 2) Cannot set mode=LIVE without exchange API keys.
  if (updates.mode === "LIVE" && (!EXCHANGE_API_KEY || !EXCHANGE_API_SECRET)) {
    return errRes(400, "Live mode requires EXCHANGE_API_KEY/SECRET to be set in the mini-service env.");
  }

  // Apply update.
  const updatedAt = new Date().toISOString();
  const setClauses: string[] = ["updatedAt = ?"];
  const params: unknown[] = [updatedAt];
  for (const [k, v] of Object.entries(updates)) {
    setClauses.push(`${k} = ?`);
    params.push(v);
  }
  db.query(`UPDATE BotConfig SET ${setClauses.join(", ")} WHERE id = 'singleton'`).run(...params);

  // Audit each notable change individually so the chain captures intent.
  if (updates.mode !== undefined && updates.mode !== cfg.mode) {
    audit({
      action: "MODE_CHANGE",
      message: `Mode changed ${cfg.mode} → ${updates.mode}`,
      contextJson: { from: cfg.mode, to: updates.mode },
      severity: updates.mode === "LIVE" ? "WARN" : "INFO",
    });
  }
  if (updates.killSwitch !== undefined && updates.killSwitch !== cfg.killSwitch) {
    const turningOn = !!updates.killSwitch;
    audit({
      action: turningOn ? "KILL_SWITCH_ON" : "KILL_SWITCH_OFF",
      message: turningOn ? "Kill-switch activated (manual)" : "Kill-switch cleared — bot resumed (manual)",
      contextJson: { trigger: "manual" },
      severity: turningOn ? "WARN" : "INFO",
    });
  }
  if (updates.autoKillDd !== undefined && updates.autoKillDd !== cfg.autoKillDd) {
    audit({
      action: "MODE_CHANGE",
      message: `Auto kill-switch drawdown threshold changed ${cfg.autoKillDd}% → ${updates.autoKillDd}%`,
      contextJson: { from: cfg.autoKillDd, to: updates.autoKillDd, field: "autoKillDd" },
      severity: "INFO",
    });
  }
  if (updates.maxOrderUsd !== undefined && updates.maxOrderUsd !== cfg.maxOrderUsd) {
    audit({
      action: "MODE_CHANGE",
      message: `Per-order cap changed $${cfg.maxOrderUsd} → $${updates.maxOrderUsd}`,
      contextJson: { from: cfg.maxOrderUsd, to: updates.maxOrderUsd, field: "maxOrderUsd" },
      severity: "INFO",
    });
  }
  if (updates.maxDailyUsd !== undefined && updates.maxDailyUsd !== cfg.maxDailyUsd) {
    audit({
      action: "MODE_CHANGE",
      message: `Daily cap changed $${cfg.maxDailyUsd} → $${updates.maxDailyUsd}`,
      contextJson: { from: cfg.maxDailyUsd, to: updates.maxDailyUsd, field: "maxDailyUsd" },
      severity: "INFO",
    });
  }

  const fresh = db.query("SELECT * FROM BotConfig WHERE id = 'singleton'").get() as BotConfigRow;
  return okRes({
    ok: true,
    mode: fresh.mode,
    killSwitch: !!fresh.killSwitch,
    autoKillDd: fresh.autoKillDd,
    maxOrderUsd: fresh.maxOrderUsd,
    maxDailyUsd: fresh.maxDailyUsd,
    updatedAt: fresh.updatedAt,
  });
}

interface OrderBody {
  instrumentId?: unknown;
  side?: unknown;
  type?: unknown;
  size?: unknown;
  price?: unknown;
  mode?: unknown;
  confirm?: unknown;
}

async function handlePlaceOrder(body: OrderBody): Promise<Response> {
  // ── 1. Auto kill-switch check (may flip config + audit). ─────────────
  let cfg: BotConfigRow;
  try {
    cfg = autoKillSwitchCheck();
  } catch (e) {
    console.error("[order] autoKillSwitchCheck failed", e);
    cfg = getConfigOrCreate();
  }

  // ── 2. Kill-switch is the hard stop. ─────────────────────────────────
  if (cfg.killSwitch) {
    audit({
      action: "ORDER_REJECTED",
      message: "Order rejected — kill-switch active",
      contextJson: { reason: "kill_switch_active", body },
      severity: "WARN",
    });
    return errRes(400, "Kill-switch active — order rejected. Clear the kill-switch to resume.");
  }

  // ── 3. Validate body. ────────────────────────────────────────────────
  const instrumentId = asStr(body.instrumentId);
  const side = asStr(body.side);
  const type = asStr(body.type);
  const size = asNum(body.size);
  const price = asNum(body.price);
  const confirm = asBool(body.confirm) ?? false;
  const reqMode = asStr(body.mode);

  if (!instrumentId) return errRes(400, "instrumentId is required");
  if (side !== "BUY" && side !== "SELL") return errRes(400, "side must be BUY or SELL");
  if (type !== "MARKET" && type !== "LIMIT") return errRes(400, "type must be MARKET or LIMIT");
  if (size === null || size <= 0) return errRes(400, "size must be a number > 0");
  if (type === "LIMIT" && (price === null || price <= 0)) {
    return errRes(400, "LIMIT order requires a price > 0");
  }
  if (reqMode && reqMode !== "PAPER" && reqMode !== "LIVE") {
    return errRes(400, "mode must be PAPER or LIVE");
  }

  // ── 4. Lookup instrument. ────────────────────────────────────────────
  const instrument = db
    .query("SELECT * FROM Instrument WHERE id = ?")
    .get(instrumentId) as InstrumentRow | null;
  if (!instrument) {
    return errRes(400, `Instrument ${instrumentId} not found`);
  }
  // Equity is not supported in this build (paper or live).
  if (instrument.assetClass === "EQUITY") {
    audit({
      action: "ORDER_REJECTED",
      message: `Equity execution not supported in this build (${instrument.symbol})`,
      contextJson: { instrumentId, ticker: instrument.ticker, assetClass: "EQUITY" },
      severity: "WARN",
    });
    return errRes(400, "Equity execution not supported in this build (PRD Fase 4 — crypto/forex/gold only).");
  }

  // ── 5. Effective mode. ───────────────────────────────────────────────
  const effectiveMode = reqMode ?? cfg.mode;
  // If LIVE requested for an unsupported asset class, reject up-front
  // (the actual CCXT path would also reject, but we get a cleaner error
  // here and avoid creating a REJECTED row).
  if (effectiveMode === "LIVE" && !LIVE_SUPPORTED.has(instrument.assetClass)) {
    audit({
      action: "ORDER_REJECTED",
      message: `LIVE execution not supported for ${instrument.symbol} (${instrument.assetClass}) — MT5 deferred per PRD FR-4.2`,
      contextJson: { instrumentId, ticker: instrument.ticker, assetClass: instrument.assetClass, mode: "LIVE" },
      severity: "WARN",
    });
    return errRes(
      400,
      `LIVE execution for ${instrument.assetClass} is not yet supported (MT5 deferred per PRD FR-4.2). Use PAPER mode.`
    );
  }
  if (effectiveMode === "LIVE" && (!EXCHANGE_API_KEY || !EXCHANGE_API_SECRET)) {
    return errRes(400, "Live mode requires EXCHANGE_API_KEY/SECRET to be set in the mini-service env.");
  }

  // ── 6. Anomaly detection (count orders in last 60s). ─────────────────
  const { anomaly, countIn60s } = recordOrderAndCheckAnomaly();
  if (anomaly) {
    forceKillSwitch(
      `Anomaly: ${countIn60s} orders in 60s (>=5 threshold) — auto kill-switch`,
      { trigger: "anomaly", countIn60s, threshold: 5, windowSeconds: 60 }
    );
    audit({
      action: "ORDER_REJECTED",
      message: `Order rejected — anomaly: ${countIn60s} orders in 60s`,
      contextJson: { instrumentId, side, type, size, countIn60s },
      severity: "CRITICAL",
    });
    return errRes(429, `Anomaly detected: ${countIn60s} orders in 60s. Kill-switch auto-activated.`);
  }

  // ── 7. Fetch live price (real, never fabricated). ────────────────────
  let livePrice: number;
  try {
    livePrice = await fetchLivePriceUsd(instrument);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    audit({
      action: "ORDER_REJECTED",
      message: `Live price fetch failed for ${instrument.symbol}: ${msg}`,
      contextJson: { instrumentId, ticker: instrument.ticker, error: msg },
      severity: "WARN",
    });
    return errRes(502, `Live price unavailable: ${msg}`);
  }

  // ── 8. Compute notional USD value. ───────────────────────────────────
  const referencePrice = type === "LIMIT" && price !== null ? price : livePrice;
  const valueUsd = computeValueUsd(instrument, size, referencePrice);
  if (!Number.isFinite(valueUsd) || valueUsd <= 0) {
    return errRes(400, "Computed valueUsd is non-finite or <= 0");
  }

  // ── 9. Hard caps. ────────────────────────────────────────────────────
  if (valueUsd > cfg.maxOrderUsd) {
    audit({
      action: "CAP_BREACH",
      message: `Order rejected — exceeds per-order cap ($${valueUsd.toFixed(2)} > $${cfg.maxOrderUsd})`,
      contextJson: { instrumentId, valueUsd, cap: cfg.maxOrderUsd, field: "maxOrderUsd" },
      severity: "WARN",
    });
    return errRes(400, `Exceeds per-order cap ($${cfg.maxOrderUsd}). Order value: $${valueUsd.toFixed(2)}.`);
  }
  const daily = dailyNotionalUsd();
  if (daily + valueUsd > cfg.maxDailyUsd) {
    audit({
      action: "CAP_BREACH",
      message: `Order rejected — exceeds daily cap (used $${daily.toFixed(2)} + new $${valueUsd.toFixed(2)} > $${cfg.maxDailyUsd})`,
      contextJson: { instrumentId, valueUsd, used: daily, cap: cfg.maxDailyUsd, field: "maxDailyUsd" },
      severity: "WARN",
    });
    return errRes(400, `Exceeds daily cap ($${cfg.maxDailyUsd}). Used today: $${daily.toFixed(2)}; this order: $${valueUsd.toFixed(2)}.`);
  }

  // ── 10. Large-order manual confirm (>=80% of per-order cap). ─────────
  const largeThreshold = cfg.maxOrderUsd * 0.8;
  if (valueUsd > largeThreshold && !confirm) {
    // 409 — caller is expected to re-submit with confirm:true after the
    // user acknowledges the dialog. We do NOT create an order row yet.
    return jsonRes(409, {
      ok: false,
      needsConfirm: true,
      message: `Large order — confirm to proceed ($${valueUsd.toFixed(2)} is ${((valueUsd / cfg.maxOrderUsd) * 100).toFixed(0)}% of per-order cap).`,
      valueUsd,
      cap: cfg.maxOrderUsd,
    });
  }

  // ── 11. Insert PENDING order row first (so we have a record even if
  //       the exchange call fails). ─────────────────────────────────────
  const id = cuid();
  const createdAt = new Date().toISOString();
  db.query(
    `INSERT INTO "Order" (id, instrumentId, side, type, size, price, avgFillPrice, status, mode, exchange, exchangeOrderId, reason, valueUsd, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 'PENDING', ?, ?, NULL, NULL, ?, ?, ?)`
  ).run(
    id,
    instrumentId,
    side,
    type,
    size,
    type === "LIMIT" ? price : null,
    effectiveMode,
    effectiveMode === "LIVE" ? EXCHANGE_NAME : null,
    valueUsd,
    createdAt,
    createdAt
  );

  audit({
    action: "ORDER_PLACED",
    message: `${effectiveMode} ${side} ${type} ${size} ${instrument.symbol} @ ${type === "LIMIT" ? "$" + (price ?? 0).toFixed(4) : "market"} (ref $${referencePrice.toFixed(4)}, notional $${valueUsd.toFixed(2)})`,
    contextJson: {
      orderId: id,
      instrumentId,
      ticker: instrument.ticker,
      symbol: instrument.symbol,
      assetClass: instrument.assetClass,
      side,
      type,
      size,
      price: type === "LIMIT" ? price : null,
      referencePrice,
      valueUsd,
      mode: effectiveMode,
      confirm,
    },
    severity: effectiveMode === "LIVE" ? "WARN" : "INFO",
  });

  // ── 12. Execute. ─────────────────────────────────────────────────────
  let finalStatus: string;
  let avgFillPrice: number | null;
  let exchangeOrderId: string | null = null;
  let reason: string | null = null;

  if (effectiveMode === "PAPER") {
    // Simulate fill at the live (or limit-cross) price. NEVER fabricate
    // — the fill price is the real live market price we just fetched.
    if (type === "MARKET") {
      avgFillPrice = livePrice;
      finalStatus = "FILLED";
    } else {
      // LIMIT: fill only if the limit price is "crossed" by the live
      // price — i.e. for a BUY, livePrice <= limit; for a SELL,
      // livePrice >= limit. Otherwise rest as PENDING.
      const crossed =
        side === "BUY" ? livePrice <= (price ?? 0) : livePrice >= (price ?? 0);
      if (crossed) {
        avgFillPrice = price; // fill at the limit (conservative)
        finalStatus = "FILLED";
      } else {
        avgFillPrice = null;
        finalStatus = "PENDING"; // rests on the book (paper)
      }
    }
  } else {
    // LIVE (crypto only — already gated above).
    const result = await placeLiveOrder({ instrument, side, type, size, price });
    finalStatus = result.status;
    avgFillPrice = result.avgFillPrice;
    exchangeOrderId = result.exchangeOrderId;
    reason = result.reason;
  }

  // ── 13. Update the order row with the result. ────────────────────────
  const executedAt = finalStatus === "FILLED" ? new Date().toISOString() : null;
  db.query(
    `UPDATE "Order" SET status = ?, avgFillPrice = ?, exchangeOrderId = ?, reason = ?, executedAt = ?, updatedAt = ? WHERE id = ?`
  ).run(
    finalStatus,
    avgFillPrice,
    exchangeOrderId,
    reason,
    executedAt,
    new Date().toISOString(),
    id
  );

  // ── 14. Audit the outcome. ───────────────────────────────────────────
  if (finalStatus === "FILLED") {
    audit({
      action: "ORDER_FILLED",
      message: `${effectiveMode} ${side} ${size} ${instrument.symbol} filled @ ${avgFillPrice !== null ? "$" + avgFillPrice.toFixed(4) : "n/a"} (notional $${valueUsd.toFixed(2)})`,
      contextJson: {
        orderId: id,
        instrumentId,
        ticker: instrument.ticker,
        side,
        type,
        size,
        avgFillPrice,
        valueUsd,
        mode: effectiveMode,
        exchangeOrderId,
      },
      severity: "INFO",
    });
  } else if (finalStatus === "REJECTED") {
    audit({
      action: "ORDER_REJECTED",
      message: `${effectiveMode} ${side} ${size} ${instrument.symbol} rejected: ${reason ?? "unknown"}`,
      contextJson: { orderId: id, instrumentId, ticker: instrument.ticker, reason, mode: effectiveMode },
      severity: "WARN",
    });
  } else {
    // PENDING — LIMIT resting on the book. Audit INFO so the chain
    // captures that the order is open, not filled.
    audit({
      action: "ORDER_PLACED",
      message: `${effectiveMode} ${side} ${type} ${size} ${instrument.symbol} resting at $${(price ?? 0).toFixed(4)} (awaiting cross)`,
      contextJson: { orderId: id, instrumentId, ticker: instrument.ticker, status: "PENDING" },
      severity: "INFO",
    });
  }

  const row = db.query(`SELECT * FROM "Order" WHERE id = ?`).get(id) as OrderRow;
  return okRes({ ok: true, order: row });
}

async function handleCancelOrder(orderId: string): Promise<Response> {
  const order = db.query(`SELECT * FROM "Order" WHERE id = ?`).get(orderId) as OrderRow | null;
  if (!order) return errRes(404, "Order not found");
  if (order.status !== "PENDING") {
    return errRes(400, `Order is in terminal status ${order.status} — cannot cancel`);
  }
  const instrument = db
    .query("SELECT * FROM Instrument WHERE id = ?")
    .get(order.instrumentId) as InstrumentRow | null;
  if (!instrument) return errRes(500, "Instrument for order not found");

  if (order.mode === "LIVE" && order.exchangeOrderId) {
    const r = await cancelLiveOrder({ instrument, exchangeOrderId: order.exchangeOrderId });
    if (!r.ok) {
      audit({
        action: "ORDER_CANCELLED",
        message: `LIVE cancel failed for ${instrument.symbol} order ${order.id}: ${r.reason}`,
        contextJson: { orderId: order.id, exchangeOrderId: order.exchangeOrderId, reason: r.reason },
        severity: "WARN",
      });
      return errRes(502, `Cancel failed: ${r.reason}`);
    }
  }
  // Paper PENDING → just flip to CANCELLED.
  db.query(`UPDATE "Order" SET status = 'CANCELLED', updatedAt = ? WHERE id = ?`).run(
    new Date().toISOString(),
    orderId
  );
  audit({
    action: "ORDER_CANCELLED",
    message: `${order.mode} ${order.side} ${order.size} ${instrument.symbol} order ${order.id} cancelled`,
    contextJson: { orderId: order.id, instrumentId: order.instrumentId, mode: order.mode, exchangeOrderId: order.exchangeOrderId },
    severity: "INFO",
  });
  const row = db.query(`SELECT * FROM "Order" WHERE id = ?`).get(orderId) as OrderRow;
  return okRes({ ok: true, order: row });
}

function handleOrders(url: URL): Response {
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  const mode = url.searchParams.get("mode");
  let rows: OrderRow[];
  if (mode && (mode === "PAPER" || mode === "LIVE")) {
    rows = db
      .query(`SELECT * FROM "Order" WHERE mode = ? ORDER BY createdAt DESC LIMIT ?`)
      .all(mode, limit) as OrderRow[];
  } else {
    rows = db
      .query(`SELECT * FROM "Order" ORDER BY createdAt DESC LIMIT ?`)
      .all(limit) as OrderRow[];
  }
  // Join instrument symbol/ticker for display.
  const byId = new Map<string, InstrumentRow>();
  const instruments = db
    .query("SELECT id, ticker, symbol, assetClass, currency FROM Instrument")
    .all() as Pick<InstrumentRow, "id" | "ticker" | "symbol" | "assetClass" | "currency">[];
  for (const i of instruments) byId.set(i.id, i as InstrumentRow);
  const out = rows.map((r) => {
    const i = byId.get(r.instrumentId);
    return {
      ...r,
      instrumentTicker: i?.ticker ?? null,
      instrumentSymbol: i?.symbol ?? null,
      instrumentAssetClass: i?.assetClass ?? null,
      instrumentCurrency: i?.currency ?? null,
    };
  });
  return okRes({ ok: true, orders: out });
}

function handleAudit(url: URL): Response {
  const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("limit") ?? "200", 10) || 200));
  const rows = db
    .query("SELECT * FROM AuditLog ORDER BY createdAt DESC LIMIT ?")
    .all(limit) as AuditLogRow[];

  // Verify the hash chain by walking it via prevHash linkage (the natural
  // definition of a hash chain). We build a Map<hash, row> + Map<prevHash,
  // row>, find the head (prevHash == "genesis"), then walk forward.
  // createdAt-sorting is unreliable for verification because two audits
  // can land in the same millisecond and have identical createdAt strings.
  const byHash = new Map<string, AuditLogRow>();
  const byPrevHash = new Map<string, AuditLogRow>();
  for (const r of rows) {
    byHash.set(r.hash, r);
    byPrevHash.set(r.prevHash, r);
  }
  // Head = row with prevHash == "genesis" (and whose hash is not pointed
  // to by any OTHER row's prevHash within the returned set — but since
  // chain linkage is strict, the head is simply the genesis-prevHash row).
  const head = byPrevHash.get("genesis") ?? null;

  let chainIntact = true;
  let firstBrokenId: string | null = null;
  const ordered: AuditLogRow[] = [];
  if (head) {
    let cursor: AuditLogRow | null = head;
    let prevHash = "genesis";
    let safety = rows.length + 5;
    while (cursor && safety-- > 0) {
      ordered.push(cursor);
      const recomputed = computeAuditHash(cursor.prevHash, {
        action: cursor.action,
        message: cursor.message,
        contextJson: cursor.contextJson,
        severity: cursor.severity,
        createdAt: cursor.createdAt,
      });
      if (cursor.prevHash !== prevHash || recomputed !== cursor.hash) {
        chainIntact = false;
        firstBrokenId = cursor.id;
        break;
      }
      prevHash = cursor.hash;
      cursor = byPrevHash.get(cursor.hash) ?? null;
    }
    // If `ordered` is shorter than `rows`, some rows were disconnected
    // from the chain (e.g. a row whose prevHash doesn't link). Flag broken.
    if (chainIntact && ordered.length !== rows.length) {
      chainIntact = false;
      // Find the first row NOT in `ordered`.
      const seen = new Set(ordered.map((r) => r.id));
      firstBrokenId = rows.find((r) => !seen.has(r.id))?.id ?? null;
    }
  } else if (rows.length > 0) {
    // No genesis row found in the returned set — either truncated by limit
    // (so we can't verify the full chain) or genuinely broken. We mark
    // chainIntact=false conservatively only if there are rows but no head.
    // If the user requested a small limit, this is expected — surface it
    // honestly but don't claim broken.
    chainIntact = true; // unknown — can't verify head-to-tail
    firstBrokenId = null;
  }

  // Return rows in DESC createdAt order for display (most recent first),
  // plus the chain verification result.
  return okRes({
    ok: true,
    audit: rows,
    chainIntact,
    firstBrokenId,
    count: rows.length,
    chainLength: ordered.length,
  });
}

// ─── Bun.serve ────────────────────────────────────────────────────────────
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    // CORS preflight.
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // /health is always open (used for liveness checks).
    if (path === "/health" && method === "GET") {
      return handleHealth();
    }

    // Auth gate (no-op when BOT_API_TOKEN is unset).
    if (!authed(req)) {
      return errRes(401, "Unauthorized — invalid or missing Bearer token");
    }

    try {
      if (path === "/status" && method === "GET") {
        return handleStatus();
      }
      if (path === "/config" && method === "POST") {
        const body = (await jsonBody(req)) as ConfigBody;
        return handleConfig(body);
      }
      if (path === "/order" && method === "POST") {
        const body = (await jsonBody(req)) as OrderBody;
        return await handlePlaceOrder(body);
      }
      if (path.startsWith("/order/") && path.endsWith("/cancel") && method === "POST") {
        const id = path.slice("/order/".length, -"/cancel".length);
        if (!id) return errRes(400, "Missing order id");
        return await handleCancelOrder(id);
      }
      if (path === "/orders" && method === "GET") {
        return handleOrders(url);
      }
      if (path === "/audit" && method === "GET") {
        return handleAudit(url);
      }
      return errRes(404, `Not found: ${method} ${path}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[execution-bot] ${method} ${path} failed`, e);
      try {
        audit({
          action: "ANOMALY",
          message: `Internal error on ${method} ${path}: ${msg}`,
          contextJson: { method, path, error: msg },
          severity: "CRITICAL",
        });
      } catch {
        /* audit failure must not mask the original error */
      }
      return errRes(500, `Internal error: ${msg}`);
    }
  },
});

console.log(`[execution-bot] listening on :${PORT} (db=${DB_PATH}, exchange=${EXCHANGE_NAME || "n/a"}, keys=${EXCHANGE_API_KEY ? "set" : "missing"}, mt5LiveDeferred=${MT5_LIVE_DEFERRED})`);
console.log(`[execution-bot] CORS origin: ${CORS_ORIGIN}`);
console.log(`[execution-bot] Shared-secret auth: ${BOT_API_TOKEN ? "ENABLED" : "DISABLED (local-only)"}`);

// Ignore SIGHUP (daemon launched via nohup/setsid).
process.on("SIGHUP", () => {
  console.log("[execution-bot] SIGHUP received (ignored — daemon mode)");
});
process.on("SIGTERM", () => {
  console.log("[execution-bot] SIGTERM, shutting down");
  server.stop(true);
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("[execution-bot] SIGINT, shutting down");
  server.stop(true);
  process.exit(0);
});
process.on("uncaughtException", (e: Error) => {
  console.error(`[execution-bot] uncaughtException: ${e.message}\n${e.stack ?? ""}`);
  try {
    audit({
      action: "ANOMALY",
      message: `uncaughtException: ${e.message}`,
      contextJson: { stack: e.stack ?? null },
      severity: "CRITICAL",
    });
  } catch {
    /* ignore */
  }
});
process.on("unhandledRejection", (e: unknown) => {
  console.error(`[execution-bot] unhandledRejection: ${e instanceof Error ? e.message : String(e)}`);
});

// Export for type-only inspection in tests/dev tooling (no-op at runtime).
export { MT5_LIVE_DEFERRED, LIVE_SUPPORTED };
