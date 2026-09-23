import { getLocale } from "next-intl/server";
import { agreementCopy, pdfResponse } from "@/features/portal/agreement-copy";
import { getVerifiedCustomer } from "@/lib/auth/customer";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_: Request, { params }: { params: Promise<{ number: string }> }) {
  const session = await getVerifiedCustomer();
  const { number } = await params;
  if (!session || !/^MV-[A-Z0-9]{6}$/.test(number)) return new Response(null, { status: 404 });
  const { data: trip } = await createAdminClient().from("reservations").select("id").eq("customer_id", session.customerId).eq("number", number).maybeSingle();
  if (!trip) return new Response(null, { status: 404 });
  const copy = await agreementCopy(trip.id, { locale: await getLocale(), channel: "portal" });
  return copy ? pdfResponse(copy) : new Response(null, { status: 404 });
}
