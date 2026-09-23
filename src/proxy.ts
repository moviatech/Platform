import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigured, supabasePublishableKey, supabaseUrl } from "@/lib/env";
import { isBareLocalhost, surfaceFromHost } from "@/lib/surface";

export default async function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const surface = surfaceFromHost(host);
  const { pathname } = request.nextUrl;

  if (!surface) {
    if (process.env.NODE_ENV !== "production" && isBareLocalhost(host) && pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
    return new NextResponse(null, { status: 404 });
  }

  const target = request.nextUrl.clone();
  target.pathname = `/${surface}${pathname === "/" ? "" : pathname}`;

  if (surface === "api" || !supabaseConfigured) {
    return NextResponse.rewrite(target);
  }

  let response = NextResponse.rewrite(target, { request });
  const maxAge = surface === "ops" || surface === "investor" ? 86400 : 7 * 86400;
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.rewrite(target, { request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, maxAge }));
      },
    },
  });
  const prefetch = request.headers.get("next-router-prefetch") === "1" || /prefetch/i.test(request.headers.get("purpose") ?? "") || /prefetch/i.test(request.headers.get("sec-purpose") ?? "");
  const { data } = await supabase.auth.getClaims();
  const amr = (data?.claims as { amr?: unknown } | undefined)?.amr;
  const times = Array.isArray(amr) ? amr.map((entry) => (entry && typeof entry === "object" ? Number((entry as { timestamp?: unknown }).timestamp) : NaN)).filter((value) => Number.isFinite(value) && value > 0) : [];
  const signedInAt = times.length ? Math.min(...times) * 1000 : null;
  if (!prefetch && signedInAt && Date.now() - signedInAt > maxAge * 1000) {
    await supabase.auth.signOut({ scope: "local" });
    const expired = NextResponse.redirect(new URL("/login?error=expired", request.url));
    response.cookies.getAll().forEach((cookie) => expired.cookies.set(cookie));
    return expired;
  }
  return response;
}

export const config = {
  matcher: "/((?!_next|brand/|.*\.(?:png|webp|svg|ico|txt|webmanifest)$).*)",
};
