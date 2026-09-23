import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { can, getStaffSession } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getStaffSession();
  const { id } = await params;
  if (!can(session, "inbox.view") || !uuid.test(id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: file } = await supabase.from("message_attachments").select("id, storage_path, filename, message_id").eq("id", id).maybeSingle();
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: signed } = await createAdminClient().storage.from("message-attachments").createSignedUrl(file.storage_path, 60, { download: file.filename });
  if (!signed?.signedUrl) return NextResponse.json({ error: "unavailable" }, { status: 502 });

  await audit({
    actorUserId: session.userId,
    actorType: "STAFF",
    action: "inbox.attachment_opened",
    entityType: "message",
    entityId: file.message_id,
    metadata: { by: session.displayName, filename: file.filename },
  });
  return NextResponse.redirect(signed.signedUrl);
}
