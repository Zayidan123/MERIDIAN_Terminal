// MERIDIAN Terminal — TOTP verify endpoint. Requires auth.
// POST { token, secret } → verifies the 6-digit code against the secret
// using otplib. Returns { verified: true/false }. This does NOT enable 2FA
// (that requires env change + restart) — it just confirms the user's
// authenticator app is correctly configured before they persist the secret.

import { OTP } from "otplib";
import { ok, fail } from "@/lib/api";
import { requireAuth, UnauthorizedError } from "@/lib/auth";

const totp = new OTP({ strategy: "totp" });

export async function POST(request: Request) {
  try {
    await requireAuth();
    const body = await request.json();
    const { token, secret } = body;
    if (!token || typeof token !== "string") return fail("token required", 400);
    if (!secret || typeof secret !== "string") return fail("secret required", 400);

    const result = await totp.verify({ token: token.replace(/\s/g, ""), secret, epochTolerance: 30 });
    const verified = "valid" in result ? result.valid : false;
    return ok({ verified });
  } catch (e) {
    if (e instanceof UnauthorizedError) return fail("Unauthorized", 401);
    console.error("[totp-verify.POST]", e);
    const msg = e instanceof Error ? e.message : "Internal error";
    return fail(msg, 500);
  }
}
