import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIpFrom } from "./client-ip";

type Actor = "CUSTOMER" | "STAFF";

export async function clientIp() {
  return clientIpFrom(await headers());
}

export async function recentCount(action: string, minutes: number, match: { ip?: string | null; email?: string }) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  let query = createAdminClient().from("audit_events").select("id", { count: "exact", head: true }).eq("action", action).gte("created_at", since);
  if (match.email) query = query.contains("metadata", { email: match.email });
  if (match.ip !== undefined) {
    if (!match.ip) return 0;
    query = query.eq("ip_address", match.ip);
  }
  const { count } = await query;
  return count ?? 0;
}

export async function throttled(input: { action: string; minutes: number; ip: string | null; perIp?: number; email?: string; perEmail?: number }) {
  const [byEmail, byIp] = await Promise.all([
    input.email && input.perEmail ? recentCount(input.action, input.minutes, { email: input.email }) : Promise.resolve(0),
    input.perIp ? recentCount(input.action, input.minutes, { ip: input.ip }) : Promise.resolve(0),
  ]);
  return Boolean((input.perEmail && byEmail >= input.perEmail) || (input.perIp && byIp >= input.perIp));
}

export async function record(action: string, email: string, ip: string | null, actor: Actor = "CUSTOMER") {
  const head = await headers();
  await createAdminClient()
    .from("audit_events")
    .insert({
      actor_type: actor,
      action,
      entity_type: actor === "STAFF" ? "staff_email" : "customer_email",
      entity_id: email,
      metadata: { email, forwarded: head.get("x-forwarded-for") ?? null },
      ip_address: ip,
      user_agent: head.get("user-agent")?.slice(0, 400) ?? null,
    });
}
