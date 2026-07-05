// MERIDIAN Terminal — data source health logging + cache.
// PRD §6: every external request is logged; failures surfaced, never silent.
// PRD FR-0.5: status of every data request recorded to data_source_health_log.

import { db } from "@/lib/db";
import type { DataSourceKey, HealthStatus } from "@/lib/types";

/// In-memory TTL cache. Local-first (PRD §5.4) — no Redis required.
interface CacheEntry<T> {
  value: T;
  expires: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

export async function cacheGet<T>(key: string): Promise<T | null> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expires: Date.now() + ttlMs });
}

/// Record a data-source request outcome. Fire-and-forget to the DB; also
/// keeps an in-memory ring buffer for the status bar / health panel.
export function logHealth(params: {
  source: DataSourceKey;
  endpoint: string;
  status: HealthStatus;
  latencyMs: number;
  errorMessage?: string | null;
}): void {
  const { source, endpoint, status, latencyMs, errorMessage } = params;
  // In-memory recent buffer (most recent first)
  recent.unshift({
    source,
    endpoint,
    status,
    latencyMs,
    errorMessage: errorMessage ?? null,
    checkedAt: Date.now(),
  });
  if (recent.length > 200) recent.length = 200;
  // Persist (non-blocking). Use a catch to never break the data path.
  db.dataSourceHealthLog
    .create({
      data: {
        source,
        endpoint,
        status,
        latencyMs,
        errorMessage: errorMessage ?? null,
      },
    })
    .catch(() => {
      /* ignore — logging must never throw the request */
    });
}

export interface HealthRecord {
  source: DataSourceKey;
  endpoint: string;
  status: HealthStatus;
  latencyMs: number;
  errorMessage: string | null;
  checkedAt: number;
}

const recent: HealthRecord[] = [];

export function getRecentHealth(limit = 50): HealthRecord[] {
  return recent.slice(0, limit);
}

/// Per-source latest status (for the top status bar).
export function getLatestHealthBySource(): Record<
  string,
  { status: HealthStatus; latencyMs: number; checkedAt: number }
> {
  const out: Record<string, { status: HealthStatus; latencyMs: number; checkedAt: number }> = {};
  for (const r of recent) {
    if (!out[r.source]) out[r.source] = { status: r.status, latencyMs: r.latencyMs, checkedAt: r.checkedAt };
  }
  return out;
}

/// Fetch with timeout + retry/backoff (PRD FR-0.6). Never fabricates data.
export async function fetchWithRetry(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
  retries = 2
): Promise<{ ok: boolean; status: number; body: string; latencyMs: number; error?: string }> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const start = Date.now();
  let lastError: string | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      const body = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        body,
        latencyMs: Date.now() - start,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (e) {
      clearTimeout(timer);
      lastError = e instanceof Error ? e.message : String(e);
      // backoff: 200ms, 500ms
      if (attempt < retries) await sleep(200 * (attempt + 1));
    }
  }
  return { ok: false, status: 0, body: "", latencyMs: Date.now() - start, error: lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
