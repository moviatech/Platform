export type GateLine = { type: string; code: string; amount_cents: number; created_at: string };

export type GateInput = {
  status: string;
  totalCents: number;
  updatedAtBefore: string;
  updatedAtAfter: string;
  lines: GateLine[];
  now: number;
};

export type GateResult = { ok: true } | { ok: false; reason: "rental_line" | "duplicate_code" | "total_mismatch" | "changed_while_reading" | "recently_changed" | "negative_total" };

const quotedStatuses = new Set(["REQUESTED", "PENDING_PAYMENT", "CONFIRMED", "ACTIVE", "COMPLETED"]);
export const SETTLE_MS = 3 * 60000;

const isExtra = (line: GateLine) => line.type === "ADDITIONAL" && !line.code.startsWith("manual.");
const isQuoted = (line: GateLine) => line.type !== "ADDITIONAL" && !line.code.startsWith("manual.");

export function checkGate(input: GateInput): GateResult {
  if (input.updatedAtBefore !== input.updatedAtAfter) return { ok: false, reason: "changed_while_reading" };
  const newest = Math.max(Date.parse(input.updatedAtAfter), ...input.lines.map((line) => Date.parse(line.created_at)));
  if (input.now - newest < SETTLE_MS) return { ok: false, reason: "recently_changed" };
  if (quotedStatuses.has(input.status) && input.lines.filter((line) => line.type === "RENTAL" && line.amount_cents > 0).length !== 1) return { ok: false, reason: "rental_line" };
  const codes = input.lines.filter(isQuoted).map((line) => line.code);
  if (new Set(codes).size !== codes.length) return { ok: false, reason: "duplicate_code" };
  const lineTotal = input.lines.reduce((sum, line) => sum + line.amount_cents, 0);
  if (lineTotal < 0) return { ok: false, reason: "negative_total" };
  const quotedTotal = input.lines.filter((line) => !isExtra(line)).reduce((sum, line) => sum + line.amount_cents, 0);
  if (quotedTotal !== input.totalCents) return { ok: false, reason: "total_mismatch" };
  return { ok: true };
}
