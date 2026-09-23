import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type ShiftNote = { id: string; body: string; created_at: string; author: { display_name: string } | null };

export async function listShiftNotes(limit = 5): Promise<ShiftNote[]> {
  const { data } = await createAdminClient().from("shift_notes").select("id, body, created_at, author:staff_members!shift_notes_created_by_fkey(display_name)").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as unknown as ShiftNote[];
}
