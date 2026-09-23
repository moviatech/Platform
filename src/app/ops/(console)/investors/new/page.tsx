import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { currentTime, zonedParts } from "@/features/booking/time";
import { listCompanies } from "@/features/investor/members";
import { NewInvestorForm } from "@/features/investor/OpsForms";
import { requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "New investor" };

type Props = { searchParams: Promise<{ company?: string }> };

export default async function NewInvestorPage({ searchParams }: Props) {
  await requirePagePermission("investor.manage");
  const { company } = await searchParams;
  const [t, companies] = await Promise.all([getTranslations("investors"), listCompanies()]);
  const preset = companies.find((item) => item.id === company)?.id ?? "";
  return (
    <>
      <BackLink href={preset ? `/investors/${preset}` : "/investors"} />
      <PageHeader title={t("new")} lead={t("newLead")} />
      <section className="card max-w-3xl p-6">
        <NewInvestorForm companies={companies} companyId={preset} today={zonedParts(new Date(currentTime()), "America/Los_Angeles").date} />
      </section>
    </>
  );
}
