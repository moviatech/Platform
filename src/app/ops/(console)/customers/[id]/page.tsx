import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { BackLink, safeBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { CustomerForm, type CustomerRecord } from "@/features/customers/CustomerForm";
import { ReservationTable } from "@/features/reservations/ReservationTable";
import type { ReservationListItem } from "@/features/reservations/types";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Customer" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomerPage({ params, searchParams }: Props) {
  const session = await requirePagePermission("customer.view_basic");
  const { id } = await params;
  const { back } = await searchParams;
  if (!uuid.test(id)) notFound();

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("id, full_name, email, phone, wechat, preferred_language, date_of_birth, dnr_flag, dnr_reason, internal_notes, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!customer) notFound();

  const { data: trips } = await supabase
    .from("reservations")
    .select(
      "id, number, status, pickup_at, return_at, rental_days, total_cents, payment_state, booking_source, customer:customers(id, full_name, phone), vehicle_class:vehicle_classes(name, name_zh), vehicle:vehicles!reservations_assigned_vehicle_id_fkey(id, fleet_number)",
    )
    .eq("customer_id", id)
    .order("pickup_at", { ascending: false })
    .limit(50);
  const reservations = (trips ?? []) as unknown as ReservationListItem[];

  const t = await getTranslations("customers");
  const completed = reservations.filter((item) => item.status === "COMPLETED");
  const stats = [
    { label: t("stats.trips"), value: String(reservations.length) },
    { label: t("stats.completed"), value: String(completed.length) },
    { label: t("stats.revenue"), value: formatMoney(completed.reduce((sum, item) => sum + item.total_cents, 0)) },
    { label: t("stats.cancelled"), value: String(reservations.filter((item) => item.status === "CANCELLED" || item.status === "NO_SHOW").length) },
  ];

  return (
    <>
      <BackLink href={safeBack(back, "/customers")} />
      <PageHeader title={customer.full_name} actions={customer.dnr_flag ? <Badge tone="danger">{t("fields.dnr")}</Badge> : undefined} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((item) => (
          <div key={item.label} className="card px-5 py-4">
            <p className="text-xs text-muted">{item.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{item.value}</p>
          </div>
        ))}
      </div>
      <section className="card mb-5 max-w-4xl p-6">
        <CustomerForm customer={customer as CustomerRecord} editable={can(session, "customer.edit")} />
      </section>
      <h2 className="mb-3 text-sm font-semibold">{t("history")}</h2>
      <ReservationTable reservations={reservations} backTo={`/customers/${id}`} />
    </>
  );
}
