import { describe, expect, it } from "vitest";
import type { ArticleBlock, ImageRef } from "./blocks";
import { compileMarkdown, countWords, h2Ids, headingTexts, serializeBlocks, slugifyHeading } from "./markdown";

const photo: ImageRef = { src: "/blog/photo.1a2b3c4d.webp", width: 1600, height: 1000 };
const wide: ImageRef = { src: "/blog/wide shot (1).webp", width: 1600, height: 900, blur: "data:image/webp;base64,AA" };
const library = new Map([photo, wide].map((image) => [image.src, image]));
const images = (src: string) => library.get(src) ?? null;

const lines = (...rows: string[]) => rows.join("\n");
const compile = (source: string, headingIds?: string[]) => compileMarkdown(source, { locale: "en", images, headingIds });
const blocksOf = (source: string, headingIds?: string[]) => compile(source, headingIds).blocks;
const issuesOf = (source: string, headingIds?: string[]) => compile(source, headingIds).issues;
const codesOf = (source: string) => issuesOf(source).map((found) => found.code);
const textOf = (source: string) => blocksOf(source).map((block) => (block.type === "p" ? block.text : block.type));
const back = (blocks: ArticleBlock[], headingIds?: string[]) => compile(serializeBlocks(blocks, { headingIds }), headingIds);

describe("slugifyHeading", () => {
  it("lower-cases and joins letters and digits with single dashes", () => {
    expect(slugifyHeading("First, what is FSD?")).toBe("first-what-is-fsd");
    expect(slugifyHeading("  --01 | Tolls & Tickets (2026)--  ")).toBe("01-tolls-tickets-2026");
    expect(slugifyHeading("概览")).toBe("");
  });

  it("cuts long slugs at the last dash at or before position 40", () => {
    expect(slugifyHeading("A good way to try FSD for the first time")).toBe("a-good-way-to-try-fsd-for-the-first-time");
    expect(slugifyHeading("Why does the car keep reminding me to pay attention?")).toBe("why-does-the-car-keep-reminding-me-to");
    expect(slugifyHeading("4. Can every Tesla get FSD v15? What about HW3 vs. HW4?")).toBe("4-can-every-tesla-get-fsd-v15-what-about");
    expect(slugifyHeading("x".repeat(60))).toBe("x".repeat(40));
  });
});

describe("block summaries", () => {
  const blocks: ArticleBlock[] = [
    { type: "p", text: "Hello **big** world" },
    { type: "h2", id: "two-words", text: "Two words" },
    { type: "h3", text: "Three" },
    { type: "ul", items: ["a b", "c"] },
    { type: "ol", items: ["d"] },
    { type: "callout", title: "Tip", text: "e f" },
    { type: "quote", text: "g\nh" },
    { type: "table", head: ["i", "j"], rows: [["k", "l m"]] },
    { type: "figure", image: photo, alt: "not counted", caption: "n o" },
    { type: "figure", image: photo, alt: "not counted" },
    { type: "faq", items: [{ q: "p?", a: "q r" }] },
    { type: "h2", id: "last", text: "Last" },
  ];

  it("lists h2 ids and h2 and h3 texts in order", () => {
    expect(h2Ids(blocks)).toEqual(["two-words", "last"]);
    expect(headingTexts(blocks)).toEqual(["Two words", "Three", "Last"]);
  });

  it("counts words the way the website does", () => {
    expect(countWords(blocks, "en")).toBe(26);
    expect(countWords([{ type: "p", text: "你好 世界" }, { type: "figure", image: photo, alt: "不计" }, { type: "h2", id: "t", text: "标题\n两行" }], "zh")).toBe(8);
    expect(countWords([], "en")).toBe(0);
  });
});

describe("source clean-up", () => {
  it("normalizes line endings and strips a BOM", () => {
    expect(blocksOf("\uFEFF## Title\r\n\r\none\r\ntwo\rthree")).toEqual([
      { type: "h2", id: "title", text: "Title" },
      { type: "p", text: "one\ntwo\nthree" },
    ]);
  });

  it("removes HTML comments, also across lines, and keeps line numbers", () => {
    expect(textOf("before <!-- hidden --> after")).toEqual(["before  after"]);
    expect(textOf(lines("one", "<!-- note", "still hidden -->", "two"))).toEqual(["one", "two"]);
    expect(issuesOf(lines("<!--", "", "-->", "# Title", "text"))).toEqual([{ level: "warning", code: "h1", line: 4 }]);
  });

  it("keeps an escaped or unfinished comment as text", () => {
    expect(textOf("\\<!-- shown -->")).toEqual(["<!-- shown -->"]);
    expect(textOf("a <!-- open")).toEqual(["a <!-- open"]);
  });

  it("reports an empty document", () => {
    expect(compile("  \n\n<!-- nothing -->\n")).toEqual({ blocks: [], issues: [{ level: "error", code: "empty" }] });
  });
});

describe("headings", () => {
  it("maps levels two and three, bolds deeper ones and drops level one", () => {
    const result = compile(lines("# Title", "## Section", "### Part", "#### Detail", "###### Deep ######"));
    expect(result.blocks).toEqual([
      { type: "h2", id: "section", text: "Section" },
      { type: "h3", text: "Part" },
      { type: "p", text: "**Detail**" },
      { type: "p", text: "**Deep**" },
    ]);
    expect(result.issues).toEqual([{ level: "warning", code: "h1", line: 1 }]);
  });

  it("removes closing hashes but keeps a hash that belongs to a word", () => {
    expect(headingTexts(blocksOf(lines("## Closed ##", "### Learning C#", "## Issue # #", "### #1 pick")))).toEqual(["Closed", "Learning C#", "Issue #", "#1 pick"]);
  });

  it("prints heading text plain", () => {
    expect(blocksOf("## The **best** `route` to [Big Sur](/blog/big-sur) _right_ __now__ on <https://example.com>")).toEqual([
      { type: "h2", id: "the-best-route-to-big-sur-right-now-on", text: "The best route to Big Sur right now on https://example.com" },
    ]);
    expect(headingTexts(blocksOf(lines("### snake_case stays, 5 * 3 stays", "", "### [Docs][d]", "", "[d]: /docs")))).toEqual(["snake_case stays, 5 * 3 stays", "Docs"]);
  });

  it("needs a space after the hashes and at most six of them", () => {
    expect(textOf(lines("#hashtag", "", "####### seven"))).toEqual(["#hashtag", "####### seven"]);
  });

  it("rejects an empty heading", () => {
    expect(compile(lines("text", "## ", "###", "#### ##"))).toEqual({
      blocks: [{ type: "p", text: "text" }],
      issues: [
        { level: "error", code: "heading_empty", line: 2 },
        { level: "error", code: "heading_empty", line: 3 },
        { level: "error", code: "heading_empty", line: 4 },
      ],
    });
  });

  it("checks the bold paragraph of a deeper heading like any other paragraph", () => {
    expect(compile("#### https://x.y/z[a](javascript:alert(1))")).toEqual({
      blocks: [{ type: "p", text: "**https://x.y/z[a](javascript:alert(1))**" }],
      issues: [
        { level: "error", code: "link_url", line: 1, detail: "javascript:alert(1" },
        { level: "warning", code: "emphasis", line: 1 },
      ],
    });
    expect(codesOf("##### https://x.y/z[a](//example.com)")).toContain("link_url");
    expect(codesOf("#### https://x.y/z[a](#top)")).toContain("link_anchor");
    expect(codesOf("#### !`[Alt](/blog/photo.1a2b3c4d.webp)`")).toContain("image_inline");
    expect(codesOf("#### Detail ![Alt](/blog/photo.1a2b3c4d.webp)").filter((code) => code === "image_inline")).toHaveLength(1);
    for (const source of ["#### https://x.y/z[a](javascript:alert(1))", "###### https://x.y/z[a](#top)", "#### !`[Alt](/blog/photo.1a2b3c4d.webp)`"]) {
      const first = compile(source);
      expect(compile(serializeBlocks(first.blocks)), source).toEqual(first);
    }
  });
});

describe("h2 ids", () => {
  it("prefers an explicit id and removes it from the text", () => {
    expect(blocksOf("## Getting there {#the-route}", ["ignored"])).toEqual([{ type: "h2", id: "the-route", text: "Getting there" }]);
    expect(blocksOf("## Getting there ## {#the-route}")).toEqual([{ type: "h2", id: "the-route", text: "Getting there" }]);
  });

  it("leaves a malformed id in the text", () => {
    expect(blocksOf("## Getting there {#The_Route}")).toEqual([{ type: "h2", id: "getting-there-the-route", text: "Getting there {#The_Route}" }]);
  });

  it("takes the given ids by position, then the slug, then the section number", () => {
    expect(h2Ids(blocksOf(lines("## 出发前", "## 充电", "## Charging tips", "## 还车"), ["before-you-go", "", ""]))).toEqual(["before-you-go", "section-2", "charging-tips", "section-4"]);
  });

  it("counts only h2 blocks for the position", () => {
    expect(h2Ids(blocksOf(lines("### 小节", "## 第一", "#### 更小", "## 第二"), ["one", "two"]))).toEqual(["one", "two"]);
  });

  it("keeps ids unique", () => {
    const result = compile(lines("## Tips", "## Tips", "## Tips {#tips-2}", "## Other {#tips}"));
    expect(h2Ids(result.blocks)).toEqual(["tips", "tips-2", "tips-2-2", "tips-3"]);
    expect(result.issues).toEqual([
      { level: "warning", code: "duplicate_id", line: 2, detail: "tips" },
      { level: "warning", code: "duplicate_id", line: 3, detail: "tips-2" },
      { level: "warning", code: "duplicate_id", line: 4, detail: "tips" },
    ]);
  });
});

describe("thematic breaks", () => {
  it("drops them", () => {
    expect(compile(lines("a", "", "---", "", "*****", "___", "- - -", "* * *", "", "b"))).toEqual({ blocks: [{ type: "p", text: "a" }, { type: "p", text: "b" }], issues: [] });
  });

  it("needs three marks alone on the line", () => {
    expect(textOf(lines("--", "**", "--- a"))).toEqual(["--\n**\n--- a"]);
  });
});

describe("lists", () => {
  it("reads the three bullet marks as one unordered list", () => {
    expect(blocksOf(lines("- one", "* two", "+ three"))).toEqual([{ type: "ul", items: ["one", "two", "three"] }]);
  });

  it("reads numbers with a dot or a parenthesis as an ordered list", () => {
    expect(blocksOf(lines("1. one", "7) two", "3. three"))).toEqual([{ type: "ol", items: ["one", "two", "three"] }]);
  });

  it("joins indented continuation lines with a space", () => {
    expect(blocksOf(lines("- one", "  still one", "\tand more", "- two"))).toEqual([{ type: "ul", items: ["one still one and more", "two"] }]);
  });

  it("flattens nested items and warns once", () => {
    const result = compile(lines("- one", "  - inner", "    1. deeper", "- two"));
    expect(result.blocks).toEqual([{ type: "ul", items: ["one", "inner", "deeper", "two"] }]);
    expect(result.issues).toEqual([{ level: "warning", code: "nested_list", line: 2 }]);
  });

  it("keeps one list across blank lines between items", () => {
    expect(blocksOf(lines("1. one", "", "2. two", "", "", "3. three"))).toEqual([{ type: "ol", items: ["one", "two", "three"] }]);
    expect(blocksOf(lines("- one", "", "  more of one", "", "- two"))).toEqual([{ type: "ul", items: ["one more of one", "two"] }]);
  });

  it("drops hard break markers and a protecting backslash in items", () => {
    expect(blocksOf(lines("- one\\", "- \\- two  ", "- \\"))).toEqual([{ type: "ul", items: ["one", "- two", ""] }]);
  });

  it("starts a new list when the kind changes", () => {
    expect(blocksOf(lines("- a", "1. b", "2. c", "- d"))).toEqual([
      { type: "ul", items: ["a"] },
      { type: "ol", items: ["b", "c"] },
      { type: "ul", items: ["d"] },
    ]);
  });

  it("ends at a line that is neither an item nor indented", () => {
    expect(blocksOf(lines("- a", "plain", "", "- b", "---", "- c"))).toEqual([
      { type: "ul", items: ["a"] },
      { type: "p", text: "plain" },
      { type: "ul", items: ["b"] },
      { type: "ul", items: ["c"] },
    ]);
  });

  it("needs a space and some text after the marker", () => {
    expect(textOf(lines("-", "", "-dash", "", "1.5 liters", "", "2026 was busy"))).toEqual(["-", "-dash", "1.5 liters", "2026 was busy"]);
  });

  it("applies the inline rules to items", () => {
    expect(blocksOf("- see __this__ [page](https://www.moviatech.ai/en/fleet)")).toEqual([{ type: "ul", items: ["see **this** [page](/fleet)"] }]);
  });
});

describe("blockquotes", () => {
  it("joins the lines and keeps an empty quoted line", () => {
    expect(blocksOf(lines("> first", ">second", ">", ">   third"))).toEqual([{ type: "quote", text: "first\nsecond\n\nthird" }]);
  });

  it("turns quoted list markers into bullets", () => {
    expect(blocksOf(lines("> Note:", "> - one", "> * two", "> + three", "> 1. four"))).toEqual([{ type: "quote", text: "Note:\n• one\n• two\n+ three\n1. four" }]);
  });

  it("removes one level only and splits at a blank line", () => {
    expect(blocksOf(lines(">> nested", "", "> next"))).toEqual([
      { type: "quote", text: "> nested" },
      { type: "quote", text: "next" },
    ]);
  });

  it("ends at the first line without the mark", () => {
    expect(blocksOf(lines("> quoted", "plain"))).toEqual([
      { type: "quote", text: "quoted" },
      { type: "p", text: "plain" },
    ]);
  });
});

describe("tables", () => {
  it("reads a header, a separator and body rows", () => {
    expect(blocksOf(lines("| Stop | Time |", "|:-----|:----:|", "| Bishop | 1 h |", "Mammoth | 2 h", "", "after"))).toEqual([
      { type: "table", head: ["Stop", "Time"], rows: [["Bishop", "1 h"], ["Mammoth", "2 h"]] },
      { type: "p", text: "after" },
    ]);
  });

  it("trims cells and unescapes pipes", () => {
    expect(blocksOf(lines("| A \\| B |   C   |", "| --- | --- |", "|  | `x` \\| y |"))).toEqual([{ type: "table", head: ["A | B", "C"], rows: [["", "`x` | y"]] }]);
  });

  it("pads and truncates rows to the header length with one warning", () => {
    const result = compile(lines("| A | B |", "| --- | --- |", "| 1 |", "| 1 | 2 | 3 |", "| 1 | 2 |"));
    expect(result.blocks).toEqual([{ type: "table", head: ["A", "B"], rows: [["1", ""], ["1", "2"], ["1", "2"]] }]);
    expect(result.issues).toEqual([{ level: "warning", code: "table_shape", line: 3 }]);
  });

  it("stops at a line without a pipe", () => {
    expect(blocksOf(lines("| A |", "| - |", "| 1 |", "plain"))).toEqual([
      { type: "table", head: ["A"], rows: [["1"]] },
      { type: "p", text: "plain" },
    ]);
  });

  it("needs the separator row", () => {
    expect(textOf(lines("| A | B |", "| 1 | 2 |"))).toEqual(["| A | B |\n| 1 | 2 |"]);
  });

  it("applies the inline rules to cells", () => {
    expect(blocksOf(lines("| _Stop_ |", "| --- |", "| [Bishop](/zh/blog/bishop) |"))).toEqual([{ type: "table", head: ["*Stop*"], rows: [["[Bishop](/blog/bishop)"]] }]);
  });

  it("warns when the separator has another number of cells", () => {
    expect(issuesOf(lines("| A | B |", "| --- |", "| 1 | 2 |"))).toEqual([{ level: "warning", code: "table_shape", line: 2 }]);
  });

  it("reads at most 32 columns", () => {
    const row = (cell: string, count: number) => `|${` ${cell} |`.repeat(count)}`;
    expect(blocksOf(lines(row("a", 32), row("-", 32))).map((block) => block.type)).toEqual(["table"]);
    expect(blocksOf(lines(row("a", 33), row("-", 33))).map((block) => block.type)).toEqual(["p"]);
  });
});

describe("figures", () => {
  it("reads an image that is alone on its line", () => {
    expect(blocksOf("![A car on the coast](/blog/photo.1a2b3c4d.webp)")).toStrictEqual([{ type: "figure", image: photo, alt: "A car on the coast" }]);
  });

  it("takes the caption from the title", () => {
    expect(blocksOf('![Alt](/blog/photo.1a2b3c4d.webp "Golden hour")')).toStrictEqual([{ type: "figure", image: photo, alt: "Alt", caption: "Golden hour" }]);
    expect(blocksOf("![Alt]( /blog/photo.1a2b3c4d.webp  'Golden hour' )")).toStrictEqual([{ type: "figure", image: photo, alt: "Alt", caption: "Golden hour" }]);
    expect(blocksOf("![Alt](/blog/photo.1a2b3c4d.webp (Golden hour))")).toStrictEqual([{ type: "figure", image: photo, alt: "Alt", caption: "Golden hour" }]);
    expect(blocksOf("  ![Alt](/blog/photo.1a2b3c4d.webp )  ")).toStrictEqual([{ type: "figure", image: photo, alt: "Alt" }]);
  });

  it("prefers an emphasised line right below", () => {
    expect(blocksOf(lines('![Alt](/blog/photo.1a2b3c4d.webp "Title")', "*Line below*", "", "![Alt](/blog/photo.1a2b3c4d.webp)", "_Under_score_"))).toStrictEqual([
      { type: "figure", image: photo, alt: "Alt", caption: "Line below" },
      { type: "figure", image: photo, alt: "Alt" },
      { type: "p", text: "*Under_score*" },
    ]);
    expect(blocksOf(lines("![Alt](/blog/photo.1a2b3c4d.webp)", "_Under_"))).toStrictEqual([{ type: "figure", image: photo, alt: "Alt", caption: "Under" }]);
  });

  it("does not take a caption across a blank line", () => {
    expect(blocksOf(lines("![Alt](/blog/photo.1a2b3c4d.webp)", "", "*Not a caption*"))).toStrictEqual([
      { type: "figure", image: photo, alt: "Alt" },
      { type: "p", text: "*Not a caption*" },
    ]);
  });

  it("unescapes brackets in the alt text and quotes in the caption", () => {
    expect(blocksOf('![Sign \\[A\\] ahead](/blog/photo.1a2b3c4d.webp "The \\"EXIT ONLY\\" panel")')).toStrictEqual([{ type: "figure", image: photo, alt: "Sign [A] ahead", caption: 'The "EXIT ONLY" panel' }]);
  });

  it("passes the source to the lookup as written", () => {
    const seen: string[] = [];
    const lookup = (src: string) => {
      seen.push(src);
      return photo;
    };
    compileMarkdown(lines("![a](/blog/photo.1a2b3c4d.webp)", "", "![b](https://cdn.example.com/x_(1).png?w=2)", "", "![c](</blog/wide shot (1).webp>)"), { locale: "zh", images: lookup });
    expect(seen).toEqual(["/blog/photo.1a2b3c4d.webp", "https://cdn.example.com/x_(1).png?w=2", "/blog/wide shot (1).webp"]);
  });

  it("reports an unknown image and emits no block", () => {
    expect(compile(lines("![Alt](/blog/missing.webp)", "*caption*", "", "text"))).toEqual({
      blocks: [{ type: "p", text: "text" }],
      issues: [{ level: "error", code: "image_unknown", line: 1, detail: "/blog/missing.webp" }],
    });
  });

  it("treats a failing lookup as an unknown image", () => {
    const result = compileMarkdown("![Alt](/x.webp)", {
      locale: "en",
      images: () => {
        throw new Error("lookup failed");
      },
    });
    expect(result.issues.map((found) => found.code)).toEqual(["image_unknown", "empty"]);
  });

  it("reports an empty alt text and still emits the block", () => {
    expect(compile("![ ](/blog/photo.1a2b3c4d.webp)")).toEqual({
      blocks: [{ type: "figure", image: photo, alt: "" }],
      issues: [{ level: "error", code: "image_alt", line: 1 }],
    });
  });

  it("rejects an image inside other text", () => {
    expect(compile(lines("intro", "Look ![Alt](/blog/photo.1a2b3c4d.webp) here", "", "- ![Alt](/blog/photo.1a2b3c4d.webp)"))).toEqual({
      blocks: [
        { type: "p", text: "intro\nLook ![Alt](/blog/photo.1a2b3c4d.webp) here" },
        { type: "ul", items: ["![Alt](/blog/photo.1a2b3c4d.webp)"] },
      ],
      issues: [
        { level: "error", code: "image_inline", line: 2, detail: "/blog/photo.1a2b3c4d.webp" },
        { level: "error", code: "image_inline", line: 4, detail: "/blog/photo.1a2b3c4d.webp" },
      ],
    });
    expect(issuesOf("## Title ![Alt](/blog/photo.1a2b3c4d.webp)")).toEqual([{ level: "error", code: "image_inline", line: 1, detail: "/blog/photo.1a2b3c4d.webp" }]);
  });

  it("rejects an image that is wrapped in a link", () => {
    const linked = "[![Alt](/blog/photo.1a2b3c4d.webp)](https://example.com)";
    expect(compile(linked)).toEqual({
      blocks: [{ type: "p", text: linked }],
      issues: [{ level: "error", code: "image_inline", line: 1, detail: "/blog/photo.1a2b3c4d.webp" }],
    });
    expect(issuesOf(lines("intro", "See [the ![Alt](/blog/photo.1a2b3c4d.webp) picture](/fleet) here"))).toEqual([{ level: "error", code: "image_inline", line: 2, detail: "/blog/photo.1a2b3c4d.webp" }]);
    expect(codesOf("### [![Alt](/blog/photo.1a2b3c4d.webp)](/fleet)")).toEqual(["image_inline"]);
    expect(compile("[not an image!](/fleet) and [a [b](/fleet)")).toEqual({ blocks: [{ type: "p", text: "[not an image!](/fleet) and [a [b](/fleet)" }], issues: [] });
  });

  it("rejects an image without alt text inside other text", () => {
    expect(compile("Look ![](/blog/photo.1a2b3c4d.webp) here")).toEqual({
      blocks: [{ type: "p", text: "Look ![](/blog/photo.1a2b3c4d.webp) here" }],
      issues: [{ level: "error", code: "image_inline", line: 1, detail: "/blog/photo.1a2b3c4d.webp" }],
    });
    expect(codesOf("- ![](/blog/photo.1a2b3c4d.webp \"Caption\")")).toEqual(["image_inline"]);
    expect(codesOf("[![](/blog/photo.1a2b3c4d.webp)](/fleet)")).toEqual(["image_inline"]);
    expect(compile("a ![] b ![][] c ![]( d")).toEqual({ blocks: [{ type: "p", text: "a ![] b ![][] c ![]( d" }], issues: [] });
  });
});

describe("containers", () => {
  it("builds a callout from the inner lines joined with a space", () => {
    expect(compile(lines(":::callout Good to know", "Tolls are billed later.", "", "  Ask __us__ on [the contact page](/zh/contact).  ", ":::", "after"))).toEqual({
      blocks: [
        { type: "callout", title: "Good to know", text: "Tolls are billed later. Ask **us** on [the contact page](/contact)." },
        { type: "p", text: "after" },
      ],
      issues: [],
    });
  });

  it("reports a callout without a title and still emits it", () => {
    expect(compile(lines(":::callout", "text", ":::"))).toEqual({
      blocks: [{ type: "callout", title: "", text: "text" }],
      issues: [{ level: "error", code: "callout_title", line: 1 }],
    });
  });

  it("does not read blocks inside a callout", () => {
    expect(blocksOf(lines(":::callout Note", "- not a list", "## not a heading", ":::"))).toEqual([{ type: "callout", title: "Note", text: "- not a list ## not a heading" }]);
  });

  it("builds FAQ entries from level-three headings and their answer lines", () => {
    expect(compile(lines(":::faq", "### Can I charge there?", "Yes.", "Superchargers are nearby.", "", "Bring a card.", "", "### Is **FSD** included? ###", "", "Yes, with `supervision`.", ":::"))).toEqual({
      blocks: [
        {
          type: "faq",
          items: [
            { q: "Can I charge there?", a: "Yes.\nSuperchargers are nearby.\n\nBring a card." },
            { q: "Is FSD included?", a: "Yes, with `supervision`." },
          ],
        },
      ],
      issues: [],
    });
  });

  it("reports FAQ entries that miss a question or an answer", () => {
    const result = compile(lines(":::faq", "stray answer", "###", "answer", "### Question only", ":::", "", ":::faq", ":::"));
    expect(result.blocks).toEqual([{ type: "faq", items: [{ q: "", a: "stray answer" }, { q: "", a: "answer" }, { q: "Question only", a: "" }] }]);
    expect(result.issues).toEqual([
      { level: "error", code: "faq_entry", line: 2 },
      { level: "error", code: "heading_empty", line: 3 },
      { level: "error", code: "faq_entry", line: 5 },
      { level: "error", code: "faq_entry", line: 8 },
    ]);
  });

  it("warns about an unknown container and compiles its content normally", () => {
    expect(compile(lines(":::note Heads up", "## Inside", "- item", ":::", "after"))).toEqual({
      blocks: [
        { type: "h2", id: "inside", text: "Inside" },
        { type: "ul", items: ["item"] },
        { type: "p", text: "after" },
      ],
      issues: [{ level: "warning", code: "container", line: 1, detail: "note" }],
    });
  });

  it("reports a container that is never closed and closes it at the end", () => {
    expect(compile(lines("intro", ":::callout Tip", "text"))).toEqual({
      blocks: [
        { type: "p", text: "intro" },
        { type: "callout", title: "Tip", text: "text" },
      ],
      issues: [{ level: "error", code: "container_open", line: 2 }],
    });
    expect(codesOf(lines(":::faq", "### Q", "A"))).toEqual(["container_open"]);
    expect(issuesOf(lines(":::note", "text"))).toEqual([
      { level: "warning", code: "container", line: 1, detail: "note" },
      { level: "error", code: "container_open", line: 1 },
    ]);
  });

  it("warns about a closing line with nothing open", () => {
    expect(compile(lines("text", ":::"))).toEqual({ blocks: [{ type: "p", text: "text" }], issues: [{ level: "warning", code: "container", line: 2 }] });
  });

  it("closes a callout before the unknown container around it", () => {
    expect(compile(lines("::: tip", ":::Callout Inside", "text", ":::", ":::", "after"))).toEqual({
      blocks: [
        { type: "callout", title: "Inside", text: "text" },
        { type: "p", text: "after" },
      ],
      issues: [{ level: "warning", code: "container", line: 1, detail: "tip" }],
    });
  });
});

describe("code blocks and HTML", () => {
  it("turns a fenced block into one paragraph of code lines", () => {
    expect(compile(lines("```js", "const a = 1;", "", "  indent();", "```", "", "~~~", "x_y_z", "~~~"))).toEqual({
      blocks: [
        { type: "p", text: "`const a = 1;`\n\n`  indent();`" },
        { type: "p", text: "`x_y_z`" },
      ],
      issues: [
        { level: "warning", code: "code_block", line: 1 },
        { level: "warning", code: "code_block", line: 7 },
      ],
    });
  });

  it("reads to the end when the fence is not closed", () => {
    expect(textOf(lines("```", "## not a heading", "[ref]: /not-a-definition"))).toEqual(["`## not a heading`\n`[ref]: /not-a-definition`"]);
  });

  it("keeps a line that starts with an HTML tag and warns", () => {
    expect(compile(lines("<div class=\"x\">box</div>", "plain <b>inline</b>", "</section>", "", "<https://example.com>", "", "a < b"))).toEqual({
      blocks: [
        { type: "p", text: "<div class=\"x\">box</div>\nplain <b>inline</b>\n</section>" },
        { type: "p", text: "[https://example.com](https://example.com)" },
        { type: "p", text: "a < b" },
      ],
      issues: [
        { level: "warning", code: "html", line: 1 },
        { level: "warning", code: "html", line: 3 },
      ],
    });
  });
});

describe("paragraphs", () => {
  it("joins consecutive lines with a newline and trims each one", () => {
    expect(textOf(lines("  **Q: Is it far?**  ", "\tNot really.", "", "Next"))).toEqual(["**Q: Is it far?**\nNot really.", "Next"]);
  });

  it("removes hard break markers", () => {
    expect(textOf(lines("two spaces  ", "backslash\\", "last\\"))).toEqual(["two spaces\nbackslash\nlast"]);
  });

  it("drops one leading backslash in front of punctuation or a digit", () => {
    expect(textOf(lines("\\# not a heading", "\\- not a list", "\\1. not a list", "\\> not a quote", "\\\\server", "\\alpha stays"))).toEqual(["# not a heading\n- not a list\n1. not a list\n> not a quote\n\\server\n\\alpha stays"]);
  });

  it("reads a lone backslash as an empty line inside the paragraph", () => {
    expect(textOf(lines("above", "\\", "below", "\\"))).toEqual(["above\n\nbelow"]);
  });

  it("ends at any other construct", () => {
    expect(textOf(lines("text", "## Heading", "text", "> quote", "text", "- item", "text", "![Alt](/blog/photo.1a2b3c4d.webp)", "text", "```", "code", "```", "text", ":::callout T", ":::", "text", "| a |", "| - |"))).toEqual(["text", "h2", "text", "quote", "text", "ul", "text", "figure", "text", "`code`", "text", "callout", "text", "table"]);
  });
});

describe("inline normalizations", () => {
  it("rewrites underscore emphasis", () => {
    expect(textOf("__bold__ and _em_, (_both_) 这是_重点_内容")).toEqual(["**bold** and *em*, (*both*) 这是*重点*内容"]);
  });

  it("leaves underscores inside words, URLs and code alone", () => {
    const source = "snake_case_name, file_name.txt, café_au_lait, https://example.com/a_b_/_c_ and `_code_` [x](/a_b_/_c_)";
    expect(textOf(source)).toEqual([source]);
  });

  it("reduces bold italic to bold", () => {
    expect(textOf("***both*** **_mixed_** _**other**_ __*way*__ *__more__*")).toEqual(["**both** **mixed** **other** **way** **more**"]);
  });

  it("drops link titles", () => {
    expect(textOf("[a](https://example.com \"Title\") [b](/x 'T') [c](/y (T))")).toEqual(["[a](https://example.com) [b](/x) [c](/y)"]);
  });

  it("turns autolinks into links", () => {
    expect(textOf("See <https://example.com/a?b=1> and <http://example.org>.")).toEqual(["See [https://example.com/a?b=1](https://example.com/a?b=1) and [http://example.org](http://example.org)."]);
  });

  it("resolves reference links and removes the definitions", () => {
    const result = compile(lines("[Docs][docs], [Tesla][] and [again][DOCS].", "", "[docs]: https://example.com/docs \"Docs\"", "[tesla]: <https://www.tesla.com>", "", "end"));
    expect(result.blocks).toEqual([
      { type: "p", text: "[Docs](https://example.com/docs), [Tesla](https://www.tesla.com) and [again](https://example.com/docs)." },
      { type: "p", text: "end" },
    ]);
    expect(result.issues).toEqual([]);
  });

  it("keeps a reference without a definition and warns", () => {
    expect(compile(lines("first", "See [the guide][guide] and [more][].", "", "[注]: 这一行不是定义"))).toEqual({
      blocks: [
        { type: "p", text: "first\nSee [the guide][guide] and [more][]." },
        { type: "p", text: "[注]: 这一行不是定义" },
      ],
      issues: [
        { level: "warning", code: "ref_missing", line: 2, detail: "guide" },
        { level: "warning", code: "ref_missing", line: 2, detail: "more" },
      ],
    });
  });

  it("reads a reference from its innermost bracket", () => {
    expect(compile(lines("[note [Docs][docs] and [more [again][]", "", "[docs]: /docs"))).toEqual({
      blocks: [{ type: "p", text: "[note [Docs](/docs) and [more [again][]" }],
      issues: [{ level: "warning", code: "ref_missing", line: 1, detail: "again" }],
    });
  });

  it("writes a resolved reference inline even when its target is rejected", () => {
    expect(compile(lines("[a][bad]", "", "[bad]: //example.com"))).toEqual({
      blocks: [{ type: "p", text: "[a](//example.com)" }],
      issues: [{ level: "error", code: "link_url", line: 1, detail: "//example.com" }],
    });
  });

  it("leaves text that only looks like markup", () => {
    const source = "I rent a [model and year] from [date] to [date]; 5 * 3 = 15, a_b, C:\\dir and 100%.";
    expect(compile(source)).toEqual({ blocks: [{ type: "p", text: source }], issues: [] });
  });
});

describe("links", () => {
  it("turns website URLs into paths without the locale", () => {
    expect(textOf("[a](https://www.moviatech.ai/zh/blog/x) [b](https://moviatech.ai/en) [c](http://moviatech.ai) [d](https://www.moviatech.ai/vehicles/model-y?x=1#top) [e](https://moviatech.ai?ref=1)")).toEqual([
      "[a](/blog/x) [b](/) [c](/) [d](/vehicles/model-y?x=1#top) [e](/?ref=1)",
    ]);
  });

  it("strips a leading locale from paths", () => {
    expect(textOf("[a](/zh/blog/x) [b](/en/) [c](/zh) [d](/en?x=1) [e](/english) [f](/blog/zh/x)")).toEqual(["[a](/blog/x) [b](/) [c](/) [d](/?x=1) [e](/english) [f](/blog/zh/x)"]);
  });

  it("leaves other hosts alone", () => {
    const source = "[a](https://account.moviatech.ai/pay) [b](https://moviatech.ai.example.com/zh/x) [c](https://example.com/zh/x)";
    expect(compile(source)).toEqual({ blocks: [{ type: "p", text: source }], issues: [] });
  });

  it("allows paths, web addresses, mail and phone links", () => {
    const source = "[a](/fleet) [b](https://example.com) [c](http://example.com) [d](mailto:hello@moviatech.ai) [e](tel:+18776966842)";
    expect(compile(source)).toEqual({ blocks: [{ type: "p", text: source }], issues: [] });
  });

  it("allows an in-page anchor with a warning", () => {
    expect(compile("[top](#top)")).toEqual({ blocks: [{ type: "p", text: "[top](#top)" }], issues: [{ level: "warning", code: "link_anchor", line: 1, detail: "#top" }] });
  });

  it("rejects every other target and keeps the text as written", () => {
    const source = lines("[a](javascript:alert(1))", "[b](data:text/html,x)", "[c](relative/path)", "[d]()", "[e](//example.com)", "[f](/\\example.com)", "[g](www.example.com \"t\")", "[h](/has space)", "[i](https://)");
    const result = compile(source);
    expect(result.blocks).toEqual([{ type: "p", text: source }]);
    expect(result.issues).toEqual([
      { level: "error", code: "link_url", line: 1, detail: "javascript:alert(1)" },
      { level: "error", code: "link_url", line: 2, detail: "data:text/html,x" },
      { level: "error", code: "link_url", line: 3, detail: "relative/path" },
      { level: "error", code: "link_url", line: 4, detail: "" },
      { level: "error", code: "link_url", line: 5, detail: "//example.com" },
      { level: "error", code: "link_url", line: 6, detail: "/\\example.com" },
      { level: "error", code: "link_url", line: 7, detail: "www.example.com" },
      { level: "error", code: "link_url", line: 8, detail: "/has space" },
      { level: "error", code: "link_url", line: 9, detail: "https://" },
    ]);
  });

  it("encodes parentheses and spaces so that the website reads the whole address", () => {
    expect(textOf("[wiki](https://en.wikipedia.org/wiki/Big_Sur_(California)) [file](</files/price list.pdf>)")).toEqual(["[wiki](https://en.wikipedia.org/wiki/Big_Sur_%28California%29) [file](/files/price%20list.pdf)"]);
  });

  it("checks a link that the website would find inside code", () => {
    expect(compile("`call[0](x)` and `[ok](/fine)`")).toEqual({
      blocks: [{ type: "p", text: "`call[0](x)` and `[ok](/fine)`" }],
      issues: [{ level: "error", code: "link_url", line: 1, detail: "x" }],
    });
  });

  it("orders issues by line", () => {
    expect(issuesOf(lines("- [a](nowhere)", "  - nested", "<b>bold</b> [b](#here)", "[c](also-nowhere)")).map((found) => [found.line, found.code])).toEqual([
      [1, "link_url"],
      [2, "nested_list"],
      [3, "html"],
      [3, "link_anchor"],
      [4, "link_url"],
    ]);
  });
});

describe("emphasis warning", () => {
  it("flags bold that the website would print with its stars", () => {
    expect(issuesOf(lines("fine", "", "**The drive *is* the good part.**"))).toEqual([{ level: "warning", code: "emphasis", line: 3 }]);
    expect(codesOf("**[bold link](/x)**")).toEqual(["emphasis"]);
    expect(codesOf("an unclosed **bold")).toEqual(["emphasis"]);
    expect(codesOf("- [**bold** label](/x)")).toEqual(["emphasis"]);
    expect(codesOf("#### 5 * 3")).toEqual(["emphasis"]);
  });

  it("stays quiet for text that renders or is clearly not markup", () => {
    for (const source of ["**bold** and *em* and `**code**`", "card ending in **** 1234", "5 * 3 and 2 ** 8", "***both***", "a * b ** c", "**", lines("**bold over", "two lines**")]) expect(codesOf(source), source).toEqual([]);
  });

  it("reports once per block, at its first line", () => {
    expect(issuesOf(lines("plain", "**a *b* c** and **d *e* f**", "", "> ok", "> an unclosed **bold"))).toEqual([
      { level: "warning", code: "emphasis", line: 1 },
      { level: "warning", code: "emphasis", line: 4 },
    ]);
  });
});

describe("serializeBlocks", () => {
  const article: ArticleBlock[] = [
    { type: "p", text: "Intro with **bold**, *em*, `code` and a [link](/vehicles)." },
    { type: "h2", id: "plan-the-route", text: "Plan the route" },
    { type: "p", text: "**Q: Is it far?**\nNot really." },
    { type: "h3", text: "1. Before you go" },
    { type: "ul", items: ["**Charge** to 80%", "Pack `snacks`"] },
    { type: "ol", items: ["Start early", "Stop often"] },
    { type: "callout", title: "Good to know", text: "Tolls are billed later. [Contact us](/contact)" },
    { type: "quote", text: "**Checked: today.**\n\n• One\n• Two" },
    { type: "table", head: ["Stop", "Time"], rows: [["`A`", "1 h"], ["B | C", ""]] },
    { type: "figure", image: photo, alt: "A car on the coast", caption: 'Shot in "golden hour".' },
    { type: "figure", image: wide, alt: "Wide shot" },
    { type: "h2", id: "custom-id", text: "FAQ & more" },
    { type: "faq", items: [{ q: "Can I charge there?", a: "Yes.\nSuperchargers are nearby.\n\nBring a card." }, { q: "Is FSD included?", a: "Yes, FSD (Supervised)." }] },
  ];

  const markdown = lines(
    "Intro with **bold**, *em*, `code` and a [link](/vehicles).",
    "",
    "## Plan the route",
    "",
    "**Q: Is it far?**",
    "Not really.",
    "",
    "### 1. Before you go",
    "",
    "- **Charge** to 80%",
    "- Pack `snacks`",
    "",
    "1. Start early",
    "2. Stop often",
    "",
    ":::callout Good to know",
    "Tolls are billed later. [Contact us](/contact)",
    ":::",
    "",
    "> **Checked: today.**",
    ">",
    "> • One",
    "> • Two",
    "",
    "| Stop | Time |",
    "| --- | --- |",
    "| `A` | 1 h |",
    "| B \\| C |  |",
    "",
    '![A car on the coast](/blog/photo.1a2b3c4d.webp "Shot in \\"golden hour\\".")',
    "",
    "![Wide shot](</blog/wide shot (1).webp>)",
    "",
    "## FAQ & more {#custom-id}",
    "",
    ":::faq",
    "### Can I charge there?",
    "Yes.",
    "Superchargers are nearby.",
    "",
    "Bring a card.",
    "",
    "### Is FSD included?",
    "Yes, FSD (Supervised).",
    ":::",
  );

  it("writes every block type in the dialect, separated by one blank line", () => {
    expect(serializeBlocks(article)).toBe(markdown);
  });

  it("compiles back to the same blocks without issues", () => {
    const result = compile(markdown);
    expect(result.blocks).toStrictEqual(article);
    expect(result.issues).toEqual([]);
  });

  it("writes an id only when it differs from the default", () => {
    const blocks: ArticleBlock[] = [
      { type: "h2", id: "tips", text: "Tips" },
      { type: "h2", id: "tips-2", text: "Tips" },
      { type: "h2", id: "section-3", text: "概览" },
      { type: "h2", id: "overview", text: "概览" },
      { type: "h2", id: "tips-3", text: "More" },
    ];
    expect(serializeBlocks(blocks)).toBe(lines("## Tips", "", "## Tips", "", "## 概览", "", "## 概览 {#overview}", "", "## More {#tips-3}"));
    expect(back(blocks)).toEqual({ blocks, issues: [{ level: "warning", code: "duplicate_id", line: 3, detail: "tips" }] });
  });

  it("uses the given ids as the default", () => {
    const blocks: ArticleBlock[] = [
      { type: "h2", id: "before-you-go", text: "出发前" },
      { type: "h2", id: "own-id", text: "充电" },
      { type: "h2", id: "return", text: "还车" },
    ];
    const mirror = ["before-you-go", "charging", "return"];
    expect(serializeBlocks(blocks, { headingIds: mirror })).toBe(lines("## 出发前", "", "## 充电 {#own-id}", "", "## 还车"));
    expect(back(blocks, mirror)).toEqual({ blocks, issues: [] });
    expect(serializeBlocks(blocks)).toBe(lines("## 出发前 {#before-you-go}", "", "## 充电 {#own-id}", "", "## 还车 {#return}"));
  });

  it("protects heading text that ends like closing hashes or an id", () => {
    const blocks: ArticleBlock[] = [
      { type: "h2", id: "c", text: "C #" },
      { type: "h2", id: "use-tag", text: "Use {#tag}" },
      { type: "h3", text: "###" },
      { type: "h3", text: "Learning C#" },
    ];
    expect(serializeBlocks(blocks)).toBe(lines("## C # #", "", "## Use {#tag} {#use-tag}", "", "### ### #", "", "### Learning C#"));
    expect(back(blocks)).toEqual({ blocks, issues: [] });
  });

  it("keeps heading text that ends like an id when the block has no usable id", () => {
    const blocks: ArticleBlock[] = [
      { type: "h2", id: "Not_A_Slug", text: "Use {#tag}" },
      { type: "h2", id: "", text: "概览 {#tag}" },
    ];
    expect(serializeBlocks(blocks)).toBe(lines("## Use {#tag} {#use-tag}", "", "## 概览 {#tag} {#tag}"));
    expect(back(blocks)).toEqual({
      blocks: [
        { type: "h2", id: "use-tag", text: "Use {#tag}" },
        { type: "h2", id: "tag", text: "概览 {#tag}" },
      ],
      issues: [],
    });
  });

  it("protects paragraph lines that would start another construct", () => {
    const text = lines("# heading", "- item", "* item", "+ item", "1. item", "2) item", "> quote", "| a | b |", "| --- | --- |", ":::callout T", ":::", "---", "***", "```", "~~~", "[ref]: /definition", "\\- escaped", "ends with a backslash\\", "", "plain #hashtag and 1.5 liters");
    const source = serializeBlocks([{ type: "p", text }]);
    expect(source).toBe(lines("\\# heading", "\\- item", "\\* item", "\\+ item", "\\1. item", "\\2) item", "\\> quote", "| a | b |", "\\| --- | --- |", "\\:::callout T", "\\:::", "\\---", "\\***", "\\```", "\\~~~", "\\[ref]: /definition", "\\\\- escaped", "ends with a backslash\\\\", "\\", "plain #hashtag and 1.5 liters"));
    expect(compile(source)).toEqual({ blocks: [{ type: "p", text }], issues: [] });
  });

  it("protects an image line and an HTML comment inside a paragraph", () => {
    const blocks: ArticleBlock[] = [{ type: "p", text: "![Alt](/blog/photo.1a2b3c4d.webp)\nkeep <!-- this --> text" }];
    expect(serializeBlocks(blocks)).toBe(lines("\\![Alt](/blog/photo.1a2b3c4d.webp)", "keep \\<!-- this --> text"));
    expect(back(blocks).blocks).toEqual(blocks);
  });

  it("protects list items, quote lines, callout text and answers", () => {
    const blocks: ArticleBlock[] = [
      { type: "ul", items: ["- -", "--", "", "\\*", "# not a heading", "1. kept"] },
      { type: "ol", items: ["- kept", "***", "ends\\"] },
      { type: "quote", text: "- dash\n* star\n• bullet\n\n> deeper\n\\#\n1. kept" },
      { type: "callout", title: "Title: with punctuation", text: ":::" },
      { type: "callout", title: "T", text: "[ref]: /definition" },
      { type: "faq", items: [{ q: "Q #", a: "### not a question\n:::\n\n[ref]: /definition\nlast\\" }] },
    ];
    expect(serializeBlocks(blocks)).toBe(
      lines(
        "- \\- -",
        "- \\--",
        "- \\",
        "- \\\\*",
        "- # not a heading",
        "- 1. kept",
        "",
        "1. - kept",
        "2. ***",
        "3. ends\\\\",
        "",
        "> \\- dash",
        "> \\* star",
        "> • bullet",
        ">",
        "> > deeper",
        "> \\\\#",
        "> 1. kept",
        "",
        ":::callout Title: with punctuation",
        "\\:::",
        ":::",
        "",
        ":::callout T",
        "\\[ref]: /definition",
        ":::",
        "",
        ":::faq",
        "### Q # #",
        "\\### not a question",
        "\\:::",
        "",
        "\\[ref]: /definition",
        "last\\\\",
        ":::",
      ),
    );
    expect(back(blocks)).toEqual({ blocks, issues: [] });
  });

  it("escapes pipes in cells and keeps empty cells", () => {
    const blocks: ArticleBlock[] = [
      { type: "table", head: ["a|b", "", "\\"], rows: [["\\|", "x\\", "|"], ["", "", ""]] },
      { type: "table", head: ["One"], rows: [] },
    ];
    expect(serializeBlocks(blocks)).toBe(lines("| a\\|b |  | \\ |", "| --- | --- | --- |", "| \\\\| | x\\ | \\| |", "|  |  |  |", "", "| One |", "| --- |"));
    expect(back(blocks)).toEqual({ blocks, issues: [] });
  });

  it("escapes brackets, quotes and backslashes in figures", () => {
    const blocks: ArticleBlock[] = [{ type: "figure", image: photo, alt: "Sign [A] \\ [more](x)", caption: 'The "EXIT" \\ panel' }];
    expect(serializeBlocks(blocks)).toBe('![Sign [A\\] \\\\ [more\\](x)](/blog/photo.1a2b3c4d.webp "The \\"EXIT\\" \\\\ panel")');
    expect(back(blocks).blocks).toStrictEqual(blocks);
  });

  it("keeps two neighbouring lists of the same kind apart", () => {
    const blocks: ArticleBlock[] = [
      { type: "ul", items: ["a"] },
      { type: "ul", items: ["b"] },
      { type: "ol", items: ["c"] },
      { type: "ol", items: ["d"] },
    ];
    expect(serializeBlocks(blocks)).toBe(lines("- a", "", "---", "", "- b", "", "1. c", "", "---", "", "1. d"));
    expect(back(blocks)).toEqual({ blocks, issues: [] });
  });

  it("keeps a paragraph after a figure from becoming its caption", () => {
    const blocks: ArticleBlock[] = [
      { type: "figure", image: photo, alt: "Alt" },
      { type: "p", text: "*Not a caption*" },
    ];
    expect(back(blocks).blocks).toStrictEqual(blocks);
  });

  it("settles text that the dialect cannot express on one stable form", () => {
    const blocks: ArticleBlock[] = [
      { type: "h2", id: "this-is-that-bridge", text: "This is *that* bridge" },
      { type: "callout", title: " Two\nlines ", text: "first\nsecond" },
      { type: "ul", items: ["one\ntwo"] },
      { type: "p", text: "  padded  \n\n" },
      { type: "p", text: "" },
      { type: "table", head: ["a\nb"], rows: [["c"]] },
      { type: "figure", image: photo, alt: " Alt\ntext ", caption: "" },
    ];
    const settled: ArticleBlock[] = [
      { type: "h2", id: "this-is-that-bridge", text: "This is that bridge" },
      { type: "callout", title: "Two lines", text: "first second" },
      { type: "ul", items: ["one two"] },
      { type: "p", text: "padded" },
      { type: "table", head: ["a b"], rows: [["c"]] },
      { type: "figure", image: photo, alt: "Alt text" },
    ];
    expect(back(blocks)).toEqual({ blocks: settled, issues: [] });
    expect(back(settled)).toEqual({ blocks: settled, issues: [] });
    expect(serializeBlocks([])).toBe("");
  });
});

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe("robustness", () => {
  const scraps = ["a", "b", " ", " ", "\n", "\n\n", "\n  ", "*", "**", "***", "_", "__", "_a_", "`", "```", "~~~", "[", "]", "(", ")", "![", "](", "<", ">", "|", "| --- |", "-", "- ", "1. ", "> ", "#", "## ", "### ", ":::", ":::callout T", ":::faq", "\\", "<!--", "-->", "{#a-b}", "\n[a]: /b\n", "[a][b]", "[a](/b)", "https://x.y/z_w", "<https://x.y>", "/zh/", '"t"', "中", "é", "\t", "---", "![a](/blog/photo.1a2b3c4d.webp)", "*c*", "javascript:x"];

  it("never throws on arbitrary input and settles after one round", () => {
    const next = seeded(20261123);
    for (let round = 0; round < 600; round += 1) {
      let source = "";
      for (let count = 1 + Math.floor(next() * 40); count > 0; count -= 1) source += scraps[Math.floor(next() * scraps.length)];
      const first = compile(source);
      const total = source.split("\n").length;
      for (const found of first.issues) expect(found.line === undefined || (found.line >= 1 && found.line <= total), source).toBe(true);
      const again = compile(serializeBlocks(first.blocks));
      expect(again.blocks, source).toStrictEqual(first.blocks);
      expect(serializeBlocks(again.blocks), source).toBe(serializeBlocks(first.blocks));
    }
  });

  it("round-trips arbitrary blocks whose text needs no inline changes", () => {
    const next = seeded(780);
    const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
    const word = (chars: string[], max: number) => {
      for (;;) {
        let out = "";
        for (let count = 1 + Math.floor(next() * max); count > 0; count -= 1) out += pick(chars);
        if (out.trim() && !out.includes("***")) return out.trim();
      }
    };
    const body = ["a", "b", "中", "0", "1", "2", "#", ">", "-", "+", "*", ".", ")", "|", ":", "~", "\\", "=", "!", "[", "]", "<", "`", " ", " "];
    const title = ["a", "b", "中", "0", "1", "#", "{", "}", "-", "|", ".", ":", ")", ">", "+", "~", "\\", "=", " ", " "];
    const rows = () => {
      const count = 1 + Math.floor(next() * 4);
      return Array.from({ length: count }, (_, index) => (index > 0 && index < count - 1 && next() < 0.25 ? "" : word(body, 12))).join("\n");
    };
    const makers: Array<() => ArticleBlock> = [
      () => ({ type: "p", text: rows() }),
      () => ({ type: "h2", id: `id-${Math.floor(next() * 1e9)}`, text: word(title, 10) }),
      () => ({ type: "h3", text: word(title, 10) }),
      () => ({ type: "ul", items: Array.from({ length: 1 + Math.floor(next() * 4) }, () => word(body, 12)) }),
      () => ({ type: "ol", items: Array.from({ length: 1 + Math.floor(next() * 4) }, () => word(body, 12)) }),
      () => ({ type: "callout", title: word(body, 6), text: word(body, 20) }),
      () => ({ type: "quote", text: rows() }),
      () => ({ type: "table", head: [word(body, 6), word(body, 6)], rows: Array.from({ length: Math.floor(next() * 3) }, () => [next() < 0.3 ? "" : word(body, 6), word(body, 6)]) }),
      () => ({ type: "figure", image: pick([photo, wide]), alt: word(body, 8), caption: word([...body, '"', "'"], 8) }),
      () => ({ type: "figure", image: photo, alt: word(body, 8) }),
      () => ({ type: "faq", items: Array.from({ length: 1 + Math.floor(next() * 3) }, () => ({ q: word(title, 10), a: rows() })) }),
    ];
    for (let round = 0; round < 400; round += 1) {
      const blocks = Array.from({ length: 1 + Math.floor(next() * 6) }, () => pick(makers)());
      const source = serializeBlocks(blocks);
      const result = compile(source);
      expect(result.blocks, source).toStrictEqual(blocks);
      expect(result.issues.filter((found) => found.level === "error"), source).toEqual([]);
    }
  });

  it("compiles 200 KB of hostile input in under a second", () => {
    const size = 200_000;
    const next = seeded(7);
    const marks = ["*", "[", "|", ">", " "];
    const blend = (longest: number, extra: string[] = []) => {
      let out = "";
      while (out.length < size) out += [...marks, ...extra][Math.floor(next() * (marks.length + extra.length))].repeat(1 + Math.floor(next() * longest));
      return out.slice(0, size);
    };
    const fill = (unit: string) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
    const inputs = [
      ...marks.map((mark) => mark.repeat(size)),
      blend(1),
      blend(30),
      blend(5000),
      blend(30, ["\n"]),
      blend(3, ["\n", "]", "(", ")", "_", "`", "!", "<", "-", "#", ":", "\\", '"', "a", "1. ", "https://"]),
      fill("[a]("),
      fill("**a *b* "),
      fill("_a "),
      fill("***a"),
      fill("<!--"),
      fill("## a\n"),
      fill("> * [ |\n"),
      `${"| a ".repeat(30)}|\n${"| - ".repeat(30)}|\n${fill("|\n")}`,
    ];
    for (const input of inputs) {
      const started = performance.now();
      const result = compile(input);
      expect(performance.now() - started, input.slice(0, 40)).toBeLessThan(1000);
      expect(Array.isArray(result.blocks)).toBe(true);
    }
  });
});
