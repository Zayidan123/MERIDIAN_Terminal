"use client";

import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/terminal/app-shell";
import { LoginScreen } from "@/components/terminal/login-screen";

/**
 * MERIDIAN Terminal — single route entrypoint.
 * Renders LoginScreen when unauthenticated, AppShell when authenticated.
 * useSession() requires SessionProvider, so the conditional lives inside
 * <Providers/> (which wraps children in SessionProvider).
 */
function Gate() {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0b0e13]">
        <Loader2 className="size-6 animate-spin text-[#3b5fe0]" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <LoginScreen />;
  }

  return <AppShell />;
}

export default function Page() {
  return (
    <Providers>
      <Gate />
    </Providers>
  );
}
