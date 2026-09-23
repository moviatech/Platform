import type { BadgeTone } from "@/components/ui/Badge";
import type { Quote } from "@/features/pricing/quote";

export const reservationStatuses = ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED", "ACTIVE", "COMPLETED", "CANCELLED", "NO_SHOW", "EXPIRED"] as const;
export type ReservationStatus = (typeof reservationStatuses)[number];

export const undoWindowMs = 15 * 60 * 1000;

export const openStatuses: ReservationStatus[] = ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED", "ACTIVE"];

export const statusTone: Record<ReservationStatus, BadgeTone> = {
  REQUESTED: "gold",
  PENDING_PAYMENT: "warning",
  CONFIRMED: "info",
  ACTIVE: "success",
  COMPLETED: "neutral",
  CANCELLED: "danger",
  NO_SHOW: "danger",
  EXPIRED: "neutral",
};

export const transitions: Record<ReservationStatus, ReservationStatus[]> = {
  REQUESTED: ["CONFIRMED", "CANCELLED"],
  PENDING_PAYMENT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["ACTIVE", "NO_SHOW", "CANCELLED"],
  ACTIVE: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  EXPIRED: [],
};

export const bookingSources = ["STAFF", "PHONE", "WECHAT", "WEB"] as const;
export type BookingSource = (typeof bookingSources)[number];

export type ReservationListItem = {
  id: string;
  number: string;
  status: ReservationStatus;
  pickup_at: string;
  return_at: string;
  rental_days: number;
  total_cents: number;
  payment_state: string;
  booking_source: BookingSource;
  customer: { id: string; full_name: string; phone: string | null } | null;
  vehicle_class: { name: string; name_zh: string | null } | null;
  vehicle: { id: string; fleet_number: string } | null;
};

export type LineItem = { id: string; type: string; code: string; description: string; quantity: number; unit_cents: number; amount_cents: number };

export type ReservationDetail = ReservationListItem & {
  class_id: string;
  assigned_vehicle_id: string | null;
  rate_plan: "PAY_NOW" | "PAY_LATER";
  pickup_method: "STORE" | "DELIVERY";
  delivery_address: string | null;
  protection: string;
  add_ons: string[];
  driver_age_band: string;
  verification_state: string;
  agreement_state: string;
  hold_state: string;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  security_hold_cents: number;
  quote_snapshot: Quote;
  policy_snapshot: { cancelPolicy?: import("@/features/payments/cancellation").CancelPolicy } | null;
  expires_at: string | null;
  actual_pickup_at: string | null;
  actual_return_at: string | null;
  customer_notes: string | null;
  internal_notes: string | null;
  cancel_reason: string | null;
  lead_id: string | null;
  created_at: string;
  customer: { id: string; full_name: string; phone: string | null; email: string | null; wechat: string | null; dnr_flag: boolean } | null;
  line_items: LineItem[];
};
