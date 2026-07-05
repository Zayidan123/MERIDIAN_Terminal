"use client";

import { Providers } from "@/components/providers";
import { AppShell } from "@/components/terminal/app-shell";

export default function Page() {
  return (
    <Providers>
      <AppShell />
    </Providers>
  );
}
