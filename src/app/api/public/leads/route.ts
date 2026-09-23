import { NextResponse } from "next/server";
import { z } from "zod";
import { createWebFormConversation } from "@/features/inbox/ingest";
import { preview } from "@/features/inbox/text";
import { notifyNewLead } from "@/features/leads/notify";
import { leadKinds } from "@/features/leads/types";
import { hasValidApiKey } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

const input = z.object({
  kind: z.enum(leadKinds),
  reference: optionalText(80),
  name: optionalText(120),
  email: z
    .union([z.email().max(200), z.literal("")])
    .optional()
    .transform((value) => (value ? value.toLowerCase() : null)),
  phone: optionalText(40),
  wechat: optionalText(60),
  locale: optionalText(8),
  sourceUrl: optionalText(500),
  summary: optionalText(500),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const transcriptEntry = z.object({ role: z.enum(["user", "bot"]), text: z.string().trim().min(1).max(4000) });

type Supabase = ReturnType<typeof createAdminClient>;
type LeadInput = z.infer<typeof input>;

async function createChatConversation(supabase: Supabase, leadId: string, lead: LeadInput) {
  const zh = lead.locale === "zh";
  const subject = zh ? "官网咨询 · 转人工" : "Website chat handoff";
  const roles = zh ? { user: "客户", bot: "助理" } : { user: "Customer", bot: "Assistant" };
  const lines = (Array.isArray(lead.payload.transcript) ? lead.payload.transcript : [])
    .map((entry) => transcriptEntry.safeParse(entry))
    .flatMap((result) => (result.success ? [`${roles[result.data.role]}: ${result.data.text}`] : []))
    .slice(-12);
  const body = lines.join("\n") || lead.summary || "";
  const email = lead.email?.toLowerCase() ?? null;
  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({
      mailbox: "contact",
      subject,
      customer_email: email,
      customer_name: lead.name,
      locale: lead.locale,
      lead_id: leadId,
      status: "OPEN",
      unread: true,
      last_message_at: new Date().toISOString(),
      last_message_preview: preview(body),
      last_direction: "INBOUND",
    })
    .select("id, token")
    .single();
  if (error || !conversation) throw new Error(`conversation_insert:${error?.message}`);
  await supabase.from("messages").insert({
    conversation_id: conversation.id,
    direction: "INBOUND",
    channel: "WEB_FORM",
    from_email: email,
    from_name: lead.name,
    subject,
    body_text: body,
    delivery_status: "RECEIVED",
  });
  await supabase.from("leads").update({ status: "CONVERTED" }).eq("id", leadId);
  return conversation.token as string;
}

export async function POST(request: Request) {
  if (!hasValidApiKey(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = input.safeParse(body);
  if (!parsed.success || JSON.stringify(parsed.data.payload).length > 40000) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 422 });
  }
  const lead = parsed.data;

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  if (lead.reference) {
    const { data: existing } = await supabase.from("leads").select("id").eq("reference", lead.reference).maybeSingle();
    if (existing) {
      const { data: linked } = lead.kind === "ASSISTANT" ? await supabase.from("conversations").select("token").eq("lead_id", existing.id).limit(1) : { data: null };
      const chatToken = linked?.[0]?.token as string | undefined;
      return NextResponse.json({ id: existing.id, duplicate: true, ...(chatToken ? { chatToken } : {}) });
    }
  }

  const { data, error } = await supabase
    .from("leads")
    .insert({
      kind: lead.kind,
      reference: lead.reference,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      wechat: lead.wechat,
      locale: lead.locale,
      source_url: lead.sourceUrl,
      summary: lead.summary,
      payload: lead.payload,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[leads:insert]", error?.message);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }

  await supabase.from("audit_events").insert({
    actor_type: "API",
    action: "lead.received",
    entity_type: "lead",
    entity_id: data.id,
    metadata: { kind: lead.kind, reference: lead.reference },
  });

  let chatToken: string | undefined;
  if (lead.kind === "ASSISTANT") {
    try {
      chatToken = await createChatConversation(supabase, data.id, lead);
    } catch (cause) {
      console.error("[leads:conversation]", cause);
    }
  }

  const message = typeof lead.payload.message === "string" ? lead.payload.message : null;
  if (lead.kind === "CONTACT" && lead.email && message) {
    try {
      await createWebFormConversation({
        leadId: data.id,
        name: lead.name,
        email: lead.email,
        locale: lead.locale,
        topic: typeof lead.payload.topic === "string" ? lead.payload.topic : null,
        message,
      });
      await supabase.from("leads").update({ status: "CONVERTED" }).eq("id", data.id);
    } catch (cause) {
      console.error("[leads:conversation]", cause);
    }
  }

  try {
    await notifyNewLead({ id: data.id, ...lead });
  } catch (cause) {
    console.error("[leads:notify]", cause);
  }

  return NextResponse.json({ id: data.id, ...(chatToken ? { chatToken } : {}) }, { status: 201 });
}
