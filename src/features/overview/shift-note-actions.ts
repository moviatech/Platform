"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getStaffSession } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export async function addShiftNote(form: FormData) {
  const session = await getStaffSession();
  const parsed = z.string().trim().min(1).max(2000).safeParse(form.get("body") ?? "");
  if (!parsed.success) return;
  await createAdminClient().from("shift_notes").insert({ body: parsed.data, created_by: session.userId });
  revalidatePath("/ops");
}
