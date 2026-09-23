import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

type AuditInput = {
  actorUserId?: string | null;
  actorType: "STAFF" | "CUSTOMER" | "INVESTOR" | "SYSTEM" | "API";
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

async function requestHeaders() {
  try {
    return await headers();
  } catch {
    return null;
  }
}

export async function audit(input: AuditInput) {
  const head = await requestHeaders();
  const ip = head ? (head.get("cf-connecting-ip") ?? head.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null) : null;
  const { error } = await createAdminClient()
    .from("audit_events")
    .insert({
      actor_user_id: input.actorUserId ?? null,
      actor_type: input.actorType,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      metadata: input.metadata ?? {},
      ip_address: ip,
      user_agent: head?.get("user-agent")?.slice(0, 400) ?? null,
    });
  if (error) console.error("[audit]", input.action, error.message);
}
