import { describe, expect, it } from "vitest";
import { summaryStale } from "./types";

const now = Date.parse("2026-11-16T20:00:00Z");

describe("summaryStale", () => {
  it("needs a title when none was ever attempted", () => {
    expect(summaryStale({ ai_summary_at: null }, now)).toBe(true);
    expect(summaryStale({}, now)).toBe(true);
  });

  it("never asks again once a title exists", () => {
    expect(summaryStale({ ai_summary_at: "2026-11-10T11:00:00Z", ai_summary: { title_zh: "a" } }, now)).toBe(false);
    expect(summaryStale({ ai_summary_at: null, ai_summary: { title_zh: "a" } }, now)).toBe(false);
  });

  it("retries a failed attempt only after six hours", () => {
    expect(summaryStale({ ai_summary_at: "2026-11-16T15:00:00Z", ai_summary: null }, now)).toBe(false);
    expect(summaryStale({ ai_summary_at: "2026-11-16T13:00:00Z", ai_summary: null }, now)).toBe(true);
  });
});
