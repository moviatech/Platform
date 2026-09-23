import { createHash } from "node:crypto";

export type ReviewLine = { type: string; code: string; amount_cents: number };
export type PriceReview = { total_cents: number; lines_hash: string; reviewed_at: string };

export function linesHash(lines: ReviewLine[]) {
  const canonical = lines
    .map((line) => `${line.type}/${line.code}/${line.amount_cents}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export function reviewedAt(input: { totalCents: number; lines: ReviewLine[]; review: PriceReview | null; legacyReviewedAt: string | null }) {
  if (input.review) return input.review.total_cents === input.totalCents && input.review.lines_hash === linesHash(input.lines) ? input.review.reviewed_at : null;
  return input.legacyReviewedAt;
}
