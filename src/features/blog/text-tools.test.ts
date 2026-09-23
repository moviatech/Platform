import { describe, expect, it } from "vitest";
import { stripProfile } from "./image-tools";
import { baseName, relinkImages, splitLeadImage } from "./media";
import { insertBlock, lineOffset, prefixLines, wrapSelection } from "./text-tools";

const apply = (value: string, edit: { from: number; to: number; text: string }) => value.slice(0, edit.from) + edit.text + value.slice(edit.to);

describe("wrapSelection", () => {
  it("wraps the selected text and keeps it selected", () => {
    const value = "rent a Tesla today";
    const edit = wrapSelection({ value, start: 7, end: 12 }, "**", "**", "bold");
    expect(apply(value, edit)).toBe("rent a **Tesla** today");
    expect(apply(value, edit).slice(edit.selectFrom, edit.selectTo)).toBe("Tesla");
  });

  it("inserts a selected placeholder when nothing is selected", () => {
    const edit = wrapSelection({ value: "", start: 0, end: 0 }, "[", "](https://example.org)", "text");
    expect(edit.text).toBe("[text](https://example.org)");
    expect(edit.text.slice(edit.selectFrom, edit.selectTo)).toBe("text");
  });
});

describe("prefixLines", () => {
  it("prefixes every touched line and replaces an existing marker", () => {
    const value = "intro\n- one\n## two\nthree\noutro";
    const edit = prefixLines({ value, start: 8, end: 21 }, (index) => `${index + 1}. `, "item");
    expect(apply(value, edit)).toBe("intro\n1. one\n2. two\n3. three\noutro");
  });

  it("uses the placeholder on an empty line", () => {
    const value = "a\n\nb";
    const edit = prefixLines({ value, start: 2, end: 2 }, () => "## ", "Heading");
    expect(apply(value, edit)).toBe("a\n## Heading\nb");
    expect(apply(value, edit).slice(edit.selectFrom, edit.selectTo)).toBe("Heading");
  });

  it("stops at the line a triple-click selected", () => {
    const value = "intro\nfirst\nsecond\noutro";
    const edit = prefixLines({ value, start: 6, end: 12 }, () => "## ", "Heading");
    expect(apply(value, edit)).toBe("intro\n## first\nsecond\noutro");
  });

  it("keeps blank lines between paragraphs and numbers only the text lines", () => {
    const value = "one\n\ntwo";
    const edit = prefixLines({ value, start: 0, end: value.length }, (index) => `${index + 1}. `, "item");
    expect(apply(value, edit)).toBe("1. one\n\n2. two");
  });

  it("works on the first line when the document starts with a blank line", () => {
    const value = "\nabc";
    const edit = prefixLines({ value, start: 0, end: 0 }, () => "## ", "Heading");
    expect(apply(value, edit)).toBe("## Heading\nabc");
  });

  it("handles a caret at the very end", () => {
    const value = "last";
    const edit = prefixLines({ value, start: 4, end: 4 }, () => "> ", "quote");
    expect(apply(value, edit)).toBe("> last");
  });
});

describe("insertBlock", () => {
  it("separates the block from surrounding text with blank lines", () => {
    const value = "before\nafter";
    const edit = insertBlock({ value, start: 6, end: 6 }, ":::callout T\nbody\n:::", 11, 1);
    expect(apply(value, edit)).toBe("before\n\n:::callout T\nbody\n:::\n\nafter");
    expect(apply(value, edit).slice(edit.selectFrom, edit.selectTo)).toBe("T");
  });

  it("adds no padding in an empty document", () => {
    const edit = insertBlock({ value: "", start: 0, end: 0 }, "![alt](x)", 2, 3);
    expect(edit.text).toBe("![alt](x)");
    expect(edit.text.slice(edit.selectFrom, edit.selectTo)).toBe("alt");
  });

  it("reuses existing blank lines", () => {
    const value = "a\n\n\n\nb";
    const edit = insertBlock({ value, start: 3, end: 3 }, "X");
    expect(apply(value, edit)).toBe("a\n\nX\n\nb");
  });
});

describe("lineOffset", () => {
  it("returns the offset of a 1-based line", () => {
    expect(lineOffset("ab\ncd\nef", 1)).toBe(0);
    expect(lineOffset("ab\ncd\nef", 3)).toBe(6);
    expect(lineOffset("ab\ncd", 9)).toBe(5);
  });
});

describe("stripProfile", () => {
  const encode = (bytes: number[]) => `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`;
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
  const icc = [0xff, 0xe2, 0x00, 0x06, 0x49, 0x43, 0x43, 0x5f];
  const table = [0xff, 0xdb, 0x00, 0x03, 0x00];
  const scan = [0xff, 0xda, 0x00, 0x02, 0x11, 0xff, 0xe2, 0x22, 0xff, 0xd9];

  it("drops the colour profile segment and keeps everything else", () => {
    expect(stripProfile(encode([0xff, 0xd8, ...app0, ...icc, ...table, ...scan]))).toBe(encode([0xff, 0xd8, ...app0, ...table, ...scan]));
  });

  it("leaves other data untouched", () => {
    const plain = encode([0xff, 0xd8, ...app0, ...table, ...scan]);
    expect(stripProfile(plain)).toBe(plain);
    expect(stripProfile("data:image/webp;base64,AAAA")).toBe("data:image/webp;base64,AAAA");
    expect(stripProfile(encode([0x00, 0x01, 0x02]))).toBe(encode([0x00, 0x01, 0x02]));
  });
});

describe("media helpers", () => {
  it("compares names without folder, extension or case", () => {
    expect(baseName("assets/FSD-Cover.PNG")).toBe("fsd-cover");
    expect(baseName("C:\\shots\\fsd%20cover.webp")).toBe("fsd cover");
  });

  it("takes a leading image and its caption off the body", () => {
    expect(splitLeadImage("![Cover shot](assets/cover.jpg)\n*Cover: illustration.*\n\nFirst paragraph.\n\n![Later](assets/b.png)")).toEqual({ markdown: "First paragraph.\n\n![Later](assets/b.png)", lead: "assets/cover.jpg" });
    expect(splitLeadImage("\n![Cover](assets/c.webp \"Title\")\nFirst paragraph.")).toEqual({ markdown: "First paragraph.", lead: "assets/c.webp" });
    expect(splitLeadImage("![Only](a.png)")).toEqual({ markdown: "", lead: "a.png" });
  });

  it("leaves a body that starts with text alone", () => {
    const body = "Opening line with ![inline](a.png) inside.\n\n![Later](b.png)";
    expect(splitLeadImage(body)).toEqual({ markdown: body, lead: null });
    expect(splitLeadImage("")).toEqual({ markdown: "", lead: null });
  });

  it("points a hand-off image at the uploaded file", () => {
    const markdown = "![Cover](assets/fsd-cover.png)\n\n![Kept](https://cdn.example.org/fsd-cover.png)\n\n![Other](assets/map.png \"Route\")";
    expect(relinkImages(markdown, "FSD-Cover.jpg", "https://media.example.org/a.webp")).toBe("![Cover](https://media.example.org/a.webp)\n\n![Kept](https://cdn.example.org/fsd-cover.png)\n\n![Other](assets/map.png \"Route\")");
  });
});
