import type { Collection } from "@/features/payments/cancel-settlement";
import type { FeeLine } from "./fees";

export const photoBucket = "inspection-photos";
export const maxPhotos = 16;
export const maxPhotoBytes = 15 * 1024 * 1024;

export type InspectionKind = "PICKUP" | "RETURN";

export type UploadTarget = { path: string; url: string } | null;

export type UploadedPhoto = { path: string; type: string; size: number };

export type HandoverState = {
  ok?: boolean;
  error?: string;
  hold?: "placed" | "existing";
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
  scheduledReturnAt: string;
  graceMinutes: number;
  dailyRateCents: number;
  lateFeeCents: { notified: number; unannounced: number };
  returnFeesTaxable: boolean;
  taxRateBps: number;
};
