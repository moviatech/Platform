import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", database: supabaseConfigured ? "configured" : "missing" });
}
