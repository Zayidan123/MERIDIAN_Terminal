// MERIDIAN Terminal — API response helpers.
// Consistent JSON envelope + provenance propagation.

import { NextResponse } from "next/server";
import type { DataResult } from "@/lib/types";

export function ok<T>(data: T, provenance?: DataResult<T>["provenance"]) {
  return NextResponse.json({ ok: true, data, provenance });
}

export function fail(message: string, status = 502, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/// Wrap a DataResult from the data layer into an API response.
export function fromResult<T>(r: DataResult<T>) {
  if (r.ok) return ok(r.data as T, r.provenance);
  return fail(r.error || "Data source unavailable", 502);
}
