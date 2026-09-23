import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { NewInvestorForm } from "@/features/investor/OpsForms";
import { requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "New investor" };

export default async function NewInvestorPage() {
  await requirePagePermission("investor.manage");
  const t = await getTranslations("investors");
  return (
    <>
      <BackLink href="/investors" />
      <PageHeader title={t("new")} lead={t("newLead")} />
      <section className="card max-w-3xl p-6">
        <NewInvestorForm />
      </section>
    </>
  );
}
