"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils/cn";
import type { DayPoint } from "../analysis";
import { exact, niceTop, shortDay, whole, type UiLocale } from "../figures";

export type TrendSeries = { key: string; label: string; points: DayPoint[] };

type Props = { series: TrendSeries[]; locale: UiLocale; labels: { chart: string; table: string; day: string; none: string } };

export const markColor = "#b8862f";

const width = 720;

const height = 250;

const pad = { top: 14, right: 18, bottom: 30, left: 46 };

const pill = "rounded-pill px-3 py-1 text-[12px] hairline hover:border-ink/25";

export function Trend({ series, locale, labels }: Props) {
  const [active, setActive] = useState(series[0]?.key ?? "");
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const current = series.find((item) => item.key === active) ?? series[0];
  const points = current?.points ?? [];
  const last = Math.max(1, points.length - 1);
  const top = niceTop(Math.max(0, ...points.map((point) => point.value)));
  const x = (index: number) => pad.left + (index * (width - pad.left - pad.right)) / last;
  const y = (value: number) => pad.top + (height - pad.top - pad.bottom) * (1 - value / top);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const area = points.length > 1 ? `${line} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z` : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => top * share);
  const marks = [...new Set([0, 1, 2, 3, 4, 5].map((step) => Math.round((step * (points.length - 1)) / 5)))].filter((index) => index >= 0 && index < points.length);
  const shown = hover !== null && hover < points.length ? hover : null;

  const track = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !points.length) return;
    const ratio = (event.clientX - box.left) / box.width;
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  };

  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!points.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const from = shown ?? (event.key === "ArrowRight" ? -1 : points.length);
      setHover(Math.min(points.length - 1, Math.max(0, from + (event.key === "ArrowRight" ? 1 : -1))));
    } else if (event.key === "Escape") setHover(null);
  };

  if (!current) return <p className="text-sm text-muted">{labels.none}</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {series.length > 1 &&
            series.map((item) => (
              <button key={item.key} type="button" aria-pressed={item.key === current.key} onClick={() => setActive(item.key)} className={cn(pill, item.key === current.key && "bg-ink text-white")}>
                {item.label}
              </button>
            ))}
        </div>
        <button type="button" aria-pressed={asTable} onClick={() => setAsTable((value) => !value)} className="text-[12px] text-muted hover:text-ink">
          {asTable ? labels.chart : labels.table}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-72 overflow-auto rounded-xl border border-ink/[0.07]">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-pearl text-left text-[11px] tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{labels.day}</th>
                <th className="px-3 py-2 text-right font-medium">{current.label}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.05]">
              {points.map((point) => (
                <tr key={point.day}>
                  <td className="px-3 py-1.5 tabular-nums">{point.day}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{exact(point.value, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-gold/15" tabIndex={0} role="group" aria-label={current.label} onKeyDown={step} onBlur={() => setHover(null)}>
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={current.label}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="#111111" strokeOpacity="0.07" strokeWidth="1" />
                <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#747474" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {whole(tick, locale)}
                </text>
              </g>
            ))}
            {marks.map((index) => (
              <text key={index} x={x(index)} y={height - 9} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} fontSize="11" fill="#747474">
                {shortDay(points[index].day, locale)}
              </text>
            ))}
            {area && <path d={area} fill={markColor} fillOpacity="0.1" />}
            {points.length > 1 ? <path d={line} fill="none" stroke={markColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /> : points.length === 1 ? <circle cx={x(0)} cy={y(points[0].value)} r="4.5" fill={markColor} /> : null}
            {shown !== null && (
              <g>
                <line x1={x(shown)} x2={x(shown)} y1={pad.top} y2={height - pad.bottom} stroke="#111111" strokeOpacity="0.28" strokeWidth="1" />
                <circle cx={x(shown)} cy={y(points[shown].value)} r="5" fill={markColor} stroke="#ffffff" strokeWidth="2" />
              </g>
            )}
            <rect x={pad.left} y={pad.top} width={width - pad.left - pad.right} height={height - pad.top - pad.bottom} fill="transparent" onPointerMove={track} onPointerDown={track} onPointerLeave={() => setHover(null)} />
          </svg>
          {shown !== null && (
            <div className="pointer-events-none absolute top-1 rounded-lg border border-ink/10 bg-white px-2.5 py-1.5 text-[12px] shadow-soft" style={{ left: `${(x(shown) / width) * 100}%`, transform: `translateX(${shown > points.length / 2 ? "calc(-100% - 10px)" : "10px"})` }}>
              <p className="font-semibold text-ink tabular-nums">{exact(points[shown].value, locale)}</p>
              <p className="text-muted">
                {current.label} · {shortDay(points[shown].day, locale)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
