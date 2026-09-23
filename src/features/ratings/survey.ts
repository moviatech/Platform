import "server-only";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email/template";
import { rootDomain } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureTripSurvey } from "./service";

const copy = {
  zh: { subject: (number: string) => `这趟旅程怎么样？· ${number}`, title: "这趟旅程怎么样？", intro: (vehicle: string) => `${vehicle} 已顺利归还。花一分钟给每个环节打个分，帮我们把下一次做得更好。`, cta: "评价本次行程" },
  en: { subject: (number: string) => `How was your trip? · ${number}`, title: "How was your trip?", intro: (vehicle: string) => `Your ${vehicle} is back. Take a minute to rate each step so we can make the next trip even better.`, cta: "Rate your trip" },
};

export async function sendTripSurvey(reservationId: string): Promise<{ sent: boolean; reason?: string }> {
  const survey = await ensureTripSurvey(reservationId);
  if (!survey || survey.sent_at) return { sent: false };
  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("reservations")
    .select("number, customer:customers(email, preferred_language), vehicle_class:vehicle_classes(name, name_zh)")
    .eq("id", reservationId)
    .maybeSingle();
  const customer = Array.isArray(row?.customer) ? row?.customer[0] : row?.customer;
  const vehicleClass = Array.isArray(row?.vehicle_class) ? row?.vehicle_class[0] : row?.vehicle_class;
  if (!row || !customer?.email) return { sent: false };
  const locale = customer.preferred_language === "zh" ? "zh" : "en";
  const text = copy[locale];
  const vehicle = (locale === "zh" ? (vehicleClass?.name_zh ?? vehicleClass?.name) : vehicleClass?.name) ?? "Tesla";
  const rendered = renderEmail({
    preheader: row.number,
    title: text.title,
    blocks: [
      { type: "paragraph", text: text.intro(vehicle) },
      { type: "button", label: text.cta, href: `https://account.${rootDomain}/survey/${survey.token}` },
    ],
  });
  const result = await sendEmail({ to: customer.email, subject: text.subject(row.number), text: rendered.text, html: rendered.html });
  if (!result.sent) return { sent: false, reason: result.reason };
  await supabase.from("trip_surveys").update({ sent_at: new Date().toISOString() }).eq("id", survey.id);
  await audit({ actorUserId: null, actorType: "SYSTEM", action: "survey.sent", entityType: "reservation", entityId: reservationId, metadata: { number: row.number } }).catch(() => undefined);
  return { sent: true };
}
