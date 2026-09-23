import "server-only";
import { zonedParts, zonedToUtc } from "@/features/booking/time";
import { createAdminClient } from "@/lib/supabase/admin";

const zone = "America/Los_Angeles";
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const auditActors = ["STAFF", "CUSTOMER", "INVESTOR", "SYSTEM", "API"] as const;
export type AuditActor = (typeof auditActors)[number];

export type AuditFilter = { from: string; to: string; q: string; actor: AuditActor | ""; before: string | null };

export type AuditRow = {
  id: string;
  created_at: string;
  actor_type: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  actor_name: string | null;
};

export function parseAuditFilter(search: Record<string, string | string[] | undefined>): AuditFilter {
  const today = zonedParts(new Date(), zone).date;
  const weekAgo = zonedParts(new Date(Date.now() - 6 * 86400000), zone).date;
  const pick = (value: string | string[] | undefined, fallback: string) => (typeof value === "string" && isoDate.test(value) ? value : fallback);
  const from = pick(search.from, weekAgo);
  const to = pick(search.to, today);
  const actor = typeof search.actor === "string" && (auditActors as readonly string[]).includes(search.actor) ? (search.actor as AuditActor) : "";
  const q = typeof search.q === "string" ? search.q.trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 60) : "";
  const before = typeof search.before === "string" && !Number.isNaN(Date.parse(search.before)) ? new Date(search.before).toISOString() : null;
  return from <= to ? { from, to, q, actor, before } : { from: to, to: from, q, actor, before };
}

export async function listAudit(filter: AuditFilter, limit: number): Promise<AuditRow[]> {
  const supabase = createAdminClient();
  const start = zonedToUtc(filter.from, "00:00", zone).toISOString();
  const end = new Date(zonedToUtc(filter.to, "23:59", zone).getTime() + 60000).toISOString();
  const page = (offset: number, size: number) => {
    let query = supabase.from("audit_events").select("id, created_at, actor_type, actor_user_id, action, entity_type, entity_id, metadata, ip_address").gte("created_at", start).lt("created_at", filter.before && filter.before < end ? filter.before : end).order("created_at", { ascending: false }).order("id").range(offset, offset + size - 1);
    if (filter.actor) query = query.eq("actor_type", filter.actor);
    if (filter.q) query = query.or(`action.ilike.%${filter.q}%,entity_type.ilike.%${filter.q}%`);
    return query;
  };
  const rows: Array<Omit<AuditRow, "actor_name">> = [];
  for (let offset = 0; offset < limit; offset += 1000) {
    const size = Math.min(1000, limit - offset);
    const { data } = await page(offset, size);
    rows.push(...((data ?? []) as Array<Omit<AuditRow, "actor_name">>));
    if ((data ?? []).length < size) break;
  }
  const staffIds = [...new Set(rows.filter((row) => row.actor_type === "STAFF" && row.actor_user_id).map((row) => row.actor_user_id as string))];
  const names = new Map<string, string>();
  for (let index = 0; index < staffIds.length; index += 100) {
    const { data: staff } = await supabase.from("staff_members").select("user_id, display_name").in("user_id", staffIds.slice(index, index + 100));
    for (const member of staff ?? []) names.set(member.user_id as string, member.display_name as string);
  }
  return rows.map((row) => ({ ...row, metadata: row.metadata ?? {}, actor_name: (row.actor_user_id && names.get(row.actor_user_id)) || (typeof row.metadata?.by === "string" ? (row.metadata.by as string) : null) }));
}

const detailKeys = ["number", "amountCents", "refundCents", "from", "to", "category", "reason", "note", "memo", "email", "count"] as const;

export function auditDetail(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of detailKeys) {
    const value = metadata[key];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") continue;
    parts.push(key.endsWith("Cents") && typeof value === "number" ? `$${(value / 100).toFixed(2)}` : String(value).slice(0, 80));
    if (parts.length === 4) break;
  }
  return parts.join(" · ");
}

const entityPaths: Record<string, string> = { reservation: "/reservations", customer: "/customers", investor: "/investors", vehicle: "/fleet", lead: "/leads", conversation: "/inbox" };

export function auditEntityHref(row: Pick<AuditRow, "entity_type" | "entity_id">): string | null {
  const base = entityPaths[row.entity_type];
  return base && row.entity_id ? `${base}/${row.entity_id}` : null;
}
