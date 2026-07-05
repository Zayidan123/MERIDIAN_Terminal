// MERIDIAN Terminal — server-side auth helpers.
// Use getSession() in API route handlers to inspect the current session,
// and requireAuth() as a defensive double-check (middleware already enforces
// auth on /api/v1/*).

import { getServerSession, type NextAuthOptions } from "next-auth";
import { authOptions } from "./auth.config";

export type { NextAuthOptions };

export async function getSession() {
  return getServerSession(authOptions);
}

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Defensive auth guard for protected API route handlers.
 * Middleware already enforces auth, but this is a fail-safe in case a route
 * is added outside the middleware matcher. Throws UnauthorizedError if no
 * session is present.
 */
export async function requireAuth(): Promise<{ email: string }> {
  const session = await getSession();
  if (!session?.user?.email) {
    throw new UnauthorizedError();
  }
  return { email: session.user.email };
}
