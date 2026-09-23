import "server-only";
import { portalOrigin } from "@/lib/env";
import { signedId } from "@/lib/signed-id";
import { createAdminClient } from "@/lib/supabase/admin";

export const linkDays = 7;
export const linkEmailLimit = 5;

const signed = signedId("agreement-link", 20);

export const linkToken = signed.token;
export const linkIdFromToken = signed.id;

export const linkUrl = (id: string) => `${portalOrigin}/sign/${linkToken(id)}`;

export type LinkReservation = {
  id: string;
  number: string;
  status: string;
  agreement_state: string;
  rental_days: number;
  customer_id: string;
  customer: { full_name: string; email: string | null; preferred_language: string | null } | null;
};

export type ResolvedLink = { state: "active"; id: string; expiresAt: string; emailsSent: number; reservation: LinkReservation } | { state: "expired" };

export async function resolveLink(token: string): Promise<ResolvedLink | null> {
  const id = linkIdFromToken(token);
  if (!id) return null;
  const { data } = await createAdminClient()
    .from("agreement_links")
    .select("id, expires_at, revoked_at, emails_sent, reservation:reservations(id, number, status, agreement_state, rental_days, customer_id, customer:customers(full_name, email, preferred_language))")
    .eq("id", id)
    .maybeSingle();
  const row = data as unknown as { id: string; expires_at: string; revoked_at: string | null; emails_sent: number; reservation: LinkReservation | null } | null;
  if (!row || !row.reservation) return null;
  if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) return { state: "expired" };
  return { state: "active", id: row.id, expiresAt: row.expires_at, emailsSent: row.emails_sent, reservation: row.reservation };
}

export async function activeLink(reservationId: string) {
  const { data } = await createAdminClient()
    .from("agreement_links")
    .select("id, expires_at")
    .eq("reservation_id", reservationId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id as string, expiresAt: data.expires_at as string } : null;
}

export async function revokeLinks(reservationId: string) {
  await createAdminClient().from("agreement_links").update({ revoked_at: new Date().toISOString() }).eq("reservation_id", reservationId).is("revoked_at", null);
}

export async function issueLink(reservationId: string, staffId: string, fresh: boolean) {
  const supabase = createAdminClient();
  if (!fresh) {
    const current = await activeLink(reservationId);
    if (current) return { ...current, created: false };
  }
  const now = new Date();
  await revokeLinks(reservationId);
  const { data, error } = await supabase
    .from("agreement_links")
    .insert({ reservation_id: reservationId, created_by: staffId, expires_at: new Date(now.getTime() + linkDays * 86400000).toISOString() })
    .select("id, expires_at")
    .single();
  if (error || !data) return null;
  return { id: data.id as string, expiresAt: data.expires_at as string, created: true };
}
