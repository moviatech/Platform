import { clientIpFrom } from "@/lib/auth/client-ip";
import { record } from "@/lib/auth/throttle";
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/auth/next-url";
import type { EmailOtpType } from "@supabase/supabase-js";
import { portalOrigin } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const target = portalOrigin;

  if (!tokenHash || !type) return NextResponse.redirect(`${target}/login?error=link`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(`${target}/login?error=link`);
  if (data.user?.email) await record("customer.signed_in", data.user.email.toLowerCase(), clientIpFrom(request.headers)).catch(() => undefined);
  const next = safeNext(url.searchParams.get("next"), type === "recovery" ? "/reset-password" : "/");
  return NextResponse.redirect(next.startsWith("/") ? `${target}${next}` : next);
}
