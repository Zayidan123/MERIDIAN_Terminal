"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { ProvenanceBar } from "@/components/provenance-bar";
import type { Provenance } from "@/lib/types";

/// Standard institutional panel: title bar + body + provenance footer.
export function Panel({
  title,
  subtitle,
  actions,
  provenance,
  loading,
  error,
  children,
  className,
  bodyClassName,
  noPadding,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  provenance?: Provenance | null;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  noPadding?: boolean;
}) {
  return (
    <section
      className={cn(
        "flex flex-col bg-[#151920] border border-[#262b33] rounded-md overflow-hidden",
        className
      )}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#262b33] bg-[#11151c]">
          <div className="min-w-0">
            {title && (
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#e7e9ec] truncate">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-[10px] text-[#8891a0] truncate mt-0.5">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn("flex-1 min-h-0", !noPadding && "p-3", bodyClassName)}>{children}</div>
      <ProvenanceBar provenance={provenance} loading={loading} error={error} />
    </section>
  );
}

export function PanelStat({
  label,
  value,
  sub,
  valueColor,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueColor?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 border border-[#262b33] rounded-md bg-[#11151c]">
      <span className="text-[9px] uppercase tracking-wider text-[#8891a0]">{label}</span>
      <span
        className={cn("text-sm leading-tight", mono && "tabular")}
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
      {sub && <span className="text-[10px] text-[#8891a0]">{sub}</span>}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      {icon && <div className="text-[#4a525c]">{icon}</div>}
      <p className="text-xs font-medium text-[#8891a0]">{title}</p>
      {hint && <p className="text-[10px] text-[#4a525c] max-w-xs">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center">
      <p className="text-[10px] uppercase tracking-wider text-[#c7484b]">Source Unavailable</p>
      <p className="text-xs text-[#8891a0] max-w-xs">{message}</p>
    </div>
  );
}

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1.5 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-5 rounded bg-[#1b2029] animate-pulse" />
      ))}
    </div>
  );
}
