import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type ExceptionCounts = {
  pendingRequests: number;
  unsignedSoon: number;
  unverifiedSoon: number;
  unpaidSoon: number;
  holdsExpiring: number;
  overdue: number;
  refundsFailed: number;
  prepOverdue: number;
  prepIssues: number;
  damageAwaiting: number;
  damageDisputed: number;
  damageConsented: number;
  selfServiceToReview: number;
  selfServiceMissingLink: number;
  selfReturnPending: number;
};

type Narrow = PromiseLike<{ count: number | null }> & { in: (column: string, values: string[]) => Narrow };

const count = async (query: PromiseLike<{ count: number | null }>) => (await query).count ?? 0;

export async function loadExceptions(ids: string[] | null): Promise<ExceptionCounts> {
  const supabase = createAdminClient();
  const sel = (join: string) => (ids ? `id, ${join}` : "id");
  const scoped = (query: PromiseLike<{ count: number | null }>, path: string) => (ids ? (query as unknown as Narrow).in(path, ids) : query);
  const now = new Date();
  const soon = new Date(now.getTime() + 48 * 3600000).toISOString();
  const holdHorizon = new Date(now.getTime() + 36 * 3600000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
  const head = { count: "exact" as const, head: true };
  const prepSoon = new Date(now.getTime() + 2 * 3600000).toISOString();
  const threeDays = new Date(now.getTime() + 72 * 3600000).toISOString();
  const [pendingRequests, unsignedSoon, unverifiedSoon, unpaidSoon, holdsExpiring, overdue, refundsFailed, prepOverdue, prepIssues, damageAwaiting, damageDisputed, damageConsented, selfServiceToReview, selfServiceMissingLink, selfReturnPending] = await Promise.all([
    count(scoped(supabase.from("change_requests").select(sel("reservation:reservations!inner(pickup_location_id)"), head).in("status", ["SUBMITTED", "IN_REVIEW", "NEED_INFO"]), "reservation.pickup_location_id")),
    count(scoped(supabase.from("reservations").select("id", head).eq("status", "CONFIRMED").neq("agreement_state", "SIGNED").lt("pickup_at", soon), "pickup_location_id")),
    count(scoped(supabase.from("reservations").select("id", head).eq("status", "CONFIRMED").neq("verification_state", "VERIFIED").lt("pickup_at", soon), "pickup_location_id")),
    count(scoped(supabase.from("reservations").select("id", head).eq("status", "CONFIRMED").eq("rate_plan", "PAY_NOW").neq("payment_state", "PAID").lt("pickup_at", soon), "pickup_location_id")),
    count(scoped(supabase.from("payments").select(sel("reservation:reservations!inner(pickup_location_id)"), head).eq("kind", "SECURITY_HOLD").eq("status", "AUTHORIZED").lt("authorization_expires_at", holdHorizon), "reservation.pickup_location_id")),
    count(scoped(supabase.from("reservations").select("id", head).eq("status", "ACTIVE").lt("return_at", now.toISOString()), "pickup_location_id")),
    count(scoped(supabase.from("refunds").select(sel("payment:payments!inner(reservation:reservations!inner(pickup_location_id))"), head).in("status", ["FAILED", "CANCELED"]).gte("created_at", monthAgo), "payment.reservation.pickup_location_id")),
    count(scoped(supabase.from("prep_tasks").select(sel("vehicle:vehicles!inner(location_id)"), head).neq("status", "DONE").lt("due_at", prepSoon), "vehicle.location_id")),
    count(scoped(supabase.from("prep_tasks").select(sel("vehicle:vehicles!inner(location_id)"), head).eq("issue_open", true), "vehicle.location_id")),
    count(scoped(supabase.from("damage_claims").select(sel("reservation:reservations!inner(pickup_location_id)"), head).eq("status", "PENDING_CONSENT"), "reservation.pickup_location_id")),
    count(scoped(supabase.from("damage_claims").select(sel("reservation:reservations!inner(pickup_location_id)"), head).eq("status", "DISPUTED"), "reservation.pickup_location_id")),
    count(scoped(supabase.from("damage_claims").select(sel("reservation:reservations!inner(pickup_location_id)"), head).eq("status", "CONSENTED"), "reservation.pickup_location_id")),
    count(scoped(supabase.from("reservations").select("id", head).eq("self_service_state", "REQUESTED").lt("pickup_at", threeDays), "pickup_location_id")),
    count(scoped(supabase.from("reservations").select("id", head).eq("self_service_state", "APPROVED").is("access_link", null).lt("pickup_at", soon), "pickup_location_id")),
    count(scoped(supabase.from("reservations").select("id", head).eq("self_service_state", "RETURNED").eq("status", "ACTIVE"), "pickup_location_id")),
  ]);
  return { pendingRequests, unsignedSoon, unverifiedSoon, unpaidSoon, holdsExpiring, overdue, refundsFailed, prepOverdue, prepIssues, damageAwaiting, damageDisputed, damageConsented, selfServiceToReview, selfServiceMissingLink, selfReturnPending };
}
