export type AdjustmentKind = "fee" | "discount";

const amountPattern = /^\d{1,6}(\.\d{1,2})?$/;

export function adjustmentCents(amount: string | null | undefined): number | null {
  const text = (amount ?? "").trim();
  if (!text) return 0;
  if (!amountPattern.test(text)) return null;
  return Math.round(Number(text) * 100);
}

export const signedAdjustment = (kind: AdjustmentKind, cents: number) => (kind === "fee" ? cents : -cents);

export type AdjustmentDraft = { kind: AdjustmentKind; note: string; amount: string };

export type Adjustment = { kind: AdjustmentKind; cents: number; note: string };

export const maxAdjustments = 10;

export function adjustmentDraftValid(draft: AdjustmentDraft) {
  const cents = adjustmentCents(draft.amount);
  return cents !== null && (cents > 0 || !draft.note.trim());
}

export function readAdjustments(drafts: AdjustmentDraft[]): Adjustment[] | null {
  if (drafts.length > maxAdjustments || !drafts.every(adjustmentDraftValid)) return null;
  return drafts.flatMap((draft) => {
    const cents = adjustmentCents(draft.amount) ?? 0;
    return cents > 0 ? [{ kind: draft.kind, cents, note: draft.note.trim().slice(0, 120) }] : [];
  });
}

export const adjustmentTotal = (list: Adjustment[]) => list.reduce((sum, item) => sum + signedAdjustment(item.kind, item.cents), 0);

export function immediateAdjustments(list: Adjustment[], discountLimitCents: number | null) {
  const discounts = list.reduce((sum, item) => sum + (item.kind === "discount" ? item.cents : 0), 0);
  return discountLimitCents !== null && discounts > discountLimitCents ? list.filter((item) => item.kind !== "discount") : list;
}

const defaults: Record<AdjustmentKind, { zh: string; en: string }> = {
  fee: { zh: "其他费用", en: "Additional charge" },
  discount: { zh: "优惠减免", en: "Discount" },
};

export function adjustmentDescription(kind: AdjustmentKind, note: string | null | undefined, language: string | null | undefined) {
  const text = (note ?? "").trim().slice(0, 120);
  return text || defaults[kind][language === "zh" ? "zh" : "en"];
}
