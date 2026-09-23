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

const count = async (query: PromiseLike<{ count: number | null }>) => (await query).count ?? 0;

export async function loadExceptions(): Promise<ExceptionCounts> {
  const supabase = createAdminClient();
  const now = new Date();
  const soon = new Date(now.getTime() + 48 * 3600000).toISOString();
  const holdHorizon = new Date(now.getTime() + 36 * 3600000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
  const head = { count: "exact" as const, head: true };
  const prepSoon = new Date(now.getTime() + 2 * 3600000).toISOString();
  const threeDays = new Date(now.getTime() + 72 * 3600000).toISOString();
  const [pendingRequests, unsignedSoon, unverifiedSoon, unpaidSoon, holdsExpiring, overdue, refundsFailed, prepOverdue, prepIssues, damageAwaiting, damageDisputed, damageConsented, selfServiceToReview, selfServiceMissingLink, selfReturnPending] = await Promise.all([
    count(supabase.from("change_requests").select("id", head).in("status", ["SUBMITTED", "IN_REVIEW", "NEED_INFO"])),
    count(supabase.from("reservations").select("id", head).eq("status", "CONFIRMED").neq("agreement_state", "SIGNED").lt("pickup_at", soon)),
    count(supabase.from("reservations").select("id", head).eq("status", "CONFIRMED").neq("verification_state", "VERIFIED").lt("pickup_at", soon)),
    count(supabase.from("reservations").select("id", head).eq("status", "CONFIRMED").eq("rate_plan", "PAY_NOW").neq("payment_state", "PAID").lt("pickup_at", soon)),
    count(supabase.from("payments").select("id", head).eq("kind", "SECURITY_HOLD").eq("status", "AUTHORIZED").lt("authorization_expires_at", holdHorizon)),
    count(supabase.from("reservations").select("id", head).eq("status", "ACTIVE").lt("return_at", now.toISOString())),
    count(supabase.from("refunds").select("id", head).in("status", ["FAILED", "CANCELED"]).gte("created_at", monthAgo)),
    count(supabase.from("prep_tasks").select("id", head).neq("status", "DONE").lt("due_at", prepSoon)),
    count(supabase.from("prep_tasks").select("id", head).eq("issue_open", true)),
    count(supabase.from("damage_claims").select("id", head).eq("status", "PENDING_CONSENT")),
    count(supabase.from("damage_claims").select("id", head).eq("status", "DISPUTED")),
    count(supabase.from("damage_claims").select("id", head).eq("status", "CONSENTED")),
    count(supabase.from("reservations").select("id", head).eq("self_service_state", "REQUESTED").lt("pickup_at", threeDays)),
    count(supabase.from("reservations").select("id", head).eq("self_service_state", "APPROVED").is("access_link", null).lt("pickup_at", soon)),
    count(supabase.from("reservations").select("id", head).eq("self_service_state", "RETURNED").eq("status", "ACTIVE")),
  ]);
  return { pendingRequests, unsignedSoon, unverifiedSoon, unpaidSoon, holdsExpiring, overdue, refundsFailed, prepOverdue, prepIssues, damageAwaiting, damageDisputed, damageConsented, selfServiceToReview, selfServiceMissingLink, selfReturnPending };
}
