export type DriverStatus = "PENDING" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "ONSITE";

export type DriverRow = {
  id: string;
  reservation_id: string;
  position: number;
  status: DriverStatus;
  international: boolean;
  spouse: boolean;
  full_name: string | null;
  license_last4: string | null;
  license_country: string | null;
  license_expires_on: string | null;
  photo_path: string | null;
  verified_at: string | null;
};

export type InsuranceState = "NOT_REQUIRED" | "PENDING" | "UPLOADED" | "VERIFIED";

export type InsuranceGate = InsuranceState | "UPGRADE";

export const licenseKinds = ["US", "INTERNATIONAL", "TRANSLATED"] as const;

export type LicenseKind = (typeof licenseKinds)[number];

export const maxDrivers = 3;

export function planDriverSlots(existing: Array<{ id: string; position: number; spouse: boolean }>, target: number, withSpouse: boolean) {
  const ordered = [...existing].sort((a, b) => a.position - b.position);
  const surplus = Math.max(0, ordered.length - target);
  const leaving = [...ordered].sort((a, b) => Number(withSpouse ? a.spouse : !a.spouse) - Number(withSpouse ? b.spouse : !b.spouse) || b.position - a.position).slice(0, surplus);
  const kept = ordered.filter((row) => !leaving.includes(row));
  const moves = kept.map((row, index) => ({ id: row.id, position: index + 1 })).filter((move, index) => kept[index].position !== move.position);
  const create = Array.from({ length: target - kept.length }, (_, index) => kept.length + index + 1);
  const flagged = kept.findIndex((row) => row.spouse);
  const spousePosition = withSpouse ? (flagged >= 0 ? flagged + 1 : (create[0] ?? 1)) : null;
  return { remove: leaving.map((row) => row.id), moves, create, spousePosition };
}

export const driverDone = (status: DriverStatus) => status === "VERIFIED" || status === "ONSITE";

export const insuranceRequired = (protection: string, licenseKind: string | null | undefined) => (licenseKind ?? "US") !== "US" && (protection === "none" || protection === "basic");

export const protectionAllowed = (protection: string, licenseKind: string | null | undefined) => protection !== "none" || (licenseKind ?? "US") === "US";

const usIssuers = ["US", "PR", "GU", "VI", "AS", "MP"];

export const usIssued = (country: string) => usIssuers.includes(country.trim().toUpperCase());

export function nextInsuranceState(current: string, required: boolean, hasProof: boolean): InsuranceState {
  if (!required) return "NOT_REQUIRED";
  if (current === "NOT_REQUIRED") return hasProof ? "UPLOADED" : "PENDING";
  return current as InsuranceState;
}

export const insuranceOk = (state: string) => state === "NOT_REQUIRED" || state === "VERIFIED";
