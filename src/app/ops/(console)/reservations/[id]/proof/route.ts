import { NextResponse } from "next/server";
import { photoBucket } from "@/features/handover/types";
import { attachmentBucket } from "@/features/portal/attachments";
import { scopeAllows } from "@/lib/auth/scope";
import { can, getStaffSession } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getStaffSession();
  const { id } = await params;
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!session || !can(session, "reservation.view") || !uuid.test(id) || !(await scopeAllows(session, { reservation: id }))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const supabase = createAdminClient();
  const { data: reservation } = await supabase.from("reservations").select("customer_id").eq("id", id).maybeSingle();
  if (!reservation) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const bucket = path.startsWith(`portal/${reservation.customer_id}/insurance/`) ? attachmentBucket : path.startsWith(`${id}/pickup/`) ? photoBucket : null;
  if (!bucket || !/^[A-Za-z0-9/_.-]+$/.test(path)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (!data?.signedUrl) return NextResponse.json({ error: "unavailable" }, { status: 502 });
  return NextResponse.redirect(data.signedUrl);
}
