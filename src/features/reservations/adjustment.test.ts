import { describe, expect, it } from "vitest";
import { adjustmentCents, adjustmentDescription, adjustmentDraftValid, adjustmentTotal, immediateAdjustments, maxAdjustments, readAdjustments, signedAdjustment } from "./adjustment";

describe("adjustmentCents", () => {
  it("reads whole and decimal amounts", () => {
    expect(adjustmentCents("50")).toBe(5000);
    expect(adjustmentCents(" 12.5 ")).toBe(1250);
    expect(adjustmentCents("0.99")).toBe(99);
  });

  it("treats an empty field as no adjustment", () => {
    expect(adjustmentCents("")).toBe(0);
    expect(adjustmentCents(null)).toBe(0);
    expect(adjustmentCents("  ")).toBe(0);
  });

  it("rejects anything that is not a plain amount", () => {
    for (const value of ["-5", "5.123", "abc", "$20", "1,000", "1234567"]) expect(adjustmentCents(value)).toBeNull();
  });
});

describe("signedAdjustment", () => {
  it("adds fees and subtracts discounts", () => {
    expect(signedAdjustment("fee", 2500)).toBe(2500);
    expect(signedAdjustment("discount", 2500)).toBe(-2500);
  });
});

describe("readAdjustments", () => {
  it("keeps every filled row and skips empty ones", () => {
    expect(
      readAdjustments([
        { kind: "fee", note: " 送车费 ", amount: "40" },
        { kind: "discount", note: "", amount: "" },
        { kind: "discount", note: "老客户", amount: "25.5" },
      ]),
    ).toEqual([
      { kind: "fee", cents: 4000, note: "送车费" },
      { kind: "discount", cents: 2550, note: "老客户" },
    ]);
    expect(readAdjustments([])).toEqual([]);
  });

  it("adds fees and discounts into one signed total", () => {
    expect(adjustmentTotal(readAdjustments([{ kind: "fee", note: "", amount: "40" }, { kind: "discount", note: "", amount: "25.5" }, { kind: "discount", note: "", amount: "10" }]) ?? [])).toBe(450);
    expect(adjustmentTotal([])).toBe(0);
  });

  it("refuses a malformed amount, a note without an amount, or too many rows", () => {
    expect(readAdjustments([{ kind: "fee", note: "", amount: "40" }, { kind: "fee", note: "", amount: "abc" }])).toBeNull();
    expect(readAdjustments([{ kind: "fee", note: "洗车", amount: "" }])).toBeNull();
    expect(readAdjustments([{ kind: "fee", note: "洗车", amount: "0" }])).toBeNull();
    expect(adjustmentDraftValid({ kind: "fee", note: "  ", amount: "" })).toBe(true);
    expect(readAdjustments(Array.from({ length: maxAdjustments }, () => ({ kind: "fee" as const, note: "", amount: "1" })))).toHaveLength(maxAdjustments);
    expect(readAdjustments(Array.from({ length: maxAdjustments + 1 }, () => ({ kind: "fee" as const, note: "", amount: "1" })))).toBeNull();
  });
});

describe("immediateAdjustments", () => {
  const fee = { kind: "fee" as const, cents: 1000, note: "" };
  const first = { kind: "discount" as const, cents: 6000, note: "" };
  const second = { kind: "discount" as const, cents: 4000, note: "" };

  it("applies everything for someone who can approve", () => {
    expect(immediateAdjustments([fee, first, { ...second, cents: 90000 }], null)).toHaveLength(3);
  });

  it("applies discounts that add up to the limit or less", () => {
    expect(immediateAdjustments([fee, first, second], 10000)).toEqual([fee, first, second]);
  });

  it("holds every discount once together they pass the limit, and keeps the fees", () => {
    expect(immediateAdjustments([fee, first, { ...second, cents: 4001 }], 10000)).toEqual([fee]);
    expect(immediateAdjustments([{ ...first, cents: 10001 }], 10000)).toEqual([]);
  });
});

describe("adjustmentDescription", () => {
  it("keeps the note that was typed", () => {
    expect(adjustmentDescription("discount", "  开业优惠  ", "zh")).toBe("开业优惠");
  });

  it("falls back to a label in the customer's language", () => {
    expect(adjustmentDescription("discount", "", "zh")).toBe("优惠减免");
    expect(adjustmentDescription("discount", null, "en")).toBe("Discount");
    expect(adjustmentDescription("fee", " ", "zh")).toBe("其他费用");
    expect(adjustmentDescription("fee", undefined, undefined)).toBe("Additional charge");
  });
});
