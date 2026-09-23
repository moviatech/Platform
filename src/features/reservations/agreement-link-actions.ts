"use server";

import { z } from "zod";
import { issueLink, linkUrl } from "@/features/portal/agreement-link";
import { audit } from "@/lib/audit";
import { requireScope } from "@/lib/auth/scope";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime } from "@/lib/utils/format";

export type SignLinkState = { url?: string; expires?: string; error?: string };

const input = z.object({ reservationId: z.uuid(), fresh: z.boolean() });

export async function issueAgreementLink(reservationId: string, fresh: boolean): Promise<SignLinkState> {
  const session = await requirePermission("reservation.edit");
  const parsed = input.safeParse({ reservationId, fresh });
  if (!parsed.success) return { error: "invalid" };
  await requireScope(session, { reservation: parsed.data.reservationId });
  const { data: reservation } = await createAdminClient().from("reservations").select("number, status").eq("id", parsed.data.reservationId).maybeSingle();
  if (!reservation) return { error: "not_found" };
  if (["CANCELLED", "NO_SHOW", "EXPIRED"].includes(reservation.status)) return { error: "reservation_closed" };
  const link = await issueLink(parsed.data.reservationId, session.userId, parsed.data.fresh);
  if (!link) return { error: "failed" };
  if (link.created) {
    await audit({ actorUserId: session.userId, actorType: "STAFF", action: "reservation.agreement_link_created", entityType: "reservation", entityId: parsed.data.reservationId, metadata: { by: session.displayName, number: reservation.number, expiresAt: link.expiresAt } });
  }
  return { url: linkUrl(link.id), expires: formatFullDateTime(link.expiresAt) };
}
