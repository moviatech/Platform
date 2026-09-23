import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ops/PageHeader";
import { zonedParts } from "@/features/booking/time";
import { FinanceTabs } from "@/features/finance/FinanceTabs";
import { VendorEdit, VendorForm } from "@/features/finance/VendorForms";
import { loadVendors } from "@/features/finance/vendor-queries";
import { missingW9 } from "@/features/finance/vendors";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const session = await requirePagePermission("finance.view");
  const today = zonedParts(new Date(), "America/Los_Angeles").date;
  const year = today.slice(0, 4);
  const [t, tabs, data] = await Promise.all([getTranslations("expenses"), getTranslations("finance.tabs"), loadVendors(year)]);
  const record = can(session, "finance.review");
  const grid = "md:grid-cols-[minmax(0,1.4fr)_9rem_4rem_7rem_9rem]";

  return (
    <>
      <PageHeader title={tabs("vendors")} />
      <FinanceTabs current="vendors" />
      {record && (
        <section className="card mb-6 px-5 py-5">
          <VendorForm today={today} />
        </section>
      )}
      <div className="card overflow-hidden">
        <div className={`hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid ${grid}`}>
          <span>{t("vendors.name")}</span>
          <span>{t("vendors.taxClass")}</span>
          <span>1099</span>
          <span>W-9</span>
          <span className="text-right">{t("vendors.yearPaid", { year })}</span>
        </div>
        {data.vendors.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{t("vendors.empty")}</p>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {data.vendors.map((vendor) => {
              const paid = data.totals.get(vendor.id) ?? 0;
              const alert = missingW9(vendor, paid);
              const cells = (
                <>
                  <span className="min-w-0 truncate">
                    {vendor.name}
                    {!vendor.active && <span className="text-muted"> · {t("vendors.inactive")}</span>}
                    {vendor.note && <span className="text-muted"> · {vendor.note}</span>}
                  </span>
                  <span className="text-muted">{t(`vendors.taxClasses.${vendor.tax_class}`)}</span>
                  <span>{vendor.needs_1099 ? <Badge tone="gold">1099</Badge> : <span className="text-muted">—</span>}</span>
                  <span className={cn(vendor.w9_received_on ? "" : "text-muted")}>{vendor.w9_received_on ?? t("vendors.w9Missing")}</span>
                  <span className={cn("tabular-nums md:text-right", alert && "font-medium text-status-danger")} title={alert ? t("vendors.missingW9") : undefined}>
                    {formatMoney(paid)}
                    {alert && <span className="ml-1 text-[11px]">{t("vendors.missingW9")}</span>}
                  </span>
                </>
              );
              return (
                <li key={vendor.id} data-vendor={vendor.id} className={cn(!vendor.active && "opacity-60")}>
                  {record ? (
                    <details>
                      <summary className={`grid cursor-pointer list-none grid-cols-2 gap-x-4 gap-y-1 px-5 py-3 text-[13px] md:items-center ${grid}`}>{cells}</summary>
                      <div className="border-t border-ink/[0.06] bg-pearl/40 px-5 py-4">
                        <VendorEdit vendor={vendor} today={today} canDelete={!data.used.has(vendor.id)} />
                      </div>
                    </details>
                  ) : (
                    <div className={`grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3 text-[13px] md:items-center ${grid}`}>{cells}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {data.unlinked.length > 0 && (
        <section className="card mt-6 overflow-hidden">
          <h2 className="border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">{t("vendors.unlinked", { year })}</h2>
          <ul className="divide-y divide-ink/[0.06]">
            {data.unlinked.map((payee) => (
              <li key={payee.name} data-payee className="flex items-center justify-between gap-4 px-5 py-2.5 text-[13px]">
                <span className="min-w-0 truncate">{payee.name}</span>
                <span className="tabular-nums">{formatMoney(payee.cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
