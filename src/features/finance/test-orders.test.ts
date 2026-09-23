import { describe, expect, it } from "vitest";
import { isTestOrder, testOrderOf } from "./test-orders";

describe("isTestOrder", () => {
  it("flags the practice order", () => {
    expect(isTestOrder({ number: "MV-PRAC01", classSlug: "zz-practice", fleetNumber: "PRACTICE-1", placeholder: false })).toBe(true);
  });

  it("flags check-script numbers the generator cannot produce", () => {
    expect(isTestOrder({ number: "MV-ZZTAX1", classSlug: "model-y-basic" })).toBe(true);
    expect(isTestOrder({ number: "MV-PRAC01" })).toBe(true);
    expect(isTestOrder({ number: "MV-TEST01" })).toBe(true);
    expect(isTestOrder({ number: "MV-ZZMAIL" })).toBe(true);
    expect(isTestOrder({ number: "MV-ZZTAX10" })).toBe(true);
  });

  it("flags check-script orders by class even when the number looks generated", () => {
    expect(isTestOrder({ number: "MV-ZZDUEA", classSlug: "zz-due" })).toBe(true);
    expect(isTestOrder({ number: "MV-ZZHND2", classSlug: "ZZ-Handover" })).toBe(true);
  });

  it("flags placeholder and test cars", () => {
    expect(isTestOrder({ number: "MV-K7Q2MX", classSlug: "model-y-basic", fleetNumber: "MY-001", placeholder: true })).toBe(true);
    expect(isTestOrder({ number: "MV-K7Q2MX", classSlug: "model-y-basic", fleetNumber: "ZZ-HND-1" })).toBe(true);
    expect(isTestOrder({ number: "MV-K7Q2MX", classSlug: "model-y-basic", fleetNumber: "practice-1" })).toBe(true);
  });

  it("keeps the real order", () => {
    expect(isTestOrder({ number: "MV-CRFBZ6", classSlug: "model-y-premium", fleetNumber: "MY-111926", placeholder: false })).toBe(false);
  });

  it("keeps a real order whose generated number happens to start with ZZ", () => {
    expect(isTestOrder({ number: "MV-ZZ4K7Q", classSlug: "model-y-basic", fleetNumber: "MY-111626", placeholder: false })).toBe(false);
  });

  it("keeps orders with no class and no vehicle", () => {
    expect(isTestOrder({ number: "MV-CRFBZ6" })).toBe(false);
    expect(isTestOrder({ number: "MV-CRFBZ6", classSlug: null, fleetNumber: null, placeholder: null })).toBe(false);
    expect(isTestOrder({})).toBe(false);
  });

  it("reads embedded rows", () => {
    expect(testOrderOf({ number: "MV-CRFBZ6", vehicle_class: { slug: "model-y-premium" }, vehicle: { fleet_number: "MY-111926", is_placeholder: false } })).toBe(false);
    expect(testOrderOf({ number: "MV-CRFBZ6", vehicle_class: { slug: "model-y-premium" }, vehicle: null })).toBe(false);
    expect(testOrderOf({ number: "MV-K7Q2MX", vehicle_class: { slug: "zz-practice" }, vehicle: null })).toBe(true);
    expect(testOrderOf({ number: "MV-K7Q2MX", vehicle_class: null, vehicle: { fleet_number: "MY-002", is_placeholder: true } })).toBe(true);
  });
});
