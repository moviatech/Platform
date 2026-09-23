"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/staff";
import { reviewSelfService, saveAccess } from "./service";

const reviewInput = z.object({ reservationId: z.uuid(), decision: z.enum(["approve", "decline"]), note: z.string().trim().max(500) });
const accessInput = z.object({ reservationId: z.uuid(), link: z.union([z.literal(""), z.string().trim().url().max(500)]), note: z.string().trim().max(1000) });

export async function reviewSelfServiceAction(form: FormData) {
  const session = await requirePermission("reservation.edit");
  const parsed = reviewInput.safeParse({ reservationId: form.get("reservationId"), decision: form.get("decision"), note: form.get("note") ?? "" });
  if (!parsed.success) return;
  await reviewSelfService(parsed.data.reservationId, parsed.data.decision, parsed.data.note, { userId: session.userId, name: session.displayName });
  revalidatePath(`/ops/reservations/${parsed.data.reservationId}`);
  revalidatePath("/ops", "layout");
}

export type AccessState = { ok?: boolean; error?: string };

export async function saveSelfServiceAccessAction(_: AccessState, form: FormData): Promise<AccessState> {
  const session = await requirePermission("reservation.edit");
  const parsed = accessInput.safeParse({ reservationId: form.get("reservationId"), link: (form.get("link") ?? "").toString().trim(), note: form.get("note") ?? "" });
  if (!parsed.success) return { error: "invalid" };
  await saveAccess(parsed.data.reservationId, parsed.data.link, parsed.data.note, { userId: session.userId, name: session.displayName });
  revalidatePath(`/ops/reservations/${parsed.data.reservationId}`);
  return { ok: true };
}
