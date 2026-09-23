import "server-only";
import { parseServiceAccount } from "./jwt";

const real = { token: "https://oauth2.googleapis.com/token", analytics: "https://analyticsdata.googleapis.com", webmasters: "https://www.googleapis.com/webmasters", inspection: "https://searchconsole.googleapis.com" };

function endpoints() {
  const base = (process.env.MARKETING_GOOGLE_BASE ?? "").trim().replace(/\/+$/, "");
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(base)) return real;
  return { token: `${base}/token`, analytics: `${base}/analyticsdata`, webmasters: `${base}/webmasters`, inspection: `${base}/searchconsole` };
}

function siteOf(raw: string) {
  const value = raw.trim();
  if (/^sc-domain:[a-z0-9.-]+$/i.test(value)) return value.toLowerCase();
  if (/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(value)) return value.endsWith("/") ? value : `${value}/`;
  return null;
}

export function googleSettings() {
  const property = (process.env.MARKETING_GA4_PROPERTY ?? "").trim();
  return {
    account: parseServiceAccount(process.env.MARKETING_GOOGLE_SA),
    property: /^\d{4,15}$/.test(property) ? property : null,
    site: siteOf(process.env.MARKETING_GSC_SITE ?? ""),
    endpoints: endpoints(),
  };
}

export function googleStatus() {
  const { account, property, site } = googleSettings();
  return { analytics: Boolean(account && property), search: Boolean(account && site) };
}
