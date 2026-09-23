import { describe, expect, it } from "vitest";
import { rankByRelevance, terms } from "./relevance";

const entries = [
  { id: "mileage", text: "How many miles are included? 每天包含多少英里 里程 超出怎么收费" },
  { id: "charging", text: "How do I charge the car at a Supercharger? 怎么充电 超充" },
  { id: "cancel", text: "What is the cancellation policy? 取消订单 退款" },
  { id: "delivery", text: "Do you deliver to the airport? 机场 送车" },
];
const text = (entry: { text: string }) => entry.text;

describe("terms", () => {
  it("splits Latin words and Chinese pairs, dropping filler words", () => {
    const found = terms("Can you please tell me the mileage? 每天里程");
    expect(found.has("mileage")).toBe(true);
    expect(found.has("please")).toBe(false);
    expect(found.has("里程")).toBe(true);
    expect(found.has("每天")).toBe(true);
  });
});

describe("rankByRelevance", () => {
  it("puts the entry that shares the rarest words first", () => {
    expect(rankByRelevance(entries, text, "一周租车每天可以开多少英里，超出怎么算", 2)[0].id).toBe("mileage");
    expect(rankByRelevance(entries, text, "can you deliver to the airport", 2)[0].id).toBe("delivery");
  });

  it("returns nothing when no entry shares a word with the question", () => {
    expect(rankByRelevance(entries, text, "zzzz qqqq", 3)).toEqual([]);
    expect(rankByRelevance(entries, text, "", 3)).toEqual([]);
  });

  it("never returns more than the limit", () => {
    expect(rankByRelevance(entries, text, "英里 充电 取消 机场", 2)).toHaveLength(2);
  });
});
