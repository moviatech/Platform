import { getLocale } from "next-intl/server";
import { agreementCopy, pdfResponse } from "@/features/portal/agreement-copy";
import { isLocale } from "@/i18n/config";
import { scopeAllows } from "@/lib/auth/scope";
import { can, getStaffSession } from "@/lib/auth/staff";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getStaffSession();
  const { id } = await params;
  if (!session || !can(session, "reservation.view") || !uuid.test(id) || !(await scopeAllows(session, { reservation: id }))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const asked = new URL(request.url).searchParams.get("lang") ?? undefined;
  const locale = isLocale(asked) ? asked : await getLocale();
  const copy = await agreementCopy(id, { locale, channel: "external" });
  return copy ? pdfResponse(copy) : Response.json({ error: "not_found" }, { status: 404 });
}
