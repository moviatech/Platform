export type UiLocale = "zh" | "en";

export type Change = { ratio: number | null; direction: "up" | "down" | "flat" };

const tag = (locale: UiLocale) => (locale === "zh" ? "zh-CN" : "en-US");

export function whole(value: number, locale: UiLocale) {
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 10000) return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: 0 }).format(rounded);
  return new Intl.NumberFormat(tag(locale), { notation: "compact", maximumFractionDigits: 1 }).format(rounded);
}

export function exact(value: number, locale: UiLocale) {
  return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function decimal(value: number, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export function percent(ratio: number, digits = 1) {
  return Number.isFinite(ratio) ? `${(ratio * 100).toFixed(digits)}%` : "—";
}

export function duration(seconds: number, locale: UiLocale) {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (locale === "zh") return minutes ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

export function change(current: number, previous: number): Change {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { ratio: null, direction: "flat" };
  if (previous === 0) return { ratio: null, direction: current > 0 ? "up" : "flat" };
  const ratio = (current - previous) / Math.abs(previous);
  return { ratio, direction: Math.abs(ratio) < 0.0005 ? "flat" : ratio > 0 ? "up" : "down" };
}

export function signed(ratio: number | null) {
  if (ratio === null) return "";
  const value = Math.abs(ratio * 100);
  return `${ratio > 0 ? "+" : ratio < 0 ? "−" : ""}${value >= 100 ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function shortDay(day: string, locale: UiLocale) {
  const [, month, date] = day.split("-").map(Number);
  return locale === "zh" ? `${month}月${date}日` : `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(month ?? 1) - 1]} ${date}`;
}

export function niceTop(max: number) {
  if (!(max > 0)) return 4;
  const power = Math.pow(10, Math.floor(Math.log10(max)));
  for (const step of [1, 2, 2.5, 4, 5, 8, 10]) if (step * power >= max) return step * power;
  return 10 * power;
}
