import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime } from "@/lib/utils/format";
import { agreementEdition, recordHints, renderAgreement, type AgreementChannel } from "./agreement";
import { loadAgreementFacts } from "./agreement-facts";
import { agreementPdf } from "./agreement-pdf";
import { recordBlocks } from "./agreement-record";

export type AgreementCopy = { pdf: Buffer; filename: string; signed: boolean };

const publisher = "Movia Technologies";
const labels = {
  zh: { signer: "签署人", signedAt: "签署时间" },
  en: { signer: "Signer", signedAt: "Signed at" },
};

type Record = { terms_snapshot: string; terms_hash: string; signer_name: string; signed_at: string; template_version: string; locale: string; signature_image: string | null; superseded_at: string | null };

export async function agreementCopy(reservationId: string, options: { locale: string; channel: AgreementChannel }): Promise<AgreementCopy | null> {
  const supabase = createAdminClient();
  const [{ data: reservation }, { data: latest }] = await Promise.all([
    supabase.from("reservations").select("number, agreement_state").eq("id", reservationId).maybeSingle(),
    supabase
      .from("agreements")
      .select("terms_snapshot, terms_hash, signer_name, signed_at, template_version, locale, signature_image, superseded_at")
      .eq("reservation_id", reservationId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!reservation) return null;
  const filename = `Movia-Rental-Agreement-${reservation.number}.pdf`;
  const record = latest as Record | null;

  if (reservation.agreement_state === "SIGNED" && record && !record.superseded_at) {
    const text = labels[record.locale === "zh" ? "zh" : "en"];
    const blocks = recordBlocks(record.terms_snapshot, {
      image: record.signature_image,
      rows: [
        [text.signer, record.signer_name],
        [text.signedAt, formatFullDateTime(record.signed_at)],
        ["SHA-256", record.terms_hash],
      ],
    }, recordHints);
    const pdf = await agreementPdf({ title: `${publisher} · ${reservation.number}`, author: publisher, footer: `${publisher} · ${reservation.number} · ${record.template_version} · SHA-256 ${record.terms_hash.slice(0, 16)}`, blocks });
    return { pdf, filename, signed: true };
  }

  const facts = await loadAgreementFacts(reservationId, options.locale);
  if (!facts) return null;
  const rendered = renderAgreement(options.locale, facts, undefined, false, options.channel);
  const pdf = await agreementPdf({ title: `${rendered.title} · ${reservation.number}`, author: facts.business.legalName || publisher, footer: `${facts.business.legalName || publisher} · ${reservation.number} · ${agreementEdition(options.locale)}`, blocks: rendered.blocks });
  return { pdf, filename, signed: false };
}

export function pdfResponse(copy: AgreementCopy) {
  return new Response(new Uint8Array(copy.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(copy.pdf.length),
      "content-disposition": `attachment; filename="${copy.filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
