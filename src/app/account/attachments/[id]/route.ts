import { NextResponse } from "next/server";
import { attachmentBucket } from "@/features/portal/attachments";
import { getCustomerSession } from "@/lib/auth/customer";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession();
  const { id } = await params;
  if (!session || !uuid.test(id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data } = await createAdminClient()
    .from("message_attachments")
    .select("storage_path, filename, message:messages(direction, conversation:conversations(customer_id))")
    .eq("id", id)
    .maybeSingle();
  const file = data as unknown as { storage_path: string; filename: string; message: { direction: string; conversation: { customer_id: string } | null } | null } | null;
  if (!file || file.message?.direction === "INTERNAL" || file.message?.conversation?.customer_id !== session.customerId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: signed } = await createAdminClient().storage.from(attachmentBucket).createSignedUrl(file.storage_path, 300, { download: file.filename });
  if (!signed?.signedUrl) return NextResponse.json({ error: "unavailable" }, { status: 502 });
  return NextResponse.redirect(signed.signedUrl);
}
