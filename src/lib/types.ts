// MERIDIAN Terminal — shared domain types

export type AssetClass = "CRYPTO" | "EQUITY" | "FOREX" | "COMMODITY";

export type DataSourceKey = "binance" | "yahoo" | "coingecko";

export interface Instrument {
  id: string;
  assetClass: AssetClass;
  ticker: string;
  symbol: string;
  name: string;
  exchange?: string | null;
  currency: string;
  source: DataSourceKey;
  lotSize?: number | null;
  metadata?: string | null;
}

/// Normalized OHLCV candle.
export interface Candle {
  time: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Range = "1d" | "7d" | "1m" | "3m" | "1y";
export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/// Quote + 24h statistics for an instrument.
export interface Quote {
  ticker: string;
  symbol: string;
  assetClass: AssetClass;
  price: number;
  prevClose: number | null;
  change24h: number | null; // absolute
  changePct24h: number | null; // percent
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  quoteVolume24h: number | null; // for crypto
  currency: string;
  source: DataSourceKey;
  syncedAt: number; // epoch ms
}

/// Fundamental metrics (PRD FR-1.3, FR-1.4).
export interface Fundamental {
  ticker: string;
  // Equity
  revenue?: number | null;
  netIncome?: number | null;
  eps?: number | null;
  roe?: number | null; // %
  per?: number | null;
  pbv?: number | null;
  graham?: number | null;
  dcfFair?: number | null;
  // Crypto
  marketCap?: number | null;
  fdv?: number | null;
  circulatingSupply?: number | null;
  totalSupply?: number | null;
  maxSupply?: number | null;
  source: DataSourceKey;
  fetchedAt: number;
}

export type HealthStatus = "OK" | "FAIL" | "RATE_LIMITED" | "TIMEOUT";

export interface DataSourceHealth {
  source: DataSourceKey;
  status: HealthStatus;
  latencyMs: number;
  endpoint: string;
  errorMessage?: string | null;
  checkedAt: number;
}

export interface Provenance {
  source: string;
  sourceLabel: string;
  syncedAt: number; // epoch ms
  status?: HealthStatus;
}

/// Technical indicator series.
export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface TechnicalSnapshot {
  ma20: number | null;
  ma50: number | null;
  ema12: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
}

export interface AlertRule {
  id: string;
  instrumentId: string;
  metric: string;
  operator: string;
  threshold: number;
  status: string;
  note?: string | null;
  createdAt: number;
  triggeredAt?: number | null;
}

export interface SignalEvent {
  id: string;
  instrumentId: string;
  instrumentTicker: string;
  instrumentSymbol: string;
  signalType: string;
  severity: string;
  message: string;
  priceAtEvent?: number | null;
  context?: Record<string, unknown>;
  createdAt: number;
}

export interface Position {
  id: string;
  instrumentId: string;
  instrumentTicker: string;
  instrumentSymbol: string;
  assetClass: AssetClass;
  side: string;
  entryPrice: number;
  size: number;
  openedAt: number;
  note?: string | null;
  // computed
  lastPrice?: number | null;
  marketValue?: number | null;
  unrealizedPnl?: number | null;
  unrealizedPnlPct?: number | null;
}

export interface RiskSummary {
  totalEquity: number;
  totalExposure: number;
  exposurePct: number;
  realizedPnl: number;
  unrealizedPnl: number;
  perAssetClass: { assetClass: AssetClass; exposure: number; pct: number; count: number }[];
  perPosition: {
    instrumentId: string;
    symbol: string;
    assetClass: AssetClass;
    marketValue: number;
    weightPct: number;
    pnlPct: number;
  }[];
  varEstimate: number | null;
  currentDrawdown: number | null;
  maxDrawdown: number | null;
  correlation: CorrelationCell[];
}

export interface CorrelationCell {
  a: string;
  b: string;
  value: number | null; // -1..1 ; null if insufficient data
}

/// Result wrapper for data-source calls: never throws on the data path,
/// callers decide how to surface failures (integrity policy §6).
export interface DataResult<T> {
  ok: boolean;
  data?: T;
  provenance?: Provenance;
  error?: string;
}
