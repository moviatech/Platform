import "server-only";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureTripSurvey } from "./service";
import { tripSurveyEmail } from "./survey-email";

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
  const vehicle = (locale === "zh" ? (vehicleClass?.name_zh ?? vehicleClass?.name) : vehicleClass?.name) ?? "Tesla";
  const message = tripSurveyEmail({ locale, vehicle, number: row.number, token: survey.token });
  const result = await sendEmail({ log: false, to: customer.email, subject: message.subject, text: message.text, html: message.html });
  if (!result.sent) return { sent: false, reason: result.reason };
  await supabase.from("trip_surveys").update({ sent_at: new Date().toISOString() }).eq("id", survey.id);
  await audit({ actorUserId: null, actorType: "SYSTEM", action: "survey.sent", entityType: "reservation", entityId: reservationId, metadata: { number: row.number } }).catch(() => undefined);
  return { sent: true };
}
