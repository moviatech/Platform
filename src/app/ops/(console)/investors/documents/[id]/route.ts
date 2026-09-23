import { NextResponse } from "next/server";
import { downloadDocument, getDocument } from "@/features/investor/documents";
import { audit } from "@/lib/audit";
import { requirePagePermission } from "@/lib/auth/staff";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("investor.view");
  const { id } = await context.params;
  if (!uuid.test(id)) return new NextResponse(null, { status: 404 });
  const document = await getDocument(id);
  if (!document) return new NextResponse(null, { status: 404 });
  const blob = await downloadDocument(document);
  if (!blob) return new NextResponse(null, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.document_opened", entityType: "investor_document", entityId: document.id, metadata: { by: session.displayName } });
  return new NextResponse(blob, {
    headers: {
      "Content-Type": document.content_type,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(document.title.slice(0, 80))}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
