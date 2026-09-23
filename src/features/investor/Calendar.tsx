import { cn } from "@/lib/utils/cn";

export function MonthCalendar({ month, rented, maintenance, weekdays, legend, activeFrom, activeTo }: { month: string; rented: Set<string>; maintenance: Set<string>; weekdays: string[]; legend: { rented: string; idle: string; maintenance: string }; activeFrom?: string; activeTo?: string | null }) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const cells: Array<{ day: number; key: string } | null> = [];
  for (let i = 0; i < offset; i += 1) cells.push(null);
  for (let day = 1; day <= days; day += 1) cells.push({ day, key: `${month}-${String(day).padStart(2, "0")}` });
  while (cells.length % 7 !== 0) cells.push(null);
  const inactive = (key: string) => (activeFrom && key < activeFrom) || (activeTo && key > activeTo);
  return (
    <div>
      <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-ink/[0.07] text-center text-[12px]">
        {weekdays.map((label) => (
          <div key={label} className="border-b border-ink/[0.07] bg-pearl/60 py-2 text-[11px] text-muted">
            {label}
          </div>
        ))}
        {cells.map((cell, index) => {
          if (!cell) return <div key={`empty-${index}`} className="h-10 border-r border-b border-ink/[0.05] last:border-r-0" />;
          const tone = inactive(cell.key) ? "text-muted/40" : maintenance.has(cell.key) ? "bg-ink/[0.06] text-charcoal" : rented.has(cell.key) ? "bg-gold/15 text-ink font-medium" : "text-charcoal";
          return (
            <div key={cell.key} className={cn("flex h-10 items-center justify-center border-r border-b border-ink/[0.05] [&:nth-child(7n)]:border-r-0", tone)}>
              {cell.day}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-gold/60" />
          {legend.rented}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border border-ink/15 bg-white" />
          {legend.idle}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-ink/20" />
          {legend.maintenance}
        </span>
      </div>
    </div>
  );
}
