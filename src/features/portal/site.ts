export const siteUrl = "https://www.moviatech.ai";

export function siteLink(locale: string, path = "") {
  return `${siteUrl}/${locale === "zh" ? "zh" : "en"}${path}`;
}
