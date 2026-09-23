import { describe, expect, it } from "vitest";
import { linesHash, reviewedAt } from "./price-review";

const lines = [
  { type: "RENTAL", code: "rental.monthly", amount_cents: 325080 },
  { type: "PROTECTION", code: "protection.full", amount_cents: 84000 },
  { type: "DISCOUNT", code: "manual.discount", amount_cents: -211180 },
];

describe("price review", () => {
  it("hashes lines regardless of order", () => {
    expect(linesHash(lines)).toBe(linesHash([...lines].reverse()));
    expect(linesHash(lines)).toMatch(/^[0-9a-f]{64}$/);
    expect(linesHash(lines)).not.toBe(linesHash([...lines.slice(0, 2), { type: "DISCOUNT", code: "manual.discount", amount_cents: -211000 }]));
  });

  it("stays reviewed while the total and lines are unchanged", () => {
    const review = { total_cents: 197900, lines_hash: linesHash(lines), reviewed_at: "2026-11-25T01:00:00Z" };
    expect(reviewedAt({ totalCents: 197900, lines, review, legacyReviewedAt: null })).toBe("2026-11-25T01:00:00Z");
    expect(reviewedAt({ totalCents: 198000, lines, review, legacyReviewedAt: null })).toBeNull();
    expect(reviewedAt({ totalCents: 197900, lines: lines.slice(0, 2), review, legacyReviewedAt: "2026-11-20T00:00:00Z" })).toBeNull();
  });

  it("falls back to the old review time only when there is no new review", () => {
    expect(reviewedAt({ totalCents: 197900, lines, review: null, legacyReviewedAt: "2026-11-20T00:00:00Z" })).toBe("2026-11-20T00:00:00Z");
    expect(reviewedAt({ totalCents: 197900, lines, review: null, legacyReviewedAt: null })).toBeNull();
  });
});
