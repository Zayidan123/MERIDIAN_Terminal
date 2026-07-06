// MERIDIAN Terminal — TOTP setup helper. Requires auth.
// GET:
//   - If MERIDIAN_TOTP_SECRET already set → { enabled: true }
//   - Else generates a new base32 secret + otpauth URL + QR data URL the
//     user can scan with their authenticator app. The user must then verify
//     a code (POST /api/auth/totp-verify) and persist the secret as
//     MERIDIAN_TOTP_SECRET env, set NEXT_PUBLIC_TOTP_ENABLED=1, restart.

import { OTP } from "otplib";
import QRCode from "qrcode";
import { ok, fail } from "@/lib/api";
import { requireAuth, UnauthorizedError } from "@/lib/auth";

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
    // Generate QR code as a data URL (PNG) so the client can render it in
    // an <img> tag without any external requests (secret never leaves server).
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
      width: 240,
      margin: 1,
      color: { dark: "#0b0e13", light: "#e7e9ec" },
    });
    return ok({ enabled: false, secret, otpauthUrl, qrDataUrl });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return fail("Unauthorized", 401);
    }
    console.error("[totp-setup.GET]", e);
    const msg = e instanceof Error ? e.message : "Internal error";
    return fail(msg, 500);
  }
}
