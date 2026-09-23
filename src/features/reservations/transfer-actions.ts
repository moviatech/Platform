"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { syncInsuranceState } from "@/features/drivers/service";
import { supersedeAgreements } from "@/features/portal/agreement-facts";
import { revokeLinks } from "@/features/portal/agreement-link";
import { cancelOpenPayments, relabelStripeCustomer } from "@/features/payments/service";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { requireScope } from "@/lib/auth/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type TransferTarget = { id: string; fullName: string; email: string | null; phone: string | null; registered: boolean; blocked: boolean };
export type TransferState = { ok?: boolean; error?: string; notices?: string[] };

type TargetRow = { id: string; full_name: string; email: string | null; phone: string | null; auth_user_id: string | null; dnr_flag: boolean; created_at: string };

const openStatuses = ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"];
const transferErrors = ["customer_not_found", "customer_blocked", "same_customer", "not_found"];
const targetColumns = "id, full_name, email, phone, auth_user_id, dnr_flag, created_at";

const escapeLike = (value: string) => value.replace(/[%_]/g, (char) => `\\${char}`);

export async function searchTransferTargets(reservationId: string, query: string): Promise<TransferTarget[]> {
  const session = await requirePermission("reservation.edit");
  if (!z.uuid().safeParse(reservationId).success) return [];
  await requireScope(session, { reservation: reservationId });
  const term = query
    .replace(/[,()*"\\]/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  if (term.length < 2) return [];

  const admin = createAdminClient();
  const scoped = session.locationIds !== null;
  const reader = scoped ? await createClient() : admin;
  const pattern = `%${escapeLike(term)}%`;
  const digits = /^[\d\s+.-]+$/.test(term) ? term.replace(/\D/g, "") : "";
  const core = digits.length >= 7 ? (digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits) : "";
  const fuzzy = (column: string, value: string) => reader.from("customers").select(targetColumns).ilike(column, value).order("created_at", { ascending: false }).limit(9);

  const lookups = [fuzzy("full_name", pattern), fuzzy("email", pattern), fuzzy("phone", pattern)];
  if (core) lookups.push(fuzzy("phone_normalized", `%${core}%`));
  if (scoped) {
    lookups.push(admin.from("customers").select(targetColumns).ilike("email", escapeLike(term)).order("created_at", { ascending: false }).limit(1));
    if (core) lookups.push(admin.from("customers").select(targetColumns).in("phone_normalized", [core, `1${core}`]).order("created_at", { ascending: false }).limit(1));
  }
  const [{ data: reservation }, ...results] = await Promise.all([admin.from("reservations").select("customer_id").eq("id", reservationId).maybeSingle(), ...lookups]);

  const found = new Map<string, TargetRow>();
  for (const result of results) for (const row of (result.data ?? []) as TargetRow[]) found.set(row.id, row);
  return [...found.values()]
    .filter((row) => row.id !== reservation?.customer_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8)
    .map((row) => ({ id: row.id, fullName: row.full_name, email: row.email, phone: row.phone, registered: Boolean(row.auth_user_id), blocked: Boolean(row.dnr_flag) }));
}

export async function transferReservation(_: TransferState, form: FormData): Promise<TransferState> {
  const session = await requirePermission("reservation.edit");
  const parsed = z.object({ reservationId: z.uuid(), customerId: z.uuid() }).safeParse({ reservationId: form.get("reservationId"), customerId: form.get("customerId") });
  if (!parsed.success) return { error: "invalid" };
  const { reservationId, customerId } = parsed.data;
  await requireScope(session, { reservation: reservationId });

  const admin = createAdminClient();
  const { data: before } = await admin.from("reservations").select("number, status, return_at, customer:customers(id, full_name)").eq("id", reservationId).maybeSingle();
  const reservation = before as unknown as { number: string; status: string; return_at: string; customer: { id: string; full_name: string } | null } | null;
  if (!reservation) return { error: "not_found" };

  const { data: moved, error } = await admin.rpc("transfer_reservation_customer", { p_reservation_id: reservationId, p_customer_id: customerId });
  if (error) return { error: transferErrors.find((code) => error.message.includes(code)) ?? "failed" };
  const outcome = (moved ?? {}) as { card?: string; stripe_customer?: string | null };

  const { data: holder } = await admin
    .from("customers")
    .select("full_name, email, phone, identity_status, license_expires_on, license_kind, license_kind_confirmed, stripe_payment_method_id")
    .eq("id", customerId)
    .maybeSingle();
  if (openStatuses.includes(reservation.status)) {
    const verified = holder?.identity_status === "VERIFIED" && holder.license_kind === "US" && Boolean(holder.license_kind_confirmed) && (!holder.license_expires_on || holder.license_expires_on >= reservation.return_at.slice(0, 10));
    await admin
      .from("reservations")
      .update({ verification_state: verified ? "VERIFIED" : "PENDING", agreement_state: "PENDING", insurance_state: "NOT_REQUIRED", insurance_verified_by: null, insurance_verified_at: null, license_onsite_photo: null, license_onsite_photos: [], license_onsite_by: null, license_onsite_at: null })
      .eq("id", reservationId);
    await syncInsuranceState(reservationId);
    await supersedeAgreements(reservationId);
  }
  await revokeLinks(reservationId);

  const cancelled = await cancelOpenPayments(reservationId).catch(() => 0);
  if (outcome.card === "moved" && outcome.stripe_customer && holder) await relabelStripeCustomer(outcome.stripe_customer, { id: customerId, fullName: holder.full_name, email: holder.email, phone: holder.phone });

  const notices: string[] = [];
  if (cancelled > 0) notices.push("link_cancelled");
  if (outcome.card === "kept") {
    const { count } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("reservation_id", reservationId).eq("kind", "SECURITY_HOLD").eq("status", "AUTHORIZED");
    if (count) notices.push("hold_on_previous_card");
    if (!holder?.stripe_payment_method_id) notices.push("no_card");
  }

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "reservation.customer_changed",
    entityType: "reservation",
    entityId: reservationId,
    metadata: { by: session.displayName, number: reservation.number, from: reservation.customer?.full_name ?? "", to: holder?.full_name ?? "", fromCustomerId: reservation.customer?.id ?? null, toCustomerId: customerId, card: outcome.card ?? "none", cancelledPayments: cancelled },
  });
  revalidatePath(`/ops/reservations/${reservationId}`);
  revalidatePath("/ops/reservations");
  return { ok: true, notices };
}
