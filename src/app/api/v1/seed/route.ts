// MERIDIAN Terminal — explicit seed trigger.
// Useful for the frontend to ensure instruments exist on first load.

import { ok, fail } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";

export async function POST() {
  try {
    await ensureSeed();
    return ok({ seeded: true });
  } catch (e) {
    console.error("[seed.POST]", e);
    return fail("Internal error", 500);
  }
}
