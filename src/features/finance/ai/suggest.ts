import { z } from "zod";
import { isDate } from "../board/range";
import { expenseCategories, expensePeriodError, type ExpenseCategory } from "../report";

export const AI_MONTHLY_CAP = 300;

export type SuggestContext = {
  categories: Array<{ code: ExpenseCategory; zh: string; en: string; account: string | null; accountName: string | null }>;
  vehicles: Array<{ id: string; fleetNumber: string; model: string | null }>;
  stores: Array<{ id: string; code: string; name: string; nameZh: string | null }>;
};

export type SuggestEntry = { vendor: string; note: string; reference: string; amount: string; spentOn: string; locale: "zh" | "en" };

export type Suggestion = {
  category: ExpenseCategory;
  vehicleId: string | null;
  locationId: string | null;
  serviceFrom: string | null;
  serviceTo: string | null;
  capital: boolean;
  reason: string;
};

export function suggestionPrompt(context: SuggestContext, entry: SuggestEntry) {
  const language = entry.locale === "zh" ? "Simplified Chinese" : "English";
  const instructions = [
    "You help a small Tesla rental company in California book one expense into its books.",
    "Choose the expense category and, only when the text clearly says so, the car, the store, a prepaid service period and whether it is an asset purchase.",
    "Rules:",
    "- category: one code from the category list.",
    "- vehicle: one fleet number from the car list, only when the text names that car or a model only one car has; otherwise null.",
    "- store: one store code from the store list, only when the text names that store or its city; otherwise null.",
    "- serviceFrom and serviceTo (YYYY-MM-DD): only when the payment covers a period longer than one month that mostly comes after the payment date, such as a yearly insurance premium or an annual subscription; otherwise both null.",
    "- capital: true only for buying a vehicle or long-lived equipment, and then serviceFrom and serviceTo are null. When unsure, false.",
    `- reason: one short sentence in ${language}, at most 60 characters.`,
    "Reply with one JSON object and nothing else:",
    '{"category":"CODE","vehicle":null,"store":null,"serviceFrom":null,"serviceTo":null,"capital":false,"reason":"..."}',
  ].join("\n");
  const prompt = [
    "Categories (code: name / books account):",
    ...context.categories.map((row) => `${row.code}: ${row.zh} ${row.en}${row.account ? ` / ${row.account} ${row.accountName ?? ""}`.trimEnd() : ""}`),
    "",
    "Cars (fleet number: model):",
    ...(context.vehicles.length ? context.vehicles.map((car) => `${car.fleetNumber}: ${car.model ?? "-"}`) : ["(none)"]),
    "",
    "Stores (code: name):",
    ...(context.stores.length ? context.stores.map((store) => `${store.code}: ${store.name}${store.nameZh ? ` ${store.nameZh}` : ""}`) : ["(none)"]),
    "",
    "Expense:",
    `date: ${entry.spentOn || "-"}`,
    `amount: ${entry.amount || "-"}`,
    `paid to: ${entry.vendor || "-"}`,
    `note: ${entry.note || "-"}`,
    `reference: ${entry.reference || "-"}`,
  ].join("\n");
  return { instructions, prompt };
}

const reply = z.object({
  category: z.string(),
  vehicle: z.string().nullable().optional(),
  store: z.string().nullable().optional(),
  serviceFrom: z.string().nullable().optional(),
  serviceTo: z.string().nullable().optional(),
  capital: z.boolean().nullable().optional(),
  reason: z.string().nullable().optional(),
});

export function parseSuggestion(text: string, context: SuggestContext): Suggestion | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = reply.safeParse(value);
  if (!parsed.success) return null;
  const data = parsed.data;
  const category = expenseCategories.find((code) => code === data.category.trim().toUpperCase());
  if (!category) return null;
  const wanted = (raw: string | null | undefined) => (raw ?? "").trim().toUpperCase();
  const vehicle = wanted(data.vehicle) ? (context.vehicles.find((car) => car.fleetNumber.toUpperCase() === wanted(data.vehicle)) ?? null) : null;
  const store = wanted(data.store) ? (context.stores.find((row) => row.code.toUpperCase() === wanted(data.store)) ?? null) : null;
  const capital = data.capital === true;
  const from = isDate(data.serviceFrom) ? data.serviceFrom : null;
  const to = isDate(data.serviceTo) ? data.serviceTo : null;
  const period = !capital && from && to && expensePeriodError({ serviceFrom: from, serviceTo: to, capital: false }) === null ? { from, to } : null;
  return {
    category,
    vehicleId: vehicle?.id ?? null,
    locationId: store?.id ?? null,
    serviceFrom: period?.from ?? null,
    serviceTo: period?.to ?? null,
    capital,
    reason: (data.reason ?? "").trim().slice(0, 120),
  };
}
