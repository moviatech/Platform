import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { supabasePublishableKey, supabaseUrl } from "@/lib/env";

export const sessionMaxAge = (host: string | null) => (host?.startsWith("ops.") || host?.startsWith("investor.") ? 86400 : 7 * 86400);

export async function createClient() {
  const [store, head] = await Promise.all([cookies(), headers()]);
  const maxAge = sessionMaxAge(head.get("host"));
  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, { ...options, maxAge }));
        } catch {}
      },
    },
  });
}
