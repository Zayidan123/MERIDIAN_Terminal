// MERIDIAN Terminal — Position sizing calculator (PRD FR-3.3).
// POST: pure calculation (no external data). Given account equity, % risk per
//       trade, entry price, stop price and side, compute the position size
//       that respects the risk budget.
//
// Inputs (JSON body):
//   equity      number > 0  — total account equity
//   riskPct     number      — % of equity to risk per trade (e.g. 1 = 1%)
//   entryPrice  number > 0
//   stopPrice   number > 0
//   side        "LONG" (default) | "SHORT"
//
// Outputs:
//   riskAmount    = equity × riskPct/100
//   perUnitRisk   = |entryPrice - stopPrice|
//   positionSize  = riskAmount / perUnitRisk       (units to hold)
//   positionValue = positionSize × entryPrice      (notional at entry)
//
// Errors (400):
//   - any non-finite / non-positive input
//   - stopPrice == entryPrice (perUnitRisk would be 0 → infinite size)

import { ok, fail } from "@/lib/api";

const VALID_SIDES = ["LONG", "SHORT"] as const;
type Side = (typeof VALID_SIDES)[number];

interface SizingBody {
  equity?: unknown;
  riskPct?: unknown;
  entryPrice?: unknown;
  stopPrice?: unknown;
  side?: unknown;
}

function toFinitePositive(v: unknown, field: string): number {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw `${field} must be a finite number`;
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (!Number.isFinite(n)) throw `${field} must be a finite number`;
    return n;
  }
  throw `${field} must be a finite number`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as SizingBody | null;
    if (!body) return fail("Invalid JSON body", 400);

    let equity: number;
    let riskPct: number;
    let entryPrice: number;
    let stopPrice: number;
    try {
      equity = toFinitePositive(body.equity, "equity");
      riskPct = toFinitePositive(body.riskPct, "riskPct");
      entryPrice = toFinitePositive(body.entryPrice, "entryPrice");
      stopPrice = toFinitePositive(body.stopPrice, "stopPrice");
    } catch (msg) {
      return fail(String(msg), 400);
    }

    if (equity <= 0) return fail("equity must be > 0", 400);
    if (entryPrice <= 0) return fail("entryPrice must be > 0", 400);
    if (stopPrice <= 0) return fail("stopPrice must be > 0", 400);

    const side =
      typeof body.side === "string" && VALID_SIDES.includes(body.side as Side)
        ? (body.side as Side)
        : "LONG";

    const riskAmount = equity * (riskPct / 100);
    const perUnitRisk = Math.abs(entryPrice - stopPrice);
    if (perUnitRisk === 0) {
      return fail("Stop price cannot equal entry price", 400);
    }
    const positionSize = riskAmount / perUnitRisk;
    const positionValue = positionSize * entryPrice;

    return ok({
      equity,
      riskPct,
      riskAmount,
      entryPrice,
      stopPrice,
      perUnitRisk,
      positionSize,
      positionValue,
      side,
    });
  } catch (e) {
    console.error("[risk.position-size.POST]", e);
    return fail("Internal error", 500);
  }
}
