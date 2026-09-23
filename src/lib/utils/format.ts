const zone = "America/Los_Angeles";

const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const zoneFormat = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" });
const weekdayFormat = (locale: string) => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { timeZone: zone, weekday: "short" });

const toDate = (value: string | Date) => (typeof value === "string" ? new Date(value) : value);

export function zoneLabel(value: string | Date) {
  return zoneFormat.formatToParts(toDate(value)).find((part) => part.type === "timeZoneName")?.value ?? "PT";
}

export function formatDate(value: string | Date) {
  return dateFormat.format(toDate(value));
}

export function formatTime(value: string | Date) {
  return timeFormat.format(toDate(value));
}

export function formatDateTime(value: string) {
  const date = toDate(value);
  return `${dateFormat.format(date)} ${timeFormat.format(date)}`;
}

export function formatFullDateTime(value: string) {
  return `${formatDateTime(value)} ${zoneLabel(value)}`;
}

export function formatMoney(cents: number) {
  const value = cents / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
}

export function formatDay(value: string | Date, locale: string) {
  const date = toDate(value);
  return `${dateFormat.format(date)} ${weekdayFormat(locale).format(date)}`;
}
