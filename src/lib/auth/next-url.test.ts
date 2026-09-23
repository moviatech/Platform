import { describe, expect, it } from "vitest";
import { websiteOrigin } from "../env";
import { safeNext, withNext } from "./next-url";

describe("safeNext", () => {
  it("keeps portal-relative paths", () => {
    expect(safeNext("/trips")).toBe("/trips");
    expect(safeNext("/trips/123?tab=agreement")).toBe("/trips/123?tab=agreement");
  });

  it("keeps website urls only on the exact website origin", () => {
    expect(safeNext(`${websiteOrigin}/zh/book/model-y?from=2026-10-10`)).toBe(`${websiteOrigin}/zh/book/model-y?from=2026-10-10`);
    expect(safeNext(`${websiteOrigin}.evil.example/x`)).toBe("/");
    expect(safeNext(`${websiteOrigin.replace("://", "://user@")}/x`)).toBe("/");
    expect(safeNext("https://evil.example/")).toBe("/");
  });

  it("rejects protocol-relative, backslash, whitespace and malformed values", () => {
    expect(safeNext("//evil.example/x")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/x\ny")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext(undefined, "/trips")).toBe("/trips");
    expect(safeNext("a".repeat(3000))).toBe("/");
  });
});

describe("withNext", () => {
  it("appends the encoded next only when it is not the root", () => {
    expect(withNext("/login", "/")).toBe("/login");
    expect(withNext("/login", "/trips")).toBe("/login?next=%2Ftrips");
    expect(withNext("/login/verify?email=a%40b.c", "/trips")).toBe("/login/verify?email=a%40b.c&next=%2Ftrips");
  });
});
