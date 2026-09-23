import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth/staff";
import { scopeAllows } from "@/lib/auth/scope";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getStaffSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await scopeAllows(session, { conversation: id }))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data } = await createAdminClient().from("conversations").select("customer_seen_at").eq("id", id).maybeSingle();
  return NextResponse.json({ seenAt: data?.customer_seen_at ?? null }, { headers: { "Cache-Control": "no-store" } });
}
