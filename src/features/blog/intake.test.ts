import { describe, expect, it } from "vitest";
import type { Handoff } from "./handoff";
import { coverFile, fileKind, matchTags, missingImages, pairTags, readSources, slugFromFileName, slugFromText, suggestCategory, suggestSlug } from "./intake";
import { splitLeadImage } from "./media";

const text = (...lines: string[]) => lines.join("\n");

const bilingual = (slug: string | null) =>
  text(
    "# Draft package",
    "",
    "| Field | 中文 | English |",
    "|---|---|---|",
    "| SEO title | 雨天开车提醒｜Movia | Rain Driving Tips \\| Movia |",
    ...(slug ? [`| Slug (recommended) | \`${slug}\`（放在 \`/zh/blog/\` 下） | \`${slug}\` |`] : []),
    "| Category / 分类 | 美国自驾指南 | Driving in California |",
    "",
    "# 中文版",
    "",
    "# 雨天开车",
    "",
    "![雨天的公路](assets/rain-driving-cover.jpg)",
    "",
    "雨刚开始下的时候，路面最滑。",
    "",
    "![雨刷](assets/wipers.png)",
    "",
    "# English Version",
    "",
    "# Driving in the Rain: What's Different & Why It Matters",
    "",
    "![A road in the rain](assets/rain-driving-cover.jpg)",
    "",
    "Roads are slickest when the rain has just started.",
    "",
    "![Wipers](assets/wipers.png)",
  );

describe("which files count", () => {
  it("takes Markdown as the article and common pictures as images", () => {
    expect(fileKind("movia-tesla-fsd-v15-blog-zh-en.md")).toBe("source");
    expect(fileKind("notes.MARKDOWN")).toBe("source");
    expect(fileKind("draft.txt")).toBe("source");
    expect(fileKind("assets/cover.JPG")).toBe("image");
    expect(fileKind("shot.webp")).toBe("image");
    expect(fileKind("pasted", "image/png")).toBe("image");
  });

  it("leaves out a readme, hidden files and everything else", () => {
    expect(fileKind("README-for-website-ai.md")).toBe("other");
    expect(fileKind("readme.md")).toBe("other");
    expect(fileKind("readmefirst.md")).toBe("source");
    expect(fileKind(".DS_Store")).toBe("other");
    expect(fileKind("photo.heic")).toBe("other");
    expect(fileKind("clip.gif", "image/gif")).toBe("other");
    expect(fileKind("brief.docx")).toBe("other");
    expect(fileKind("")).toBe("other");
  });
});

describe("the address", () => {
  it("uses the one written in the article package", () => {
    const { handoff } = readSources([{ name: "rain.md", text: bilingual("rain-driving-tips") }]);
    expect(suggestSlug(handoff, ["rain.md"])).toBe("rain-driving-tips");
  });

  it("falls back to the English title, cut at a word", () => {
    const { handoff } = readSources([{ name: "rain.md", text: bilingual(null) }]);
    expect(suggestSlug(handoff, ["rain.md"])).toBe("driving-in-the-rain-whats-different-and-why-it-matters");
    expect(slugFromText("Tesla FSD v15 Is Rolling Out: What's New—and Can You Try It in a Rental Tesla?")).toBe("tesla-fsd-v15-is-rolling-out-whats-new-and-can-you-try-it-in");
    expect(slugFromText("Café & Crème brûlée")).toBe("cafe-and-creme-brulee");
    expect(slugFromText("  ")).toBe("");
    expect(slugFromText("雨天开车")).toBe("");
  });

  it("falls back to the file name without dates and language marks", () => {
    expect(slugFromFileName("movia-tesla-fsd-v15-blog-zh-en.md")).toBe("movia-tesla-fsd-v15");
    expect(slugFromFileName("winter-driving-guide.big-bear-mammoth.bilingual(1).md")).toBe("winter-driving-guide-big-bear-mammoth");
    expect(slugFromFileName("10022026 Tesla Dining.md")).toBe("tesla-dining");
    expect(slugFromFileName("Movia_California_Bioluminescence_Guide_2026 10062026.md")).toBe("movia-california-bioluminescence-guide-2026");
    expect(slugFromFileName("fsd-quick-start.zh.md")).toBe("fsd-quick-start");
    expect(slugFromFileName("C:\\Articles\\SC Police Guide.md")).toBe("sc-police-guide");
    expect(suggestSlug(null, ["雨天开车.md", "fsd-quick-start.en.md"])).toBe("fsd-quick-start");
  });

  it("gives nothing when no usable address can be made", () => {
    expect(suggestSlug(null, [])).toBe("");
    expect(suggestSlug(null, ["雨天.md"])).toBe("");
    expect(suggestSlug(null, ["new.md"])).toBe("");
    expect(suggestSlug(null, ["ab.md"])).toBe("");
  });
});

describe("the article files", () => {
  const zh = text("---", "title: 雨天开车", "slug: rain-driving-tips", "lang: zh", "---", "", "雨刚开始下的时候，路面最滑。");
  const en = text("---", "title: Driving in the rain", "slug: rain-driving-tips", "lang: en", "---", "", "Roads are slickest when the rain has just started.");

  it("reads one file", () => {
    const result = readSources([{ name: "rain.md", text: bilingual("rain-driving-tips") }]);
    expect(result.many).toBe(false);
    expect(result.used).toHaveLength(1);
    expect(result.handoff?.zh?.title).toBe("雨天开车");
    expect(result.handoff?.category).toBe("driving");
  });

  it("joins a Chinese file and an English file", () => {
    const result = readSources([
      { name: "rain.en.md", text: en },
      { name: "rain.zh.md", text: zh },
    ]);
    expect(result.many).toBe(false);
    expect(result.used).toHaveLength(2);
    expect(result.handoff?.zh?.title).toBe("雨天开车");
    expect(result.handoff?.en?.title).toBe("Driving in the rain");
  });

  it("refuses two complete articles, two files in one language, or three files", () => {
    const whole = { name: "a.md", text: bilingual("rain-driving-tips") };
    expect(readSources([whole, { name: "b.md", text: bilingual("other-article") }])).toEqual({ handoff: null, used: [], many: true });
    expect(readSources([{ name: "a.md", text: zh }, { name: "b.md", text: zh }]).many).toBe(true);
    expect(readSources([{ name: "a.md", text: zh }, { name: "b.md", text: en }, whole]).many).toBe(true);
  });

  it("has nothing to say without a file", () => {
    expect(readSources([])).toEqual({ handoff: null, used: [], many: false });
  });
});

describe("the pictures", () => {
  const { handoff } = readSources([{ name: "rain.md", text: bilingual("rain-driving-tips") }]);

  it("lists the pictures the article names that were not provided", () => {
    expect(handoff?.images).toEqual(["assets/rain-driving-cover.jpg", "assets/wipers.png"]);
    expect(missingImages(handoff?.images ?? [], [])).toEqual(["rain-driving-cover.jpg", "wipers.png"]);
    expect(missingImages(handoff?.images ?? [], ["Rain-Driving-Cover.PNG"])).toEqual(["wipers.png"]);
    expect(missingImages(handoff?.images ?? [], ["wipers.webp", "rain-driving-cover.jpeg", "extra.png"])).toEqual([]);
  });

  it("does not ask for pictures that already have a web address", () => {
    expect(missingImages(["https://example.org/a.png", "//example.org/b.png", "/blog/c.webp", "assets/d.png"], [])).toEqual(["d.png"]);
  });

  it("names the cover: the first picture of the article, else a file called cover", () => {
    expect(coverFile(handoff, ["wipers.png", "rain-driving-cover.jpg"])).toBe("rain-driving-cover.jpg");
    expect(coverFile(handoff, ["wipers.png", "my-cover.jpg"])).toBeNull();
    expect(coverFile(null, ["wipers.png", "trip-cover-v2.jpg"])).toBe("trip-cover-v2.jpg");
    expect(coverFile(null, ["wipers.png", "discover.jpg"])).toBeNull();
    expect(coverFile(null, [])).toBeNull();
  });
});

describe("category guess", () => {
  const handoff = (zh: string, en: string, extra: Partial<Handoff> = {}): Handoff => ({ zh: { title: zh, markdown: "正文" }, en: { title: en, markdown: "Body" }, tags: [], images: [], notes: [], ...extra });

  it("keeps a stated category", () => {
    expect(suggestCategory(handoff("周末去哪儿", "Weekend routes", { category: "news" }))).toBe("news");
  });

  it("reads the titles", () => {
    expect(suggestCategory(handoff("感恩节周末去哪玩？8 种玩法与自驾攻略", "Thanksgiving Weekend: 8 Things to Do"))).toBe("travel");
    expect(suggestCategory(handoff("Tesla FSD v15 开始推送", "Tesla FSD v15 Is Rolling Out"))).toBe("fsd");
    expect(suggestCategory(handoff("第一次在洛杉矶开车？停车和收费公路", "Driving in Los Angeles: Parking and Toll Roads"))).toBe("driving");
    expect(suggestCategory(handoff("信用卡有租车保险就够了吗", "Is Your Credit Card Rental Insurance Enough?"))).toBe("tips");
  });

  it("returns nothing without a signal", () => {
    expect(suggestCategory(handoff("一些想法", "A few thoughts"))).toBeNull();
    expect(suggestCategory(null)).toBeNull();
  });
});

describe("tag ideas", () => {
  const known = [
    { id: "orange-county", label_zh: "橙县", label_en: "Orange County" },
    { id: "damage-waiver", label_zh: "车损减免", label_en: "Damage Waivers" },
    { id: "fsd", label_zh: "FSD（监督版）", label_en: "FSD (Supervised)" },
  ];

  it("pairs alternating and blocked lists", () => {
    expect(pairTags(["租车保险", "Rental Insurance", "车损减免", "Damage Waivers"])).toEqual([
      { zh: "租车保险", en: "Rental Insurance" },
      { zh: "车损减免", en: "Damage Waivers" },
    ]);
    expect(pairTags(["路边停车", "安全", "Roadside Stop", "Safety"])).toEqual([
      { zh: "路边停车", en: "Roadside Stop" },
      { zh: "安全", en: "Safety" },
    ]);
  });

  it("leaves unpaired tags alone", () => {
    expect(pairTags(["Orange County", "LAX", "夜间驾驶"])).toEqual([
      { zh: "Orange County", en: "Orange County" },
      { zh: "LAX", en: "LAX" },
      { zh: "夜间驾驶", en: "" },
    ]);
  });

  it("matches by label or id and keeps the rest as hints", () => {
    expect(matchTags(pairTags(["Orange County", "LAX", "FSD", "Holiday Events"]), known)).toEqual({ tags: ["orange-county", "fsd"], hints: [{ zh: "LAX", en: "LAX" }, { zh: "Holiday Events", en: "Holiday Events" }] });
    expect(matchTags(pairTags(["车损减免", "Collision Waiver"]), known)).toEqual({ tags: ["damage-waiver"], hints: [] });
    expect(matchTags([{ zh: "", en: "" }], known)).toEqual({ tags: [], hints: [] });
  });
});

describe("cover image inside the text", () => {
  const body = ["First paragraph.", "", "Second paragraph.", "", "![Coast](assets/trip-cover.jpg)", "*Illustration only.*", "", "## Section", "", "Text.", "", "![Map](assets/map.png)"].join("\n");

  it("takes a cover named image before the first heading", () => {
    expect(splitLeadImage(body)).toEqual({ markdown: ["First paragraph.", "", "Second paragraph.", "", "## Section", "", "Text.", "", "![Map](assets/map.png)"].join("\n"), lead: "assets/trip-cover.jpg" });
  });

  it("still takes an image on the first line", () => {
    expect(splitLeadImage("![Coast](assets/hero.jpg)\n*Caption.*\n\nText.")).toEqual({ markdown: "Text.", lead: "assets/hero.jpg" });
  });

  it("leaves other images where they are", () => {
    const plain = body.replace("trip-cover.jpg", "trip-view.jpg");
    expect(splitLeadImage(plain)).toEqual({ markdown: plain, lead: null });
    const late = "Intro.\n\n## Section\n\n![Coast](assets/trip-cover.jpg)";
    expect(splitLeadImage(late)).toEqual({ markdown: late, lead: null });
  });

  it("uses that image as the cover file", () => {
    const handoff: Handoff = { zh: { markdown: body }, en: null, tags: [], images: [], notes: [] };
    expect(coverFile(handoff, ["map.png", "trip-cover.png"])).toBe("trip-cover.png");
  });
});
