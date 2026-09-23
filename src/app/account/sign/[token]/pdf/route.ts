import { agreementCopy, pdfResponse } from "@/features/portal/agreement-copy";
import { resolveLink } from "@/features/portal/agreement-link";
import { closedForSigning } from "@/features/portal/sign-core";
import { defaultLocale, isLocale } from "@/i18n/config";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveLink(token);
  if (!link || link.state !== "active") return new Response(null, { status: 404 });
  const asked = new URL(request.url).searchParams.get("lang") ?? undefined;
  const preferred = link.reservation.customer?.preferred_language ?? undefined;
  const locale = isLocale(asked) ? asked : isLocale(preferred) ? preferred : defaultLocale;
  const copy = await agreementCopy(link.reservation.id, { locale, channel: "portal" });
  if (!copy || (!copy.signed && closedForSigning.includes(link.reservation.status))) return new Response(null, { status: 404 });
  return pdfResponse(copy);
}
