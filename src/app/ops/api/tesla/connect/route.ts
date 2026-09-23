import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { can, getStaffSession } from "@/lib/auth/staff";
import { opsOrigin } from "@/lib/env";
import { authorizeUrl, teslaConfigured } from "@/lib/tesla/client";

export async function GET() {
  const session = await getStaffSession();
  if (!session || !can(session, "settings.manage") || session.locationIds !== null) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!teslaConfigured()) return NextResponse.redirect(`${opsOrigin}/fleet/tesla?error=not_configured`);
  const state = randomBytes(16).toString("hex");
  const response = NextResponse.redirect(authorizeUrl(state));
  response.cookies.set("tesla_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}
