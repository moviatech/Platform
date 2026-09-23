import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { OutreachForm } from "@/features/inbox/OutreachForm";
import { requirePagePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "New conversation" };

type Props = { searchParams: Promise<{ q?: string }> };

export default async function NewConversationPage({ searchParams }: Props) {
  const session = await requirePagePermission("inbox.reply");
  const { q } = await searchParams;
  const t = await getTranslations("inbox.outreach");
  const supabase = createAdminClient();
  const term = (q ?? "").trim().replace(/[%_,()]/g, " ").slice(0, 60);
  const [{ data: customers }, { count }] = await Promise.all([
    term
      ? supabase.from("customers").select("id, full_name, email, phone").or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`).order("full_name").limit(40)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string; email: string | null; phone: string | null }> }),
    supabase.from("customers").select("id", { count: "exact", head: true }).not("email", "is", null),
  ]);
  const canBroadcast = session.roles.includes("SUPER_ADMIN") || session.roles.includes("STAFF");

  return (
    <>
      <BackLink href="/inbox" />
      <PageHeader title={t("title")} />
      <div className="max-w-3xl">
        <OutreachForm customers={customers ?? []} totalCustomers={count ?? 0} canBroadcast={canBroadcast} query={term} />
      </div>
    </>
  );
}
