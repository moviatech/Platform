"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { setAcceptingBookings } from "./status";

export async function toggleBookings(form: FormData) {
  const session = await requirePermission("settings.manage");
  const on = form.get("value") === "1";
  await setAcceptingBookings(on, session.userId);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: on ? "settings.bookings_opened" : "settings.bookings_paused", entityType: "settings", entityId: "business", metadata: { by: session.displayName } });
  revalidatePath("/ops", "layout");
}
