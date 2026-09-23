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
    phoneAlias: location.support_phone ? "" : base.phoneAlias,
    email: location.support_email || base.email,
    wechat: location.support_wechat || base.wechat,
    hours: { en: location.support_hours || base.hours.en, zh: location.support_hours_zh || location.support_hours || base.hours.zh },
  };
}

type Relevant = { pickup_location_id: string | null; location: LocationSupport | null };

async function relevantForCustomer(customerId: string): Promise<Relevant | null> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const columns = `pickup_location_id, location:locations!reservations_pickup_location_id_fkey(${supportColumns})`;
  const [{ data: active }, { data: upcoming }, { data: latest }] = await Promise.all([
    admin.from("reservations").select(columns).eq("customer_id", customerId).eq("status", "ACTIVE").order("pickup_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("reservations").select(columns).eq("customer_id", customerId).in("status", ["CONFIRMED", "REQUESTED", "PENDING_PAYMENT"]).gte("pickup_at", now).order("pickup_at").limit(1).maybeSingle(),
    admin.from("reservations").select(columns).eq("customer_id", customerId).order("pickup_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const rows = [active, upcoming].map((row) => row as unknown as Relevant | null);
  return rows.find((row) => row?.pickup_location_id) ?? (latest as unknown as Relevant | null) ?? null;
}

export async function supportForCustomer(customerId: string): Promise<LocationSupport | null> {
  const relevant = await relevantForCustomer(customerId);
  return relevant?.pickup_location_id ? relevant.location : null;
}
