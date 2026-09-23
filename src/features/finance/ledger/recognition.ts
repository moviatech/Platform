import { laDate, monthOf, monthStart, nextMonth, roundHalfAway } from "./dates";

export type SpreadState = { at: number; end: number; amounts: Record<string, number> };
export type MonthAmounts = { month: string; lastDate: string; amounts: Record<string, number> };

type Segment = { from: number; end: number; totals: Record<string, number> };

function segmentsOf(start: number, states: SpreadState[]): Segment[] {
  const sorted = [...states].sort((a, b) => a.at - b.at);
  const opening = [...sorted].reverse().find((state) => state.at <= start) ?? sorted[0];
  const later = sorted.filter((state) => state.at > start && state !== opening);
  return [{ from: start, end: opening.end, totals: opening.amounts }, ...later.map((state) => ({ from: state.at, end: state.end, totals: state.amounts }))];
}

function valueIn(segment: Segment, base: Record<string, number>, at: number) {
  const keys = new Set([...Object.keys(base), ...Object.keys(segment.totals)]);
  const out: Record<string, number> = {};
  for (const key of keys) {
    const total = segment.totals[key] ?? 0;
    const already = base[key] ?? 0;
    out[key] = segment.end <= segment.from || at >= segment.end ? total : already + ((total - already) * (at - segment.from)) / (segment.end - segment.from);
  }
  return out;
}

export function cumulativeAt(start: number, states: SpreadState[], at: number): Record<string, number> {
  if (states.length === 0 || at <= start) return {};
  const segments = segmentsOf(start, states);
  let base: Record<string, number> = {};
  for (let index = 0; index < segments.length; index += 1) {
    const boundary = index + 1 < segments.length ? segments[index + 1].from : Number.POSITIVE_INFINITY;
    if (at < boundary) return valueIn(segments[index], base, at);
    base = valueIn(segments[index], base, boundary);
  }
  return base;
}

export function fullyRecognizedAt(start: number, states: SpreadState[]) {
  if (states.length === 0) return start;
  const segments = segmentsOf(start, states);
  const last = segments[segments.length - 1];
  return Math.max(last.from, last.end);
}

export function recognizeMonths(input: { start: number; states: SpreadState[]; cutoff: number }): MonthAmounts[] {
  if (input.states.length === 0) return [];
  const until = Math.min(input.cutoff, fullyRecognizedAt(input.start, input.states));
  if (until <= input.start) return [];
  const out: MonthAmounts[] = [];
  let previous: Record<string, number> = {};
  for (let month = monthOf(laDate(input.start)); month <= monthOf(laDate(until - 1)); month = nextMonth(month)) {
    const boundary = Math.min(monthStart(nextMonth(month)), until);
    const exact = cumulativeAt(input.start, input.states, boundary);
    const rounded: Record<string, number> = {};
    const amounts: Record<string, number> = {};
    for (const key of new Set([...Object.keys(previous), ...Object.keys(exact)])) {
      rounded[key] = roundHalfAway(exact[key] ?? 0);
      const delta = rounded[key] - (previous[key] ?? 0);
      if (delta !== 0) amounts[key] = delta;
    }
    previous = rounded;
    if (Object.keys(amounts).length > 0) out.push({ month, lastDate: laDate(boundary - 1), amounts });
  }
  return out;
}
