export const prepItems = ["exterior", "interior", "vacuum", "glass", "charge", "accessories", "tires", "odor"] as const;

export type PrepItem = (typeof prepItems)[number];

export type PrepStatus = "OPEN" | "IN_PROGRESS" | "DONE";

export type PrepCheck = { done: boolean; by?: string; at?: string };

export type PrepChecklist = Partial<Record<PrepItem, PrepCheck>>;

export const prepPhotoBucket = "inspection-photos";
export const prepVideoRetentionDays = 90;
