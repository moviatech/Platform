import { NextResponse } from "next/server";
import { listExpensesBetween } from "@/features/finance/expenses";
import { loadOwnerYear } from "@/features/finance/owner-queries";
import { isYear } from "@/features/finance/owners";
import { listStripeLedger } from "@/features/finance/stripe-sync";
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
  const requested = url.searchParams.get("kind");
  const kind = requested === "payments" || requested === "expenses" || requested === "stripe" || requested === "owners" ? requested : "reservations";
  const yearParam = url.searchParams.get("year");
  const year = isYear(yearParam) ? Number(yearParam) : new Date().getUTCFullYear();
  const lines: string[][] = [];
  if (kind === "payments") {
    lines.push(["payment_id", "reservation", "kind", "status", "amount", "captured", "refunded", "created_at", "stripe_payment_intent"]);
    for (const row of await listPaymentsForExport(range)) {
      lines.push([row.id, row.reservation?.number ?? "", row.kind, row.status, money(row.amount_cents), money(row.amount_captured_cents), money(row.amount_refunded_cents), row.created_at, row.stripe_payment_intent_id ?? ""]);
    }
  } else if (kind === "expenses") {
    lines.push(["date", "category", "amount", "vendor", "vehicle", "method", "reference", "note", "recorded_by", "recorded_at", "voided_at", "void_reason", "receipts"]);
    for (const row of await listExpensesBetween(range.from, range.to)) {
      lines.push([row.spent_on, row.category, money(row.amount_cents), row.vendor ?? "", row.vehicle?.fleet_number ?? "", row.method, row.reference ?? "", row.note ?? "", row.author?.display_name ?? "", row.created_at, row.voided_at ?? "", row.void_reason ?? "", String(row.receipts.length)]);
    }
  } else if (kind === "stripe") {
    lines.push(["id", "created_at", "type", "category", "amount", "fee", "net", "status", "payment_intent", "payout", "available_on", "description"]);
    for (const row of await listStripeLedger(range.from, range.to)) {
      lines.push([row.id, row.created_at, row.type, row.category, money(row.amount_cents), money(row.fee_cents), money(row.net_cents), row.status, row.payment_intent_id ?? "", row.payout_id ?? "", row.available_on ?? "", row.description ?? ""]);
    }
  } else if (kind === "owners") {
    lines.push(["year", "investor_number", "legal_name", "email", "compensation", "earnings", "capital_returned", "paid", "owed_now"]);
    for (const row of await loadOwnerYear(year)) {
      lines.push([String(year), row.investor_number, row.legal_name, row.email, row.compensation, money(row.earningsCents), money(row.capitalReturnedCents), money(row.paidCents), money(row.owedCents)]);
    }
  } else {
    lines.push(["reservation", "customer", "status", "pickup_at", "total", "tax", "paid", "refunded", "payment_state", "price_reviewed_at", "ownership", "owner_payable", "retained"]);
    for (const row of (await loadFinance(range)).rows) {
      lines.push([row.number, row.customer?.full_name ?? "", row.status, row.pickup_at, money(row.total_cents), money(row.tax_cents), money(row.paid_cents), money(row.refunded_cents), row.payment_state, row.price_reviewed_at ?? "", row.ownership, money(row.payable_cents), money(row.retained_cents)]);
    }
  }
  const body = "\ufeff" + lines.map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="movia-${kind}-${kind === "owners" ? year : `${range.from}-${range.to}`}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
