import type { ZodType } from "zod";
import { marketingZone, zoneDay } from "./dates";

export const defaultMonthlyCalls = 300;

export const maxMonthlyCalls = 5000;

export function monthlyLimit(value: unknown) {
  const calls = value && typeof value === "object" ? (value as { monthlyCalls?: unknown }).monthlyCalls : undefined;
  return typeof calls === "number" && Number.isInteger(calls) && calls >= 1 && calls <= maxMonthlyCalls ? calls : defaultMonthlyCalls;
}

export function aiMockBase(raw: string | undefined) {
  const base = (raw ?? "").trim().replace(/\/+$/, "");
  return /^http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(base) ? base : null;
}

export function monthStart(now: Date, zone = marketingZone) {
  const first = `${zoneDay(now, zone).slice(0, 7)}-01`;
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(new Date(`${first}T08:00:00Z`)).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const offset = /^GMT([+-]\d{2}:\d{2})$/.exec(name)?.[1] ?? "+00:00";
  return new Date(`${first}T00:00:00${offset}`).toISOString();
}

export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export function readJson<Value>(text: string, schema: ZodType<Value>): { ok: true; value: Value } | { ok: false; reason: string } {
  const raw = extractJson(text);
  if (raw === undefined) return { ok: false, reason: "json" };
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const where = (issue?.path ?? []).map((part) => (typeof part === "symbol" ? "?" : String(part))).join(".");
  return { ok: false, reason: `${where || "root"}:${issue?.code ?? "invalid"}`.slice(0, 80) };
}

export function dataBlock(value: unknown) {
  return `<data>\n${JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")}\n</data>`;
}
