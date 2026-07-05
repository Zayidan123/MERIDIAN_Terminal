// MERIDIAN Terminal — data source health. Returns the per-source latest
// status (in-memory ring buffer) plus the most recent ~30 persisted log rows.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { getLatestHealthBySource } from "@/lib/data-health";
import type { DataSourceKey, HealthStatus } from "@/lib/types";

interface RecentRow {
  id: string;
  source: string;
  endpoint: string;
  status: string;
  latencyMs: number | null;
  errorMessage: string | null;
  createdAt: number;
}

export async function GET() {
  try {
    const latest = getLatestHealthBySource();
    const recentRows = await db.dataSourceHealthLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const recent: RecentRow[] = recentRows.map((r) => ({
      id: r.id,
      source: r.source,
      endpoint: r.endpoint,
      status: r.status,
      latencyMs: r.latencyMs,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt.getTime(),
    }));

    // Normalize latest as typed records.
    const latestTyped: { source: DataSourceKey; status: HealthStatus; latencyMs: number; checkedAt: number }[] =
      Object.entries(latest).map(([source, v]) => ({
        source: source as DataSourceKey,
        status: v.status,
        latencyMs: v.latencyMs,
        checkedAt: v.checkedAt,
      }));

    return ok({ latest: latestTyped, recent });
  } catch (e) {
    console.error("[health.GET]", e);
    return fail("Internal error", 500);
  }
}
