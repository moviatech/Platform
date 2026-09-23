export type Preferences = { notifications: boolean; updates: boolean; offers: boolean };

export const preferenceKeys = ["notifications", "updates", "offers"] as const;

export function readPreferences(value: unknown): Preferences {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    notifications: raw.notifications !== false,
    updates: raw.updates !== false,
    offers: raw.offers !== false,
  };
}
