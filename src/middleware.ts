// MERIDIAN Terminal — middleware: auth gate + security headers + CSRF + rate-limit.
// Applies to all non-static routes. Auth + CSRF + rate-limit only apply to
// /api/v1/* (everything under /api/v1/ except /api/v1/health).

import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// ─── security headers (applied to every response) ───────────────────────
// frame-ancestors is configurable via FRAME_ANCESTORS env (space-separated
// origins). Default allows any http/https origin so the app can be embedded
// in preview panels / IDE iframes. Clickjacking risk is mitigated because
// the app requires authentication — an attacker framing it gains nothing
// without credentials. For production, set FRAME_ANCESTORS to your exact
// trusted origins (e.g. "'self' https://yourdomain.com").
const FRAME_ANCESTORS =
  process.env.FRAME_ANCESTORS?.trim() || "'self' http: https:";
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' wss: ws: https:",
    `frame-ancestors ${FRAME_ANCESTORS}`,
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  // X-Frame-Options removed — superseded by CSP frame-ancestors which is
  // more granular. Keeping both causes conflicts in some browsers.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function applySecurityHeaders(res: NextResponse): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
}

// ─── in-memory sliding-window rate limit (per IP, 600 req/min) ──────────
// A data-heavy terminal makes many concurrent polling calls (quotes, risk,
// signals, health, bot status…). 600/min = 10/s is a reasonable ceiling for
// a single-user local-first app while still blocking brute-force/abuse.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 600;
interface Bucket {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<string, Bucket>();

// Periodically purge expired buckets to keep memory bounded in long-running
// dev. Cheap and good enough for a single-instance terminal.
function pruneRateBuckets(now: number): void {
  if (rateBuckets.size < 512) return;
  for (const [k, b] of rateBuckets) {
    if (b.resetAt < now) rateBuckets.delete(k);
  }
}

function rateCheck(ip: string): { ok: true; remaining: number } | { ok: false; retryAfter: number } {
  const now = Date.now();
  pruneRateBuckets(now);
  const b = rateBuckets.get(ip);
  if (!b || b.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true, remaining: RATE_MAX - 1 };
  }
  b.count += 1;
  if (b.count > RATE_MAX) {
    const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return { ok: false, retryAfter };
  }
  return { ok: true, remaining: Math.max(0, RATE_MAX - b.count) };
}

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

// ─── CSRF: same-origin check for state-changing methods ─────────────────
function csrfOk(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  // Allow clients that explicitly opt-in via the X-Requested-With header
  // (XMLHttpRequest convention). Same-origin fetch with Origin is also fine.
  const requestedWith = req.headers.get("x-requested-with");
  if (requestedWith && requestedWith.toLowerCase() === "xmlhttprequest") {
    return true;
  }
  if (!origin || !host) return false;
  try {
    const u = new URL(origin);
    return u.host === host;
  } catch {
    return false;
  }
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ─── middleware entry ───────────────────────────────────────────────────
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // Apply security headers to every response that flows through middleware.
  // (Static assets not matched here get the same headers via next.config.ts.)
  const next = NextResponse.next();
  applySecurityHeaders(next);

  // Only /api/v1/* is subject to auth + rate-limit + CSRF.
  if (!pathname.startsWith("/api/v1/")) {
    return next;
  }

  // 1) Auth — /api/v1/health is the only public v1 route.
  if (pathname !== "/api/v1/health") {
    const token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
    });
    if (!token) {
      const r = NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
      applySecurityHeaders(r);
      return r;
    }
  }

  // 2) Rate-limit (sliding window per IP).
  const ip = getClientIp(req);
  const rl = rateCheck(ip);
  if (!rl.ok) {
    const r = NextResponse.json(
      { ok: false, error: "Rate limit exceeded" },
      { status: 429 }
    );
    r.headers.set("Retry-After", String(rl.retryAfter));
    applySecurityHeaders(r);
    return r;
  }
  next.headers.set("X-RateLimit-Remaining", String(rl.remaining));
  next.headers.set("X-RateLimit-Limit", String(RATE_MAX));

  // 3) CSRF — same-origin for state-changing methods.
  if (STATE_CHANGING.has(method) && !csrfOk(req)) {
    const r = NextResponse.json(
      { ok: false, error: "CSRF check failed" },
      { status: 403 }
    );
    applySecurityHeaders(r);
    return r;
  }

  return next;
}

export const config = {
  // Match everything except Next internals and well-known static files.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|logo\\.svg|robots\\.txt).*)",
  ],
};
