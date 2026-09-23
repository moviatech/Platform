import type { LineState, OrderLine } from "./order-targets";

export type SnapshotRow = { id: number; source_table: string; source_id: string; captured_at: string; fields: Record<string, unknown>; deleted: boolean };

export const RUN_GAP_MS = 60000;

const toLine = (id: string, fields: Record<string, unknown>): OrderLine => ({ id, type: String(fields.type ?? ""), code: String(fields.code ?? ""), amount_cents: Number(fields.amount_cents ?? 0), created_at: String(fields.created_at ?? "") });

const signature = (state: { end: number; lines: OrderLine[] }) => JSON.stringify([state.end, state.lines.map((line) => `${line.type}/${line.code}/${line.amount_cents}`).sort()]);

export function priceHistory(input: { snapshots: SnapshotRow[]; currentLines: OrderLine[]; currentReturnAt: string; returnedAt: number | null }): LineState[] {
  const rows = [...input.snapshots].sort((a, b) => a.id - b.id);
  const lines = new Map<string, OrderLine>();
  let end = Date.parse(input.currentReturnAt);
  const states: LineState[] = [];
  const push = (state: LineState) => {
    const last = states[states.length - 1];
    if (last && signature(last) === signature(state)) return;
    states.push(state);
  };

  for (let index = 0; index < rows.length; ) {
    const runStart = Date.parse(rows[index].captured_at);
    const known = new Set(lines.keys());
    while (index < rows.length && Date.parse(rows[index].captured_at) - runStart < RUN_GAP_MS) {
      const row = rows[index];
      index += 1;
      if (row.source_table === "reservations") {
        if (!row.deleted && typeof row.fields.return_at === "string") end = Date.parse(row.fields.return_at);
      } else if (row.deleted) {
        lines.delete(row.source_id);
      } else {
        lines.set(row.source_id, toLine(row.source_id, row.fields));
      }
    }
    const added = [...lines.values()].filter((line) => !known.has(line.id) && line.created_at);
    const previous = states[states.length - 1];
    const changedAt = added.length > 0 ? Math.min(runStart, Math.max(...added.map((line) => Date.parse(line.created_at)))) : runStart;
    push({ at: previous ? Math.max(previous.at, changedAt) : Number.NEGATIVE_INFINITY, end, lines: [...lines.values()] });
  }

  const current: LineState = { at: Number.NEGATIVE_INFINITY, end: Date.parse(input.currentReturnAt), lines: input.currentLines };
  const last = states[states.length - 1];
  if (!last) {
    states.push(current);
  } else if (signature(last) !== signature(current)) {
    const known = new Set(last.lines.map((line) => line.id));
    const added = input.currentLines.filter((line) => !known.has(line.id));
    const changedAt = added.length > 0 ? Math.max(...added.map((line) => Date.parse(line.created_at))) : last.at;
    states.push({ ...current, at: Math.max(last.at, changedAt) });
  }

  if (input.returnedAt !== null) {
    const returnedAt = input.returnedAt;
    const inForce = [...states].reverse().find((state) => state.at <= returnedAt) ?? states[0];
    states.push({ at: returnedAt, end: returnedAt, lines: inForce.lines });
    states.sort((a, b) => a.at - b.at);
  }
  return states;
}
