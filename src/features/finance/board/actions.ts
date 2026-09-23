"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { maxReceiptBytes, receiptTypes } from "../report";
import { isTestOrder } from "../test-orders";
import { laDate } from "../ledger/dates";
import { evidenceBucket, evidencePath } from "./evidence";
import { isDate } from "./range";

export type BoardState = { ok?: boolean; error?: "invalid" | "failed" | "price" | "dates" | "vehicle" | "lease" | "residual" };

const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();
const optionalDate = (value: FormDataEntryValue | null) => trimmed(value) || null;

function cents(value: FormDataEntryValue | null) {
  const text = trimmed(value).replace(/[,$\s]/g, "");
  if (!text) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

const money = (max: number) => z.number().int().min(0).max(max).nullable();
const day = z.string().refine((value) => isDate(value)).nullable();

const costsSchema = z.object({
  vehicleId: z.uuid(),
  inServiceOn: day,
  retiredOn: day,
  purchasePriceCents: money(100_000_000),
  depreciationMonths: z.number().int().min(1).max(360).nullable(),
  residualCents: money(100_000_000),
  monthlyPaymentCents: money(10_000_000),
  purchaseTax: z.enum(["PAID", "RESALE", "UNKNOWN"]).nullable(),
  insuranceMonthlyCents: money(10_000_000),
  registrationYearlyCents: money(10_000_000),
});

const done = (): BoardState => {
  revalidatePath("/ops/finance", "layout");
  return { ok: true };
};

type Admin = ReturnType<typeof createAdminClient>;

async function realVehicle(admin: Admin, vehicleId: string) {
  const { data } = await admin.from("vehicles").select("id, fleet_number, is_placeholder, vehicle_class:vehicle_classes(slug)").eq("id", vehicleId).maybeSingle();
  const facts = data as unknown as { id: string; fleet_number: string | null; is_placeholder: boolean | null; vehicle_class: { slug: string | null } | null } | null;
  if (!facts || isTestOrder({ classSlug: facts.vehicle_class?.slug, fleetNumber: facts.fleet_number, placeholder: facts.is_placeholder })) return null;
  return facts;
}

export async function saveVehicleCosts(_: BoardState, form: FormData): Promise<BoardState> {
  const session = await requirePermission("finance.ledger");
  const months = trimmed(form.get("depreciationMonths"));
  const parsed = costsSchema.safeParse({
    vehicleId: trimmed(form.get("vehicleId")),
    inServiceOn: optionalDate(form.get("inServiceOn")),
    retiredOn: optionalDate(form.get("retiredOn")),
    purchasePriceCents: cents(form.get("purchasePrice")),
    depreciationMonths: months ? Number(months) : null,
    residualCents: cents(form.get("residual")),
    monthlyPaymentCents: cents(form.get("monthlyPayment")),
    purchaseTax: trimmed(form.get("purchaseTax")) || null,
    insuranceMonthlyCents: cents(form.get("insuranceMonthly")),
    registrationYearlyCents: cents(form.get("registrationYearly")),
  });
  if (!parsed.success) return { error: "invalid" };
  const value = parsed.data;
  if (value.purchasePriceCents !== null && value.depreciationMonths === null) return { error: "price" };
  if (value.residualCents !== null && (value.purchasePriceCents === null || value.residualCents >= value.purchasePriceCents)) return { error: "residual" };
  if (value.purchasePriceCents !== null && value.monthlyPaymentCents !== null) return { error: "lease" };
  if (value.inServiceOn && value.retiredOn && value.retiredOn <= value.inServiceOn) return { error: "dates" };
  const admin = createAdminClient();
  const facts = await realVehicle(admin, value.vehicleId);
  if (!facts) return { error: "vehicle" };
  const { data: before } = await admin.from("fin_vehicle_costs").select("*").eq("vehicle_id", value.vehicleId).maybeSingle();
  const after = {
    vehicle_id: value.vehicleId,
    in_service_on: value.inServiceOn,
    retired_on: value.retiredOn,
    purchase_price_cents: value.purchasePriceCents,
    depreciation_months: value.purchasePriceCents === null ? null : value.depreciationMonths,
    residual_cents: value.purchasePriceCents === null ? null : value.residualCents,
    monthly_payment_cents: value.monthlyPaymentCents,
    purchase_tax: value.purchaseTax,
    insurance_monthly_cents: value.insuranceMonthlyCents,
    registration_yearly_cents: value.registrationYearlyCents,
  };
  const { error } = await admin.from("fin_vehicle_costs").upsert({ ...after, updated_by: session.userId, updated_at: new Date().toISOString() }, { onConflict: "vehicle_id" });
  if (error) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.vehicle_costs_saved", entityType: "vehicle", entityId: value.vehicleId, metadata: { by: session.displayName, fleetNumber: facts.fleet_number, before: before ?? null, after } });
  return done();
}

export type EvidenceTarget = { path: string; url: string } | null;

const extensionOf = (type: string) => (type === "application/pdf" ? "pdf" : type.split("/")[1].replace("jpeg", "jpg"));
const validFile = (type: string, size: number) => receiptTypes.test(type) && Number.isInteger(size) && size > 0 && size <= maxReceiptBytes;

export async function createTaxEvidenceUpload(vehicleId: string, file: { type: string; size: number }): Promise<EvidenceTarget> {
  await requirePermission("finance.ledger");
  if (!z.uuid().safeParse(vehicleId).success || !validFile(file.type, file.size)) return null;
  const admin = createAdminClient();
  if (!(await realVehicle(admin, vehicleId))) return null;
  const path = `vehicles/${vehicleId.toLowerCase()}/${randomUUID()}.${extensionOf(file.type)}`;
  const { data } = await admin.storage.from(evidenceBucket).createSignedUploadUrl(path);
  return data ? { path, url: data.signedUrl } : null;
}

export async function attachTaxEvidence(vehicleId: string, path: string, contentType: string, size: number): Promise<{ ok: boolean }> {
  const session = await requirePermission("finance.ledger");
  if (!z.uuid().safeParse(vehicleId).success || !validFile(contentType, size) || !evidencePath(vehicleId).test(path)) return { ok: false };
  const admin = createAdminClient();
  const facts = await realVehicle(admin, vehicleId);
  if (!facts) return { ok: false };
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data: stored } = await admin.storage.from(evidenceBucket).list(folder, { search: name });
  if (!stored?.some((item) => item.name === name)) return { ok: false };
  const { data: before } = await admin.from("fin_vehicle_costs").select("*").eq("vehicle_id", vehicleId).maybeSingle();
  const { error } = await admin.from("fin_vehicle_costs").upsert({ vehicle_id: vehicleId, tax_evidence_path: path, updated_by: session.userId, updated_at: new Date().toISOString() }, { onConflict: "vehicle_id" });
  if (error) return { ok: false };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.vehicle_costs_saved", entityType: "vehicle", entityId: vehicleId, metadata: { by: session.displayName, fleetNumber: facts.fleet_number, before: before ?? null, after: { tax_evidence_path: path, contentType, size } } });
  revalidatePath("/ops/finance", "layout");
  return { ok: true };
}

export async function addBankBalance(_: BoardState, form: FormData): Promise<BoardState> {
  const session = await requirePermission("finance.ledger");
  const parsed = z
    .object({ accountName: z.string().min(1).max(80), asOf: z.string().refine((value) => isDate(value) && value <= laDate(Date.now())), balanceCents: z.number().int().min(-100_000_000_000).max(100_000_000_000) })
    .safeParse({ accountName: trimmed(form.get("accountName")).replace(/\s+/g, " "), asOf: trimmed(form.get("asOf")), balanceCents: cents(form.get("balance")) });
  if (!parsed.success) return { error: "invalid" };
  const { data, error } = await createAdminClient()
    .from("fin_bank_balances")
    .insert({ account_name: parsed.data.accountName, as_of: parsed.data.asOf, balance_cents: parsed.data.balanceCents, entered_by: session.userId })
    .select("id")
    .single();
  if (error || !data) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.bank_balance_added", entityType: "finance_bank_balance", entityId: String(data.id), metadata: { by: session.displayName, account: parsed.data.accountName, asOf: parsed.data.asOf, balanceCents: parsed.data.balanceCents } });
  return done();
}

export async function deleteBankBalance(_: BoardState, form: FormData): Promise<BoardState> {
  const session = await requirePermission("finance.ledger");
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse({ id: trimmed(form.get("id")) });
  if (!parsed.success) return { error: "invalid" };
  const { data, error } = await createAdminClient().from("fin_bank_balances").delete().eq("id", parsed.data.id).select("id, account_name, as_of, balance_cents, entered_by, entered_at");
  if (error) return { error: "failed" };
  if (!data?.length) return { error: "invalid" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "finance.bank_balance_deleted", entityType: "finance_bank_balance", entityId: String(parsed.data.id), metadata: { by: session.displayName, row: data[0] } });
  return done();
}
