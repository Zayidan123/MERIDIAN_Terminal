"use client";

import { fmtTimeAgo } from "@/lib/format";
import type { Provenance } from "@/lib/types";
import { SOURCE_LABELS } from "@/lib/format";
import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_META: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  OK: { icon: CheckCircle2, color: "text-[#2e9e6d]", label: "OK" },
  FAIL: { icon: XCircle, color: "text-[#c7484b]", label: "FAIL" },
  RATE_LIMITED: { icon: AlertTriangle, color: "text-[#d4a02a]", label: "RATE-LIMITED" },
  TIMEOUT: { icon: AlertTriangle, color: "text-[#d4a02a]", label: "TIMEOUT" },
};

/// PRD §13 signature element — provenance bar shown on every data panel.
export function ProvenanceBar({
  provenance,
  loading,
  error,
  className,
}: {
  provenance?: Provenance | null;
  loading?: boolean;
  error?: string | null;
  className?: string;
}) {
  let status = provenance?.status ?? "OK";
  if (loading) status = "LOADING";
  else if (error && !provenance) status = "FAIL";

  const sourceLabel = provenance?.sourceLabel
    ? provenance.sourceLabel
    : provenance?.source
      ? SOURCE_LABELS[provenance.source] ?? provenance.source
      : "—";

  const meta = STATUS_META[status];
  const Icon = meta?.icon ?? Loader2;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-wider border-t border-[#262b33] bg-[#11151c]",
        className
      )}
    >
      {status === "LOADING" ? (
        <Loader2 className="h-3 w-3 animate-spin text-[#8891a0]" />
      ) : (
        <Icon className={cn("h-3 w-3", meta?.color ?? "text-[#8891a0]")} />
      )}
      <span className="text-[#8891a0]">{sourceLabel}</span>
      <span className="text-[#4a525c]">·</span>
      {loading ? (
        <span className="text-[#8891a0]">syncing…</span>
      ) : error && !provenance ? (
        <span className="text-[#c7484b]">{error}</span>
      ) : (
        <span className="text-[#8891a0]">synced {fmtTimeAgo(provenance?.syncedAt)}</span>
      )}
    </div>
  );
}
