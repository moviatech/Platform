import { addDays, lastDayOf, monthOf } from "../ledger/dates";

export const PRESETS = ["month", "last", "quarter", "year", "custom"] as const;
export type Preset = (typeof PRESETS)[number];
export type BoardRange = { preset: Preset; from: string; to: string; end: string; daysEnd: string | null; partial: boolean; prevFrom: string; prevTo: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 120;

export const isDate = (value: string | null | undefined): value is string => typeof value === "string" && DATE.test(value) && addDays(value, 0) === value;
export const isMonth = (value: string | null | undefined): value is string => typeof value === "string" && MONTH.test(value);

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

export function shiftMonths(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const key = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
  const last = Number(lastDayOf(key).slice(8));
  return `${key}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

const monthsBetween = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;

function build(preset: Preset, from: string, to: string, today: string, months: number): BoardRange {
  const end = to < today ? to : today;
  const yesterday = addDays(today, -1);
  const daysEnd = end < today ? end : yesterday >= from ? yesterday : null;
  const prevFrom = shiftMonths(from, -months);
  return { preset, from, to, end, daysEnd, partial: end < to, prevFrom, prevTo: addDays(from, -1) };
}

export function boardRange(input: { preset?: string | null; from?: string | null; to?: string | null }, today: string): BoardRange {
  const preset = PRESETS.find((value) => value === input.preset) ?? "month";
  const current = monthOf(today);
  if (preset === "custom" && isMonth(input.from) && isMonth(input.to) && input.from <= input.to && input.from <= current) {
    const last = input.to < current ? input.to : current;
    const months = monthsBetween(input.from, last);
    if (months <= MAX_MONTHS) return build("custom", `${input.from}-01`, lastDayOf(last), today, months);
  }
  if (preset === "last") {
    const month = monthOf(shiftMonths(`${current}-01`, -1));
    return build("last", `${month}-01`, lastDayOf(month), today, 1);
  }
  if (preset === "quarter") {
    const from = `${today.slice(0, 4)}-${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
    return build("quarter", from, addDays(shiftMonths(from, 3), -1), today, 3);
  }
  if (preset === "year") return build("year", `${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`, today, 12);
  return build("month", `${current}-01`, lastDayOf(current), today, 1);
}
