import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const localized = z.object({ zh: z.string().default(""), en: z.string().default("") }).default({ zh: "", en: "" });

export const portalContentSchema = z.object({
  announcements: z.array(z.object({ title: localized, body: localized, url: z.string().default("") })).default([]),
  links: z.array(z.object({ label: localized, url: z.string(), kind: z.enum(["site", "youtube"]).default("site") })).default([]),
  referral: z.object({ headline: localized, body: localized }).default({ headline: { zh: "", en: "" }, body: { zh: "", en: "" } }),
  contact: z
    .object({ phone: z.string().default(""), wechat: z.string().default(""), email: z.string().default(""), hours: localized })
    .default({ phone: "", wechat: "", email: "", hours: { zh: "", en: "" } }),
  banners: z.object({ home: z.string().default(""), help: z.string().default(""), rewards: z.string().default("") }).default({ home: "", help: "", rewards: "" }),
});

export type PortalContent = z.infer<typeof portalContentSchema>;
export type Localized = { zh: string; en: string };

export const pick = (value: Localized, locale: string) => (locale === "zh" ? value.zh || value.en : value.en || value.zh);

export async function loadPortalContent(): Promise<PortalContent> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "portal").maybeSingle();
  const parsed = portalContentSchema.safeParse(data?.value ?? {});
  return parsed.success ? parsed.data : portalContentSchema.parse({});
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function ensureReferralCode(customerId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("customers").select("referral_code").eq("id", customerId).maybeSingle();
  if (data?.referral_code) return data.referral_code;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `MV${Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("")}`;
    const { data: rows, error } = await supabase.from("customers").update({ referral_code: code }).eq("id", customerId).is("referral_code", null).select("referral_code");
    if (!error && rows?.[0]?.referral_code) return rows[0].referral_code;
    if (!error) {
      const { data: existing } = await supabase.from("customers").select("id, referral_code").eq("id", customerId).limit(1);
      if (existing?.[0]?.referral_code) return existing[0].referral_code;
    }
  }
  return "";
}
