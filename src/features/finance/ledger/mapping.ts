export type MappingKind = "LINE" | "EXPENSE" | "STRIPE" | "OWNER" | "RESOLUTION";
export type MappingMode = "SPREAD" | "ONCE" | "NONE";
export type Mapping = { kind: MappingKind; match: string; account: string | null; mode: MappingMode; version: number; effective_from: string };

export function activeMappings(rows: Mapping[], kind: MappingKind, onDate: string): Mapping[] {
  const best = new Map<string, Mapping>();
  for (const row of rows) {
    if (row.kind !== kind || row.effective_from > onDate) continue;
    const current = best.get(row.match);
    if (!current || row.version > current.version) best.set(row.match, row);
  }
  return [...best.values()];
}

export function matchKey(mappings: Mapping[], key: string): Mapping | null {
  const exact = mappings.find((mapping) => mapping.match === key);
  if (exact) return exact;
  let found: Mapping | null = null;
  for (const mapping of mappings) {
    if (!mapping.match.endsWith("*")) continue;
    const prefix = mapping.match.slice(0, -1);
    if (key.startsWith(prefix) && (!found || prefix.length > found.match.length - 1)) found = mapping;
  }
  return found;
}

export const matchLine = (mappings: Mapping[], type: string, code: string) => matchKey(mappings, `${type}/${code}`);
