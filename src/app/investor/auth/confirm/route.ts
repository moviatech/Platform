import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { clientIpFrom } from "@/lib/auth/client-ip";
import { record } from "@/lib/auth/throttle";
import { investorOrigin } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  if (!tokenHash || !type) return NextResponse.redirect(`${investorOrigin}/login?error=link`);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(`${investorOrigin}/login?error=link`);
  if (data.user?.email) await record("investor.signed_in", data.user.email.toLowerCase(), clientIpFrom(request.headers), "INVESTOR").catch(() => undefined);
  return NextResponse.redirect(`${investorOrigin}${type === "recovery" ? "/reset-password" : "/"}`);
}
