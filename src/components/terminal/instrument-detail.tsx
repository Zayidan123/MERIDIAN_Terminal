"use client";

import { useState } from "react";
import { Panel, PanelStat, ErrorState, LoadingState } from "@/components/panel";
import { AssetBadge, ChangeText } from "@/components/asset-badge";
import { CandlestickChart } from "@/components/candlestick-chart";
import {
  useCandles,
  useTechnicals,
  useFundamentals,
  useQuotes,
} from "@/lib/api-client";
import type { Range, Instrument } from "@/lib/types";
import { fmtPrice, fmtCompact, fmtPct, fmtTimeAgo, ASSET_CLASS_META } from "@/lib/format";
import { cn } from "@/lib/utils";
import { X, LineChart } from "lucide-react";

const RANGES: Range[] = ["1d", "7d", "1m", "3m", "1y"];

export function InstrumentDetail({
  instrument,
  onClose,
}: {
  instrument: Instrument;
  onClose?: () => void;
}) {
  const [range, setRange] = useState<Range>("3m");
  const candles = useCandles(instrument.id, range);
  const technicals = useTechnicals(instrument.id, range);
  const fundamentals = useFundamentals(
    instrument.id,
    instrument.assetClass === "EQUITY" || instrument.assetClass === "CRYPTO"
  );
  const quotes = useQuotes();
  const quoteRow = (quotes.data?.quotes ?? []).find((q) => q.instrumentId === instrument.id);
  const quote = quoteRow?.quote;

  // compute MA20 overlay from candles
  const ma20 =
    candles.data?.candles && candles.data.candles.length >= 20
      ? (() => {
          const arr = candles.data.candles;
          const out: number[] = [];
          for (let i = 0; i < arr.length; i++) {
            if (i < 19) {
              out.push(NaN);
              continue;
            }
            let s = 0;
            for (let j = i - 19; j <= i; j++) s += arr[j].close;
            out.push(s / 20);
          }
          return out;
        })()
      : undefined;

  const meta = ASSET_CLASS_META[instrument.assetClass];

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">
      {/* Header strip */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <AssetBadge assetClass={instrument.assetClass} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-heading font-semibold text-lg text-[#e7e9ec] leading-none">
                {instrument.symbol}
              </h2>
              <span className="text-[10px] uppercase tracking-wider text-[#4a525c]">
                {instrument.exchange}
              </span>
            </div>
            <p className="text-[11px] text-[#8891a0] truncate mt-0.5">{instrument.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {quote ? (
            <div className="text-right">
              <div className="tabular text-xl font-semibold text-[#e7e9ec] leading-none">
                {fmtPrice(quote.price, quote.currency)}
              </div>
              <div className="flex items-center justify-end gap-1.5 mt-1">
                <ChangeText value={quote.changePct24h} />
                <span className="text-[10px] tabular text-[#8891a0]">
                  {quote.change24h != null ? (quote.change24h >= 0 ? "+" : "") + fmtPrice(quote.change24h) : "—"}
                </span>
              </div>
            </div>
          ) : quoteRow && !quoteRow.ok ? (
            <div className="text-right">
              <div className="text-xs text-[#c7484b]">Source unavailable</div>
              <div className="text-[10px] text-[#4a525c]">{quoteRow.error}</div>
            </div>
          ) : null}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-[#151920] text-[#8891a0] hover:text-[#e7e9ec]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Chart panel */}
      <Panel
        title="Price — OHLCV"
        subtitle={`${instrument.symbol} · ${range.toUpperCase()}`}
        provenance={candles.data?.provenance}
        loading={candles.isLoading}
        error={candles.error ? String(candles.error) : null}
        actions={
          <div className="flex items-center gap-0.5">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider tabular",
                  r === range ? "bg-[#3b5fe0] text-white" : "text-[#8891a0] hover:bg-[#1b2029]"
                )}
              >
                {r}
              </button>
            ))}
          </div>
        }
        bodyClassName="p-1"
      >
        {candles.isLoading ? (
          <LoadingState />
        ) : candles.error ? (
          <ErrorState message={String(candles.error)} />
        ) : candles.data && candles.data.candles.length > 0 ? (
          <CandlestickChart candles={candles.data.candles} ma={ma20} height={340} />
        ) : (
          <ErrorState message="No candle data returned by source" />
        )}
      </Panel>

      {/* 24h stats + Technicals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Panel title="24h Statistics" className="col-span-2 lg:col-span-2">
          {quote ? (
            <div className="grid grid-cols-2 gap-2">
              <PanelStat label="Open" value={fmtPrice(quote.prevClose, quote.currency)} />
              <PanelStat label="Last" value={fmtPrice(quote.price, quote.currency)} />
              <PanelStat
                label="High 24h"
                value={fmtPrice(quote.high24h, quote.currency)}
                valueColor="#2e9e6d"
              />
              <PanelStat
                label="Low 24h"
                value={fmtPrice(quote.low24h, quote.currency)}
                valueColor="#c7484b"
              />
              <PanelStat label="Volume 24h" value={fmtCompact(quote.volume24h)} />
              <PanelStat
                label="Change 24h"
                value={<ChangeText value={quote.changePct24h} />}
              />
            </div>
          ) : (
            <ErrorState message={quoteRow?.error ?? "No live quote available"} />
          )}
        </Panel>

        <Panel
          title="Technicals"
          subtitle={`${range.toUpperCase()} · MA/EMA/RSI/MACD`}
          provenance={candles.data?.provenance}
          loading={technicals.isLoading}
          error={technicals.error ? String(technicals.error) : null}
          className="col-span-2 lg:col-span-2"
        >
          {technicals.isLoading ? (
            <LoadingState />
          ) : technicals.data ? (
            <div className="grid grid-cols-2 gap-2">
              <PanelStat
                label="MA20"
                value={fmtPrice(technicals.data.technicals.ma20, instrument.currency)}
                valueColor={
                  technicals.data.technicals.ma20 != null && technicals.data.lastClose > technicals.data.technicals.ma20 ? "#2e9e6d" : "#c7484b"
                }
              />
              <PanelStat
                label="MA50"
                value={fmtPrice(technicals.data.technicals.ma50, instrument.currency)}
                valueColor={
                  technicals.data.technicals.ma50 != null && technicals.data.lastClose > technicals.data.technicals.ma50 ? "#2e9e6d" : "#c7484b"
                }
              />
              <PanelStat
                label="RSI 14"
                value={technicals.data.technicals.rsi14 != null ? technicals.data.technicals.rsi14.toFixed(1) : "—"}
                valueColor={
                  technicals.data.technicals.rsi14 == null
                    ? undefined
                    : technicals.data.technicals.rsi14 > 70
                      ? "#c7484b"
                      : technicals.data.technicals.rsi14 < 30
                        ? "#2e9e6d"
                        : "#e7e9ec"
                }
              />
              <PanelStat
                label="Vol Z-Score"
                value={technicals.data.volumeZScore != null ? technicals.data.volumeZScore.toFixed(2) : "—"}
                valueColor={
                  technicals.data.volumeZScore != null && technicals.data.volumeZScore > 2.5
                    ? "#d4a02a"
                    : undefined
                }
              />
              <PanelStat
                label="MACD"
                value={technicals.data.technicals.macd != null ? technicals.data.technicals.macd.toFixed(3) : "—"}
                valueColor={
                  technicals.data.technicals.macd != null && technicals.data.technicals.macd >= 0 ? "#2e9e6d" : "#c7484b"
                }
              />
              <PanelStat
                label="MACD Hist"
                value={technicals.data.technicals.macdHist != null ? technicals.data.technicals.macdHist.toFixed(3) : "—"}
                valueColor={
                  technicals.data.technicals.macdHist != null && technicals.data.technicals.macdHist >= 0 ? "#2e9e6d" : "#c7484b"
                }
              />
            </div>
          ) : (
            <ErrorState message="Technicals unavailable" />
          )}
        </Panel>
      </div>

      {/* Fundamentals */}
      <Panel
        title="Fundamentals"
        subtitle={
          instrument.assetClass === "EQUITY"
            ? "Valuation & quality ratios (Yahoo Finance)"
            : instrument.assetClass === "CRYPTO"
              ? "Market cap & supply (CoinGecko)"
              : "Not applicable for this asset class"
        }
        loading={fundamentals.isLoading}
        error={null}
        className="mb-1"
      >
        {instrument.assetClass === "FOREX" || instrument.assetClass === "COMMODITY" ? (
          <div className="flex items-center gap-2 py-3 text-[11px] text-[#8891a0]">
            <LineChart className="h-4 w-4 text-[#4a525c]" />
            Fundamental analysis is not applicable for this asset class.
          </div>
        ) : instrument.assetClass === "CRYPTO" ? (
          fundamentals.isLoading ? (
            <LoadingState />
          ) : fundamentals.data ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              <PanelStat
                label="Market Cap"
                value={fmtCompact(fundamentals.data.marketCap)}
                sub="USD"
                valueColor="#d4a02a"
              />
              <PanelStat
                label="FDV"
                value={fmtCompact(fundamentals.data.fdv)}
                sub="fully diluted · USD"
              />
              <PanelStat
                label="Circulating Supply"
                value={fmtCompact(fundamentals.data.circulatingSupply)}
              />
              <PanelStat
                label="Total Supply"
                value={fmtCompact(fundamentals.data.totalSupply)}
              />
              <PanelStat
                label="Max Supply"
                value={fmtCompact(fundamentals.data.maxSupply)}
              />
              <PanelStat
                label="Source"
                value={fundamentals.data.source === "coingecko" ? "CoinGecko" : fundamentals.data.source}
                mono={false}
                sub={fmtTimeAgo(fundamentals.data.fetchedAt)}
              />
            </div>
          ) : (
            <ErrorState message="CoinGecko rate-limited or unavailable. Retry by selecting another instrument or waiting ~60s." />
          )
        ) : fundamentals.isLoading ? (
          <LoadingState />
        ) : fundamentals.data ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <PanelStat label="PER (trailing)" value={fundamentals.data.per != null ? fundamentals.data.per.toFixed(2) + "×" : "—"} />
            <PanelStat label="PBV" value={fundamentals.data.pbv != null ? fundamentals.data.pbv.toFixed(2) + "×" : "—"} />
            <PanelStat label="ROE" value={fundamentals.data.roe != null ? fmtPct(fundamentals.data.roe) : "—"} />
            <PanelStat label="EPS" value={fundamentals.data.eps != null ? fmtPrice(fundamentals.data.eps) : "—"} />
            <PanelStat label="Revenue" value={fmtCompact(fundamentals.data.revenue)} sub="period reported" />
            <PanelStat label="Net Income" value={fmtCompact(fundamentals.data.netIncome)} />
            <PanelStat
              label="Graham Number"
              value={fundamentals.data.graham != null ? fmtPrice(fundamentals.data.graham, instrument.currency) : "—"}
              valueColor="#d4a02a"
            />
            <PanelStat
              label="DCF Fair Value"
              value={fundamentals.data.dcfFair != null ? fmtPrice(fundamentals.data.dcfFair, instrument.currency) : "—"}
              sub={fundamentals.data.dcfFair != null && quote ? "vs last " + fmtPrice(quote.price, quote.currency) : undefined}
            />
          </div>
        ) : (
          <ErrorState message="Yahoo Finance fundamentals unavailable (rate-limited or not returned). Retry later." />
        )}
      </Panel>
    </div>
  );
}
