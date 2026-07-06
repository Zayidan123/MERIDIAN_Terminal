// MERIDIAN Terminal — NextAuth options (single-user, JWT session).
// Credentials provider backed by env-defined admin (bcrypt-hashed password +
// optional TOTP via otplib). Designed to run server-side only.

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { OTP } from "otplib";

// otplib v13 exposes the `OTP` class (default strategy 'totp') instead of
// the v12 `authenticator` singleton. We reuse a single instance.
const totp = new OTP({ strategy: "totp" });

// ─── env-driven admin config ────────────────────────────────────────────
const ADMIN_EMAIL = (process.env.MERIDIAN_ADMIN_EMAIL ?? "admin@meridian.local")
  .trim()
  .toLowerCase();
const TOTP_SECRET = (process.env.MERIDIAN_TOTP_SECRET ?? "").trim();

// Fallback default password used ONLY when no env var is set, so a fresh
// dev box can still log in. Always logs a loud warning.
const FALLBACK_DEFAULT_PASSWORD = "Meridian@2025";

let cachedHash: string | null = null;
let warnedFallback = false;
let warnedSecret = false;

function getAdminPasswordHash(): string {
  if (cachedHash) return cachedHash;

  const preHashed = (process.env.MERIDIAN_ADMIN_PASSWORD_HASH ?? "").trim();
  if (preHashed) {
    cachedHash = preHashed;
    return cachedHash;
  }

  const plain = process.env.MERIDIAN_ADMIN_PASSWORD;
  if (plain && plain.length > 0) {
    // Compute bcrypt hash at first authorize() call, cache for the lifetime
    // of the server process.
    cachedHash = bcrypt.hashSync(plain, 10);
    return cachedHash;
  }

  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      "┌──────────────────────────────────────────────────────────────────┐"
    );
    console.warn("│  [MERIDIAN AUTH] WARNING — INSECURE FALLBACK ACTIVE             │");
    console.warn("│  MERIDIAN_ADMIN_PASSWORD(_HASH) not set in environment.        │");
    console.warn("│  Using default password. CHANGE BEFORE ANY PRODUCTION USE.     │");
    console.warn("└──────────────────────────────────────────────────────────────────┘");
  }
  cachedHash = bcrypt.hashSync(FALLBACK_DEFAULT_PASSWORD, 10);
  return cachedHash;
}

function getAuthSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s || s.length < 16) {
    if (!warnedSecret) {
      warnedSecret = true;
      console.warn(
        "[MERIDIAN AUTH] NEXTAUTH_SECRET missing or too short — using insecure dev default."
      );
    }
    return "meridian-insecure-dev-secret-do-not-use-in-production";
  }
  return s;
}

// ─── NextAuth options ───────────────────────────────────────────────────
export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    // 8h session maxAge, with rolling refresh (default behaviour).
    maxAge: 8 * 60 * 60,
  },
  secret: getAuthSecret(),
  // trustHost lets NextAuth auto-detect the canonical URL from the Host /
  // X-Forwarded-Host headers instead of requiring a hardcoded NEXTAUTH_URL.
  // This is critical when the app is behind a reverse proxy (Caddy gateway
  // on port 81) or embedded in a preview panel iframe — the access origin
  // may differ from localhost:3000. Without this, redirects after login
  // point to the wrong port and the session cookie never "sticks".
  trustHost: true,
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totp: { label: "TOTP", type: "text" },
      },
      async authorize(credentials) {
        try {
          if (!credentials) return null;
          const email = (credentials.email ?? "").trim().toLowerCase();
          const password = credentials.password ?? "";
          const totp = (credentials.totp ?? "").trim();

          if (!email || !password) return null;
          if (email !== ADMIN_EMAIL) return null;

          const hash = getAdminPasswordHash();
          const passwordOk = await bcrypt.compare(password, hash);
          if (!passwordOk) return null;

          // TOTP only enforced if MERIDIAN_TOTP_SECRET is configured.
          if (TOTP_SECRET) {
            if (!totp) return null;
            // Allow ±1 time step (30s) drift to match Google Authenticator /
            // Authy / 1Password behaviour.
            const result = await totp.verify({
              token: totp,
              secret: TOTP_SECRET,
              epochTolerance: 30,
            });
            if (!result.valid) return null;
          }

          return { id: "admin", email, name: "Admin" };
        } catch (e) {
          console.error("[auth.authorize]", e);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email;
      return token;
    },
    async session({ session, token }) {
      if (token.email && session.user) {
        session.user.email = token.email as string;
      }
      return session;
    },
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-next-auth.session-token"
          : "next-auth.session-token",
      options: {
        httpOnly: true,
        // "lax" works for top-level navigation. For iframe embedding (preview
        // panels), the browser may still block cookies in cross-site iframe
        // contexts — but since the app itself requires same-origin fetch for
        // the session check, this is acceptable. If iframe login issues
        // persist, the fallback is a full-page form POST (see login-screen).
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name: "next-auth.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    callbackUrl: {
      name: "next-auth.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  // We render the login form inline at "/" — no separate sign-in route.
  pages: {
    signIn: "/",
  },
};
