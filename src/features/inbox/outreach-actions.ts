"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { conversationTargetColumns, postPortalMessage, sendEmailReply, type PortalTarget } from "./outbound";
import { preview } from "./text";

export type OutreachState = { ok?: boolean; sent?: number; error?: string; confirm?: number; values?: Record<string, string>; selected?: string[] };

const input = z.object({
  channel: z.enum(["portal", "email"]),
  audience: z.enum(["selected", "all"]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  confirm: z.string().optional(),
  customerIds: z.array(z.uuid()).max(200),
});

type Recipient = { id: string; full_name: string; email: string | null; preferred_language: string };

export async function sendOutreach(_: OutreachState, form: FormData): Promise<OutreachState> {
  const session = await requirePermission("inbox.reply");
  const parsed = input.safeParse({
    channel: form.get("channel"),
    audience: form.get("audience") ?? "selected",
    subject: form.get("subject"),
    body: form.get("body"),
    confirm: form.get("confirm") ?? undefined,
    customerIds: form.getAll("customerIds").map(String),
  });
  const values = Object.fromEntries(["channel", "audience", "subject", "body"].map((key) => [key, String(form.get(key) ?? "")]));
  const selected = form.getAll("customerIds").map(String);
  if (!parsed.success) return { error: "invalid", values, selected };
  const { channel, audience, subject, body, confirm, customerIds } = parsed.data;
  const supabase = createAdminClient();

  let recipients: Recipient[] = [];
  if (audience === "all") {
    if (!session.roles.includes("SUPER_ADMIN") && !session.roles.includes("STAFF")) return { error: "forbidden", values, selected };
    const { data } = await supabase.from("customers").select("id, full_name, email, preferred_language").not("email", "is", null).order("created_at");
    recipients = (data ?? []) as Recipient[];
    if (confirm !== "yes") return { confirm: recipients.length, values, selected };
  } else {
    if (customerIds.length === 0) return { error: "none", values, selected };
    const { data } = await supabase.from("customers").select("id, full_name, email, preferred_language").in("id", customerIds);
    recipients = (data ?? []) as Recipient[];
  }
  if (recipients.length === 0) return { error: "none", values, selected };

  const actor = { userId: session.userId, displayName: session.displayName };
  const now = new Date().toISOString();
  let sent = 0;
  for (const recipient of recipients) {
    const { data: conversation } = await supabase
      .from("conversations")
      .insert({
        mailbox: "contact",
        subject,
        customer_email: recipient.email?.toLowerCase() ?? null,
        customer_name: recipient.full_name,
        customer_id: recipient.id,
        locale: recipient.preferred_language === "zh" ? "zh" : "en",
        status: "PENDING_CUSTOMER",
        unread: false,
        assigned_to: session.userId,
        last_message_at: now,
        last_message_preview: preview(body),
        last_direction: "OUTBOUND",
      })
      .select(conversationTargetColumns)
      .single();
    if (!conversation) continue;
    const target = conversation as PortalTarget;
    if (channel === "email" && target.customer_email) {
      const result = await sendEmailReply({ ...target, customer_email: target.customer_email }, { body, actor, persona: "support" });
      if (result.sent) sent += 1;
    } else {
      await postPortalMessage(target, { body, actor, persona: "support" });
      sent += 1;
    }
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "inbox.outreach_sent", entityType: "conversation", metadata: { by: session.displayName, channel, audience, recipients: recipients.length, sent, subject } });
  revalidatePath("/ops/inbox", "layout");
  return { ok: true, sent };
}
