import { websiteOrigin } from "../env";

export const nextCookie = "portal_next";

const placeholder = "https://placeholder.invalid";

export function safeNext(value: unknown, fallback = "/") {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\s\\]/.test(value)) return fallback;
  try {
    if (value.startsWith("/")) {
      return !value.startsWith("//") && new URL(value, placeholder).origin === placeholder ? value : fallback;
    }
    const url = new URL(value);
    return url.origin === websiteOrigin && !url.username && !url.password && value.startsWith(`${websiteOrigin}/`) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function withNext(path: string, next: string) {
  return next === "/" ? path : `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
}
