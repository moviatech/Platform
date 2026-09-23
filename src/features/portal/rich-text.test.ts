import { describe, expect, it } from "vitest";
import { hasMarkup, parseRich, plainRich } from "./rich-text";

const kinds = (text: string) => parseRich(text).map((line) => line.kind);
const words = (text: string) => parseRich(text).map((line) => line.spans.map((span) => span.text).join(""));

describe("parseRich", () => {
  it("reads headings, bold lines, bullets and plain lines", () => {
    const lines = parseRich(["### 2. Complimentary delivery", "Movia waives the fee.", "**Rental Charges**", "- Monthly rental: 28 × $119.00", "* Second item", "Closing line."].join("\n"));
    expect(lines).toEqual([
      { kind: "heading", spans: [{ text: "2. Complimentary delivery", bold: true }] },
      { kind: "text", spans: [{ text: "Movia waives the fee.", bold: false }] },
      { kind: "heading", spans: [{ text: "Rental Charges", bold: true }] },
      { kind: "bullet", spans: [{ text: "Monthly rental: 28 × $119.00", bold: false }] },
      { kind: "bullet", spans: [{ text: "Second item", bold: false }] },
      { kind: "text", spans: [{ text: "Closing line.", bold: false }] },
    ]);
  });

  it("marks bold parts inside a line", () => {
    expect(parseRich("- **No-show:** $500 fee. Total **$1,979.00** due\n- second")[0]).toEqual({
      kind: "bullet",
      spans: [
        { text: "No-show:", bold: true },
        { text: " $500 fee. Total ", bold: false },
        { text: "$1,979.00", bold: true },
        { text: " due", bold: false },
      ],
    });
    expect(parseRich("## Total **due** today")[0]).toEqual({ kind: "heading", spans: [{ text: "Total ", bold: true }, { text: "due", bold: true }, { text: " today", bold: true }] });
  });

  it("keeps asterisks that are not a bold pair", () => {
    for (const text of ["We sent the link to jo****@gm****.com, please check.", "Your card **** **** **** 4242 was charged $120.00 today.", "We will call (949) ***-**12 tomorrow.", "Model Y $99** and Model 3 $79** per day", "Total = 3 ** 2 and 4 ** 2", "Card on file: **** 4242", "DL: D12****89", "****", "5 ** 2 is twenty-five"]) {
      expect(words(text)).toEqual([text]);
      expect(parseRich(text)[0].spans.some((span) => span.bold)).toBe(false);
      expect(hasMarkup(text)).toBe(false);
      expect(plainRich(text)).toBe(text);
    }
  });

  it("treats a hash as a heading only when it reads like one", () => {
    expect(kinds("# Pickup details\ntext")).toEqual(["heading", "text"]);
    expect(kinds("# 2. Delivery\ntext")).toEqual(["heading", "text"]);
    expect(kinds("## reservation notes\ntext")).toEqual(["heading", "text"]);
    expect(words("Hi Michael,\n# of days: 3\n# 12345 is confirmed\n#hashtag and 3 * 4")).toEqual(["Hi Michael,", "# of days: 3", "# 12345 is confirmed", "#hashtag and 3 * 4"]);
    expect(kinds("Hi Michael,\n# of days: 3\n# 12345 is confirmed")).toEqual(["text", "text", "text"]);
    expect(words("## Reservation #")).toEqual(["Reservation #"]);
    expect(words("## ##")).toEqual(["##"]);
    expect(words("#")).toEqual(["#"]);
  });

  it("needs two bullet lines before it calls them a list", () => {
    expect(words("Rental: $300.00\n- $50.00 coupon\n= $250.00 due at pickup")).toEqual(["Rental: $300.00", "- $50.00 coupon", "= $250.00 due at pickup"]);
    expect(kinds("See you tomorrow at 10 AM.\n\n- Lori")).toEqual(["text", "gap", "text"]);
    expect(words("Model Y is $99/day*\n\n* weekday rate")).toEqual(["Model Y is $99/day*", "", "* weekday rate"]);
    expect(kinds("Bring:\n- license\n- card")).toEqual(["text", "bullet", "bullet"]);
    expect(words("-$50 off\n-Lori\n— Lori")).toEqual(["-$50 off", "-Lori", "— Lori"]);
  });

  it("treats a short numbered line standing alone as a heading, but not a numbered list", () => {
    expect(kinds("1. Special Rental Pricing & Discounts\nMovia agrees to the following.")).toEqual(["heading", "text"]);
    expect(kinds("Steps:\n1. Bring the license\n2. Sign the form\nDone")).toEqual(["text", "text", "text", "text"]);
    expect(kinds("1. Free delivery to the airport\n\n2. Return by 8 PM\n\n3. One extra driver at no charge")).toEqual(["text", "gap", "text", "gap", "text"]);
    expect(kinds("1. The renter returns the car by 8 PM.\nLate returns are billed.")).toEqual(["text", "text"]);
    expect(kinds("Intro\n3. Closing remark")).toEqual(["text", "text"]);
    expect(kinds("1. Pricing\nbody one\n\n2. Delivery\nbody two")).toEqual(["heading", "text", "gap", "heading", "text"]);
    expect(parseRich("1. **Pickup** at LAX\nBring your license")[0]).toEqual({ kind: "heading", spans: [{ text: "1. ", bold: true }, { text: "Pickup", bold: true }, { text: " at LAX", bold: true }] });
  });

  it("keeps indentation and spacing of ordinary lines", () => {
    expect(words("    10:00   pickup\n    18:00   return")).toEqual(["    10:00   pickup", "    18:00   return"]);
  });

  it("keeps one gap between paragraphs and none at the ends", () => {
    expect(kinds("\n\nFirst\n\n\n\nSecond\n\n")).toEqual(["text", "gap", "text"]);
    expect(parseRich("")).toEqual([]);
    expect(parseRich("   \n\t\n")).toEqual([]);
  });

  it("drops no words", () => {
    const text = "## Title **here**\n- one **two** three\n- item\nplain **four**\n\n**Whole line**";
    const out = words(text).join(" ");
    for (const word of ["Title", "here", "one", "two", "three", "item", "plain", "four", "Whole", "line"]) expect(out).toContain(word);
    expect(out).not.toContain("*");
    expect(out).not.toContain("#");
  });

  it("stays fast on long runs of spaces, blank lines and asterisks", () => {
    const started = Date.now();
    const spaces = `# a${" ".repeat(60000)}b`;
    expect(parseRich(spaces)).toHaveLength(1);
    expect(hasMarkup(`a${"\n".repeat(100000)}b`)).toBe(false);
    expect(hasMarkup(`${"- ".repeat(40000)}x`)).toBe(false);
    expect(parseRich("**a ".repeat(20000))).toHaveLength(1);
    expect(plainRich(`${"** ".repeat(30000)}\n${"*".repeat(50000)}`).length).toBeGreaterThan(100000);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe("hasMarkup", () => {
  it("spots bold, headings and lists", () => {
    expect(hasMarkup("Thanks for **booking** with us")).toBe(true);
    expect(hasMarkup("Hello\n## Pickup\nSee you")).toBe(true);
    expect(hasMarkup("Please bring:\n- license\n- card")).toBe(true);
  });

  it("leaves ordinary messages alone", () => {
    expect(hasMarkup("Hi Michael,\nYour car is ready at 10 AM.\nThanks")).toBe(false);
    expect(hasMarkup("Rate is $99 * 3 days, #1 choice - really")).toBe(false);
    expect(hasMarkup("1. Yes we can deliver\nSee you")).toBe(false);
    expect(hasMarkup("Thanks!\n\n- Lori")).toBe(false);
    expect(hasMarkup("# of days: 3")).toBe(false);
  });
});

describe("plainRich", () => {
  it("removes the markers and keeps the words and order", () => {
    expect(plainRich("## Pickup details\n**Time:** 10 AM\n\n- Bring your **license**\n- Bring the card")).toBe("Pickup details\nTime: 10 AM\n\n• Bring your license\n• Bring the card");
  });
});
