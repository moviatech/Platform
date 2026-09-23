import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { signed, type Change } from "../figures";

const pill = "rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25";

export const barColor = "#b8862f";

export function Choice({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn(pill, active && "bg-ink text-white")} scroll={false}>
      {children}
    </Link>
  );
}

export function Delta({ change, better = "up" }: { change: Change; better?: "up" | "down" }) {
  if (change.direction === "flat" || change.ratio === null) return <span className="text-[12px] text-muted">{change.ratio === null ? "—" : signed(change.ratio)}</span>;
  const good = (change.direction === "up") === (better === "up");
  return (
    <span className={cn("text-[12px] font-medium tabular-nums", good ? "text-status-available" : "text-status-danger")}>
      <span aria-hidden="true">{change.direction === "up" ? "↑" : "↓"}</span> {signed(change.ratio)}
    </span>
  );
}

export function Tile({ label, value, change, better }: { label: string; value: string; change?: Change; better?: "up" | "down" }) {
  return (
    <div className="card min-w-0 p-5">
      <p className="text-xs font-medium tracking-wide text-muted">{label}</p>
      <p className="mt-2 truncate text-[1.7rem] leading-none font-semibold tracking-tight">{value}</p>
      <p className="mt-2.5 h-4">{change && <Delta change={change} better={better} />}</p>
    </div>
  );
}

export function Panel({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("card min-w-0 p-5", className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Bar({ share }: { share: number }) {
  const width = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0)) * 100;
  return (
    <span className="block h-1.5 w-full" aria-hidden="true">
      <span className="block h-full rounded-r-[4px]" style={{ width: `${width}%`, minWidth: width > 0 ? 2 : 0, backgroundColor: barColor }} />
    </span>
  );
}

export type Column<Row> = { key: string; label: string; align?: "left" | "right"; cell: (row: Row) => ReactNode; width?: string };

export function Ranked<Row>({ rows, columns, name, share, empty, rowKey }: { rows: Row[]; columns: Array<Column<Row>>; name: Column<Row>; share?: (row: Row) => number; empty: string; rowKey: (row: Row) => string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] text-[13px]">
        <thead>
          <tr className="text-[11px] tracking-wide text-muted">
            <th className="pb-2 text-left font-medium">{name.label}</th>
            {columns.map((column) => (
              <th key={column.key} className={cn("pb-2 pl-4 font-medium whitespace-nowrap", column.align === "left" ? "text-left" : "text-right")} style={column.width ? { width: column.width } : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/[0.05]">
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              <td className="max-w-0 py-2 align-top" style={{ width: "100%" }}>
                <div className="truncate text-charcoal">{name.cell(row)}</div>
                {share && (
                  <div className="mt-1.5">
                    <Bar share={share(row)} />
                  </div>
                )}
              </td>
              {columns.map((column) => (
                <td key={column.key} className={cn("py-2 pl-4 align-top whitespace-nowrap tabular-nums", column.align === "left" ? "text-left" : "text-right")}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Notice({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warning" }) {
  return <div className={cn("card px-6 py-10 text-center text-sm", tone === "warning" ? "text-status-danger" : "text-muted")}>{children}</div>;
}
