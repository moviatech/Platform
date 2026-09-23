import "server-only";
import { createClient } from "@/lib/supabase/server";
import { leadKinds, leadStatuses, openLeadStatuses, type Lead, type LeadKind, type LeadStatus } from "./types";

const columns = "id, kind, status, reference, name, email, phone, wechat, locale, source_url, summary, payload, internal_notes, created_at, updated_at";

export type LeadFilters = { status?: string; kind?: string; kinds?: LeadKind[] };

export async function listLeads(filters: LeadFilters = {}, limit = 100): Promise<Lead[]> {
  const supabase = await createClient();
  let query = supabase.from("leads").select(columns).order("created_at", { ascending: false }).limit(limit);
  if ((leadStatuses as readonly string[]).includes(filters.status ?? "")) {
    query = query.eq("status", filters.status as LeadStatus);
  } else if (filters.status !== "all") {
    query = query.in("status", openLeadStatuses);
  }
  if ((leadKinds as readonly string[]).includes(filters.kind ?? "")) {
    query = query.eq("kind", filters.kind as LeadKind);
  } else if (filters.kinds?.length) {
    query = query.in("kind", filters.kinds);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Lead[];
}

export async function getLead(id: string): Promise<Lead | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("leads").select(columns).eq("id", id).maybeSingle();
  return (data as Lead | null) ?? null;
}

export async function countOpenLeads(kinds?: LeadKind[]) {
  const supabase = await createClient();
  let query = supabase.from("leads").select("id", { count: "exact", head: true }).in("status", openLeadStatuses);
  if (kinds?.length) query = query.in("kind", kinds);
  const { count } = await query;
  return count ?? 0;
}

export type AuditEntry = {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_user_id: string | null;
};

export async function listEntityAudit(entityType: string, entityId: string): Promise<AuditEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_events")
    .select("id, action, metadata, created_at, actor_user_id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as AuditEntry[];
}
