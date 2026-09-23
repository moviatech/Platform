import { NextResponse } from "next/server";
import { evidenceBucket, evidencePath, evidenceTypes } from "@/features/finance/board/evidence";
import { ForbiddenError, requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_: Request, context: { params: Promise<{ vehicleId: string }> }) {
  try {
    await requirePermission("finance.view");
  } catch (cause) {
    if (cause instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw cause;
  }
  const { vehicleId } = await context.params;
  if (!uuid.test(vehicleId)) return new NextResponse(null, { status: 404 });
  const admin = createAdminClient();
  const { data } = await admin.from("fin_vehicle_costs").select("tax_evidence_path").eq("vehicle_id", vehicleId.toLowerCase()).maybeSingle();
  const path = (data?.tax_evidence_path as string | null | undefined) ?? null;
  if (!path || !evidencePath(vehicleId).test(path)) return new NextResponse(null, { status: 404 });
  const { data: blob } = await admin.storage.from(evidenceBucket).download(path);
  if (!blob) return new NextResponse(null, { status: 404 });
  const extension = path.slice(path.lastIndexOf(".") + 1);
  return new NextResponse(blob, {
    headers: {
      "Content-Type": evidenceTypes[extension] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="tax-${vehicleId.slice(0, 8).toLowerCase()}.${extension}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
