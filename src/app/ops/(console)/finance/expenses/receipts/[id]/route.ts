import { NextResponse } from "next/server";
import { downloadReceipt, getReceipt } from "@/features/finance/expenses";
import { ForbiddenError, requirePermission } from "@/lib/auth/staff";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("finance.view");
  } catch (cause) {
    if (cause instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw cause;
  }
  const { id } = await context.params;
  if (!uuid.test(id)) return new NextResponse(null, { status: 404 });
  const receipt = await getReceipt(id);
  if (!receipt) return new NextResponse(null, { status: 404 });
  const blob = await downloadReceipt(receipt.storage_path);
  if (!blob) return new NextResponse(null, { status: 404 });
  const extension = receipt.storage_path.split(".").pop() ?? "bin";
  return new NextResponse(blob, {
    headers: {
      "Content-Type": receipt.content_type,
      "Content-Disposition": `inline; filename="receipt-${receipt.id.slice(0, 8)}.${extension}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
