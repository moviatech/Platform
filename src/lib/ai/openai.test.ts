import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { waitSeconds } = await import("./openai");

describe("waitSeconds", () => {
  it("reads the wait from a provider rate-limit message", () => {
    expect(waitSeconds("Limit 100000, Used 99683, Requested 7891. Please try again in 54h31m58.08s. Visit")).toBeCloseTo(54 * 3600 + 31 * 60 + 58.08, 2);
    expect(waitSeconds("Please try again in 6m0s.")).toBe(360);
    expect(waitSeconds("Please try again in 1.2s.")).toBeCloseTo(1.2, 5);
    expect(waitSeconds("Please try again in 412ms.")).toBeCloseTo(0.412, 5);
  });

  it("returns null when the message has no wait", () => {
    expect(waitSeconds("You exceeded your current quota")).toBeNull();
    expect(waitSeconds(undefined)).toBeNull();
  });
});
