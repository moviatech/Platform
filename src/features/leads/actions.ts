"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { leadStatuses } from "./types";

export type LeadFormState = { ok?: boolean; error?: boolean };

const input = z.object({
  id: z.uuid(),
  status: z.enum(leadStatuses),
  notes: z.string().max(4000),
});

export async function updateLead(_: LeadFormState, form: FormData): Promise<LeadFormState> {
  const session = await requirePermission("lead.edit");
  const parsed = input.safeParse({
    id: form.get("id"),
    status: form.get("status"),
    notes: form.get("notes") ?? "",
  });
  if (!parsed.success) return { error: true };

  const supabase = await createClient();
  const { data: before } = await supabase.from("leads").select("status, internal_notes").eq("id", parsed.data.id).maybeSingle();
  if (!before) return { error: true };

  const notes = parsed.data.notes.trim() || null;
  const { error } = await supabase.from("leads").update({ status: parsed.data.status, internal_notes: notes }).eq("id", parsed.data.id);
  if (error) return { error: true };

  if (before.status !== parsed.data.status) {
    await audit({
      actorUserId: session.userId,
      actorType: "STAFF",
      action: "lead.status_changed",
      entityType: "lead",
      entityId: parsed.data.id,
      metadata: { from: before.status, to: parsed.data.status, by: session.displayName },
    });
  }
  if ((before.internal_notes ?? null) !== notes) {
    await audit({
      actorUserId: session.userId,
      actorType: "STAFF",
      action: "lead.notes_updated",
      entityType: "lead",
      entityId: parsed.data.id,
      metadata: { by: session.displayName },
    });
  }

  revalidatePath("/ops/leads", "layout");
  return { ok: true };
}
