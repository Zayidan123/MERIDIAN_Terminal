// MERIDIAN Terminal — add / remove instrument from Default watchlist.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ instrumentId: string }> }
) {
  try {
    const { instrumentId } = await params;

    const instrument = await db.instrument.findUnique({ where: { id: instrumentId } });
    if (!instrument) return fail("Instrument not found", 404);

    let wl = await db.watchlist.findFirst({ where: { name: "Default" } });
    if (!wl) wl = await db.watchlist.create({ data: { name: "Default" } });

    // Ignore-if-exists (idempotent): use upsert on the composite unique key.
    await db.watchlistItem.upsert({
      where: {
        watchlistId_instrumentId: { watchlistId: wl.id, instrumentId },
      },
      update: {},
      create: { watchlistId: wl.id, instrumentId },
    });

    return ok({ added: true, watchlistId: wl.id, instrumentId });
  } catch (e) {
    console.error("[watchlist.POST]", e);
    return fail("Internal error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ instrumentId: string }> }
) {
  try {
    const { instrumentId } = await params;
    const wl = await db.watchlist.findFirst({ where: { name: "Default" } });
    if (!wl) return ok({ removed: true }); // nothing to remove
    await db.watchlistItem.deleteMany({
      where: { watchlistId: wl.id, instrumentId },
    });
    return ok({ removed: true });
  } catch (e) {
    console.error("[watchlist.DELETE]", e);
    return fail("Internal error", 500);
  }
}
