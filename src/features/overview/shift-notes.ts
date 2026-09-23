import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type ShiftNote = { id: string; body: string; created_at: string; author: { display_name: string } | null };

export async function listShiftNotes(locationIds: string[] | null, limit = 5): Promise<ShiftNote[]> {
  let query = createAdminClient().from("shift_notes").select("id, body, created_at, author:staff_members!shift_notes_created_by_fkey(display_name)");
  if (locationIds) query = query.or(`location_id.is.null,location_id.in.(${locationIds.join(",")})`);
  const { data } = await query.order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as unknown as ShiftNote[];
}
