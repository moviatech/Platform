"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCustomerSession } from "@/lib/auth/customer";
import { createAdminClient } from "@/lib/supabase/admin";
import { finishSelfReturn, loadSelfService, startSelfPickup } from "./service";
import { maxSelfServicePhotos, minSelfServicePhotos, selfServicePhotoBucket } from "./types";

export type SelfServiceActionState = { ok?: boolean; error?: string };

const numberInput = z.string().regex(/^MV-[A-Z0-9]{6}$/);
const imageType = /^image\/(jpeg|png|webp|heic|heif)$/;
const maxBytes = 15 * 1024 * 1024;
const photoSchema = z.array(z.object({ path: z.string().max(200), type: z.string().regex(imageType), size: z.number().int().min(0).max(maxBytes) })).max(maxSelfServicePhotos);

async function ownedRow(number: string) {
  const session = await getCustomerSession();
  if (!session) redirect("/login");
  const { data } = await createAdminClient().from("reservations").select("id").eq("number", number).eq("customer_id", session.customerId).maybeSingle();
  if (!data) return { session, row: null };
  return { session, row: await loadSelfService(data.id) };
}

export async function createSelfServiceUploads(number: string, phase: "PICKUP" | "RETURN", files: Array<{ type: string; size: number }>) {
  if (!numberInput.safeParse(number).success || files.length > maxSelfServicePhotos) return files.map(() => null);
  const { row } = await ownedRow(number);
  if (!row) return files.map(() => null);
  const storage = createAdminClient().storage.from(selfServicePhotoBucket);
  const targets: Array<{ path: string; url: string } | null> = [];
  for (const file of files) {
    if (!imageType.test(file.type) || file.size > maxBytes) {
      targets.push(null);
      continue;
    }
    const path = `self/${row.id}/${phase.toLowerCase()}/${randomUUID()}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
    const { data } = await storage.createSignedUploadUrl(path);
    targets.push(data ? { path, url: data.signedUrl } : null);
  }
  return targets;
}

function parsePhotos(raw: FormDataEntryValue | null, reservationId: string, phase: "PICKUP" | "RETURN") {
  let parsed: unknown = [];
  try {
    parsed = raw ? JSON.parse(String(raw)) : [];
  } catch {
    return null;
  }
  const result = photoSchema.safeParse(parsed);
  if (!result.success) return null;
  const prefix = `self/${reservationId}/${phase.toLowerCase()}/`;
  return result.data.every((photo) => photo.path.startsWith(prefix)) ? result.data : null;
}

export async function startSelfPickupAction(_: SelfServiceActionState, form: FormData): Promise<SelfServiceActionState> {
  const parsed = numberInput.safeParse(form.get("number"));
  if (!parsed.success) return { error: "invalid" };
  const { session, row } = await ownedRow(parsed.data);
  if (!row) return { error: "not_found" };
  const photos = parsePhotos(form.get("photos"), row.id, "PICKUP");
  if (!photos) return { error: "invalid" };
  if (photos.length < minSelfServicePhotos) return { error: "photos_required" };
  const result = await startSelfPickup(row, photos, { userId: session.userId, name: session.fullName });
  revalidatePath(`/account/trips/${parsed.data}`);
  revalidatePath("/account");
  return result.ok ? { ok: true } : { error: result.error };
}

export async function finishSelfReturnAction(_: SelfServiceActionState, form: FormData): Promise<SelfServiceActionState> {
  const parsed = numberInput.safeParse(form.get("number"));
  if (!parsed.success) return { error: "invalid" };
  const { session, row } = await ownedRow(parsed.data);
  if (!row) return { error: "not_found" };
  const photos = parsePhotos(form.get("photos"), row.id, "RETURN");
  if (!photos) return { error: "invalid" };
  if (photos.length < minSelfServicePhotos) return { error: "photos_required" };
  if (form.get("keyCard") !== "on") return { error: "key_card_required" };
  const note = String(form.get("note") ?? "").trim().slice(0, 1000);
  const result = await finishSelfReturn(row, { photos, keyCard: true, note }, { userId: session.userId, name: session.fullName });
  revalidatePath(`/account/trips/${parsed.data}`);
  revalidatePath("/account");
  return result.ok ? { ok: true } : { error: result.error };
}
