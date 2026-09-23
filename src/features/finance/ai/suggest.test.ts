import { describe, expect, it } from "vitest";
import { parseSuggestion, suggestionPrompt, type SuggestContext, type SuggestEntry } from "./suggest";

const context: SuggestContext = {
  categories: [
    { code: "INSURANCE", zh: "保险", en: "Insurance", account: "6030", accountName: "保险费" },
    { code: "SOFTWARE", zh: "软件与服务", en: "Software", account: "6110", accountName: "软件与订阅" },
    { code: "OTHER", zh: "其他", en: "Other", account: null, accountName: null },
  ],
  vehicles: [
    { id: "car-1", fleetNumber: "MY-111626", model: "model-y" },
    { id: "car-2", fleetNumber: "MY-111926", model: "model-y" },
  ],
  stores: [{ id: "store-1", code: "IRV", name: "Irvine Hub", nameZh: "尔湾门店" }],
};

const entry: SuggestEntry = { vendor: "State Farm", note: "年度车险 MY-111626", reference: "INV-7", amount: "$1,200.00", spentOn: "2026-11-25", locale: "zh" };

describe("entry helper prompt", () => {
  it("sends only the chart, the cars, the stores and this entry", () => {
    const { instructions, prompt } = suggestionPrompt(context, entry);
    expect(instructions).toContain("Simplified Chinese");
    expect(prompt).toContain("INSURANCE: 保险 Insurance / 6030 保险费");
    expect(prompt).toContain("OTHER: 其他 Other");
    expect(prompt).toContain("MY-111926: model-y");
    expect(prompt).toContain("IRV: Irvine Hub 尔湾门店");
    expect(prompt).toContain("paid to: State Farm");
    expect(prompt).toContain("note: 年度车险 MY-111626");
    expect(prompt).toContain("amount: $1,200.00");
    expect(suggestionPrompt(context, { ...entry, locale: "en" }).instructions).toContain("in English");
  });
});

describe("entry helper reply", () => {
  it("maps a good reply to ids", () => {
    const text = '```json\n{"category":"insurance","vehicle":"my-111626","store":"irv","serviceFrom":"2026-12-01","serviceTo":"2027-11-30","capital":false,"reason":"年度保险，按年分摊"}\n```';
    expect(parseSuggestion(text, context)).toEqual({ category: "INSURANCE", vehicleId: "car-1", locationId: "store-1", serviceFrom: "2026-12-01", serviceTo: "2027-11-30", capital: false, reason: "年度保险，按年分摊" });
  });

  it("drops what it cannot trust", () => {
    const loose = parseSuggestion('{"category":"SOFTWARE","vehicle":"CT-009","store":"Mars","serviceFrom":"2026-02-30","serviceTo":"2026-03-01","reason":null}', context);
    expect(loose).toEqual({ category: "SOFTWARE", vehicleId: null, locationId: null, serviceFrom: null, serviceTo: null, capital: false, reason: "" });
    const backwards = parseSuggestion('{"category":"SOFTWARE","serviceFrom":"2027-01-01","serviceTo":"2026-01-01"}', context);
    expect(backwards?.serviceFrom).toBeNull();
    const capital = parseSuggestion('{"category":"OTHER","capital":true,"serviceFrom":"2026-12-01","serviceTo":"2027-11-30"}', context);
    expect(capital).toMatchObject({ capital: true, serviceFrom: null, serviceTo: null });
  });

  it("refuses replies without a known category or valid JSON", () => {
    expect(parseSuggestion('{"category":"FOOD"}', context)).toBeNull();
    expect(parseSuggestion("I think this is insurance.", context)).toBeNull();
    expect(parseSuggestion('{"category": INSURANCE}', context)).toBeNull();
  });

  it("keeps the reason short", () => {
    expect(parseSuggestion(`{"category":"OTHER","reason":"${"长".repeat(200)}"}`, context)?.reason).toHaveLength(120);
  });
});
