import { describe, expect, it } from "vitest";
import { placeRows } from "./place";

const labels = { location: "地点", method: "取车方式", delivery: "送车地址", address: "取车地址" };
const methods = { DELIVERY: "送车上门", SELF_SERVICE: "自助取车" };
const store = "尔湾门店 · 780 Roosevelt, Irvine, CA 92620";

describe("placeRows", () => {
  it("shows the store for a store pickup", () => {
    expect(placeRows(labels, methods, "STORE", null, store)).toEqual([["地点", store]]);
    expect(placeRows(labels, methods, "STORE", "1 Main St, Irvine", store)).toEqual([["地点", store]]);
  });

  it("names the delivery and shows where the car is brought", () => {
    expect(placeRows(labels, methods, "DELIVERY", " 1 Main St,\nIrvine, CA 92618 ", store)).toEqual([
      ["取车方式", "送车上门"],
      ["送车地址", "1 Main St, Irvine, CA 92618"],
    ]);
  });

  it("names self-service pickup and shows its address", () => {
    expect(placeRows(labels, methods, "SELF_SERVICE", "John Wayne Airport, Lot C", store)).toEqual([
      ["取车方式", "自助取车"],
      ["取车地址", "John Wayne Airport, Lot C"],
    ]);
  });

  it("falls back to the store while no address is on the order", () => {
    expect(placeRows(labels, methods, "DELIVERY", null, store)).toEqual([
      ["取车方式", "送车上门"],
      ["地点", store],
    ]);
    expect(placeRows(labels, methods, "SELF_SERVICE", "   ", store)).toEqual([
      ["取车方式", "自助取车"],
      ["地点", store],
    ]);
  });
});
