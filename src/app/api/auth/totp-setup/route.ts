// MERIDIAN Terminal — TOTP setup helper. Requires auth.
// GET:
//   - If MERIDIAN_TOTP_SECRET already set → { enabled: true }
//   - Else generates a new base32 secret + otpauth URL the user can scan
//     with their authenticator app. The user must then persist the secret
//     as MERIDIAN_TOTP_SECRET env, set NEXT_PUBLIC_TOTP_ENABLED=1, restart.

import { OTP } from "otplib";
import { ok, fail } from "@/lib/api";
import { requireAuth, UnauthorizedError } from "@/lib/auth";

// Single OTP instance — otplib v13 exposes the OTP class instead of the
// v12 `authenticator` singleton. Default strategy is 'totp'.
const totp = new OTP({ strategy: "totp" });

export async function GET() {
  try {
    await requireAuth();
    const existing = (process.env.MERIDIAN_TOTP_SECRET ?? "").trim();
    const email =
      (process.env.MERIDIAN_ADMIN_EMAIL ?? "").trim() || "admin@meridian.local";

    if (existing) {
      return ok({ enabled: true });
    }

    const secret = totp.generateSecret();
    const otpauthUrl = totp.generateURI({
      issuer: "MERIDIAN Terminal",
      label: email,
      secret,
    });
    return ok({ enabled: false, secret, otpauthUrl });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return fail("Unauthorized", 401);
    }
    console.error("[totp-setup.GET]", e);
    const msg = e instanceof Error ? e.message : "Internal error";
    return fail(msg, 500);
  }
}
