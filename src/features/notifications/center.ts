import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type Audience = "STAFF" | "CUSTOMER" | "INVESTOR";

export type Notification = {
  id: string;
  audience: Audience;
  customer_id: string | null;
  investor_id: string | null;
  reservation_id: string | null;
  kind: string;
  params: Record<string, unknown>;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

type Input = { kind: string; params?: Record<string, unknown>; href?: string | null; reservationId?: string | null; dedupeKey?: string | null };

async function insert(audience: Audience, customerId: string | null, input: Input, investorId: string | null = null) {
  const row = {
    audience,
    customer_id: customerId,
    investor_id: investorId,
    reservation_id: input.reservationId ?? null,
    kind: input.kind,
    params: input.params ?? {},
    href: input.href ?? null,
    dedupe_key: input.dedupeKey ?? null,
  };
  const supabase = createAdminClient();
  if (row.dedupe_key) {
    const { data } = await supabase.from("notifications").upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
    return (data?.length ?? 0) > 0;
  }
  await supabase.from("notifications").insert(row);
  return true;
}

export async function notifyStaff(input: Input) {
  return insert("STAFF", null, input).catch(() => false);
}

export async function notifyCustomer(customerId: string, input: Input) {
  return insert("CUSTOMER", customerId, input).catch(() => false);
}

export async function notifyInvestor(investorId: string, input: Input) {
  return insert("INVESTOR", null, input, investorId).catch(() => false);
}

export async function listInvestorNotifications(investorId: string, limit = 60): Promise<Notification[]> {
  const { data } = await createAdminClient().from("notifications").select("*").eq("audience", "INVESTOR").eq("investor_id", investorId).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as Notification[];
}

export async function markInvestorNotificationRead(id: string, investorId: string) {
  await createAdminClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("audience", "INVESTOR").eq("investor_id", investorId).is("read_at", null);
}

export async function markAllInvestorRead(investorId: string) {
  await createAdminClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("audience", "INVESTOR").eq("investor_id", investorId).is("read_at", null);
}

export async function listStaffNotifications(limit = 60): Promise<Notification[]> {
  const { data } = await createAdminClient().from("notifications").select("*").eq("audience", "STAFF").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as Notification[];
}

export async function countUnreadStaff() {
  const { count } = await createAdminClient().from("notifications").select("id", { count: "exact", head: true }).eq("audience", "STAFF").is("read_at", null);
  return count ?? 0;
}

export async function listCustomerNotifications(customerId: string, limit = 60): Promise<Notification[]> {
  const { data } = await createAdminClient().from("notifications").select("*").eq("audience", "CUSTOMER").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as Notification[];
}

export async function markNotificationRead(id: string, audience: "STAFF" | "CUSTOMER", customerId?: string) {
  let query = createAdminClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("audience", audience).is("read_at", null);
  if (audience === "CUSTOMER") query = query.eq("customer_id", customerId ?? "");
  await query;
}

export async function markAllStaffRead() {
  await createAdminClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("audience", "STAFF").is("read_at", null);
}

export function pickParam(value: unknown, locale: string): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record[locale] ?? record.en ?? record.zh ?? "");
  }
  return value === undefined || value === null ? "" : String(value);
}

export function renderParams(params: Record<string, unknown>, locale: string): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, pickParam(value, locale)]));
}

export async function markAllCustomerRead(customerId: string) {
  await createAdminClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("audience", "CUSTOMER").eq("customer_id", customerId).is("read_at", null);
}
