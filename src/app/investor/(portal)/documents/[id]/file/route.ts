import { NextResponse } from "next/server";
import { downloadDocument, getDocument } from "@/features/investor/documents";
import { audit } from "@/lib/audit";
import { requireInvestor } from "@/lib/auth/investor";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireInvestor();
  const { id } = await context.params;
  if (!uuid.test(id)) return new NextResponse(null, { status: 404 });
  const document = await getDocument(id, session.investorId);
  if (!document) return new NextResponse(null, { status: 404 });
  const blob = await downloadDocument(document);
  if (!blob) return new NextResponse(null, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  const ext = document.content_type === "application/pdf" ? "pdf" : document.content_type.split("/")[1].replace("jpeg", "jpg");
  const filename = `${document.title.replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 80) || "document"}.${ext}`;
  if (download) await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.document_downloaded", entityType: "investor_document", entityId: document.id });
  return new NextResponse(blob, {
    headers: {
      "Content-Type": document.content_type,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
