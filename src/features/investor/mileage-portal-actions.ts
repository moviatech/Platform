"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireInvestor } from "@/lib/auth/investor";
import { disputeStatement } from "./mileage";

export type DisputeState = { ok?: boolean; error?: "invalid" | "status" | "window" | "failed" };

const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();

export async function submitDispute(_: DisputeState, form: FormData): Promise<DisputeState> {
  const session = await requireInvestor();
  const parsed = z.object({ id: z.uuid(), miles: z.number().int().positive().max(1000000), note: z.string().trim().min(2).max(1000) }).safeParse({ id: form.get("id"), miles: Number(trimmed(form.get("miles")).replace(/[,\s]/g, "")), note: trimmed(form.get("note")) });
  if (!parsed.success) return { error: "invalid" };
  const result = await disputeStatement(parsed.data.id, session.investorId, parsed.data.miles, parsed.data.note).catch(() => ({ error: "failed" as const }));
  if ("error" in result) return { error: result.error };
  revalidatePath("/investor/earnings", "layout");
  revalidatePath("/investor", "layout");
  return { ok: true };
}
