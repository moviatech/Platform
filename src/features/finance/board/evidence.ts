export const evidenceBucket = "finance-documents";

export const evidenceTypes: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

export const evidencePath = (vehicleId: string) => new RegExp(`^vehicles/${vehicleId.toLowerCase()}/[0-9a-f-]{36}\\.(pdf|jpg|png|webp|heic)$`);

export const isStoredEvidence = (vehicleId: string, path: string | null) => Boolean(path && evidencePath(vehicleId).test(path));
