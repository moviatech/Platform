import { describe, expect, it } from "vitest";
import { isTestCar, openServiceCosts, serviceLogError, unbookedLogs } from "./service-due";

const car = (fleet_number: string, is_placeholder = false, slug = "model-y") => ({ fleet_number, is_placeholder, vehicle_class: { slug } });

describe("service logs waiting to be booked", () => {
  const logs = [
    { id: "a", vehicle_id: "v1", cost_cents: 12000, vehicle: car("MY-111626") },
    { id: "b", vehicle_id: "v1", cost_cents: 0, vehicle: car("MY-111626") },
    { id: "c", vehicle_id: "v2", cost_cents: 5000, vehicle: car("MY-111926") },
    { id: "d", vehicle_id: "v3", cost_cents: 9000, vehicle: car("CT-001", true) },
    { id: "e", vehicle_id: "v4", cost_cents: 9000, vehicle: car("ZZ-FIN-1") },
    { id: "f", vehicle_id: "v5", cost_cents: 9000, vehicle: car("PRACTICE-1") },
    { id: "g", vehicle_id: "v6", cost_cents: 9000, vehicle: car("MY-2", false, "zz-test") },
    { id: "h", vehicle_id: "v1", cost_cents: 7000, vehicle: car("MY-111626") },
  ];

  it("keeps real cars with a cost that are neither booked nor skipped", () => {
    expect(unbookedLogs(logs, new Set(["c"]), new Set(["h"])).map((log) => log.id)).toEqual(["a"]);
  });

  it("treats placeholders, ZZ, practice and zz classes as test cars", () => {
    expect([car("CT-001", true), car("ZZ-1"), car("PRACTICE-2"), car("X", false, "zz-a"), car("MY-111626"), null].map(isTestCar)).toEqual([true, true, true, true, false, false]);
  });

  it("drops booked and skipped logs from the old report's service costs", () => {
    expect(openServiceCosts(logs, new Set(["a"]), new Set(["c"])).map((log) => log.id)).toEqual(["b", "d", "e", "f", "g", "h"]);
  });

  it("checks that a linked log exists and belongs to the chosen car", () => {
    expect(serviceLogError(null, undefined)).toBe("serviceGone");
    expect(serviceLogError({ vehicle_id: "v1" }, "v2")).toBe("vehicle");
    expect(serviceLogError({ vehicle_id: "v1" }, "v1")).toBeNull();
    expect(serviceLogError({ vehicle_id: "v1" }, undefined)).toBeNull();
  });
});
