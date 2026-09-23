"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { defaultLocale, isLocale } from "@/i18n/config";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email/template";
import { createAdminClient } from "@/lib/supabase/admin";
import { signatureImageInput } from "./agreement";
import { agreementCopy } from "./agreement-copy";
import { linkEmailLimit, resolveLink } from "./agreement-link";
import { readSignFields, signOnline } from "./sign-core";

export type LinkActionState = { ok?: boolean; error?: string; sentTo?: string };

function maskEmail(address: string) {
  const [name, domain] = address.split("@");
  return `${name.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain ?? ""}`;
}

export async function signByLink(_: LinkActionState, form: FormData): Promise<LinkActionState> {
  const token = String(form.get("token") ?? "");
  const link = await resolveLink(token);
  if (!link) return { error: "link_invalid" };
  if (link.state !== "active") return { error: "link_expired" };
  const parsed = readSignFields(form);
  if (!parsed.success) return { error: "invalid" };
  const signature = signatureImageInput.safeParse(form.get("signature"));
  if (!signature.success) return { error: "signatureInvalid" };

  const picked = String(form.get("lang") ?? "");
  const preferred = link.reservation.customer?.preferred_language ?? undefined;
  const locale = isLocale(picked) ? picked : isLocale(preferred) ? preferred : defaultLocale;
  const result = await signOnline({ reservation: link.reservation, locale, fields: parsed.data, signature: signature.data, termsMark: String(form.get("termsMark") ?? ""), head: await headers(), actorUserId: null, via: "link" });
  if ("error" in result) return result;
  revalidatePath(`/account/trips/${link.reservation.number}`, "layout");
  redirect(`/sign/${token}?lang=${locale}`);
}

export async function emailSignedCopy(_: LinkActionState, form: FormData): Promise<LinkActionState> {
  const link = await resolveLink(String(form.get("token") ?? ""));
  if (!link) return { error: "link_invalid" };
  if (link.state !== "active") return { error: "link_expired" };
  const address = link.reservation.customer?.email;
  if (!address) return { error: "no_email" };
  if (link.reservation.agreement_state !== "SIGNED") return { error: "not_signed" };

  const picked = String(form.get("lang") ?? "");
  const preferred = link.reservation.customer?.preferred_language ?? undefined;
  const locale = isLocale(picked) ? picked : isLocale(preferred) ? preferred : defaultLocale;
  const copy = await agreementCopy(link.reservation.id, { locale, channel: "portal" });
  if (!copy || !copy.signed) return { error: "not_signed" };

  const { data: counted } = await createAdminClient().rpc("count_agreement_link_email", { p_link_id: link.id, p_limit: linkEmailLimit });
  if (counted !== true) return { error: "email_limit" };

  const zh = locale === "zh";
  const number = link.reservation.number;
  const rendered = renderEmail({
    title: zh ? "您的租车协议" : "Your rental agreement",
    blocks: [{ type: "paragraph", text: zh ? `订单 ${number} 已签署的租车协议见附件，请妥善保存。` : `The signed rental agreement for booking ${number} is attached. Please keep it for your records.` }],
  });
  const sent = await sendEmail({
    log: "customer", ref: { reservationId: link.reservation.id, customerId: link.reservation.customer_id },
    to: address,
    subject: zh ? `Movia 租车协议 · ${number}` : `Movia rental agreement · ${number}`,
    text: rendered.text,
    html: rendered.html,
    attachments: [{ filename: copy.filename, contentType: "application/pdf", content: new Uint8Array(copy.pdf) }],
  });
  if (!sent.sent) return { error: "send_failed" };
  await audit({ actorType: "CUSTOMER", action: "reservation.agreement_copy_sent", entityType: "reservation", entityId: link.reservation.id, metadata: { number, via: "link" } });
  return { ok: true, sentTo: maskEmail(address) };
}
