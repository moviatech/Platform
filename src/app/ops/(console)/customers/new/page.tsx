import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ops/PageHeader";
import { NewCustomerForm } from "@/features/customers/NewCustomerForm";
import { requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  await requirePagePermission("customer.edit");
  const t = await getTranslations("customers");
  const common = await getTranslations("common");

  return (
    <>
      <Link href="/customers" className="mb-4 inline-block text-[13px] text-muted hover:text-ink">
        ← {common("back")}
      </Link>
      <PageHeader title={t("new")} lead={t("newLead")} />
      <section className="card max-w-3xl p-6">
        <NewCustomerForm />
      </section>
    </>
  );
}
