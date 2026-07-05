// MERIDIAN Terminal — formatting utilities (institutional precision)

export function fmtPrice(value: number | null | undefined, currency?: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  let digits = 2;
  const abs = Math.abs(value);
  if (abs > 0 && abs < 1) digits = 6;
  else if (abs < 100) digits = 4;
  else if (abs < 10000) digits = 2;
  else digits = 2;
  const out = value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (currency === "IDR") return "Rp " + out;
  if (currency === "USDT" || currency === "USD") return "$" + out;
  return out;
}

export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

/// Compact notation for large numbers (volume, market cap).
export function fmtCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return (value / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (value / 1e3).toFixed(2) + "K";
  return value.toFixed(2);
}

export function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return sign + value.toFixed(digits) + "%";
}

export function fmtSigned(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return sign + value.toFixed(digits);
}

export function fmtTimeAgo(epochMs: number | null | undefined): string {
  if (!epochMs) return "—";
  const diff = Date.now() - epochMs;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

export function fmtClock(epochMs: number | null | undefined): string {
  if (!epochMs) return "—";
  const d = new Date(epochMs);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

export function fmtDateTime(epochMs: number | null | undefined): string {
  if (!epochMs) return "—";
  const d = new Date(epochMs);
  return (
    d.toLocaleDateString("en-GB", { timeZone: "Asia/Jakarta" }) +
    " " +
    d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta",
    })
  );
}

export function changeColor(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "text-muted-foreground";
  if (value > 0) return "text-[#2e9e6d]";
  if (value < 0) return "text-[#c7484b]";
  return "text-muted-foreground";
}

export const ASSET_CLASS_META: Record<
  string,
  { label: string; short: string; color: string; bg: string }
> = {
  CRYPTO: { label: "Crypto", short: "CRY", color: "#d4a02a", bg: "rgba(212,160,42,0.12)" },
  EQUITY: { label: "IDX Equity", short: "EQ", color: "#3b5fe0", bg: "rgba(59,95,224,0.12)" },
  FOREX: { label: "Forex", short: "FX", color: "#2e9e6d", bg: "rgba(46,158,109,0.12)" },
  COMMODITY: { label: "Commodity", short: "COM", color: "#c7484b", bg: "rgba(199,72,75,0.12)" },
};

export const SOURCE_LABELS: Record<string, string> = {
  binance: "Binance API",
  yahoo: "Yahoo Finance",
  coingecko: "CoinGecko",
};
