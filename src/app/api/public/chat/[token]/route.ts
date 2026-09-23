import { NextResponse } from "next/server";
import { z } from "zod";
import { preview } from "@/features/inbox/text";
import { createAdminClient } from "@/lib/supabase/admin";

const origins = new Set(["https://www.moviatech.ai", "https://moviatech.ai", "http://localhost:3200"]);
const tokenPattern = /^[a-f0-9]{20}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rateLimit = 30;
const rateWindowMs = 10 * 60 * 1000;

const postInput = z.object({
  text: z.string().trim().min(1).max(2000),
  name: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((value) => value || null),
  email: z
    .union([z.email().max(200), z.literal("")])
    .optional()
    .transform((value) => (value ? value.toLowerCase() : null)),
});

type Context = { params: Promise<{ token: string }> };

function headersFor(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": origins.has(origin) ? origin : "https://www.moviatech.ai",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}

const json = (request: Request, body: unknown, status = 200) => NextResponse.json(body, { status, headers: headersFor(request) });

async function loadConversation(token: string) {
  if (!tokenPattern.test(token)) return null;
  const { data } = await createAdminClient()
    .from("conversations")
    .select("id, status, ended_at, subject, customer_name, customer_email")
    .eq("token", token)
    .maybeSingle();
  return data;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: headersFor(request) });
}

export async function GET(request: Request, { params }: Context) {
  const conversation = await loadConversation((await params).token);
  if (!conversation) return json(request, { error: "not_found" }, 404);
  const supabase = createAdminClient();

  const after = new URL(request.url).searchParams.get("after");
  let since: string | null = null;
  if (after && uuidPattern.test(after)) {
    const { data } = await supabase.from("messages").select("created_at").eq("id", after).eq("conversation_id", conversation.id).maybeSingle();
    since = data?.created_at ?? null;
  }

  let query = supabase
    .from("messages")
    .select("id, direction, channel, from_name, body_text, created_at")
    .eq("conversation_id", conversation.id)
    .in("direction", ["INBOUND", "OUTBOUND"])
    .in("channel", ["WEB_FORM", "EMAIL", "PORTAL"])
    .order("created_at", { ascending: true })
    .limit(100);
  if (since) query = query.gt("created_at", since);
  const { data: rows } = await query;

  const messages = (rows ?? []).map((row) => {
    const agent = row.direction === "OUTBOUND";
    return {
      id: row.id as string,
      role: agent ? "agent" : "user",
      text: row.body_text as string,
      at: row.created_at as string,
      agentName: agent ? String(row.from_name ?? "").split(" · ")[0] || "Movia" : null,
    };
  });
  if (messages.some((item) => item.role === "agent")) {
    await supabase.from("conversations").update({ customer_read_at: new Date().toISOString(), customer_unread: false }).eq("id", conversation.id);
  }
  return json(request, { status: conversation.status, ended: conversation.status === "RESOLVED" || Boolean(conversation.ended_at), messages });
}

export async function POST(request: Request, { params }: Context) {
  const conversation = await loadConversation((await params).token);
  if (!conversation) return json(request, { error: "not_found" }, 404);
  if (conversation.status === "SPAM") return json(request, { error: "rejected" }, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(request, { error: "invalid_json" }, 400);
  }
  const parsed = postInput.safeParse(body);
  if (!parsed.success) return json(request, { error: "invalid_fields" }, 422);
  const { text, name, email } = parsed.data;

  const supabase = createAdminClient();
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation.id)
    .eq("direction", "INBOUND")
    .gte("created_at", new Date(Date.now() - rateWindowMs).toISOString());
  if ((count ?? 0) >= rateLimit) return json(request, { error: "rate_limited" }, 429);

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      direction: "INBOUND",
      channel: "WEB_FORM",
      from_name: conversation.customer_name ?? name ?? "Visitor",
      from_email: conversation.customer_email ?? email,
      subject: conversation.subject,
      body_text: text,
      delivery_status: "RECEIVED",
    })
    .select("id, created_at")
    .single();
  if (error || !message) return json(request, { error: "store_failed" }, 500);

  await supabase
    .from("conversations")
    .update({
      status: "OPEN",
      unread: true,
      last_message_at: message.created_at,
      last_message_preview: preview(text),
      last_direction: "INBOUND",
      ...(conversation.customer_email || !email ? {} : { customer_email: email }),
      ...(conversation.customer_name || !name ? {} : { customer_name: name }),
    })
    .eq("id", conversation.id);
  return json(request, { id: message.id, at: message.created_at }, 201);
}
