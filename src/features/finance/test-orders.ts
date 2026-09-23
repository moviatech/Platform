export type TestOrderFacts = { number?: string | null; classSlug?: string | null; fleetNumber?: string | null; placeholder?: boolean | null };

export type TestOrderRow = {
  number?: string | null;
  vehicle_class?: { slug?: string | null } | null;
  vehicle?: { fleet_number?: string | null; is_placeholder?: boolean | null } | null;
};

export const testOrderColumns = "vehicle_class:vehicle_classes(slug), vehicle:vehicles!reservations_assigned_vehicle_id_fkey(fleet_number, is_placeholder)";

const generatedNumber = /^MV-[2-9A-HJ-NP-Z]{6}$/;

export function isTestOrder(facts: TestOrderFacts): boolean {
  const slug = (facts.classSlug ?? "").trim().toLowerCase();
  const fleet = (facts.fleetNumber ?? "").trim().toUpperCase();
  const number = (facts.number ?? "").trim().toUpperCase();
  if (slug.startsWith("zz-")) return true;
  if (facts.placeholder === true) return true;
  if (fleet.startsWith("ZZ-") || fleet.startsWith("PRACTICE")) return true;
  return number !== "" && !generatedNumber.test(number);
}

export const testOrderOf = (row: TestOrderRow) => isTestOrder({ number: row.number, classSlug: row.vehicle_class?.slug, fleetNumber: row.vehicle?.fleet_number, placeholder: row.vehicle?.is_placeholder });
