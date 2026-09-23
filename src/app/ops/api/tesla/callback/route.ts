import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { can, getStaffSession } from "@/lib/auth/staff";
import { opsOrigin } from "@/lib/env";
import { exchangeCode, TeslaError } from "@/lib/tesla/client";

export async function GET(request: Request) {
  const session = await getStaffSession();
  if (!session || !can(session, "settings.manage") || session.locationIds !== null) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)tesla_state=([a-f0-9]+)/)?.[1] ?? null;
  const target = (query: string) => NextResponse.redirect(`${opsOrigin}/fleet/tesla?${query}`);
  if (!code || !state || !cookie || state !== cookie) return target("error=state");
  try {
    await exchangeCode(code);
  } catch (cause) {
    return target(`error=${cause instanceof TeslaError ? cause.code : "token_failed"}&detail=${encodeURIComponent(cause instanceof Error ? cause.message.slice(0, 200) : "")}`);
  }
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "tesla.connected", entityType: "settings", entityId: "tesla", metadata: { by: session.displayName } });
  const response = target("connected=1");
  response.cookies.set("tesla_state", "", { path: "/", maxAge: 0 });
  return response;
}
