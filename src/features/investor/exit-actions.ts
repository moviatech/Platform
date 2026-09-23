"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireInvestor } from "@/lib/auth/investor";
import { requirePermission } from "@/lib/auth/staff";
import { hasStepUp } from "@/lib/auth/step-up";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllocation } from "./contributions";
import { notifyInvestorEvent, notifyStaffInvestorEvent } from "./notify";

export type ExitState = { ok?: boolean; error?: "invalid" | "step_up" | "status" | "failed" | "exists" };

const uuid = z.uuid();
const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();

export async function requestExit(_: ExitState, form: FormData): Promise<ExitState> {
  const session = await requireInvestor();
  if (!(await hasStepUp(session.userId))) return { error: "step_up" };
  const parsed = z.object({ allocationId: uuid, reason: z.string().trim().max(1000).optional() }).safeParse({ allocationId: form.get("allocationId"), reason: trimmed(form.get("reason")) });
  if (!parsed.success) return { error: "invalid" };
  const allocation = await getAllocation(parsed.data.allocationId);
  if (!allocation || allocation.investor_id !== session.investorId || allocation.status !== "ACTIVE") return { error: "status" };
  const admin = createAdminClient();
  const { count } = await admin.from("investor_exit_requests").select("id", { count: "exact", head: true }).eq("allocation_id", allocation.id).in("status", ["REQUESTED", "IN_PROGRESS"]);
  if (count) return { error: "exists" };
  const { data, error } = await admin.from("investor_exit_requests").insert({ investor_id: session.investorId, allocation_id: allocation.id, reason: parsed.data.reason || null }).select("id").single();
  if (error || !data) return { error: "failed" };
  await admin.from("investor_allocations").update({ status: "EXITING" }).eq("id", allocation.id).eq("status", "ACTIVE");
  const label = `${allocation.vehicle?.vehicle_class?.name ?? ""} ${allocation.vehicle?.fleet_number ?? ""}`.trim();
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.exit_requested", entityType: "investor_exit_request", entityId: data.id, metadata: { allocationId: allocation.id, reason: parsed.data.reason || null } });
  await notifyStaffInvestorEvent("investor_exit_requested", { name: session.legalName, vehicle: label, reason: parsed.data.reason ?? "" }, `/investors/${session.investorId}`, `exit:${data.id}`);
  revalidatePath(`/investor/assets/${allocation.id}`);
  return { ok: true };
}

export async function cancelExit(_: ExitState, form: FormData): Promise<ExitState> {
  const session = await requireInvestor();
  const id = uuid.safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { data } = await admin.from("investor_exit_requests").update({ status: "DECLINED", resolution_note: "cancelled_by_investor", resolved_at: new Date().toISOString() }).eq("id", id.data).eq("investor_id", session.investorId).eq("status", "REQUESTED").select("id, allocation_id");
  const row = data?.[0];
  if (!row) return { error: "status" };
  await admin.from("investor_allocations").update({ status: "ACTIVE" }).eq("id", row.allocation_id).eq("status", "EXITING");
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.exit_cancelled", entityType: "investor_exit_request", entityId: row.id });
  revalidatePath(`/investor/assets/${row.allocation_id}`);
  return { ok: true };
}

export async function updateExit(_: ExitState, form: FormData): Promise<ExitState> {
  const session = await requirePermission("investor.manage");
  const parsed = z.object({ id: uuid, status: z.enum(["IN_PROGRESS", "DECLINED"]), note: z.string().trim().max(1000).optional() }).safeParse({ id: form.get("id"), status: form.get("status"), note: trimmed(form.get("note")) });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { data } = await admin
    .from("investor_exit_requests")
    .update({ status: parsed.data.status, resolution_note: parsed.data.note || null, ...(parsed.data.status === "DECLINED" ? { resolved_by: session.userId, resolved_at: new Date().toISOString() } : {}) })
    .eq("id", parsed.data.id)
    .in("status", ["REQUESTED", "IN_PROGRESS"])
    .select("id, investor_id, allocation_id");
  const row = data?.[0];
  if (!row) return { error: "status" };
  if (parsed.data.status === "DECLINED") await admin.from("investor_allocations").update({ status: "ACTIVE" }).eq("id", row.allocation_id).eq("status", "EXITING");
  const allocation = await getAllocation(row.allocation_id);
  const label = `${allocation?.vehicle?.vehicle_class?.name ?? ""} ${allocation?.vehicle?.fleet_number ?? ""}`.trim();
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: `investor.exit_${parsed.data.status.toLowerCase()}`, entityType: "investor_exit_request", entityId: row.id, metadata: { by: session.displayName, note: parsed.data.note || null } });
  await notifyInvestorEvent(row.investor_id, "exit_updated", { vehicle: label, status: parsed.data.status === "IN_PROGRESS" ? "处理中 / In progress" : "未通过 / Declined", note: parsed.data.note ?? "" }, `/assets/${row.allocation_id}`);
  revalidatePath(`/ops/investors/${row.investor_id}`);
  return { ok: true };
}
