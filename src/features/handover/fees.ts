export type ReturnFeeInput = {
  startOdometer: number;
  endOdometer: number;
  allowanceMiles: number | null;
  excessRateCents: number;
  batteryLevel: number;
  minReturnLevel: number;
  lowChargeFeeCentsPerPercent: number;
  chargingIncluded: boolean;
  scheduledReturnAt: string;
  actualReturnAt: string;
  graceMinutes: number;
  dailyRateCents: number;
  lateHourlyCapHours: number;
  superchargingCents: number;
  cleaningCents: number;
  otherCents: number;
};

export type FeeCode = "excess_mileage" | "low_charge" | "late_hours" | "late_return" | "supercharging" | "cleaning" | "other";

export type FeeLine = { code: FeeCode; quantity: number; unitCents: number; amountCents: number };

export const hourlyRate = (dailyRateCents: number) => Math.round(dailyRateCents / 24);

export function computeReturnFees(input: ReturnFeeInput): FeeLine[] {
  const lines: FeeLine[] = [];
  const driven = Math.max(0, input.endOdometer - input.startOdometer);
  if (input.allowanceMiles !== null && driven > input.allowanceMiles && input.excessRateCents > 0) {
    const excess = driven - input.allowanceMiles;
    lines.push({ code: "excess_mileage", quantity: excess, unitCents: input.excessRateCents, amountCents: excess * input.excessRateCents });
  }
  if (!input.chargingIncluded && input.batteryLevel < input.minReturnLevel && input.lowChargeFeeCentsPerPercent > 0) {
    const short = input.minReturnLevel - input.batteryLevel;
    lines.push({ code: "low_charge", quantity: short, unitCents: input.lowChargeFeeCentsPerPercent, amountCents: short * input.lowChargeFeeCentsPerPercent });
  }
  const lateMinutes = (new Date(input.actualReturnAt).getTime() - new Date(input.scheduledReturnAt).getTime()) / 60000 - input.graceMinutes;
  if (lateMinutes > 0 && input.dailyRateCents > 0) {
    const hours = Math.ceil(lateMinutes / 60);
    if (hours <= input.lateHourlyCapHours) {
      const unit = hourlyRate(input.dailyRateCents);
      lines.push({ code: "late_hours", quantity: hours, unitCents: unit, amountCents: hours * unit });
    } else {
      const days = Math.ceil(lateMinutes / 1440);
      lines.push({ code: "late_return", quantity: days, unitCents: input.dailyRateCents, amountCents: days * input.dailyRateCents });
    }
  }
  if (input.superchargingCents > 0) lines.push({ code: "supercharging", quantity: 1, unitCents: input.superchargingCents, amountCents: input.superchargingCents });
  if (input.cleaningCents > 0) lines.push({ code: "cleaning", quantity: 1, unitCents: input.cleaningCents, amountCents: input.cleaningCents });
  if (input.otherCents > 0) lines.push({ code: "other", quantity: 1, unitCents: input.otherCents, amountCents: input.otherCents });
  return lines;
}

export const feeTotal = (lines: FeeLine[]) => lines.reduce((sum, line) => sum + line.amountCents, 0);
