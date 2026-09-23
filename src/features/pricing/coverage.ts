export const liabilityLimits = { perPersonCents: 3000000, perAccidentCents: 6000000, propertyCents: 1500000 } as const;

export const wholeDollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export const liabilityText = {
  perPerson: wholeDollars(liabilityLimits.perPersonCents),
  perAccident: wholeDollars(liabilityLimits.perAccidentCents),
  property: wholeDollars(liabilityLimits.propertyCents),
} as const;
