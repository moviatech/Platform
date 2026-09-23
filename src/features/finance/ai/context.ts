import "server-only";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { expenseCategories } from "../report";
import { isTestOrder } from "../test-orders";
import type { SuggestContext } from "./suggest";

type CarRow = { id: string; fleet_number: string; is_placeholder: boolean; vehicle_class: { slug: string; model: string | null } | null };

export async function loadSuggestContext(today: string): Promise<SuggestContext> {
  const supabase = createAdminClient();
  const [zh, en, mappings, accounts, cars, stores] = await Promise.all([
    getTranslations({ locale: "zh", namespace: "expenses" }),
    getTranslations({ locale: "en", namespace: "expenses" }),
    supabase.from("fin_mappings").select("match, account, version, effective_from").eq("kind", "EXPENSE").lte("effective_from", today).order("effective_from", { ascending: false }).order("version", { ascending: false }),
    supabase.from("fin_accounts").select("code, name_zh"),
    supabase.from("vehicles").select("id, fleet_number, is_placeholder, vehicle_class:vehicle_classes(slug, model)").order("fleet_number"),
    supabase.from("locations").select("id, code, name, name_zh").eq("active", true).order("name"),
  ]);
  const failed = [mappings, accounts, cars, stores].find((result) => result.error);
  if (failed?.error) throw new Error(`suggest_context: ${failed.error.message}`);
  const accountOf = new Map<string, string | null>();
  for (const row of (mappings.data ?? []) as Array<{ match: string; account: string | null }>) if (!accountOf.has(row.match)) accountOf.set(row.match, row.account);
  const names = new Map(((accounts.data ?? []) as Array<{ code: string; name_zh: string }>).map((row) => [row.code, row.name_zh]));
  return {
    categories: expenseCategories.map((code) => {
      const account = accountOf.get(code) ?? null;
      return { code, zh: zh(`categories.${code}`), en: en(`categories.${code}`), account, accountName: account ? (names.get(account) ?? null) : null };
    }),
    vehicles: ((cars.data ?? []) as unknown as CarRow[])
      .filter((car) => !isTestOrder({ classSlug: car.vehicle_class?.slug, fleetNumber: car.fleet_number, placeholder: car.is_placeholder }))
      .map((car) => ({ id: car.id, fleetNumber: car.fleet_number, model: car.vehicle_class?.model ?? null })),
    stores: ((stores.data ?? []) as Array<{ id: string; code: string; name: string; name_zh: string | null }>).map((row) => ({ id: row.id, code: row.code, name: row.name, nameZh: row.name_zh })),
  };
}

export async function aiUsedThisMonth(month: string) {
  const { count, error } = await createAdminClient().from("fin_ai_runs").select("id", { count: "exact", head: true }).eq("month", month);
  return error ? 0 : (count ?? 0);
}
