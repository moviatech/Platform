import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BackLink, safeBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { listClasses, loadActiveConfig } from "@/features/booking/service";
import { bookingSlots, currentTime, zonedParts } from "@/features/booking/time";
import { getLead } from "@/features/leads/queries";
import { NewReservationForm, type InitialDraft } from "@/features/reservations/NewReservationForm";
import { can, requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "New reservation" };

type Props = { searchParams: Promise<{ lead?: string; back?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function initialFromLead(leadId: string | undefined, allowed: boolean): Promise<InitialDraft | undefined> {
  if (!allowed || !leadId || !uuid.test(leadId)) return undefined;
  const lead = await getLead(leadId);
  if (!lead || lead.kind !== "BOOKING_REQUEST") return undefined;
  const payload = lead.payload ?? {};
  const text = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : "");
  return {
    leadId: lead.id,
    addOns: Array.isArray(payload.addOns) ? payload.addOns.filter((item): item is string => typeof item === "string") : [],
    values: {
      classSlug: text("vehicleSlug"),
      pickupDate: text("pickupDate"),
      pickupTime: text("pickupTime"),
      returnDate: text("returnDate"),
      returnTime: text("returnTime"),
      protection: text("protection") || "none",
      ratePlan: text("payment") === "now" ? "PAY_NOW" : "PAY_LATER",
      pickupMethod: text("pickupMethod") === "delivery" ? "DELIVERY" : "STORE",
      fullName: lead.name ?? "",
      phone: lead.phone ?? "",
      email: lead.email ?? "",
      wechat: lead.wechat ?? "",
      language: lead.locale === "zh" ? "zh" : "en",
      source: "WEB",
      customerNotes: text("notes"),
    },
  };
}

export default async function NewReservationPage({ searchParams }: Props) {
  const session = await requirePagePermission("reservation.create");
  const { lead, back } = await searchParams;
  const t = await getTranslations("reservations");
  const [classes, config, initial] = await Promise.all([listClasses(), loadActiveConfig(), initialFromLead(lead, can(session, "lead.view"))]);

  const zone = "America/Los_Angeles";
  const pickupDate = zonedParts(new Date(currentTime() + 86400000), zone).date;
  const returnDate = zonedParts(new Date(currentTime() + 4 * 86400000), zone).date;

  return (
    <>
      <BackLink href={safeBack(back, initial ? `/leads/${initial.leadId}` : "/reservations")} />
      <PageHeader title={t("new")} lead={initial ? t("newFromLead") : t("newLead")} />
      <NewReservationForm
        classes={classes.map((item) => ({ slug: item.slug, name: item.name, name_zh: item.name_zh, base_daily_rate_cents: item.base_daily_rate_cents }))}
        protections={config.data.protectionPlans.map((item) => item.id)}
        addOns={config.data.addOns.map((item) => item.id)}
        slots={bookingSlots(config.data.bookingWindow)}
        defaults={{ pickupDate, returnDate }}
        initial={initial}
      />
    </>
  );
}
