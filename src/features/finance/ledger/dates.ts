import { zonedParts, zonedToUtc } from "../../booking/time";

export const BOOK_ZONE = "America/Los_Angeles";

export const laDate = (instant: string | number | Date) => zonedParts(typeof instant === "number" ? new Date(instant) : instant, BOOK_ZONE).date;

export const monthOf = (date: string) => date.slice(0, 7);

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function nextMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, value, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const dayStart = (date: string) => zonedToUtc(date, "00:00", BOOK_ZONE).getTime();

export const monthStart = (month: string) => dayStart(`${month}-01`);

export const lastDayOf = (month: string) => addDays(`${nextMonth(month)}-01`, -1);

export const todayStart = (now: number) => dayStart(laDate(now));

export const roundHalfAway = (value: number) => (value < 0 ? -Math.round(-value) : Math.round(value));
