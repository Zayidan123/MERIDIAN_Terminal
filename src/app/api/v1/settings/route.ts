// MERIDIAN Terminal — generic key-value user settings (single-user app).
// GET → all settings as { key: value } object.
// POST { key, value } → upsert one setting. Returns the updated settings.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";

export async function GET() {
  try {
    const rows = await db.setting.findMany();
    const settings: Record<string, string> = {};
    for (const r of rows) settings[r.key] = r.value;
    return ok(settings);
  } catch (e) {
    console.error("[settings.GET]", e);
    return fail("Internal error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { key, value } = body;
    if (!key || typeof key !== "string") return fail("key required", 400);
    if (typeof value !== "string") return fail("value must be a string", 400);

    await db.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    const rows = await db.setting.findMany();
    const settings: Record<string, string> = {};
    for (const r of rows) settings[r.key] = r.value;
    return ok(settings);
  } catch (e) {
    console.error("[settings.POST]", e);
    return fail("Internal error", 500);
  }
}
