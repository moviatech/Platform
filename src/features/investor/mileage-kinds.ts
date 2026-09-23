export const adjustmentKinds = ["OWNER_USE", "REPOSITIONING", "ODOMETER_ERROR", "FRAUD", "DISPUTE", "OTHER"] as const;
export type AdjustmentKind = (typeof adjustmentKinds)[number];
