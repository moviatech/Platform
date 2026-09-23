"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireScope } from "@/lib/auth/scope";
import { requireHq, requirePermission } from "@/lib/auth/staff";
import { registerPartner, TeslaError } from "@/lib/tesla/client";
import { readForReservation } from "./service";

export type TeslaActionState = { ok?: boolean; error?: string; detail?: string; at?: number };
export type ReadResult = { odometer?: number | null; battery?: number | null; latitude?: number | null; longitude?: number | null; at?: string; error?: string };

const uuid = z.uuid();
const errorCode = (cause: unknown) => (cause instanceof TeslaError ? cause.code : "failed");

export async function registerPartnerAction(): Promise<TeslaActionState> {
  const session = await requireHq("settings.manage");
  try {
    await registerPartner();
  } catch (cause) {
    return { error: errorCode(cause), detail: cause instanceof Error ? cause.message.slice(0, 300) : undefined };
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "tesla.partner_registered", entityType: "settings", entityId: "tesla", metadata: { by: session.displayName } });
  revalidatePath("/ops/fleet/tesla");
  return { ok: true, at: Date.now() };
}

export async function readVehicleState(reservationId: string): Promise<ReadResult> {
  const session = await requirePermission("vehicle.inspect");
  if (!uuid.safeParse(reservationId).success) return { error: "invalid" };
  await requireScope(session, { reservation: reservationId });
  try {
    const snapshot = await readForReservation(reservationId, { wake: true });
    if (!snapshot) return { error: "no_vin" };
    await audit({ actorUserId: session.userId, actorType: "STAFF", action: "vehicle.tesla_read", entityType: "reservation", entityId: reservationId, metadata: { by: session.displayName, odometer: snapshot.odometer, battery: snapshot.battery } });
    return { odometer: snapshot.odometer, battery: snapshot.battery, at: snapshot.at };
  } catch (cause) {
    return { error: errorCode(cause) };
  }
}

export async function locateVehicle(reservationId: string): Promise<ReadResult> {
  const session = await requirePermission("vehicle.inspect");
  if (!uuid.safeParse(reservationId).success) return { error: "invalid" };
  await requireScope(session, { reservation: reservationId });
  try {
    const snapshot = await readForReservation(reservationId, { wake: true, location: true });
    if (!snapshot) return { error: "no_vin" };
    await audit({ actorUserId: session.userId, actorType: "STAFF", action: "vehicle.located", entityType: "reservation", entityId: reservationId, metadata: { by: session.displayName, latitude: snapshot.latitude, longitude: snapshot.longitude } });
    return { odometer: snapshot.odometer, battery: snapshot.battery, latitude: snapshot.latitude, longitude: snapshot.longitude, at: snapshot.at };
  } catch (cause) {
    return { error: errorCode(cause) };
  }
}
