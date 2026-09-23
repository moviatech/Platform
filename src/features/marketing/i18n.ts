import "server-only";
import { getLocale } from "next-intl/server";
import en from "../../../locales/marketing/en.json";
import zh from "../../../locales/marketing/zh.json";

export type MarketingMessages = typeof zh;

const catalogs: Record<"zh" | "en", MarketingMessages> = { zh, en };

export async function marketingMessages() {
  const locale = (await getLocale()) === "en" ? "en" : "zh";
  return { locale, messages: catalogs[locale] } as const;
}
