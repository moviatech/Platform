"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type FilterSelect = { name: string; label: string; options: Array<{ value: string; label: string }> };

export function QueryFilters({ search, selects }: { search?: { name: string; placeholder: string }; selects: FilterSelect[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const update = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };
  const field = "h-9 rounded-xl border border-ink/10 bg-white px-3 text-[13px] text-charcoal focus:border-gold/60 focus:outline-none focus:ring-4 focus:ring-gold/10";
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {search && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            update(search.name, String(new FormData(event.currentTarget).get(search.name) ?? "").trim());
          }}
        >
          <input type="search" name={search.name} defaultValue={params.get(search.name) ?? ""} placeholder={search.placeholder} className={`${field} w-56 placeholder:text-muted/70`} />
        </form>
      )}
      {selects.map((select) => (
        <select key={select.name} value={params.get(select.name) ?? ""} onChange={(event) => update(select.name, event.target.value)} aria-label={select.label} className={field}>
          <option value="">{select.label}</option>
          {select.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
