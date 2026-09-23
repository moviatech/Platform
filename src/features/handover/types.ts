import type { Collection } from "@/features/payments/cancel-settlement";
import type { FeeLine } from "./fees";

export const photoBucket = "inspection-photos";
export const maxPhotos = 16;
export const maxPhotoBytes = 15 * 1024 * 1024;

export type InspectionKind = "PICKUP" | "RETURN";

export type UploadTarget = { path: string; url: string } | null;

export type UploadedPhoto = { path: string; type: string; size: number };

export const maxVideoBytes = 200 * 1024 * 1024;
export const maxVideoSeconds = 90;
export const videoRetentionDays = 180;

export type VideoTarget = { key: string; url: string } | null;

export type UploadedVideo = { key: string; type: string; size: number; duration: number };

export type SpecialRequest = { id: string; label: string };

export type PayStage = "done" | "open" | "blocked";

export type DamageConfirmState = { ok?: boolean; error?: string; charged?: boolean; amountCents?: number; failure?: string };

export type SignedDamage = { cents: number; notes: string; unpaidCents: number };

export type PickupPayState = { intent?: "hold" | "charge" | "link"; ok?: boolean; error?: string; sentTo?: string };

export type HandoverState = {
  ok?: boolean;
  error?: string;
  hold?: "placed" | "existing" | "waived";
  holdFailed?: boolean;
  early?: boolean;
  collection?: Collection;
  fees?: FeeLine[];
  chargedCents?: number;
  capturedCents?: number;
  uncollectedCents?: number;
  released?: boolean;
  paymentError?: string;
};

export type ReturnParams = {
  startOdometer: number;
  allowanceMiles: number | null;
  excessRateCents: number;
  minReturnLevel: number;
  lowChargeFeeCentsPerPercent: number;
  chargingIncluded: boolean;
  scheduledReturnAt: string;
  graceMinutes: number;
  dailyRateCents: number;
  lateHourlyCapHours: number;
  tollIncluded: boolean;
  superchargingCents: number;
  superchargingSessions: number;
  superchargingUnknown?: boolean;
  vin: string | null;
  returnFeesTaxable: boolean;
  taxRateBps: number;
  timeZone: string;
};
