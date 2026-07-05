"use client";

import { useMemo } from "react";
import type { Candle } from "@/lib/types";
import { fmtCompact, fmtPrice } from "@/lib/format";

/// Custom SVG candlestick chart — institutional look, no heavy deps.
/// Renders price candles + volume bars + optional MA overlay.
export function CandlestickChart({
  candles,
  height = 320,
  ma,
  showVolume = true,
}: {
  candles: Candle[];
  height?: number;
  ma?: number[];
  showVolume?: boolean;
}) {
  const W = 1000; // viewBox width (responsive via CSS)
  const padding = { top: 8, right: 56, bottom: showVolume ? 56 : 20, left: 4 };
  const volH = showVolume ? 36 : 0;

  const { paths, scale } = useMemo(() => {
    if (candles.length === 0) return { paths: null, scale: null };
    const priceAreaH = height - padding.top - padding.bottom - volH;
    const lows = candles.map((c) => c.low);
    const highs = candles.map((c) => c.high);
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    // include MA in range
    if (ma && ma.length) {
      const maMin = Math.min(...ma.filter((v) => v != null && !Number.isNaN(v)));
      const maMax = Math.max(...ma.filter((v) => v != null && !Number.isNaN(v)));
      if (Number.isFinite(maMin)) min = Math.min(min, maMin);
      if (Number.isFinite(maMax)) max = Math.max(max, maMax);
    }
    const pad = (max - min) * 0.06 || max * 0.06 || 1;
    min -= pad;
    max += pad;
    const range = max - min || 1;

    const plotW = W - padding.left - padding.right;
    const n = candles.length;
    const slot = plotW / n;
    const bodyW = Math.max(1, Math.min(slot * 0.66, 14));

    const xOf = (i: number) => padding.left + i * slot + slot / 2;
    const yOf = (p: number) => padding.top + (1 - (p - min) / range) * priceAreaH;

    const maxVol = Math.max(...candles.map((c) => c.volume), 1);
    const volYOf = (v: number) =>
      height - padding.bottom + volH - (v / maxVol) * (volH - 4);

    const candleEls = candles.map((c, i) => {
      const x = xOf(i);
      const up = c.close >= c.open;
      const color = up ? "#2e9e6d" : "#c7484b";
      const yHigh = yOf(c.high);
      const yLow = yOf(c.low);
      const yOpen = yOf(c.open);
      const yClose = yOf(c.close);
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1, Math.abs(yClose - yOpen));
      const volY = volYOf(c.volume);
      return { x, color, up, yHigh, yLow, bodyTop, bodyH, volY, volH: height - padding.bottom - volY };
    });

    // MA path
    let maPath: string | null = null;
    if (ma && ma.length) {
      const pts: string[] = [];
      let started = false;
      for (let i = 0; i < ma.length; i++) {
        const v = ma[i];
        if (v == null || Number.isNaN(v)) continue;
        const x = xOf(i);
        const y = yOf(v);
        pts.push(`${started ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`);
        started = true;
      }
      if (pts.length) maPath = pts.join(" ");
    }

    // gridlines (5 horizontal)
    const grid: { y: number; label: string }[] = [];
    for (let g = 0; g <= 4; g++) {
      const p = min + (range * g) / 4;
      grid.push({ y: yOf(p), label: fmtPrice(p) });
    }

    // last price line
    const last = candles[candles.length - 1];
    const lastY = yOf(last.close);

    return {
      paths: { candleEls, maPath, grid, lastY, lastPrice: last.close, lastColor: last.close >= last.open ? "#2e9e6d" : "#c7484b" },
      scale: { min, max },
    };
  }, [candles, ma, height, volH, padding.top, padding.bottom, padding.left, padding.right]);

  if (!paths) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-[#4a525c]">
        No price data
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      {/* grid */}
      {paths.grid.map((g, i) => (
        <g key={i}>
          <line
            x1={padding.left}
            x2={W - padding.right}
            y1={g.y}
            y2={g.y}
            stroke="#1b2029"
            strokeWidth={1}
          />
          <text
            x={W - padding.right + 4}
            y={g.y + 3}
            fontSize={10}
            fill="#4a525c"
            className="tabular"
          >
            {g.label}
          </text>
        </g>
      ))}

      {/* volume bars */}
      {showVolume &&
        paths.candleEls.map((c, i) => (
          <rect
            key={`v${i}`}
            x={c.x - 3}
            y={c.volY}
            width={6}
            height={Math.max(0, c.volH)}
            fill={c.color}
            opacity={0.28}
          />
        ))}

      {/* candles */}
      {paths.candleEls.map((c, i) => (
        <g key={`c${i}`}>
          <line x1={c.x} x2={c.x} y1={c.yHigh} y2={c.yLow} stroke={c.color} strokeWidth={1} />
          <rect
            x={c.x - (Math.min(7, 4))}
            y={c.bodyTop}
            width={Math.min(8, 8)}
            height={c.bodyH}
            fill={c.color}
          />
        </g>
      ))}

      {/* MA overlay */}
      {paths.maPath && (
        <path
          d={paths.maPath}
          fill="none"
          stroke="#d4a02a"
          strokeWidth={1.4}
          opacity={0.9}
        />
      )}

      {/* last price line */}
      <line
        x1={padding.left}
        x2={W - padding.right}
        y1={paths.lastY}
        y2={paths.lastY}
        stroke={paths.lastColor}
        strokeWidth={1}
        strokeDasharray="3,3"
        opacity={0.7}
      />
      <rect
        x={W - padding.right}
        y={paths.lastY - 8}
        width={padding.right}
        height={16}
        fill={paths.lastColor}
      />
      <text
        x={W - padding.right + 3}
        y={paths.lastY + 3}
        fontSize={10}
        fill="#0b0e13"
        fontWeight={600}
        className="tabular"
      >
        {fmtPrice(paths.lastPrice)}
      </text>
    </svg>
  );
}

/// Tiny sparkline for table rows / mini panels.
export function Sparkline({
  data,
  width = 80,
  height = 24,
  color,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const path = useMemo(() => {
    if (data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const step = width / (data.length - 1);
    return data
      .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
      .join(" ");
  }, [data, width, height]);

  if (!path) return <span className="text-[#4a525c] text-[10px]">—</span>;
  const c = color ?? (data[data.length - 1] >= data[0] ? "#2e9e6d" : "#c7484b");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path} fill="none" stroke={c} strokeWidth={1.2} />
    </svg>
  );
}
