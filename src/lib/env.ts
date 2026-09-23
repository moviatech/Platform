export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);
export const rootDomain = process.env.ROOT_DOMAIN ?? "moviatech.ai";
export const websiteOrigin = process.env.WEBSITE_ORIGIN ?? (process.env.NODE_ENV === "development" ? "http://localhost:3200" : "https://www.moviatech.ai");
export const portalOrigin = process.env.PORTAL_ORIGIN ?? (process.env.NODE_ENV === "development" ? "http://account.localhost:3300" : `https://account.${rootDomain}`);
