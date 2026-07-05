// MERIDIAN Terminal — NextAuth v4 catch-all API route.
// Exposes GET/POST for all /api/auth/* paths (signin, callback, signout,
// session, csrf, providers).

import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth.config";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
