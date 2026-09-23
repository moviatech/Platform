export type PlaceLabels = { location: string; method: string; delivery: string; address: string };

export function placeRows(labels: PlaceLabels, methods: Record<string, string>, pickupMethod: string, deliveryAddress: string | null | undefined, store: string): Array<[string, string]> {
  if (pickupMethod === "STORE") return [[labels.location, store]];
  const handover = (deliveryAddress ?? "").replace(/\s+/g, " ").trim();
  return [[labels.method, methods[pickupMethod] ?? pickupMethod], handover ? [pickupMethod === "DELIVERY" ? labels.delivery : labels.address, handover] : [labels.location, store]];
}
