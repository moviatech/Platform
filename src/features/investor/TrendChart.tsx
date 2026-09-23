import { formatMoney } from "@/lib/utils/format";
import type { TrendPoint } from "./earnings";

export function TrendChart({ points, labels, legend }: { points: TrendPoint[]; labels: string[]; legend: { settled: string; pending: string } }) {
  const width = 720;
  const height = 240;
  const pad = { top: 30, right: 44, bottom: 36, left: 56 };
  const settled = points.map((point) => point.settledCents);
  const totals = points.map((point) => point.settledCents + point.pendingCents);
  const max = Math.max(1, ...totals);
  const step = Math.pow(10, Math.floor(Math.log10(max))) / 2 || 1;
  const top = Math.ceil(max / step) * step;
  const x = (index: number) => pad.left + (index * (width - pad.left - pad.right)) / Math.max(1, points.length - 1);
  const y = (value: number) => pad.top + (height - pad.top - pad.bottom) * (1 - value / top);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => top * ratio);
  const path = (values: number[]) => values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const area = `${path(settled)} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const anchor = (index: number) => (index === 0 ? "start" : index === points.length - 1 ? "end" : "middle");
  const label = (cents: number) => formatMoney(cents).replace(/\.00$/, "");
  return (
    <div>
      <div className="no-scrollbar overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[34rem]" role="img" aria-label={legend.settled}>
          <defs>
            <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#b58b4b" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#b58b4b" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="#111" strokeOpacity="0.06" />
              <text x={pad.left - 10} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#747474">
                {label(tick)}
              </text>
            </g>
          ))}
          {settled.some((value) => value > 0) && <path d={area} fill="url(#trendFill)" />}
          {totals.some((value, index) => value !== settled[index]) && <path d={path(totals)} fill="none" stroke="#b58b4b" strokeWidth="2" strokeDasharray="5 5" strokeLinejoin="round" />}
          <path d={path(settled)} fill="none" stroke="#b58b4b" strokeWidth="2" strokeLinejoin="round" />
          {points.map((point, index) => {
            const total = settled[index] + point.pendingCents;
            const stacked = point.pendingCents > 0 && y(settled[index]) - y(total) < 26;
            return (
              <g key={point.month}>
                {point.pendingCents > 0 && (
                  <>
                    <circle cx={x(index)} cy={y(total)} r="4.5" fill="#fff" stroke="#b58b4b" strokeWidth="2" />
                    <text x={x(index)} y={y(total) - 11} textAnchor={anchor(index)} fontSize="12" fill="#b58b4b" fontWeight="500" stroke="#fff" strokeWidth="3" paintOrder="stroke">
                      {label(total)}
                    </text>
                  </>
                )}
                <circle cx={x(index)} cy={y(settled[index])} r="4.5" fill="#b58b4b" stroke="#fff" strokeWidth="1.5" />
                {settled[index] > 0 && (
                  <text x={x(index)} y={stacked ? y(settled[index]) + 20 : y(settled[index]) - 11} textAnchor={anchor(index)} fontSize="12" fill="#111" fontWeight="500" stroke="#fff" strokeWidth="3" paintOrder="stroke">
                    {label(settled[index])}
                  </text>
                )}
                <text x={x(index)} y={height - 10} textAnchor="middle" fontSize="12" fill="#747474">
                  {labels[index]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex justify-center gap-6 text-[12px] text-muted">
        <span className="flex items-center gap-2">
          <span className="h-px w-5 bg-gold" />
          <span className="-ml-4 size-2 rounded-full bg-gold" />
          {legend.settled}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-px w-5 border-t border-dashed border-gold" />
          <span className="-ml-4 size-2 rounded-full border border-gold bg-white" />
          {legend.pending}
        </span>
      </div>
    </div>
  );
}
