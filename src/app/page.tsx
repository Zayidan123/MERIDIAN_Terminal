"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/terminal/app-shell";
import { LoginScreen } from "@/components/terminal/login-screen";

/**
 * Detect if the app is running inside a cross-origin iframe.
 * In cross-origin iframes (like the preview panel), browsers block SameSite
 * cookies on fetch requests — which breaks NextAuth's cookie-based auth.
 * When detected, we show an "Open in new tab" prompt so the user can use
 * the app in a full browser tab where cookies work normally.
 */
function useIsCrossOriginIframe(): boolean {
  const [crossOrigin, setCrossOrigin] = useState(false);
  useEffect(() => {
    try {
      // If we can access parent.location, we're same-origin (or top-level).
      // If it throws, we're in a cross-origin iframe.
      if (window.self !== window.top) {
        void window.top.location.href; // throws if cross-origin
      }
    } catch {
      // Cross-origin iframe — cookies blocked. Defer setState to next tick
      // to avoid the "synchronous setState in effect" lint error.
      const id = setTimeout(() => setCrossOrigin(true), 0);
      return () => clearTimeout(id);
    }
  }, []);
  return crossOrigin;
}

function IframeNotice() {
  return (
    <div className="min-h-screen bg-[#0b0e13] text-[#e7e9ec] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-[#151920] border border-[#262b33] rounded-md p-6 flex flex-col items-center text-center gap-4">
        <div className="size-12 rounded-md bg-[#d4a02a]/15 border border-[#d4a02a]/40 flex items-center justify-center">
          <AlertTriangle className="size-6 text-[#d4a02a]" />
        </div>
        <div>
          <h1 className="font-heading text-[16px] font-semibold tracking-tight">
            Open in New Tab Required
          </h1>
          <p className="text-[11px] text-[#8891a0] mt-2 leading-relaxed">
            MERIDIAN Terminal uses secure cookies for authentication, which
            browsers block inside embedded preview panels. To log in and use
            the terminal, open it in a new browser tab.
          </p>
        </div>
        <Button
          onClick={() => window.open(window.location.href, "_blank", "noopener")}
          className="bg-[#3b5fe0] hover:bg-[#3b5fe0]/90 text-white h-9 text-[12px] font-medium w-full"
        >
          <ExternalLink className="size-4 mr-1.5" />
          Open MERIDIAN Terminal in New Tab
        </Button>
        <p className="text-[9px] text-[#4a525c] leading-relaxed">
          Login: admin@meridian.local / Meridian@2025
          <br />
          The terminal works fully in a standalone tab.
        </p>
      </div>
    </div>
  );
}

function Gate() {
  const { status } = useSession();
  const isCrossOriginIframe = useIsCrossOriginIframe();

  // If in a cross-origin iframe, cookies won't work — show the notice.
  // The "Open in new tab" button opens the app in a top-level tab where
  // SameSite cookies function normally.
  if (isCrossOriginIframe) {
    return <IframeNotice />;
  }

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
