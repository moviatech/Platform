"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { serviceKinds } from "./types";
import type { FleetFormState } from "./actions";

const input = z.object({
  vehicleId: z.uuid(),
  kind: z.enum(serviceKinds),
  performedOn: z.iso.date(),
  odometer: z.union([z.literal(""), z.coerce.number().int().min(0).max(2000000)]),
  cost: z
    .string()
    .trim()
    .regex(/^(\d{1,6}(\.\d{1,2})?)?$/)
    .transform((value) => (value ? Math.round(Number(value) * 100) : 0)),
  vendor: z.string().trim().max(120),
  notes: z.string().trim().max(2000),
});

export async function addServiceLog(_: FleetFormState, form: FormData): Promise<FleetFormState> {
  const session = await requirePermission("vehicle.edit");
  const parsed = input.safeParse({ vehicleId: form.get("vehicleId"), kind: form.get("kind"), performedOn: form.get("performedOn"), odometer: form.get("odometer") ?? "", cost: form.get("cost") ?? "", vendor: form.get("vendor") ?? "", notes: form.get("notes") ?? "" });
  if (!parsed.success) return { error: "invalid" };
  const { vehicleId, kind, performedOn, odometer, cost, vendor, notes } = parsed.data;
  const { error } = await createAdminClient().from("vehicle_service_logs").insert({ vehicle_id: vehicleId, kind, performed_on: performedOn, odometer: odometer === "" ? null : odometer, cost_cents: cost, vendor: vendor || null, notes: notes || null, created_by: session.userId });
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "vehicle.service_logged", entityType: "vehicle", entityId: vehicleId, metadata: { by: session.displayName, kind, performedOn, costCents: cost, vendor: vendor || undefined } });
  revalidatePath(`/ops/fleet/${vehicleId}`);
  return { ok: true };
}

export async function removeServiceLog(form: FormData) {
  const session = await requirePermission("vehicle.edit");
  const parsed = z.object({ vehicleId: z.uuid(), logId: z.uuid() }).safeParse({ vehicleId: form.get("vehicleId"), logId: form.get("logId") });
  if (!parsed.success) return;
  await createAdminClient().from("vehicle_service_logs").delete().eq("id", parsed.data.logId).eq("vehicle_id", parsed.data.vehicleId);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "vehicle.service_removed", entityType: "vehicle", entityId: parsed.data.vehicleId, metadata: { by: session.displayName, logId: parsed.data.logId } });
  revalidatePath(`/ops/fleet/${parsed.data.vehicleId}`);
}
