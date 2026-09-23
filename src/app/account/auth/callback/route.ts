import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { nextCookie, safeNext } from "@/lib/auth/next-url";
import { portalOrigin } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const target = portalOrigin;

  if (!code) return NextResponse.redirect(`${target}/login?error=google`);
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${target}/login?error=google`);
  const store = await cookies();
  const next = safeNext(store.get(nextCookie)?.value);
  store.delete(nextCookie);
  return NextResponse.redirect(next.startsWith("/") ? `${target}${next}` : next);
}
