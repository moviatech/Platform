import { describe, expect, it } from "vitest";
import { activeMappings, matchKey, matchLine, type Mapping } from "./mapping";

const seed: Mapping[] = [
  ["RENTAL/*", "4010", "SPREAD"],
  ["PROTECTION/*", "4020", "SPREAD"],
  ["ADD_ON/addon.childSeat", null, "NONE"],
  ["ADD_ON/*", "4030", "SPREAD"],
  ["YOUNG_DRIVER/*", "4030", "SPREAD"],
  ["DELIVERY/*", "4040", "ONCE"],
  ["DISCOUNT/discount.pay_now", "4910", "SPREAD"],
  ["DISCOUNT/discount.coupon_company", "4920", "SPREAD"],
  ["DISCOUNT/discount.coupon", "4925", "SPREAD"],
  ["DISCOUNT/manual.discount", "4930", "SPREAD"],
  ["TAX/*", "2100", "ONCE"],
  ["ADDITIONAL/fee.tax", "2100", "ONCE"],
  ["ADDITIONAL/fee.supercharging", "4060", "ONCE"],
  ["ADDITIONAL/fee.*", "4050", "ONCE"],
  ["ADDITIONAL/charge.toll", "4060", "ONCE"],
  ["ADDITIONAL/charge.cancellation", "4070", "ONCE"],
  ["ADDITIONAL/charge.additional", "4090", "ONCE"],
  ["ADDITIONAL/manual.fee", "4090", "ONCE"],
].map(([match, account, mode]) => ({ kind: "LINE", match: match as string, account: account as string | null, mode: mode as Mapping["mode"], version: 1, effective_from: "2026-01-01" }));

const line = (type: string, code: string) => {
  const found = matchLine(seed, type, code);
  return found ? `${found.account ?? "none"}/${found.mode}` : null;
};

describe("matchLine with the seed mappings", () => {
  it("maps every quoted line type", () => {
    expect(line("RENTAL", "rental.weekly")).toBe("4010/SPREAD");
    expect(line("PROTECTION", "protection.full")).toBe("4020/SPREAD");
    expect(line("ADD_ON", "addon.driver")).toBe("4030/SPREAD");
    expect(line("YOUNG_DRIVER", "fee.young_driver")).toBe("4030/SPREAD");
    expect(line("DELIVERY", "fee.delivery")).toBe("4040/ONCE");
    expect(line("TAX", "tax.sales")).toBe("2100/ONCE");
  });

  it("prefers an exact match over a wildcard", () => {
    expect(line("ADD_ON", "addon.childSeat")).toBe("none/NONE");
    expect(line("ADDITIONAL", "fee.tax")).toBe("2100/ONCE");
    expect(line("ADDITIONAL", "fee.supercharging")).toBe("4060/ONCE");
    expect(line("ADDITIONAL", "fee.late_return")).toBe("4050/ONCE");
  });

  it("keeps the two coupon codes apart", () => {
    expect(line("DISCOUNT", "discount.coupon")).toBe("4925/SPREAD");
    expect(line("DISCOUNT", "discount.coupon_company")).toBe("4920/SPREAD");
    expect(line("DISCOUNT", "discount.pay_now")).toBe("4910/SPREAD");
    expect(line("DISCOUNT", "manual.discount")).toBe("4930/SPREAD");
  });

  it("maps additional charges", () => {
    expect(line("ADDITIONAL", "charge.toll")).toBe("4060/ONCE");
    expect(line("ADDITIONAL", "charge.cancellation")).toBe("4070/ONCE");
    expect(line("ADDITIONAL", "charge.additional")).toBe("4090/ONCE");
    expect(line("ADDITIONAL", "manual.fee")).toBe("4090/ONCE");
  });

  it("returns nothing for unknown codes", () => {
    expect(line("FEE", "fee.airport")).toBeNull();
    expect(line("DISCOUNT", "discount.mystery")).toBeNull();
    expect(line("ADDITIONAL", "charge.new_kind")).toBeNull();
  });

  it("lets the longest wildcard win", () => {
    const rows: Mapping[] = [
      { kind: "LINE", match: "ADDITIONAL/*", account: "4090", mode: "ONCE", version: 1, effective_from: "2026-01-01" },
      { kind: "LINE", match: "ADDITIONAL/fee.*", account: "4050", mode: "ONCE", version: 1, effective_from: "2026-01-01" },
    ];
    expect(matchKey(rows, "ADDITIONAL/fee.cleaning")?.account).toBe("4050");
    expect(matchKey(rows, "ADDITIONAL/other")?.account).toBe("4090");
  });
});

describe("activeMappings", () => {
  it("takes the highest version in force on the date and ignores other kinds", () => {
    const rows: Mapping[] = [
      { kind: "LINE", match: "RENTAL/*", account: "4010", mode: "SPREAD", version: 1, effective_from: "2026-01-01" },
      { kind: "LINE", match: "RENTAL/*", account: "4090", mode: "ONCE", version: 2, effective_from: "2027-02-01" },
      { kind: "EXPENSE", match: "RENT", account: "6130", mode: "ONCE", version: 1, effective_from: "2026-01-01" },
    ];
    expect(activeMappings(rows, "LINE", "2027-01-31").map((row) => row.account)).toEqual(["4010"]);
    expect(activeMappings(rows, "LINE", "2027-02-01").map((row) => row.account)).toEqual(["4090"]);
    expect(activeMappings(rows, "EXPENSE", "2027-02-01").map((row) => row.match)).toEqual(["RENT"]);
  });
});
