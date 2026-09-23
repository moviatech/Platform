import { NextResponse } from "next/server";
import { z } from "zod";
import { summarizeStale } from "@/features/inbox/ai";
import { can, getStaffSession } from "@/lib/auth/staff";
import { scopeAllows } from "@/lib/auth/scope";

export const maxDuration = 30;

const input = z.array(z.uuid()).min(1).max(20);

export async function POST(request: Request) {
  const session = await getStaffSession();
  if (!can(session, "inbox.view")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 422 });
  const allowed: string[] = [];
  for (const id of parsed.data) if (await scopeAllows(session, { conversation: id })) allowed.push(id);
  const result = await summarizeStale(allowed).catch(() => ({ updated: 0, failed: "failed" }));
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
