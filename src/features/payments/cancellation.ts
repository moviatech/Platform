export type CancelPolicy = {
  short: { freeHours: number; lateDays: number; noShowMaxDays: number };
  monthly: { freeHours: number; feeHours: number; feeCents: number; lateHours: number; lateDays: number; finalDays: number; noShowDays: number };
};

export type CancellationInput = {
  policy: CancelPolicy;
  rentalDays: number;
  listDailyCents: number;
  totalCents: number;
  pickupAt: Date;
  at: Date;
  noShow: boolean;
};

export function listDailyCents(averageDailyCents: number, multiplierBps: number) {
  return multiplierBps > 0 ? Math.round((averageDailyCents * 10000) / multiplierBps) : averageDailyCents;
}

export function cancellationFeeCents({ policy, rentalDays, listDailyCents: daily, totalCents, pickupAt, at, noShow }: CancellationInput) {
  const hoursBefore = (pickupAt.getTime() - at.getTime()) / 3600000;
  let fee: number;
  if (rentalDays >= 30) {
    const m = policy.monthly;
    if (noShow) fee = m.noShowDays * daily;
    else if (hoursBefore >= m.freeHours) fee = 0;
    else if (hoursBefore >= m.feeHours) fee = m.feeCents;
    else if (hoursBefore >= m.lateHours) fee = m.lateDays * daily;
    else fee = m.finalDays * daily;
  } else {
    const s = policy.short;
    if (noShow) fee = Math.min(s.noShowMaxDays, rentalDays) * daily;
    else if (hoursBefore >= s.freeHours) fee = 0;
    else fee = s.lateDays * daily;
  }
  return Math.max(0, Math.min(Math.round(fee), totalCents));
}
