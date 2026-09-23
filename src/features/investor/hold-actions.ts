"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyInvestorEvent } from "./notify";

export type HoldState = { ok?: boolean; error?: "invalid" | "failed" | "exists" };

const uuid = z.uuid();
const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();

function refresh() {
  revalidatePath("/ops/investors", "layout");
  revalidatePath("/ops/fleet", "layout");
}

async function investorsForVehicle(vehicleId: string) {
  const { data } = await createAdminClient().from("investor_allocations").select("investor_id").eq("vehicle_id", vehicleId).in("status", ["ACTIVE", "EXITING"]);
  return [...new Set((data ?? []).map((row) => row.investor_id))];
}

export async function placeHold(_: HoldState, form: FormData): Promise<HoldState> {
  const session = await requirePermission("investor.manage");
  const parsed = z
    .object({ scope: z.enum(["ENTRY", "VEHICLE", "INVESTOR"]), target: uuid, reason: z.string().trim().min(2).max(1000) })
    .safeParse({ scope: form.get("scope"), target: form.get("target"), reason: trimmed(form.get("reason")) });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const column = parsed.data.scope === "ENTRY" ? "entry_id" : parsed.data.scope === "VEHICLE" ? "vehicle_id" : "investor_id";
  const { data: existing } = await admin.from("investor_settlement_holds").select("id").eq("scope", parsed.data.scope).eq(column, parsed.data.target).is("released_at", null).maybeSingle();
  if (existing) return { error: "exists" };
  const { data: hold, error } = await admin.from("investor_settlement_holds").insert({ scope: parsed.data.scope, [column]: parsed.data.target, reason: parsed.data.reason, created_by: session.userId }).select("id").single();
  if (error || !hold) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.hold_placed", entityType: "investor_hold", entityId: hold.id, metadata: { by: session.displayName, scope: parsed.data.scope, target: parsed.data.target, reason: parsed.data.reason } });
  let investors: string[] = [];
  if (parsed.data.scope === "INVESTOR") investors = [parsed.data.target];
  else if (parsed.data.scope === "VEHICLE") investors = await investorsForVehicle(parsed.data.target);
  else {
    const { data: entry } = await admin.from("investor_ledger_entries").select("investor_id").eq("id", parsed.data.target).maybeSingle();
    if (entry) investors = [entry.investor_id];
  }
  for (const investorId of investors) await notifyInvestorEvent(investorId, "hold_placed", { reason: parsed.data.reason }, "/earnings");
  refresh();
  return { ok: true };
}

export async function releaseHold(_: HoldState, form: FormData): Promise<HoldState> {
  const session = await requirePermission("investor.manage");
  const parsed = z.object({ id: uuid, note: z.string().trim().max(1000).optional() }).safeParse({ id: form.get("id"), note: trimmed(form.get("note")) });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { data: hold } = await admin.from("investor_settlement_holds").select("id, scope, entry_id, vehicle_id, investor_id").eq("id", parsed.data.id).is("released_at", null).maybeSingle();
  if (!hold) return { error: "invalid" };
  const { error } = await admin.from("investor_settlement_holds").update({ released_at: new Date().toISOString(), released_by: session.userId, release_note: parsed.data.note || null }).eq("id", hold.id);
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.hold_released", entityType: "investor_hold", entityId: hold.id, metadata: { by: session.displayName, note: parsed.data.note || null } });
  let investors: string[] = [];
  if (hold.scope === "INVESTOR" && hold.investor_id) investors = [hold.investor_id];
  else if (hold.scope === "VEHICLE" && hold.vehicle_id) investors = await investorsForVehicle(hold.vehicle_id);
  else if (hold.entry_id) {
    const { data: entry } = await admin.from("investor_ledger_entries").select("investor_id").eq("id", hold.entry_id).maybeSingle();
    if (entry) investors = [entry.investor_id];
  }
  for (const investorId of investors) await notifyInvestorEvent(investorId, "hold_released", {}, "/earnings");
  refresh();
  return { ok: true };
}
