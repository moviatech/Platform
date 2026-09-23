import { describe, expect, it } from "vitest";
import { insuranceOk, insuranceRequired, nextInsuranceState, planDriverSlots, protectionAllowed, usIssued } from "./types";

describe("insuranceRequired", () => {
  it("asks foreign licence holders whose option has no damage waiver", () => {
    for (const option of ["none", "basic"]) {
      expect(insuranceRequired(option, "INTERNATIONAL")).toBe(true);
      expect(insuranceRequired(option, "TRANSLATED")).toBe(true);
    }
  });

  it("never asks a U.S. licence holder, whatever they pick", () => {
    for (const option of ["none", "basic", "standard", "premier"]) {
      expect(insuranceRequired(option, "US")).toBe(false);
      expect(insuranceRequired(option, null)).toBe(false);
      expect(insuranceRequired(option, undefined)).toBe(false);
    }
  });

  it("never asks when the option includes the damage waiver", () => {
    for (const option of ["standard", "premier"]) expect(insuranceRequired(option, "INTERNATIONAL")).toBe(false);
  });
});

describe("protectionAllowed", () => {
  it("lets only U.S. licence holders decline every option", () => {
    expect(protectionAllowed("none", "US")).toBe(true);
    expect(protectionAllowed("none", null)).toBe(true);
    expect(protectionAllowed("none", "INTERNATIONAL")).toBe(false);
    expect(protectionAllowed("none", "TRANSLATED")).toBe(false);
    for (const option of ["basic", "standard", "premier"]) expect(protectionAllowed(option, "INTERNATIONAL")).toBe(true);
  });
});

describe("nextInsuranceState", () => {
  it("turns the step off whenever it is not required", () => {
    for (const state of ["NOT_REQUIRED", "PENDING", "UPLOADED", "VERIFIED"]) expect(nextInsuranceState(state, false, true)).toBe("NOT_REQUIRED");
  });

  it("starts from pending, or from uploaded when a file is already on record", () => {
    expect(nextInsuranceState("NOT_REQUIRED", true, false)).toBe("PENDING");
    expect(nextInsuranceState("NOT_REQUIRED", true, true)).toBe("UPLOADED");
  });

  it("keeps progress while the requirement stays", () => {
    for (const state of ["PENDING", "UPLOADED", "VERIFIED"]) expect(nextInsuranceState(state, true, true)).toBe(state);
  });
});

describe("usIssued", () => {
  it("counts the states and U.S. territories as U.S. licences", () => {
    for (const code of ["US", "us", "PR", "GU", "VI", "AS", "MP"]) expect(usIssued(code)).toBe(true);
    for (const code of ["CN", "CA", "MX", "GB", ""]) expect(usIssued(code)).toBe(false);
  });
});

describe("insuranceOk", () => {
  it("passes when not required or verified", () => {
    expect(insuranceOk("NOT_REQUIRED")).toBe(true);
    expect(insuranceOk("VERIFIED")).toBe(true);
    expect(insuranceOk("PENDING")).toBe(false);
    expect(insuranceOk("UPLOADED")).toBe(false);
  });
});

const slot = (id: string, position: number, spouse = false) => ({ id, position, spouse });

describe("planDriverSlots", () => {
  it("creates the missing slots and puts the spouse on the first new one", () => {
    expect(planDriverSlots([], 2, true)).toEqual({ remove: [], moves: [], create: [1, 2], spousePosition: 1 });
    expect(planDriverSlots([slot("bob", 1)], 2, true)).toEqual({ remove: [], moves: [], create: [2], spousePosition: 2 });
  });

  it("keeps an existing spouse where they are", () => {
    expect(planDriverSlots([slot("bob", 1), slot("amy", 2, true)], 3, true)).toEqual({ remove: [], moves: [], create: [3], spousePosition: 2 });
  });

  it("falls back to the first slot when nobody is new", () => {
    expect(planDriverSlots([slot("bob", 1), slot("amy", 2)], 2, true).spousePosition).toBe(1);
  });

  it("drops the spouse first when the spouse is unticked and the count goes down", () => {
    expect(planDriverSlots([slot("amy", 1, true), slot("bob", 2)], 1, false)).toEqual({ remove: ["amy"], moves: [{ id: "bob", position: 1 }], create: [], spousePosition: null });
  });

  it("keeps the spouse and drops the last other driver when only the count goes down", () => {
    expect(planDriverSlots([slot("amy", 1, true), slot("bob", 2), slot("cat", 3)], 2, true)).toEqual({ remove: ["cat"], moves: [], create: [], spousePosition: 1 });
  });

  it("only clears the flag when the spouse is unticked and the count stays", () => {
    expect(planDriverSlots([slot("amy", 1, true), slot("bob", 2)], 2, false)).toEqual({ remove: [], moves: [], create: [], spousePosition: null });
  });

  it("removes everything when no driver is left", () => {
    expect(planDriverSlots([slot("amy", 1, true), slot("bob", 2)], 0, false)).toEqual({ remove: ["amy", "bob"], moves: [], create: [], spousePosition: null });
  });
});
