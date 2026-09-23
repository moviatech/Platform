import { NextResponse } from "next/server";
import { listNewMessages } from "@/features/portal/live-queries";
import { getCustomerSession } from "@/lib/auth/customer";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  const after = new URL(request.url).searchParams.get("after") ?? "";
  const data = await listNewMessages(session.customerId, id, uuid.test(after) ? after : null);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  return NextResponse.json(data, { headers });
}
