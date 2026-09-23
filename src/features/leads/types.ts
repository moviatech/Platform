import type { BadgeTone } from "@/components/ui/Badge";

export const leadKinds = ["CONTACT", "BOOKING_REQUEST", "ASSISTANT"] as const;
export type LeadKind = (typeof leadKinds)[number];

export const leadStatuses = ["NEW", "IN_PROGRESS", "CONVERTED", "CLOSED", "SPAM"] as const;
export type LeadStatus = (typeof leadStatuses)[number];

export const openLeadStatuses: LeadStatus[] = ["NEW", "IN_PROGRESS"];

export const handoffKinds: LeadKind[] = ["ASSISTANT", "BOOKING_REQUEST"];

export const leadStatusTone: Record<LeadStatus, BadgeTone> = {
  NEW: "gold",
  IN_PROGRESS: "info",
  CONVERTED: "success",
  CLOSED: "neutral",
  SPAM: "danger",
};

export type Lead = {
  id: string;
  kind: LeadKind;
  status: LeadStatus;
  reference: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  wechat: string | null;
  locale: string | null;
  source_url: string | null;
  summary: string | null;
  payload: Record<string, unknown>;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
};
