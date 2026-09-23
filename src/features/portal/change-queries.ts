import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const changeStatuses = ["SUBMITTED", "IN_REVIEW", "NEED_INFO", "APPROVED", "DECLINED", "CLOSED"] as const;
export type ChangeStatus = (typeof changeStatuses)[number];

export type ChangePayload = { pickupAt?: string; returnAt?: string; driverName?: string; notes?: string };

export type ChangeRequest = {
  id: string;
  reservation_id: string;
  customer_id: string;
  conversation_id: string | null;
  kind: string;
  status: ChangeStatus;
  payload: ChangePayload;
  staff_note: string | null;
  fee_cents: number | null;
  created_at: string;
  resolved_at: string | null;
};

const columns = "id, reservation_id, customer_id, conversation_id, kind, status, payload, staff_note, fee_cents, created_at, resolved_at";

export async function listChangeRequests(reservationId: string, customerId?: string): Promise<ChangeRequest[]> {
  let query = createAdminClient().from("change_requests").select(columns).eq("reservation_id", reservationId);
  if (customerId) query = query.eq("customer_id", customerId);
  const { data } = await query.order("created_at", { ascending: false });
  return (data ?? []) as ChangeRequest[];
}

export async function listCustomerChangeRequests(customerId: string): Promise<ChangeRequest[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("change_requests").select(columns).eq("customer_id", customerId).order("created_at", { ascending: false }).limit(50);
  return (data ?? []) as ChangeRequest[];
}

export const pendingChangeStatuses: ChangeStatus[] = ["SUBMITTED", "IN_REVIEW", "NEED_INFO"];
