export type ReadinessFacts = { paidCents: number; totalCents: number; hasCard: boolean };

export type Readiness = { license: boolean; agreement: boolean; payment: boolean; ready: boolean };

type ReadinessTrip = { verification_state: string; agreement_state: string; rate_plan: string };

export const fullyPaid = (facts: Pick<ReadinessFacts, "paidCents" | "totalCents">) => facts.paidCents > 0 && facts.paidCents >= facts.totalCents;

export function tripReadiness(trip: ReadinessTrip, facts: ReadinessFacts): Readiness {
  const license = trip.verification_state === "VERIFIED";
  const agreement = trip.agreement_state === "SIGNED";
  const payment = fullyPaid(facts) || (trip.rate_plan === "PAY_LATER" ? facts.hasCard : facts.totalCents <= 0);
  return { license, agreement, payment, ready: license && agreement && payment };
}
