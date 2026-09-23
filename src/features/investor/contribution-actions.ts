"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireInvestor } from "@/lib/auth/investor";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";
import { vehiclePayloadSchema } from "./contributions";
import { notifyStaffInvestorEvent } from "./notify";
import { loadInvestorSettings } from "./settings";

export type ContributionState = { ok?: boolean; error?: "invalid" | "min" | "agreement" | "failed" | "status" | "rate_limited" };

async function tooMany(userId: string) {
  const since = new Date(Date.now() - 10 * 60000).toISOString();
  const { count } = await createAdminClient().from("audit_events").select("id", { count: "exact", head: true }).eq("actor_user_id", userId).eq("action", "investor.contribution_requested").gte("created_at", since);
  return (count ?? 0) >= 10;
}

const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();
const dollars = z.coerce.number().min(0).max(10_000_000);

export async function requestCapital(_: ContributionState, form: FormData): Promise<ContributionState> {
  const session = await requireInvestor();
  const settings = await loadInvestorSettings();
  const parsed = z.object({ amount: dollars, note: z.string().trim().max(1000).optional(), agree: z.literal("1") }).safeParse({ amount: trimmed(form.get("amount")).replace(/[,$\s]/g, ""), note: trimmed(form.get("note")), agree: form.get("agree") });
  if (!parsed.success) return { error: parsed.error.issues.some((issue) => issue.path[0] === "agree") ? "agreement" : "invalid" };
  const amountCents = Math.round(parsed.data.amount * 100);
  if (amountCents < settings.capitalMinCents) return { error: "min" };
  if (await tooMany(session.userId)) return { error: "rate_limited" };
  const { data, error } = await createAdminClient()
    .from("investor_contributions")
    .insert({ investor_id: session.investorId, kind: "CAPITAL", amount_cents: amountCents, note: parsed.data.note || null })
    .select("id")
    .single();
  if (error || !data) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.contribution_requested", entityType: "investor_contribution", entityId: data.id, metadata: { kind: "CAPITAL", amountCents } });
  await notifyStaffInvestorEvent("investor_contribution_requested", { name: session.legalName, kind: "CAPITAL", amount: formatMoney(amountCents) }, `/investors/${session.investorId}`, `contribution:${data.id}`);
  revalidatePath("/investor/invest");
  redirect("/invest?submitted=1");
}

export async function requestVehicle(_: ContributionState, form: FormData): Promise<ContributionState> {
  const session = await requireInvestor();
  const parsed = z
    .object({ payload: vehiclePayloadSchema, note: z.string().trim().max(1000).optional(), agree: z.literal("1") })
    .safeParse({
      payload: { model: trimmed(form.get("model")), year: Number(trimmed(form.get("year"))), vin: trimmed(form.get("vin")).toUpperCase(), plate: trimmed(form.get("plate")), color: trimmed(form.get("color")), mileage: trimmed(form.get("mileage")) ? Number(trimmed(form.get("mileage"))) : undefined },
      note: trimmed(form.get("note")),
      agree: form.get("agree"),
    });
  if (!parsed.success) return { error: parsed.error.issues.some((issue) => issue.path[0] === "agree") ? "agreement" : "invalid" };
  if (await tooMany(session.userId)) return { error: "rate_limited" };
  const { data, error } = await createAdminClient()
    .from("investor_contributions")
    .insert({ investor_id: session.investorId, kind: "VEHICLE", amount_cents: 0, vehicle_payload: parsed.data.payload, note: parsed.data.note || null })
    .select("id")
    .single();
  if (error || !data) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.contribution_requested", entityType: "investor_contribution", entityId: data.id, metadata: { kind: "VEHICLE", vin: parsed.data.payload.vin } });
  await notifyStaffInvestorEvent("investor_contribution_requested", { name: session.legalName, kind: "VEHICLE", amount: `${parsed.data.payload.year} ${parsed.data.payload.model}` }, `/investors/${session.investorId}`, `contribution:${data.id}`);
  revalidatePath("/investor/invest");
  redirect("/invest?submitted=1");
}

export async function cancelContribution(form: FormData) {
  const session = await requireInvestor();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return;
  const { data } = await createAdminClient().from("investor_contributions").update({ status: "CANCELLED" }).eq("id", id.data).eq("investor_id", session.investorId).eq("status", "REQUESTED").select("id");
  if (data?.length) await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.contribution_cancelled", entityType: "investor_contribution", entityId: id.data });
  revalidatePath("/investor/invest");
}
