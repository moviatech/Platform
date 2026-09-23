export const marketingZone = "America/Los_Angeles";

export const rangeChoices = [7, 28, 90] as const;

export type RangeDays = (typeof rangeChoices)[number];

export type Period = { start: string; end: string };

export function parseRange(value: unknown): RangeDays {
  const days = Number(Array.isArray(value) ? value[0] : value);
  return rangeChoices.find((choice) => choice === days) ?? 28;
}

export function zoneDay(instant: Date, zone = marketingZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

export function isDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function addDays(day: string, amount: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
}

export function daysApart(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function listDays(start: string, end: string) {
  const days: string[] = [];
  for (let day = start; day <= end && days.length < 800; day = addDays(day, 1)) days.push(day);
  return days;
}

export function periodsEnding(lastDay: string, days: number): { current: Period; previous: Period } {
  const start = addDays(lastDay, 1 - days);
  return { current: { start, end: lastDay }, previous: { start: addDays(start, -days), end: addDays(start, -1) } };
}

export function within(day: string, period: Period) {
  return day >= period.start && day <= period.end;
}

export function compactDay(value: string) {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
}
