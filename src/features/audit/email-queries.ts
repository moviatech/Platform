import "server-only";
import { zonedToUtc } from "@/features/booking/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAuditFilter } from "./queries";

const zone = "America/Los_Angeles";

export const emailAudiences = ["customer", "staff", "investor"] as const;
export type EmailAudienceFilter = (typeof emailAudiences)[number];

export type EmailFilter = { from: string; to: string; q: string; audience: EmailAudienceFilter; before: string | null };

export type EmailRow = {
  id: string;
  created_at: string;
  audience: string;
  recipients: string;
  subject: string;
  sent: boolean;
  attachments: string[];
  reservation: { id: string; number: string } | null;
};

export type EmailRecord = EmailRow & { body_text: string; body_html: string | null };

export function parseEmailFilter(search: Record<string, string | string[] | undefined>): EmailFilter {
  const base = parseAuditFilter({ from: search.from, to: search.to, before: search.before });
  const audience = typeof search.audience === "string" && (emailAudiences as readonly string[]).includes(search.audience) ? (search.audience as EmailAudienceFilter) : "customer";
  const q = typeof search.q === "string" ? search.q.replace(/[^\p{L}\p{N}@._+\- ]/gu, "").trim().slice(0, 60) : "";
  return { from: base.from, to: base.to, before: base.before, audience, q };
}

const listColumns = "id, created_at, audience, recipients, subject, sent, attachments, reservation:reservations(id, number)";

export async function listEmails(filter: EmailFilter, limit: number): Promise<EmailRow[]> {
  const start = zonedToUtc(filter.from, "00:00", zone).toISOString();
  const end = new Date(zonedToUtc(filter.to, "23:59", zone).getTime() + 60000).toISOString();
  let query = createAdminClient()
    .from("email_log")
    .select(listColumns)
    .eq("audience", filter.audience)
    .gte("created_at", start)
    .lt("created_at", filter.before && filter.before < end ? filter.before : end)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (filter.q) query = query.or(`recipients.ilike.%${filter.q}%,subject.ilike.%${filter.q}%`);
  const { data } = await query;
  return (data ?? []) as unknown as EmailRow[];
}

export async function getEmail(id: string): Promise<EmailRecord | null> {
  const { data } = await createAdminClient().from("email_log").select(`${listColumns}, body_text, body_html`).eq("id", id).maybeSingle();
  return (data as unknown as EmailRecord | null) ?? null;
}
