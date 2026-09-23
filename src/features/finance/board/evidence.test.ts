import { describe, expect, it } from "vitest";
import { evidencePath, evidenceTypes, isStoredEvidence } from "./evidence";

const car = "8f14e45f-ceea-4e1b-9a3c-1d2e3f405060";
const file = "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9";

describe("tax proof paths", () => {
  it("accepts only files under the car's own folder", () => {
    expect(isStoredEvidence(car, `vehicles/${car}/${file}.pdf`)).toBe(true);
    expect(isStoredEvidence(car.toUpperCase(), `vehicles/${car}/${file}.jpg`)).toBe(true);
    expect(isStoredEvidence(car, `vehicles/${file}/${file}.pdf`)).toBe(false);
    expect(isStoredEvidence(car, `vehicles/${car}/../${file}.pdf`)).toBe(false);
    expect(isStoredEvidence(car, `vehicles/${car}/${file}.exe`)).toBe(false);
  });

  it("keeps old typed notes apart from stored files", () => {
    expect(isStoredEvidence(car, "云盘 › 车辆 › 购车合同 第 2 页")).toBe(false);
    expect(isStoredEvidence(car, null)).toBe(false);
  });

  it("knows the content type of every allowed extension", () => {
    for (const extension of ["pdf", "jpg", "png", "webp", "heic"]) {
      expect(evidencePath(car).test(`vehicles/${car}/${file}.${extension}`)).toBe(true);
      expect(evidenceTypes[extension]).toBeTruthy();
    }
  });
});
