import "server-only";
import { z } from "zod";
import { protectionAllowed } from "@/features/drivers/types";
import { audit } from "@/lib/audit";
import { clientIpFrom } from "@/lib/auth/client-ip";
import { agreementVersion, isLongTerm, renderAgreement, type Elections } from "./agreement";
import { loadAgreementFacts, recordSignature } from "./agreement-facts";

const signFields = z.object({
  signerName: z.string().trim().min(2).max(120).regex(/^\P{Cc}+$/u),
  initials: z.string().trim().regex(/^\p{L}{1,6}$/u),
  waiverAck: z.literal("on"),
  locationAck: z.literal("on"),
  longTermAck: z.string().optional(),
  electronicComms: z.string().optional(),
  agree: z.literal("on"),
});

export type SignFields = z.infer<typeof signFields>;

export function readSignFields(form: FormData) {
  return signFields.safeParse({
    signerName: form.get("signerName"),
    initials: form.get("initials"),
    waiverAck: form.get("waiverAck"),
    locationAck: form.get("locationAck"),
    longTermAck: form.get("longTermAck") ?? undefined,
    electronicComms: form.get("electronicComms") ?? undefined,
    agree: form.get("agree"),
  });
}

export const closedForSigning = ["CANCELLED", "NO_SHOW", "EXPIRED", "COMPLETED"];

type SignInput = {
  reservation: { id: string; status: string; agreement_state: string };
  locale: string;
  fields: SignFields;
  signature: string;
  termsMark: string;
  head: Headers;
  actorUserId: string | null;
  via: "portal" | "link";
};

export async function signOnline(input: SignInput): Promise<{ ok: true } | { error: string }> {
  const { reservation, locale, fields } = input;
  if (closedForSigning.includes(reservation.status)) return { error: "not_signable" };
  if (reservation.agreement_state === "SIGNED") return { ok: true };

  const facts = await loadAgreementFacts(reservation.id, locale);
  if (!facts) return { error: "failed" };
  if (!protectionAllowed(facts.waiver.tier, facts.licenseKind)) return { error: "protection_required" };
  if (input.termsMark !== renderAgreement(locale, facts).hash) return { error: "agreement_changed" };
  const longTerm = isLongTerm(facts.rentalDays);
  if (longTerm && fields.longTermAck !== "on") return { error: "invalid" };
  const electronic = fields.electronicComms === "on";
  const elections: Elections = {
    waiverTier: facts.waiver.tier,
    waiverInitials: fields.initials,
    locationInitials: fields.initials,
    electronicComms: electronic,
    electronicInitials: electronic ? fields.initials : null,
    longTermInitials: longTerm ? fields.initials : null,
  };
  const signedAt = new Date().toISOString();
  const rendered = renderAgreement(locale, facts, { signerName: fields.signerName, signedAt, elections });

  const saved = await recordSignature(reservation.id, facts.seenAt, {
    templateVersion: agreementVersion,
    locale,
    text: rendered.text,
    hash: rendered.hash,
    signerName: fields.signerName,
    signerIp: clientIpFrom(input.head),
    userAgent: input.head.get("user-agent")?.slice(0, 400) ?? null,
    signedAt,
    elections,
    signatureImage: input.signature,
  });
  if (saved.outcome === "already") return { ok: true };
  if (saved.outcome !== "signed") return { error: saved.outcome === "changed" ? "agreement_changed" : "failed" };
  await audit({
    actorUserId: input.actorUserId,
    actorType: "CUSTOMER",
    action: "reservation.agreement_signed",
    entityType: "reservation",
    entityId: reservation.id,
    metadata: { by: fields.signerName, version: agreementVersion, revision: saved.version ?? 1, locale, hash: rendered.hash, elections, ...(input.via === "link" ? { via: "link" } : {}) },
  });
  return { ok: true };
}
