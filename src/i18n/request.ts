import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, localeCookie } from "./config";

export default getRequestConfig(async () => {
  const stored = (await cookies()).get(localeCookie)?.value;
  const locale = isLocale(stored) ? stored : defaultLocale;
  return {
    locale,
    timeZone: "America/Los_Angeles",
    messages: (await import(`../../locales/${locale}.json`)).default,
  };
});
