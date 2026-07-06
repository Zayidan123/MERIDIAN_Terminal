"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const ADMIN_EMAIL_HINT =
  process.env.NEXT_PUBLIC_ADMIN_EMAIL || "admin@meridian.local";
const TOTP_ENABLED = process.env.NEXT_PUBLIC_TOTP_ENABLED === "1";

/**
 * MERIDIAN Terminal — institutional login screen.
 * Rendered conditionally inside src/app/page.tsx when no session is present.
 * Uses the same dark palette as the rest of the app (#0b0e13 / #151920 / #262b33).
 */
export function LoginScreen() {
  const [email, setEmail] = useState(ADMIN_EMAIL_HINT);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    try {
      // Try the next-auth client signIn first (uses fetch under the hood).
      // This works in most same-origin contexts.
      const res = await signIn("credentials", {
        email,
        password,
        ...(TOTP_ENABLED ? { totp } : {}),
        redirect: false,
        callbackUrl: window.location.origin + "/",
      });

      if (res && res.error) {
        toast.error("Authentication failed", {
          description: "Invalid email, password, or TOTP code.",
        });
        setLoading(false);
        return;
      }

      if (res && res.ok) {
        // Force a full reload so the SessionProvider refetches and the
        // AppShell mounts cleanly with all authed queries primed.
        window.location.href = window.location.origin + "/";
        return;
      }

      // Fallback: if signIn returned no ok flag (can happen in some iframe /
      // cross-origin contexts where fetch cookies are blocked), use a native
      // form POST. The browser handles cookies + redirect natively, which
      // works even when fetch-based signIn doesn't.
      const form = e.currentTarget.closest("form") as HTMLFormElement | null;
      if (form) {
        const hiddenForm = document.createElement("form");
        hiddenForm.method = "POST";
        hiddenForm.action = "/api/auth/callback/credentials";
        hiddenForm.style.display = "none";

        const fields: Record<string, string> = { email, password };
        if (TOTP_ENABLED && totp) fields.totp = totp;
        fields.callbackUrl = window.location.origin + "/";
        fields.json = "true";

        // Fetch the CSRF token first (required by NextAuth).
        const csrfRes = await fetch("/api/auth/csrf");
        const csrfData = await csrfRes.json();
        fields.csrfToken = csrfData.csrfToken;

        for (const [key, value] of Object.entries(fields)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = key;
          input.value = value;
          hiddenForm.appendChild(input);
        }
        document.body.appendChild(hiddenForm);
        hiddenForm.submit();
        return;
      }

      // Last resort: just reload
      window.location.reload();
    } catch (err) {
      console.error("[login]", err);
      toast.error("Authentication error", {
        description: err instanceof Error ? err.message : "Unexpected error",
      });
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0e13] text-[#e7e9ec] flex flex-col">
      {/* Brand strip */}
      <header className="flex items-center gap-2 px-6 h-14 border-b border-[#262b33] shrink-0">
        <span className="font-heading font-semibold text-[13px] tracking-[0.18em]">
          MERIDIAN
        </span>
        <span className="text-[9px] uppercase tracking-[0.2em] text-[#4a525c] border border-[#262b33] rounded px-1 py-0.5">
          Terminal
        </span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-[#4a525c]">
          Secure Access Required
        </span>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="size-11 rounded-md bg-[#151920] border border-[#262b33] flex items-center justify-center mb-3">
              <ShieldCheck className="size-5 text-[#3b5fe0]" />
            </div>
            <h1 className="font-heading text-[18px] font-semibold tracking-tight">
              MERIDIAN Terminal
            </h1>
            <p className="text-[11px] text-[#8891a0] mt-1">
              Authenticate to enter the terminal.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-[#151920] border border-[#262b33] rounded-md p-5 flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="email"
                className="text-[10px] uppercase tracking-[0.15em] text-[#8891a0]"
              >
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-[#0b0e13] border-[#262b33] text-[13px]"
                placeholder="admin@meridian.local"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="password"
                className="text-[10px] uppercase tracking-[0.15em] text-[#8891a0]"
              >
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-[#0b0e13] border-[#262b33] text-[13px]"
                placeholder="••••••••"
              />
            </div>

            {TOTP_ENABLED && (
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="totp"
                  className="text-[10px] uppercase tracking-[0.15em] text-[#8891a0]"
                >
                  TOTP Code
                </Label>
                <Input
                  id="totp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                  className="bg-[#0b0e13] border-[#262b33] text-[13px] tabular tracking-[0.3em] text-center"
                  placeholder="000000"
                />
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="bg-[#3b5fe0] hover:bg-[#3b5fe0]/90 text-white h-9 text-[12px] font-medium"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Lock className="size-4" />
              )}
              {loading ? "Authenticating…" : "Sign In"}
            </Button>
          </form>

          <div className="mt-4 text-center space-y-1">
            <p className="text-[10px] text-[#4a525c]">
              Single-user terminal · credentials from env
            </p>
            <p className="text-[10px] text-[#4a525c]">
              Configured admin:{" "}
              <span className="text-[#8891a0] tabular">{ADMIN_EMAIL_HINT}</span>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
