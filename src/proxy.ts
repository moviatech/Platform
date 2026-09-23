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
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.rewrite(target, { request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: "/((?!_next|brand/|.*\.(?:png|webp|svg|ico|txt|webmanifest)$).*)",
};
