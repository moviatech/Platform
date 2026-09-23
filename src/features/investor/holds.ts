import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type HoldScope = "ENTRY" | "VEHICLE" | "INVESTOR";

export type Hold = {
  id: string;
  scope: HoldScope;
  entry_id: string | null;
  vehicle_id: string | null;
  investor_id: string | null;
  reason: string;
  created_at: string;
  released_at: string | null;
  release_note: string | null;
  author: { display_name: string } | null;
  investor: { id: string; legal_name: string; investor_number: string } | null;
  vehicle: { fleet_number: string } | null;
  entry: { amount_cents: number; investor_id: string; reservation: { number: string } | null } | null;
};

const columns = "id, scope, entry_id, vehicle_id, investor_id, reason, created_at, released_at, release_note, author:staff_members!investor_settlement_holds_created_by_fkey(display_name), investor:investors(id, legal_name, investor_number), vehicle:vehicles(fleet_number), entry:investor_ledger_entries(amount_cents, investor_id, reservation:reservations(number))";

export async function listActiveHolds(): Promise<Hold[]> {
  const { data } = await createAdminClient().from("investor_settlement_holds").select(columns).is("released_at", null).order("created_at", { ascending: false });
  return (data ?? []) as unknown as Hold[];
}

export async function countActiveHolds() {
  const { count } = await createAdminClient().from("investor_settlement_holds").select("id", { count: "exact", head: true }).is("released_at", null);
  return count ?? 0;
}

export type HoldMap = { investor: Hold | null; vehicles: Record<string, Hold>; entries: Record<string, Hold> };

export async function holdsAffecting(investorId: string, vehicleIds: string[]): Promise<HoldMap> {
  const supabase = createAdminClient();
  const parts = [`investor_id.eq.${investorId}`];
  if (vehicleIds.length) parts.push(`vehicle_id.in.(${vehicleIds.join(",")})`);
  const { data: entryIds } = await supabase.from("investor_ledger_entries").select("id").eq("investor_id", investorId).eq("bucket", "PENDING");
  const ids = (entryIds ?? []).map((row) => row.id);
  if (ids.length) parts.push(`entry_id.in.(${ids.join(",")})`);
  const { data } = await supabase.from("investor_settlement_holds").select(columns).is("released_at", null).or(parts.join(","));
  const map: HoldMap = { investor: null, vehicles: {}, entries: {} };
  for (const hold of (data ?? []) as unknown as Hold[]) {
    if (hold.scope === "INVESTOR") map.investor = hold;
    else if (hold.scope === "VEHICLE" && hold.vehicle_id) map.vehicles[hold.vehicle_id] = hold;
    else if (hold.scope === "ENTRY" && hold.entry_id) map.entries[hold.entry_id] = hold;
  }
  return map;
}

export function holdFor(map: HoldMap, entry: { id: string; vehicle_id: string | null }): Hold | null {
  return map.entries[entry.id] ?? (entry.vehicle_id ? map.vehicles[entry.vehicle_id] : null) ?? map.investor ?? null;
}
