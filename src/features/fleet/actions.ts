"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadPrimaryLocation } from "@/features/booking/service";
import { zonedToUtc } from "@/features/booking/time";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { blockTypes, cleanStates, vehicleConditions } from "./types";

export type FleetFormState = { ok?: boolean; error?: "invalid" | "duplicate" | "conflict" | "failed" };

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null);

const optionalInt = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : Number(value)))
    .refine((value) => value === null || (Number.isInteger(value) && value >= min && value <= max));

const vehicleInput = z.object({
  id: z.union([z.uuid(), z.literal("")]),
  classId: z.uuid(),
  fleetNumber: z.string().trim().min(2).max(20),
  vin: optionalText(17),
  licensePlate: optionalText(12),
  year: optionalInt(2015, 2035),
  exteriorColor: optionalText(40),
  condition: z.enum(vehicleConditions),
  cleanState: z.enum(cleanStates),
  batteryLevel: optionalInt(0, 100),
  odometer: optionalInt(0, 2000000),
  isPlaceholder: z.boolean(),
  notes: optionalText(2000),
});

export async function saveVehicle(_: FleetFormState, form: FormData): Promise<FleetFormState> {
  const session = await requirePermission("vehicle.edit");
  const parsed = vehicleInput.safeParse({
    id: form.get("id") ?? "",
    classId: form.get("classId"),
    fleetNumber: form.get("fleetNumber"),
    vin: form.get("vin") ?? "",
    licensePlate: form.get("licensePlate") ?? "",
    year: form.get("year") ?? "",
    exteriorColor: form.get("exteriorColor") ?? "",
    condition: form.get("condition"),
    cleanState: form.get("cleanState"),
    batteryLevel: form.get("batteryLevel") ?? "",
    odometer: form.get("odometer") ?? "",
    isPlaceholder: form.get("isPlaceholder") === "on",
    notes: form.get("notes") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };
  const input = parsed.data;

  const supabase = createAdminClient();
  const values = {
    class_id: input.classId,
    fleet_number: input.fleetNumber.toUpperCase(),
    vin: input.vin?.toUpperCase() ?? null,
    license_plate: input.licensePlate?.toUpperCase() ?? null,
    year: input.year,
    exterior_color: input.exteriorColor,
    condition: input.condition,
    clean_state: input.cleanState,
    battery_level: input.batteryLevel,
    odometer: input.odometer,
    is_placeholder: input.isPlaceholder,
    notes: input.notes,
  };

  if (input.id) {
    const { data: before } = await supabase.from("vehicles").select("condition, clean_state, battery_level, odometer").eq("id", input.id).maybeSingle();
    const { error } = await supabase.from("vehicles").update(values).eq("id", input.id);
    if (error) return { error: error.code === "23505" ? "duplicate" : "failed" };
    await audit({
      actorUserId: session.userId,
      actorType: "STAFF",
      action: before?.condition !== input.condition ? "vehicle.status_changed" : "vehicle.updated",
      entityType: "vehicle",
      entityId: input.id,
      metadata: { by: session.displayName, from: before?.condition, to: input.condition, battery: input.batteryLevel, odometer: input.odometer },
    });
    revalidatePath("/ops/fleet", "layout");
    return { ok: true };
  }

  const location = await loadPrimaryLocation();
  const { data: created, error } = await supabase.from("vehicles").insert({ ...values, location_id: location.id }).select("id").single();
  if (error || !created) return { error: error?.code === "23505" ? "duplicate" : "failed" };
  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "vehicle.created",
    entityType: "vehicle",
    entityId: created.id,
    metadata: { by: session.displayName, fleetNumber: values.fleet_number },
  });
  revalidatePath("/ops/fleet", "layout");
  redirect(`/fleet/${created.id}`);
}

const blockInput = z.object({
  vehicleId: z.uuid(),
  startDate: z.iso.date(),
  startTime: z.iso.time({ precision: -1 }),
  endDate: z.iso.date(),
  endTime: z.iso.time({ precision: -1 }),
  type: z.enum(blockTypes),
  reason: z.string().trim().max(300),
});

export async function addBlock(_: FleetFormState, form: FormData): Promise<FleetFormState> {
  const session = await requirePermission("vehicle.edit");
  const parsed = blockInput.safeParse({
    vehicleId: form.get("vehicleId"),
    startDate: form.get("startDate"),
    startTime: form.get("startTime"),
    endDate: form.get("endDate"),
    endTime: form.get("endTime"),
    type: form.get("type"),
    reason: form.get("reason") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };
  const input = parsed.data;

  const location = await loadPrimaryLocation();
  const startsAt = zonedToUtc(input.startDate, input.startTime, location.timezone);
  const endsAt = zonedToUtc(input.endDate, input.endTime, location.timezone);
  if (endsAt <= startsAt) return { error: "invalid" };

  const { data, error } = await createAdminClient().rpc("create_vehicle_block", {
    p_vehicle_id: input.vehicleId,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: endsAt.toISOString(),
    p_type: input.type,
    p_reason: input.reason,
    p_created_by: session.userId,
  });
  if (error) return { error: error.code === "23P01" ? "conflict" : "failed" };

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "vehicle.block_created",
    entityType: "vehicle",
    entityId: input.vehicleId,
    metadata: { by: session.displayName, blockId: data, type: input.type, from: startsAt.toISOString(), to: endsAt.toISOString() },
  });
  revalidatePath("/ops/fleet", "layout");
  revalidatePath("/ops/reservations", "layout");
  return { ok: true };
}

export async function removeBlock(form: FormData) {
  const session = await requirePermission("vehicle.edit");
  const parsed = z.object({ blockId: z.uuid(), vehicleId: z.uuid() }).safeParse({ blockId: form.get("blockId"), vehicleId: form.get("vehicleId") });
  if (!parsed.success) return;
  const { error } = await createAdminClient().from("vehicle_blocks").delete().eq("id", parsed.data.blockId);
  if (error) return;
  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "vehicle.block_removed",
    entityType: "vehicle",
    entityId: parsed.data.vehicleId,
    metadata: { by: session.displayName, blockId: parsed.data.blockId },
  });
  revalidatePath("/ops/fleet", "layout");
  revalidatePath("/ops/reservations", "layout");
}
