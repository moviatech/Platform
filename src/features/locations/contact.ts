import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PortalContent } from "@/features/portal/content";

export type Contact = PortalContent["contact"];
export type LocationSupport = { support_phone: string | null; support_email: string | null; support_wechat: string | null; support_hours: string | null; support_hours_zh: string | null };

export const supportColumns = "support_phone, support_email, support_wechat, support_hours, support_hours_zh";

export function mergeContact(base: Contact, location: LocationSupport | null | undefined): Contact {
  if (!location) return base;
  return {
    phone: location.support_phone || base.phone,
    email: location.support_email || base.email,
    wechat: location.support_wechat || base.wechat,
    hours: { en: location.support_hours || base.hours.en, zh: location.support_hours_zh || location.support_hours || base.hours.zh },
  };
}

export async function locationSupport(locationId: string | null | undefined): Promise<LocationSupport | null> {
  if (!locationId) return null;
  const { data } = await createAdminClient().from("locations").select(supportColumns).eq("id", locationId).maybeSingle();
  return (data as LocationSupport | null) ?? null;
}

export async function relevantLocationForCustomer(customerId: string): Promise<string | null> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: active } = await admin.from("reservations").select("pickup_location_id").eq("customer_id", customerId).eq("status", "ACTIVE").order("pickup_at", { ascending: false }).limit(1).maybeSingle();
  if (active?.pickup_location_id) return active.pickup_location_id as string;
  const { data: upcoming } = await admin.from("reservations").select("pickup_location_id").eq("customer_id", customerId).in("status", ["CONFIRMED", "REQUESTED", "PENDING_PAYMENT"]).gte("pickup_at", now).order("pickup_at").limit(1).maybeSingle();
  if (upcoming?.pickup_location_id) return upcoming.pickup_location_id as string;
  const { data: latest } = await admin.from("reservations").select("pickup_location_id").eq("customer_id", customerId).order("pickup_at", { ascending: false }).limit(1).maybeSingle();
  return (latest?.pickup_location_id as string | undefined) ?? null;
}

export async function contactForCustomer(customerId: string, base: Contact): Promise<Contact> {
  return mergeContact(base, await locationSupport(await relevantLocationForCustomer(customerId)));
}
