export type DriverStatus = "PENDING" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "ONSITE";

export type DriverRow = {
  id: string;
  reservation_id: string;
  position: number;
  status: DriverStatus;
  international: boolean;
  full_name: string | null;
  license_last4: string | null;
  license_country: string | null;
  license_expires_on: string | null;
  photo_path: string | null;
  verified_at: string | null;
};

export type InsuranceState = "NOT_REQUIRED" | "PENDING" | "UPLOADED" | "VERIFIED";

export const licenseKinds = ["US", "INTERNATIONAL", "TRANSLATED"] as const;

export type LicenseKind = (typeof licenseKinds)[number];

export const maxDrivers = 3;

export const driverDone = (status: DriverStatus) => status === "VERIFIED" || status === "ONSITE";

export const insuranceRequired = (protection: string) => protection === "none";

export const insuranceOk = (state: string) => state === "NOT_REQUIRED" || state === "VERIFIED";
