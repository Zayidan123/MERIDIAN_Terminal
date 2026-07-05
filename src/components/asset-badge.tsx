"use client";

import { cn } from "@/lib/utils";
import { ASSET_CLASS_META } from "@/lib/format";
import type { AssetClass } from "@/lib/types";

export function AssetBadge({
  assetClass,
  size = "sm",
  className,
}: {
  assetClass: AssetClass;
  size?: "xs" | "sm";
  className?: string;
}) {
  const meta = ASSET_CLASS_META[assetClass];
  if (!meta) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-sm font-medium uppercase tracking-wider whitespace-nowrap",
        size === "xs" ? "px-1 py-0.5 text-[9px]" : "px-1.5 py-0.5 text-[10px]",
        className
      )}
      style={{ color: meta.color, backgroundColor: meta.bg, border: `1px solid ${meta.color}33` }}
      title={meta.label}
    >
      {meta.short}
    </span>
  );
}

export function ChangeText({
  value,
  className,
  suffix = "%",
  digits = 2,
}: {
  value: number | null | undefined;
  className?: string;
  suffix?: string;
  digits?: number;
}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className={cn("text-[#4a525c]", className)}>—</span>;
  }
  const color = value > 0 ? "#2e9e6d" : value < 0 ? "#c7484b" : "#8891a0";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={cn("tabular", className)} style={{ color }}>
      {sign}
      {value.toFixed(digits)}
      {suffix}
    </span>
  );
}
