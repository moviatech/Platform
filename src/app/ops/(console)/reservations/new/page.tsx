import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BackLink, safeBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { listClasses, loadActiveConfig } from "@/features/booking/service";
import { bookingSlots, currentTime, zonedParts } from "@/features/booking/time";
import { getLead } from "@/features/leads/queries";
import { NewReservationForm, type InitialDraft } from "@/features/reservations/NewReservationForm";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New reservation" };

type Props = { searchParams: Promise<{ lead?: string; conversation?: string; back?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function initialFromLead(leadId: string | undefined, allowed: boolean): Promise<InitialDraft | undefined> {
  if (!allowed || !leadId || !uuid.test(leadId)) return undefined;
  const lead = await getLead(leadId);
  if (!lead) return undefined;
  const payload = lead.payload ?? {};
  const text = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : "");
  const booking = lead.kind === "BOOKING_REQUEST";
  return {
    leadId: lead.id,
    addOns: booking && Array.isArray(payload.addOns) ? payload.addOns.filter((item): item is string => typeof item === "string") : [],
    values: {
      classSlug: text("vehicleSlug"),
      pickupDate: text("pickupDate"),
      pickupTime: text("pickupTime") || "10:00",
      returnDate: text("returnDate"),
      returnTime: text("returnTime") || "10:00",
      protection: text("protection") || "none",
      ratePlan: text("payment") === "now" ? "PAY_NOW" : "PAY_LATER",
      pickupMethod: text("pickupMethod") === "delivery" ? "DELIVERY" : text("pickupMethod") === "self" ? "SELF_SERVICE" : "STORE",
      fullName: lead.name ?? "",
      phone: lead.phone ?? "",
      email: lead.email ?? "",
      wechat: lead.wechat ?? "",
      language: lead.locale === "zh" ? "zh" : "en",
      source: "WEB",
      customerNotes: booking ? text("notes") : text("message"),
    },
  };
}

async function initialFromConversation(conversationId: string | undefined): Promise<InitialDraft | undefined> {
  if (!conversationId || !uuid.test(conversationId)) return undefined;
  const supabase = await createClient();
  const { data: conversation } = await supabase.from("conversations").select("customer_name, customer_email, locale, customer_id").eq("id", conversationId).maybeSingle();
  if (!conversation) return undefined;
  const { data: customer } = conversation.customer_id ? await supabase.from("customers").select("full_name, phone, wechat").eq("id", conversation.customer_id).maybeSingle() : { data: null };
  return {
    addOns: [],
    values: {
      pickupTime: "10:00",
      returnTime: "10:00",
      protection: "none",
      ratePlan: "PAY_LATER",
      pickupMethod: "STORE",
      fullName: customer?.full_name ?? conversation.customer_name ?? "",
      phone: customer?.phone ?? "",
      email: conversation.customer_email ?? "",
      wechat: customer?.wechat ?? "",
      language: conversation.locale === "zh" ? "zh" : "en",
      source: "WEB",
    },
  };
}

export default async function NewReservationPage({ searchParams }: Props) {
  const session = await requirePagePermission("reservation.create");
  const { lead, conversation, back } = await searchParams;
  const t = await getTranslations("reservations");
  const [classes, config, initial] = await Promise.all([listClasses(), loadActiveConfig(), lead ? initialFromLead(lead, can(session, "lead.view")) : initialFromConversation(conversation)]);

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
