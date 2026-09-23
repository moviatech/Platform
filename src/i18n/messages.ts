import type { Locale } from "./config";

export async function loadMessages(locale: Locale) {
  return (await import(`../../locales/${locale}.json`)).default;
}
