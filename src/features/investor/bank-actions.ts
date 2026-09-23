"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireInvestor } from "@/lib/auth/investor";
import { hasStepUp } from "@/lib/auth/step-up";
import { encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyInvestorEvent } from "./notify";
import { loadInvestorSettings } from "./settings";

export type BankState = { ok?: boolean; error?: "invalid" | "step_up" | "failed" | "in_use" | "limit" };

const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();

const accountInput = z.object({
  holderName: z.string().trim().min(2).max(120),
  bankName: z.string().trim().min(2).max(120),
  accountType: z.enum(["CHECKING", "SAVINGS"]),
  routing: z.string().regex(/^\d{9}$/),
  account: z.string().regex(/^\d{4,17}$/),
});

export async function addBankAccount(_: BankState, form: FormData): Promise<BankState> {
  const session = await requireInvestor();
  if (!(await hasStepUp(session.userId))) return { error: "step_up" };
  const parsed = accountInput.safeParse({ holderName: trimmed(form.get("holderName")), bankName: trimmed(form.get("bankName")), accountType: form.get("accountType"), routing: trimmed(form.get("routing")).replace(/\s/g, ""), account: trimmed(form.get("account")).replace(/\s/g, "") });
  if (!parsed.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { count } = await admin.from("investor_bank_accounts").select("id", { count: "exact", head: true }).eq("investor_id", session.investorId).is("removed_at", null);
  if ((count ?? 0) >= 3) return { error: "limit" };
  const settings = await loadInvestorSettings();
  const last4 = parsed.data.account.slice(-4);
  const { data, error } = await admin
    .from("investor_bank_accounts")
    .insert({
      investor_id: session.investorId,
      bank_name: parsed.data.bankName,
      account_type: parsed.data.accountType,
      holder_name: parsed.data.holderName,
      last4,
      encrypted_payload: encryptSecret(JSON.stringify({ routing: parsed.data.routing, account: parsed.data.account })),
      usable_after: new Date(Date.now() + settings.bankCoolingHours * 3600000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.bank_account_added", entityType: "investor_bank_account", entityId: data.id, metadata: { last4, bank: parsed.data.bankName } });
  await notifyInvestorEvent(session.investorId, "bank_account_changed", { last4 }, "/funds/accounts");
  revalidatePath("/investor/funds", "layout");
  return { ok: true };
}

export async function removeBankAccount(_: BankState, form: FormData): Promise<BankState> {
  const session = await requireInvestor();
  if (!(await hasStepUp(session.userId))) return { error: "step_up" };
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { count } = await admin.from("investor_withdrawals").select("id", { count: "exact", head: true }).eq("bank_account_id", id.data).in("status", ["REQUESTED", "APPROVED"]);
  if (count) return { error: "in_use" };
  const { data } = await admin.from("investor_bank_accounts").update({ removed_at: new Date().toISOString() }).eq("id", id.data).eq("investor_id", session.investorId).is("removed_at", null).select("id, last4");
  if (!data?.length) return { error: "invalid" };
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.bank_account_removed", entityType: "investor_bank_account", entityId: id.data, metadata: { last4: data[0].last4 } });
  await notifyInvestorEvent(session.investorId, "bank_account_changed", { last4: data[0].last4 }, "/funds/accounts");
  revalidatePath("/investor/funds", "layout");
  return { ok: true };
}
