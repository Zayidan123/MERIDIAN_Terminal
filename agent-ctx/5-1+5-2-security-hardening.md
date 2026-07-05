# Task 5-1+5-2 — Security Hardening (Auth + Middleware)

Agent: full-stack-developer (security hardening)
Date: 2025-07-05

## Scope
PRD §16.3 (auth), §16.5 (CSP/CSRF/rate-limit), gap list items #1+#7.

## Files Created
- `src/lib/auth.config.ts` — NextAuth v4 options. Credentials provider, bcrypt
  password hash (auto-hashed from `MERIDIAN_ADMIN_PASSWORD` if no pre-hash
  given, with insecure fallback default + loud warning), otplib v13 TOTP
  verification when `MERIDIAN_TOTP_SECRET` set. JWT session, 8h maxAge,
  httpOnly+SameSite=Lax cookie. `pages.signIn = "/"` (inline login).
- `src/lib/auth.ts` — `getSession()` + `requireAuth()` (throws
  `UnauthorizedError` w/ status 401) + class export for typed catches.
- `src/app/api/auth/[...nextauth]/route.ts` — NextAuth catch-all GET/POST.
- `src/app/api/auth/totp-setup/route.ts` — authed GET; returns existing secret
  status or generates a new base32 secret + otpauth URL (otplib v13 API).
- `src/components/terminal/login-screen.tsx` — institutional dark card matching
  the terminal palette. Email/password (+ TOTP field gated by
  `NEXT_PUBLIC_TOTP_ENABLED`). Submits via `signIn('credentials',{redirect:false})`,
  error toast on fail, reload on success.
- `src/middleware.ts` — auth gate (`next-auth/jwt` `getToken`), CSP + 5 other
  security headers on every response, in-memory sliding-window rate-limit
  (120/min per IP on `/api/v1/*`), same-origin CSRF check on state-changing
  methods.

## Files Modified
- `src/components/providers.tsx` — wraps children in `<SessionProvider>` then
  `<QueryClientProvider>` (kept existing QueryClient config).
- `src/app/page.tsx` — `<Providers><Gate/></Providers>`; Gate uses
  `useSession()`: loading→spinner, unauthenticated→LoginScreen,
  authenticated→AppShell.
- `next.config.ts` — added async `headers()` returning the same security
  headers as a static fallback (so static assets bypassing middleware also
  get them). Kept all existing config.
- `.env` — appended documented auth block (DATABASE_URL preserved).

## Critical Implementation Notes
- **otplib v13 API change**: v13.4.1 dropped the v12 `authenticator` singleton.
  Use `import { OTP } from 'otplib'; const otp = new OTP({ strategy: 'totp' })`
  with `await otp.verify({ token, secret, epochTolerance: 30 })` (returns
  `{valid:true,delta,epoch}|{valid:false}`) and
  `otp.generateURI({ issuer, label, secret })`.
- **NextAuth v4 + Next.js 16**: works. `getToken({req, secret})` runs cleanly
  in middleware (Edge runtime, uses jose). The middleware filename is
  *deprecated* in Next 16 (renamed to `proxy.ts`) but still fully functional —
  dev server emits a one-line warning, no behavior impact.
- **CSRF ordering**: auth check fires before CSRF. Both are applied to
  `/api/v1/*` state-changing methods. Same-origin policy via `Origin` header
  host comparison (with `X-Requested-With: XMLHttpRequest` opt-in).

## Default Credentials (for testing)
- Email: `admin@meridian.local`
- Password: `Meridian@2025`
- TOTP: disabled by default (`MERIDIAN_TOTP_SECRET` empty)

## Verified (curl)
- `GET /api/v1/instruments` no cookie → 401 ✅
- `GET /api/v1/health` no cookie → 200 (public) ✅
- All other `/api/v1/*` no cookie → 401 ✅
- Security headers present on `/` ✅
- Login flow → 200 + session cookie set (httpOnly, SameSite=Lax) ✅
- `GET /api/v1/instruments` with cookie → 200 ✅
- `POST /api/v1/seed` with cookie + same Origin → 200 ✅
- `POST /api/v1/seed` with cookie + wrong Origin → 403 CSRF ✅
- `GET /api/auth/totp-setup` with cookie → 200 (returns secret + otpauth URL) ✅

## Lint
`bun run lint` → 0 errors, 0 warnings.
