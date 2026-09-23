import { describe, expect, it } from "vitest";
import type { ArticleDraft, ImageRef } from "./blocks";
import { draftSchema, emptyDraft } from "./draft";
import { buildLive, checkDraft, displayWidth, laDate, safeLink, siteLink } from "./publish";

const cover: ImageRef = { src: "https://media.example.org/cover.webp", width: 1600, height: 900, blur: "data:image/webp;base64,AAAA" };
const inside: ImageRef = { src: "https://media.example.org/inside.webp", width: 1200, height: 750 };
const images = (src: string) => [cover, inside].find((image) => image.src === src) ?? null;

function sample(): ArticleDraft {
  return {
    category: "fsd",
    tags: ["fsd", "irvine", "fsd"],
    cover,
    published: null,
    updated: null,
    zh: {
      title: "FSD (Supervised) 上手指南",
      seoTitle: "",
      seoDescription: "",
      excerpt: "第一次用 FSD (Supervised) 之前先看这篇。",
      kicker: "FSD 指南",
      line: "方向盘仍在你手里。",
      markdown: "开头一段。\n\n## 一、怎么开启\n\n- 第一步\n- 第二步\n\n![车内中控屏](https://media.example.org/inside.webp)\n\n## 二、何时接管\n\n随时准备接管，详见[租车政策](/legal/rental)。",
    },
    en: {
      title: "Getting started with FSD (Supervised)",
      seoTitle: "FSD (Supervised) quick start",
      seoDescription: "What to know before your first drive.",
      excerpt: "Read this before your first drive with FSD (Supervised).",
      kicker: "FSD guide",
      line: "Your hands stay on the wheel.",
      markdown: "An opening paragraph.\n\n## 1. How to turn it on\n\n- Step one\n- Step two\n\n![Center screen](https://media.example.org/inside.webp)\n\n## 2. When to take over\n\nBe ready at all times. See the [rental policy](/legal/rental).",
    },
  };
}

const codes = (issues: Array<{ code: string; level: string }>, level: string) => issues.filter((issue) => issue.level === level).map((issue) => issue.code);

describe("buildLive", () => {
  it("produces the public article from a complete draft", () => {
    const { live, issues } = buildLive(sample(), images, "2026-11-23");
    expect(codes(issues, "error")).toEqual([]);
    expect(live).not.toBeNull();
    expect(live?.category).toBe("fsd");
    expect(live?.tags).toEqual(["fsd", "irvine"]);
    expect(live?.cover).toEqual(cover);
    expect(live?.published).toBe("2026-11-23");
    expect(live?.updated).toBeNull();
    expect(live?.zh.title).toBe("FSD (Supervised) 上手指南");
    expect(live?.zh).not.toHaveProperty("seoTitle");
    expect(live?.en.seoTitle).toBe("FSD (Supervised) quick start");
    expect(live?.en.headings).toEqual(["1. How to turn it on", "2. When to take over"]);
    expect(live?.en.words).toBeGreaterThan(10);
    expect(live?.zh.words).toBeGreaterThan(10);
    expect(live?.zh.blocks.map((block) => block.type)).toEqual(["p", "h2", "ul", "figure", "h2", "p"]);
    expect(live?.zh.blocks[3]).toEqual({ type: "figure", image: inside, alt: "车内中控屏" });
  });

  it("gives both languages the same section anchors", () => {
    const { live } = buildLive(sample(), images, "2026-11-23");
    const ids = (locale: "zh" | "en") => live?.[locale].blocks.flatMap((block) => (block.type === "h2" ? [block.id] : []));
    expect(ids("en")).toEqual(["1-how-to-turn-it-on", "2-when-to-take-over"]);
    expect(ids("zh")).toEqual(ids("en"));
  });

  it("keeps a chosen published date and only reports a later updated date", () => {
    const earlier = buildLive({ ...sample(), published: "2026-11-01", updated: "2026-11-01" }, images, "2026-11-23").live;
    expect([earlier?.published, earlier?.updated]).toEqual(["2026-11-01", null]);
    const later = buildLive({ ...sample(), published: "2026-11-01", updated: "2026-11-20" }, images, "2026-11-23").live;
    expect(later?.updated).toBe("2026-11-20");
  });

  it("refuses a draft with missing fields, cover or images", () => {
    const draft = sample();
    const broken: ArticleDraft = { ...draft, cover: null, zh: { ...draft.zh, title: " ", kicker: "" }, en: { ...draft.en, markdown: `${draft.en.markdown}\n\n![Missing](assets/nope.png)` } };
    const { live, issues } = buildLive(broken, images, "2026-11-23");
    expect(live).toBeNull();
    expect(codes(issues, "error")).toEqual(expect.arrayContaining(["missing_cover", "missing_title", "missing_kicker", "image_unknown"]));
    expect(issues.find((issue) => issue.code === "image_unknown")).toMatchObject({ locale: "en", detail: "assets/nope.png" });
  });

  it("never sends a question-and-answer block to the website", () => {
    const draft = sample();
    const asked: ArticleDraft = { ...draft, en: { ...draft.en, markdown: `${draft.en.markdown}\n\n:::faq\n### Can I charge at home?\nYes.\nAny outlet works.\n\n### Is tax included?\nNo.\n:::` } };
    const { live, issues } = buildLive(asked, images, "2026-11-23");
    expect(issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(live?.en.blocks.some((block) => block.type === "faq")).toBe(false);
    expect(live?.en.blocks.slice(-4)).toEqual([
      { type: "h3", text: "Can I charge at home?" },
      { type: "p", text: "Yes.\nAny outlet works." },
      { type: "h3", text: "Is tax included?" },
      { type: "p", text: "No." },
    ]);
    expect(live?.en.headings).toContain("Can I charge at home?");
  });

  it("refuses a date that does not exist", () => {
    for (const published of ["2026-02-30", "2026-13-01", "20261-01-01"]) {
      const { live, issues } = buildLive({ ...sample(), published }, images, "2026-11-23");
      expect(live, published).toBeNull();
      expect(issues.some((issue) => issue.code === "published" && issue.level === "error"), published).toBe(true);
    }
    expect(draftSchema.safeParse({ ...sample(), updated: "2026-02-30" }).success).toBe(false);
    expect(buildLive({ ...sample(), published: "2024-02-29" }, images, "2026-11-23").live?.published).toBe("2024-02-29");
  });

  it("refuses an empty article", () => {
    const { live, issues } = buildLive(emptyDraft("news"), images, "2026-11-23");
    expect(live).toBeNull();
    expect(codes(issues, "error")).toEqual(expect.arrayContaining(["empty", "missing_title", "missing_excerpt", "missing_line", "missing_cover"]));
  });
});

describe("checkDraft warnings", () => {
  it("flags long fields, a narrow cover and mismatched sections without blocking", () => {
    const draft = sample();
    const noisy: ArticleDraft = {
      ...draft,
      cover: { ...cover, width: 900 },
      zh: { ...draft.zh, excerpt: "长".repeat(91), markdown: `${draft.zh.markdown}\n\n## 三、多出来的一节\n\n正文。` },
      en: { ...draft.en, seoTitle: "x".repeat(65), seoDescription: "y".repeat(171) },
    };
    const { live, issues } = buildLive(noisy, (src) => (src === cover.src ? { ...cover, width: 900 } : images(src)), "2026-11-23");
    expect(live).not.toBeNull();
    expect(codes(issues, "warning")).toEqual(expect.arrayContaining(["small_cover", "long_excerpt", "long_seo_title", "long_seo_description", "h2_mismatch"]));
  });

  it("reminds about brand wording", () => {
    const draft = sample();
    const plain: ArticleDraft = {
      ...draft,
      zh: { ...draft.zh, title: "FSD 上手指南", excerpt: "第一次用 FSD 之前先看这篇。", markdown: "带着 Cybertruck 去越野。" },
      en: { ...draft.en, title: "Getting started with FSD", seoTitle: "", excerpt: "Read this first.", markdown: "Take the Cybertruck off-road." },
    };
    const found = checkDraft(plain, images).issues;
    expect(found.filter((issue) => issue.code === "brand_fsd").map((issue) => issue.locale)).toEqual(["zh", "en"]);
    expect(found.filter((issue) => issue.code === "brand_offroad").map((issue) => issue.locale)).toEqual(["zh", "en"]);
    expect(checkDraft(sample(), images).issues.some((issue) => issue.code.startsWith("brand_"))).toBe(false);
  });
});

describe("links", () => {
  it("accepts site paths, web addresses, mail, phone and anchors only", () => {
    for (const url of ["/blog/x", "/", "https://www.tesla.com/support", "http://example.org", "mailto:contact@moviatech.ai", "tel:+18776966842", "#section-1"]) expect(safeLink(url), url).toBe(true);
    for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example", "assets/x.png", "vbscript:x", "https://", "https://a b", ""]) expect(safeLink(url), url).toBe(false);
  });

  it("blocks publishing when a link the website would render is unsafe", () => {
    const draft = sample();
    for (const url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,boom", "//evil.example/x"]) {
      const bad: ArticleDraft = { ...draft, en: { ...draft.en, markdown: `${draft.en.markdown}\n\nClick [here](${url}).` } };
      const { live, issues } = buildLive(bad, images, "2026-11-23");
      expect(live, url).toBeNull();
      expect(issues.some((issue) => issue.code === "link_url" && issue.level === "error" && issue.locale === "en"), url).toBe(true);
    }
  });

  it("agrees with the website about what becomes a link", () => {
    const website = /^(\/|https?:\/\/|mailto:|tel:)/;
    for (const url of ["/blog/x", "/", "https://www.tesla.com/support", "http://example.org", "mailto:contact@moviatech.ai", "tel:+18776966842", "#section-1", "HTTPS://EXAMPLE.ORG", "Mailto:a@b.co", "assets/x.png", "javascript:alert(1)", "//evil.example"]) {
      expect(siteLink(url), url).toBe(website.test(url));
      if (safeLink(url) && !url.startsWith("#")) expect(siteLink(url), url).toBe(true);
    }
    for (const url of ["HTTPS://EXAMPLE.ORG", "Mailto:a@b.co", "TEL:+18776966842"]) expect(safeLink(url), url).toBe(false);
  });

  it("writes the scheme of a web address in lower case so the website links it", () => {
    const draft = sample();
    const shouted: ArticleDraft = { ...draft, en: { ...draft.en, markdown: `${draft.en.markdown}\n\nSee [Tesla](HTTPS://www.tesla.com/Support) or [mail us](MAILTO:contact@moviatech.ai).` } };
    const { live, issues } = buildLive(shouted, images, "2026-11-23");
    expect(issues.filter((issue) => issue.code === "link_url")).toEqual([]);
    expect(live?.en.blocks.at(-1)).toEqual({ type: "p", text: "See [Tesla](https://www.tesla.com/Support) or [mail us](mailto:contact@moviatech.ai)." });
  });

  it("lets an in-page anchor through with a note that the website shows plain text", () => {
    const draft = sample();
    const jumped: ArticleDraft = { ...draft, zh: { ...draft.zh, markdown: `${draft.zh.markdown}\n\n回到[开头](#top)。` } };
    const { live, issues } = buildLive(jumped, images, "2026-11-23");
    expect(live).not.toBeNull();
    expect(issues.filter((issue) => issue.code === "link_anchor").map((issue) => [issue.level, issue.locale])).toEqual([["warning", "zh"]]);
    expect(issues.some((issue) => issue.code === "link_url")).toBe(false);
  });

  it("suggests a short label when the link text is a long web address", () => {
    const draft = sample();
    const long = "https://www.tesla.com/support/autopilot/full-self-driving-supervised-subscriptions";
    const noisy: ArticleDraft = {
      ...draft,
      en: { ...draft.en, markdown: `${draft.en.markdown}\n\n## Sources\n\n- [${long}](${long})\n- <${long}>\n- [Tesla support](${long})\n- [https://tesla.com](https://tesla.com)\n- [A long but readable label that explains where the link goes](${long})` },
      zh: { ...draft.zh, markdown: `${draft.zh.markdown}\n\n## 三、参考资料\n\n- [Tesla 支持页面](${long})` },
    };
    const { live, issues } = buildLive(noisy, images, "2026-11-23");
    expect(live).not.toBeNull();
    const notes = issues.filter((issue) => issue.code === "link_text");
    expect(notes.map((issue) => [issue.level, issue.locale])).toEqual([["warning", "en"]]);
    expect(notes[0].detail).toBe(`${long.slice(0, 48)}…`);
  });

  it("stays fast when the text is full of half-written links", () => {
    const draft = sample();
    for (const filler of ["a](b", "[a](", "]("]) {
      const heavy: ArticleDraft = { ...draft, en: { ...draft.en, markdown: filler.repeat(Math.floor(200000 / filler.length)) } };
      const started = performance.now();
      checkDraft(heavy, images);
      expect(performance.now() - started, filler).toBeLessThan(3000);
    }
  });

  it("turns links to the website into site paths without a language prefix", () => {
    const draft = sample();
    const linked: ArticleDraft = { ...draft, zh: { ...draft.zh, markdown: `${draft.zh.markdown}\n\n看[车型](https://www.moviatech.ai/zh/vehicles)和[另一篇](/en/blog/fsd-quick-start)。` } };
    const { live } = buildLive(linked, images, "2026-11-23");
    const last = live?.zh.blocks.at(-1);
    expect(last).toEqual({ type: "p", text: "看[车型](/vehicles)和[另一篇](/blog/fsd-quick-start)。" });
  });
});

describe("draft schema", () => {
  it("accepts the sample and drops unknown keys", () => {
    const parsed = draftSchema.parse({ ...sample(), extra: true });
    expect(parsed).toEqual(sample());
  });

  it("rejects malformed drafts", () => {
    expect(draftSchema.safeParse({ ...sample(), category: "cars" }).success).toBe(false);
    expect(draftSchema.safeParse({ ...sample(), tags: ["Bad Tag"] }).success).toBe(false);
    expect(draftSchema.safeParse({ ...sample(), published: "11/23/2026" }).success).toBe(false);
    expect(draftSchema.safeParse({ ...sample(), zh: { ...sample().zh, markdown: "x".repeat(200001) } }).success).toBe(false);
  });
});

describe("displayWidth", () => {
  it("counts full-width characters twice, as search results do", () => {
    expect(displayWidth("Tesla FSD")).toBe(9);
    expect(displayWidth("租车指南")).toBe(8);
    expect(displayWidth(" Tesla 租车｜Movia ")).toBe(17);
  });

  it("keeps realistic fields under the limits", () => {
    const { issues } = buildLive({ ...sample(), zh: { ...sample().zh, seoTitle: "Tesla FSD v15 最新功能｜LAX、Irvine 租 Tesla 指南", excerpt: "长".repeat(80) } }, images, "2026-11-23");
    expect(issues.filter((issue) => issue.code.startsWith("long_"))).toEqual([]);
  });
});

describe("laDate", () => {
  it("uses the Pacific calendar day", () => {
    expect(laDate(new Date("2026-11-24T03:00:00Z"))).toBe("2026-11-23");
    expect(laDate(new Date("2026-11-24T09:00:00Z"))).toBe("2026-11-24");
  });
});
