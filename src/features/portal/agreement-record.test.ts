import { describe, expect, it } from "vitest";
import { recordBlocks, snapshotStructured } from "./agreement-record";

const signature = { rows: [["Signer", "Jane Doe"]] as Array<[string, string]>, image: null };
const hints = { termsLabels: ["Special Terms & Promotional Arrangements", "特别约定及优惠安排"], termsEnds: ["== EXHIBIT B ==", "== 附件 B =="], colonLabels: ["Each extension: duration, price and mileage"] };

describe("recordBlocks", () => {
  it("rebuilds the title, sections, clauses and rows of a stored snapshot", () => {
    const text = ["MOVIA\nRental agreement\nCalifornia edition", "Entity: Movia Technologies, Inc.\nBooking: MV-TEST01", "Read together with the exhibits.", "== CONTRACT TERMS ==", "1. Parties\nFirst paragraph.\nSecond paragraph."].join("\n\n");
    expect(recordBlocks(text, signature)).toEqual([
      { kind: "title", brand: "MOVIA", text: "Rental agreement", sub: "California edition" },
      { kind: "rows", rows: [["Entity", "Movia Technologies, Inc."], ["Booking", "MV-TEST01"]] },
      { kind: "paragraph", text: "Read together with the exhibits." },
      { kind: "section", text: "CONTRACT TERMS" },
      { kind: "clause", heading: "1. Parties", paragraphs: ["First paragraph.", "Second paragraph."] },
      { kind: "signature", rows: signature.rows, image: null },
    ]);
  });

  it("keeps further lines of a value with the row they belong to", () => {
    const blocks = recordBlocks("Renter: Jane Doe\nSpecial terms: Delivery fee waived.\nReturn by 8 PM.\nTravel: Continental U.S.", signature);
    expect(blocks[0]).toEqual({ kind: "rows", rows: [["Renter", "Jane Doe"], ["Special terms", "Delivery fee waived.\nReturn by 8 PM."], ["Travel", "Continental U.S."]] });
  });

  it("keeps special terms as one block up to the next exhibit, however they are written", () => {
    const terms = ["1. Rental charges", "**Rental Charges**", "- Monthly rental: 28 × $119.00 = $3,332.00", "- Note: fee waived", "", "### 2. Delivery", "Movia delivers the car."].join("\n");
    const text = ["Booking: MV-TEST01\nTravel: Continental U.S.", `Special Terms & Promotional Arrangements:\n${terms}`, "== EXHIBIT B ==", "Selected option: Liability only\nRenter initials: MC"].join("\n\n");
    const blocks = recordBlocks(text, signature, hints);
    expect(blocks.map((block) => block.kind)).toEqual(["rows", "terms", "section", "rows", "signature"]);
    expect(blocks[1]).toEqual({ kind: "terms", label: "Special Terms & Promotional Arrangements", text: terms });
    expect(recordBlocks(text, signature).map((block) => block.kind)).not.toContain("terms");
  });

  it("does not let a section line inside the special terms end them early", () => {
    const terms = ["First point.", "", "== Notes ==", "", "== EXHIBIT B ==", "", "Second point."].join("\n");
    const text = ["Booking: MV-TEST01\nTravel: Continental U.S.", `特别约定及优惠安排:\n${terms}`, "== EXHIBIT B ==", "Selected option: Liability only\nRenter initials: MC", "== EXHIBIT C ==", "Odometer: 12\nFuel: full"].join("\n\n");
    const blocks = recordBlocks(text, signature, hints);
    expect(blocks.map((block) => block.kind)).toEqual(["rows", "terms", "section", "rows", "section", "rows", "signature"]);
    expect(blocks[1]).toEqual({ kind: "terms", label: "特别约定及优惠安排", text: terms });
    expect(blocks[2]).toEqual({ kind: "section", text: "EXHIBIT B" });
  });

  it("falls back to the next section line when the closing title is not known", () => {
    const text = ["Special Terms & Promotional Arrangements:\nOne line.", "== SOMETHING ELSE ==", "Label: value\nOther: value"].join("\n\n");
    const blocks = recordBlocks(text, signature, { termsLabels: hints.termsLabels });
    expect(blocks.map((block) => block.kind)).toEqual(["terms", "section", "rows", "signature"]);
  });

  it("splits a known label that carries a colon at the right place", () => {
    const text = "== EXHIBIT E ==\n\nMileage: 150 mi/day\nEach extension: duration, price and mileage: 7 days, $700.00, 1,050 mi\nNotes: none";
    expect(recordBlocks(text, signature, hints)[1]).toEqual({
      kind: "rows",
      rows: [["Mileage", "150 mi/day"], ["Each extension: duration, price and mileage", "7 days, $700.00, 1,050 mi"], ["Notes", "none"]],
    });
    expect(recordBlocks(text, signature)[1]).toEqual({
      kind: "rows",
      rows: [["Mileage", "150 mi/day"], ["Each extension", "duration, price and mileage: 7 days, $700.00, 1,050 mi"], ["Notes", "none"]],
    });
  });

  it("leaves a lone line with a colon as a paragraph", () => {
    expect(recordBlocks("NOTICE: read this exhibit on its own.", signature)[0]).toEqual({ kind: "paragraph", text: "NOTICE: read this exhibit on its own." });
  });

  it("keeps every line of the snapshot", () => {
    const text = ["A\nB\nC", "Label: one\ntwo\nthree", "plain\nlines", "== S ==", "2. Clause\nbody"].join("\n\n");
    const flat = recordBlocks(text, signature)
      .slice(0, -1)
      .map((block) => {
        if (block.kind === "title") return [block.brand, block.text, block.sub];
        if (block.kind === "rows") return block.rows.flatMap(([label, value]) => `${label}: ${value}`.split("\n"));
        if (block.kind === "section") return [`== ${block.text} ==`];
        if (block.kind === "clause") return [block.heading, ...block.paragraphs];
        if (block.kind === "paragraph") return block.text.split("\n");
        return [];
      })
      .flat();
    expect(flat).toEqual(text.split("\n").filter(Boolean));
  });
});

describe("snapshotStructured", () => {
  it("is true from the first version stored in the rebuilt layout", () => {
    expect(snapshotStructured("2026-11-20.2")).toBe(true);
    expect(snapshotStructured("2026-11-20.10")).toBe(true);
    expect(snapshotStructured("2026-11-21.1")).toBe(true);
    expect(snapshotStructured("2027-01-02.1")).toBe(true);
  });

  it("is false for older or unreadable versions", () => {
    expect(snapshotStructured("2026-11-20.1")).toBe(false);
    expect(snapshotStructured("2026-11-19.3")).toBe(false);
    expect(snapshotStructured("2026-11-05")).toBe(false);
    expect(snapshotStructured("")).toBe(false);
    expect(snapshotStructured("CA-2026-11-20 · REV 15")).toBe(false);
  });
});
