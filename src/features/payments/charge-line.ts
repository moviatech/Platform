import { formatMoney } from "../../lib/utils/format";

export type ChargeKind = "RENTAL" | "ADDITIONAL" | "CANCELLATION_FEE" | "TOLL" | "SETTLE";
export type PaymentChargeKind = Exclude<ChargeKind, "TOLL" | "SETTLE">;

export type ChargePlan = { kind: PaymentChargeKind; amountCents: number; note: string; lineCode: string | null; toll: boolean };

export const rentalKinds = ["RENTAL"];

export const chargeLineCode = (kind: string) => (kind === "RENTAL" || kind === "SETTLE" ? null : kind === "CANCELLATION_FEE" ? "charge.cancellation" : kind === "TOLL" ? "charge.toll" : "charge.additional");

export function planCharge(input: { kind: ChargeKind; amountCents: number; note: string; tollDays: number; adminFeeCentsPerDay: number }): ChargePlan {
  const toll = input.kind === "TOLL";
  const handlingCents = toll ? input.tollDays * input.adminFeeCentsPerDay : 0;
  const note = toll ? `Tolls ${formatMoney(input.amountCents)} · ${input.tollDays} day(s) handling ${formatMoney(handlingCents)}${input.note ? ` · ${input.note}` : ""}` : input.note;
  return { kind: toll || input.kind === "SETTLE" ? "ADDITIONAL" : (input.kind as PaymentChargeKind), amountCents: input.amountCents + handlingCents, note, lineCode: chargeLineCode(input.kind), toll };
}

export function approvedCharge(payload: Record<string, unknown>): { kind: PaymentChargeKind; lineCode: string | null; toll: boolean } {
  const raw = typeof payload.kind === "string" ? payload.kind : "ADDITIONAL";
  const kind: PaymentChargeKind = raw === "RENTAL" || raw === "CANCELLATION_FEE" ? raw : "ADDITIONAL";
  if (typeof payload.claimId === "string" || kind === "RENTAL" || payload.lineCode === null) return { kind, lineCode: null, toll: false };
  const stored = typeof payload.lineCode === "string" && payload.lineCode.startsWith("charge.") ? payload.lineCode : null;
  return { kind, lineCode: stored ?? chargeLineCode(kind), toll: payload.toll === true };
}

export const chargeLine = (reservationId: string, input: { lineCode: string; amountCents: number; note: string }) => ({
  reservation_id: reservationId,
  type: "ADDITIONAL",
  code: input.lineCode,
  description: input.note,
  quantity: 1,
  unit_cents: input.amountCents,
  amount_cents: input.amountCents,
  taxable: false,
  sort_order: 300,
});
