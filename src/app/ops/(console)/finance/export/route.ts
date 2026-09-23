import { NextResponse } from "next/server";
import { listPaymentsForExport, loadFinance, parseRange } from "@/features/finance/queries";
import { ForbiddenError, requirePermission } from "@/lib/auth/staff";

const cell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const money = (cents: number) => (cents / 100).toFixed(2);

export async function GET(request: Request) {
  try {
    await requirePermission("finance.export");
  } catch (cause) {
    if (cause instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw cause;
  }
  const url = new URL(request.url);
  const range = parseRange(Object.fromEntries(url.searchParams.entries()));
  const kind = url.searchParams.get("kind") === "payments" ? "payments" : "reservations";
  const lines: string[][] = [];
  if (kind === "payments") {
    lines.push(["payment_id", "reservation", "kind", "status", "amount", "captured", "refunded", "created_at", "stripe_payment_intent"]);
    for (const row of await listPaymentsForExport(range)) {
      lines.push([row.id, row.reservation?.number ?? "", row.kind, row.status, money(row.amount_cents), money(row.amount_captured_cents), money(row.amount_refunded_cents), row.created_at, row.stripe_payment_intent_id ?? ""]);
    }
  } else {
    lines.push(["reservation", "customer", "status", "pickup_at", "total", "tax", "paid", "refunded", "payment_state", "price_reviewed_at"]);
    for (const row of (await loadFinance(range)).rows) {
      lines.push([row.number, row.customer?.full_name ?? "", row.status, row.pickup_at, money(row.total_cents), money(row.tax_cents), money(row.paid_cents), money(row.refunded_cents), row.payment_state, row.price_reviewed_at ?? ""]);
    }
  }
  const body = "\ufeff" + lines.map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="movia-${kind}-${range.from}-${range.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
