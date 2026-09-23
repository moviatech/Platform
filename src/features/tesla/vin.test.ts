import { describe, expect, it } from "vitest";
import { colorName, decodeVin } from "./vin";

describe("decodeVin", () => {
  it("reads year, model line and a fleet number", () => {
    expect(decodeVin("7saygdee5ta454870")).toEqual({ vin: "7SAYGDEE5TA454870", year: 2026, model: "model-y", fleetNumber: "MY-454870" });
    expect(decodeVin("5YJ3E1EA7RF123456")).toMatchObject({ year: 2024, model: "model-3", fleetNumber: "M3-123456" });
    expect(decodeVin("7G2CEHED1SA004321")).toMatchObject({ year: 2025, model: "cybertruck", fleetNumber: "CT-004321" });
  });

  it("keeps unknown lines and year codes open", () => {
    expect(decodeVin("5YJRE1EA70F123456")).toEqual({ vin: "5YJRE1EA70F123456", year: null, model: null, fleetNumber: "TS-123456" });
  });

  it("rejects malformed values", () => {
    expect(decodeVin("")).toBeNull();
    expect(decodeVin(null)).toBeNull();
    expect(decodeVin("7SAYGDEE5TA45487")).toBeNull();
    expect(decodeVin("7SAYGDEE5TA45487O")).toBeNull();
    expect(decodeVin("7SAYGDEE5TA454870/../x")).toBeNull();
  });
});

describe("colorName", () => {
  it("splits Tesla colour codes into words", () => {
    expect(colorName("PearlWhite")).toBe("Pearl White");
    expect(colorName("StealthGrey")).toBe("Stealth Grey");
    expect(colorName("Quicksilver")).toBe("Quicksilver");
    expect(colorName("")).toBeNull();
    expect(colorName(undefined)).toBeNull();
  });
});
