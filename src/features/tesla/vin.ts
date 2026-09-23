const yearCodes = "ABCDEFGHJKLMNPRSTVWXY123456789";

const lines: Record<string, { model: string; prefix: string }> = {
  "3": { model: "model-3", prefix: "M3" },
  Y: { model: "model-y", prefix: "MY" },
  C: { model: "cybertruck", prefix: "CT" },
  S: { model: "model-s", prefix: "MS" },
  X: { model: "model-x", prefix: "MX" },
};

const pattern = /^[A-HJ-NPR-Z0-9]{17}$/;

export type DecodedVin = { vin: string; year: number | null; model: string | null; fleetNumber: string };

export function decodeVin(value: string | null | undefined): DecodedVin | null {
  const vin = (value ?? "").trim().toUpperCase();
  if (!pattern.test(vin)) return null;
  const index = yearCodes.indexOf(vin[9]);
  const line = lines[vin[3]];
  return { vin, year: index < 0 ? null : 2010 + index, model: line?.model ?? null, fleetNumber: `${line?.prefix ?? "TS"}-${vin.slice(-6)}` };
}

export function colorName(value: string | null | undefined) {
  const name = (value ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").trim().slice(0, 40);
  return name || null;
}
