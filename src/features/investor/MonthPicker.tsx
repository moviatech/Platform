import Link from "next/link";
import { Icon } from "@/features/portal/icons";

export function MonthPicker({ month, label, base, max }: { month: string; label: string; base: string; max: string }) {
  const [y, m] = month.split("-").map(Number);
  const shift = (delta: number) => {
    const date = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const prev = shift(-1);
  const next = shift(1);
  const link = "flex size-9 items-center justify-center rounded-full text-charcoal hover:bg-ink/5";
  return (
    <span className="inline-flex h-11 items-center gap-1 rounded-xl bg-white px-1 hairline">
      <Link href={`${base}?month=${prev}`} className={link} aria-label={prev}>
        <Icon name="chevron" size={14} className="rotate-180" />
      </Link>
      <span className="min-w-28 text-center text-[14px] font-medium">{label}</span>
      {next <= max ? (
        <Link href={`${base}?month=${next}`} className={link} aria-label={next}>
          <Icon name="chevron" size={14} />
        </Link>
      ) : (
        <span className={`${link} opacity-30`}>
          <Icon name="chevron" size={14} />
        </span>
      )}
    </span>
  );
}
