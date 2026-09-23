import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ops/PageHeader";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Customers" };

type Props = { searchParams: Promise<{ q?: string }> };

const grid = "md:grid-cols-[minmax(0,1.3fr)_8.5rem_minmax(0,1.4fr)_minmax(0,1fr)_7.5rem]";

export default async function CustomersPage({ searchParams }: Props) {
  const session = await requirePagePermission("customer.view_basic");
  const { q } = await searchParams;
  const t = await getTranslations("customers");
  const common = await getTranslations("common");
  const locale = await getLocale();

  const supabase = await createClient();
  let query = supabase.from("customers").select("id, full_name, email, phone, wechat, dnr_flag, created_at").order("created_at", { ascending: false }).limit(100);
  const term = (q ?? "").trim().replace(/[%_,()]/g, " ").slice(0, 60);
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,wechat.ilike.%${term}%`);
  const { data } = await query;
  const customers = data ?? [];

  return (
    <>
      <PageHeader
        title={t("title")}
        lead={t("lead")}
        actions={
          <div className="flex items-center gap-2">
            <form action="/customers">
              <input
                type="search"
                name="q"
                defaultValue={q ?? ""}
                placeholder={t("search")}
                className="h-9 w-56 rounded-xl border border-ink/10 bg-white px-3 text-[13px] placeholder:text-muted/70 focus:border-gold/60 focus:outline-none focus:ring-4 focus:ring-gold/10"
              />
            </form>
            {can(session, "customer.edit") && (
              <ButtonLink href="/customers/new" size="sm">
                {t("new")}
              </ButtonLink>
            )}
          </div>
        }
      />
      {customers.length === 0 ? (
        <div className="card px-6 py-14 text-center text-sm text-muted">{common("empty")}</div>
      ) : (
        <div className="card overflow-hidden">
          <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid ${grid}`}>
            <span>{t("columns.name")}</span>
            <span>{t("columns.phone")}</span>
            <span>{t("columns.email")}</span>
            <span>{t("columns.wechat")}</span>
            <span className="text-right">{t("columns.created")}</span>
          </div>
          <ul className="divide-y divide-ink/[0.06]">
            {customers.map((customer) => (
              <li key={customer.id}>
                <Link href={`/customers/${customer.id}`} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 py-3.5 text-sm transition-colors hover:bg-gold/[0.04] md:items-center ${grid}`}>
                  <span className="truncate font-medium">
                    {customer.full_name}
                    {customer.dnr_flag && (
                      <Badge tone="danger" className="ml-2">
                        DNR
                      </Badge>
                    )}
                  </span>
                  <span className="text-right text-[13px] tabular-nums text-charcoal md:text-left">{customer.phone || "—"}</span>
                  <span className="truncate text-[13px] text-charcoal">{customer.email || "—"}</span>
                  <span className="truncate text-[13px] text-charcoal">{customer.wechat || "—"}</span>
                  <span className="col-span-2 text-xs text-muted md:col-span-1 md:text-right">{formatDateTime(customer.created_at, locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
