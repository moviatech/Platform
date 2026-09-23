"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireInvestor } from "@/lib/auth/investor";
import { hasStepUp } from "@/lib/auth/step-up";
import { encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyInvestorEvent, notifyStaffInvestorEvent } from "./notify";
import { loadInvestorSettings } from "./settings";

export type BankState = { ok?: boolean; requested?: boolean; error?: "invalid" | "step_up" | "failed" | "in_use" | "limit" };

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
  const member = session.memberId;
  const counting = admin.from("investor_bank_accounts").select("id", { count: "exact", head: true }).eq("investor_id", session.ownerId).is("removed_at", null);
  const { count } = await (member ? counting.or(`status.eq.ACTIVE,requested_by.eq.${member}`) : counting);
  if ((count ?? 0) >= 3) return { error: "limit" };
  const settings = await loadInvestorSettings();
  const last4 = parsed.data.account.slice(-4);
  const { data, error } = await admin
    .from("investor_bank_accounts")
    .insert({
      investor_id: session.ownerId,
      bank_name: parsed.data.bankName,
      account_type: parsed.data.accountType,
      holder_name: parsed.data.holderName,
      last4,
      encrypted_payload: encryptSecret(JSON.stringify({ routing: parsed.data.routing, account: parsed.data.account })),
      usable_after: new Date(Date.now() + (member ? 0 : settings.bankCoolingHours * 3600000)).toISOString(),
      ...(member ? { status: "PENDING", requested_by: member } : {}),
    })
    .select("id")
    .single();
  if (error || !data) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: member ? "investor.bank_account_requested" : "investor.bank_account_added", entityType: "investor_bank_account", entityId: data.id, metadata: { last4, bank: parsed.data.bankName, ...(member ? { memberId: member, companyId: session.ownerId } : {}) } });
  if (member) await notifyStaffInvestorEvent("investor_bank_requested", { name: `${session.legalName} · ${session.company?.name ?? ""}`, bank: parsed.data.bankName, last4 }, `/investors/${session.ownerId}`, `bank_add:${data.id}`);
  else await notifyInvestorEvent(session.ownerId, "bank_account_changed", { last4 }, "/funds/accounts");
  revalidatePath("/investor/funds", "layout");
  return member ? { ok: true, requested: true } : { ok: true };
}

export async function removeBankAccount(_: BankState, form: FormData): Promise<BankState> {
  const session = await requireInvestor();
  if (!(await hasStepUp(session.userId))) return { error: "step_up" };
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const member = session.memberId;
  if (member) {
    const { data: own } = await admin.from("investor_bank_accounts").update({ removed_at: now }).eq("id", id.data).eq("investor_id", session.ownerId).eq("status", "PENDING").eq("requested_by", member).is("removed_at", null).select("id, last4");
    if (own?.length) {
      await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.bank_request_withdrawn", entityType: "investor_bank_account", entityId: id.data, metadata: { last4: own[0].last4, memberId: member } });
      revalidatePath("/investor/funds", "layout");
      return { ok: true };
    }
    const { data } = await admin.from("investor_bank_accounts").update({ removal_requested_by: member, removal_requested_at: now }).eq("id", id.data).eq("investor_id", session.ownerId).eq("status", "ACTIVE").is("removed_at", null).is("removal_requested_at", null).select("id, last4, bank_name");
    if (!data?.length) return { error: "invalid" };
    await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.bank_removal_requested", entityType: "investor_bank_account", entityId: id.data, metadata: { last4: data[0].last4, memberId: member, companyId: session.ownerId } });
    await notifyStaffInvestorEvent("investor_bank_removal_requested", { name: `${session.legalName} · ${session.company?.name ?? ""}`, bank: data[0].bank_name, last4: data[0].last4 }, `/investors/${session.ownerId}`, `bank_remove:${id.data}:${now}`);
    revalidatePath("/investor/funds", "layout");
    return { ok: true, requested: true };
  }
  const { count } = await admin.from("investor_withdrawals").select("id", { count: "exact", head: true }).eq("bank_account_id", id.data).in("status", ["REQUESTED", "APPROVED"]);
  if (count) return { error: "in_use" };
  const { data } = await admin.from("investor_bank_accounts").update({ removed_at: now }).eq("id", id.data).eq("investor_id", session.ownerId).is("removed_at", null).select("id, last4");
  if (!data?.length) return { error: "invalid" };
  await audit({ actorUserId: session.userId, actorType: "INVESTOR", action: "investor.bank_account_removed", entityType: "investor_bank_account", entityId: id.data, metadata: { last4: data[0].last4 } });
  await notifyInvestorEvent(session.ownerId, "bank_account_changed", { last4: data[0].last4 }, "/funds/accounts");
  revalidatePath("/investor/funds", "layout");
  return { ok: true };
}
