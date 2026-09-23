import { NextResponse } from "next/server";
import { listAudit, parseAuditFilter } from "@/features/audit/queries";
import { ForbiddenError, requirePermission } from "@/lib/auth/staff";

const cell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export async function GET(request: Request) {
  try {
    await requirePermission("audit.view");
  } catch (cause) {
    if (cause instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw cause;
  }
  const url = new URL(request.url);
  const filter = { ...parseAuditFilter(Object.fromEntries(url.searchParams.entries())), before: null };
  const lines: string[][] = [["time", "actor_type", "actor", "action", "entity_type", "entity_id", "ip", "metadata"]];
  for (const row of await listAudit(filter, 20000)) lines.push([row.created_at, row.actor_type, row.actor_name ?? "", row.action, row.entity_type, row.entity_id ?? "", row.ip_address ?? "", JSON.stringify(row.metadata)]);
  const body = "﻿" + lines.map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="movia-audit-${filter.from}-${filter.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
