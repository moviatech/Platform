import { describe, expect, it } from "vitest";
import { mergeHandoffs, splitHandoff } from "./handoff";

const text = (...lines: string[]) => lines.join("\n");

const front = (keys: string[], ...body: string[]) => text("---", ...keys, "---", "", ...body);

describe("one language per file", () => {
  const source = front(
    [
      "slug: night-drive-basics",
      "locale: zh",
      "translation_key: night-drive-basics",
      "category: FSD 指南",
      'tags: [夜间驾驶, FSD, "灯光, 视线", FSD]',
      'title: "夜里开车的三个习惯"',
      'seo_title: "夜间开车指南：灯光、车距与休息 | Movia"',
      'seo_description: "天黑以后开车，先看灯光、车距和休息安排。"',
      "excerpt: '天黑以后，慢一点，看远一点。'",
      "reading_time: 4",
      "cover_image: /images/blog/night-drive/cover.webp",
      "status: draft",
    ],
    "# 夜里开车的三个习惯",
    "",
    "![夜晚的公路](/images/blog/night-drive/cover.webp)",
    "",
    "天黑以后，路还是那条路，只是能看清的东西少了。",
    "",
    "## 先看灯光",
    "",
    "出发前检查两种灯：",
    "- 近光灯",
    "- 远光灯",
    "",
    "---",
    "",
    "### 最后",
    "",
    "**慢一点，没关系。**",
    "",
  );

  it("reads the frontmatter and returns the body without the H1", () => {
    expect(splitHandoff(source)).toEqual({
      zh: {
        title: "夜里开车的三个习惯",
        seoTitle: "夜间开车指南：灯光、车距与休息",
        seoDescription: "天黑以后开车，先看灯光、车距和休息安排。",
        excerpt: "天黑以后，慢一点，看远一点。",
        markdown: text(
          "![夜晚的公路](/images/blog/night-drive/cover.webp)",
          "",
          "天黑以后，路还是那条路，只是能看清的东西少了。",
          "",
          "## 先看灯光",
          "",
          "出发前检查两种灯：",
          "",
          "- 近光灯",
          "- 远光灯",
          "",
          "### 最后",
          "",
          "**慢一点，没关系。**",
        ),
      },
      en: null,
      slug: "night-drive-basics",
      category: "fsd",
      tags: ["夜间驾驶", "FSD", "灯光, 视线"],
      images: ["/images/blog/night-drive/cover.webp"],
      notes: ["layout:single-language", "missing:en"],
    });
  });

  it("handles Windows line endings and a byte order mark", () => {
    expect(splitHandoff(`${String.fromCharCode(0xfeff)}${source.split("\n").join("\r\n")}`)).toEqual(splitHandoff(source));
  });

  it("takes the language from the frontmatter before looking at the text", () => {
    const result = splitHandoff(front(["lang: en", "title: Phrase list"], "# Phrase list", "", "充电、停车、高速、出口、收费，这些词路牌上都有。"));
    expect(result.zh).toBeNull();
    expect(result.en).toEqual({ title: "Phrase list", markdown: "充电、停车、高速、出口、收费，这些词路牌上都有。" });
    expect(result.notes).toEqual(["layout:single-language", "missing:zh"]);
  });

  it("falls back to the share of Chinese characters", () => {
    const zh = splitHandoff(text("# 雨天提醒", "", "下雨的时候先把速度降下来，再打开 wipers 和 defroster。"));
    const en = splitHandoff(text("# Rain notes", "", "Slow down first. The sign may say 小心路滑 in some places."));
    expect(zh.zh).toEqual({ title: "雨天提醒", markdown: "下雨的时候先把速度降下来，再打开 wipers 和 defroster。" });
    expect(zh.notes).toEqual(["layout:single-language", "missing:en"]);
    expect(en.en).toEqual({ title: "Rain notes", markdown: "Slow down first. The sign may say 小心路滑 in some places." });
    expect(en.notes).toEqual(["layout:single-language", "missing:zh"]);
  });

  it("accepts frontmatter without any heading", () => {
    const result = splitHandoff(front(["locale: en", 'title: "Quiet roads"', "tags: quiet, roads"], "The road is empty before seven.", "", "## Early start", "", "Leave before the commute."));
    expect(result.en).toEqual({ title: "Quiet roads", markdown: text("The road is empty before seven.", "", "## Early start", "", "Leave before the commute.") });
    expect(result.tags).toEqual(["quiet", "roads"]);
    expect(result.notes).toEqual(["layout:single-language", "missing:zh"]);
  });

  it("drops an editorial part that follows the article", () => {
    const result = splitHandoff(text("# Quiet roads", "", "The road is empty before seven.", "", "# Editor notes", "", "Check the photo credit."));
    expect(result.en).toEqual({ title: "Quiet roads", markdown: "The road is empty before seven." });
    expect(result.notes).toEqual(["layout:single-language", "dropped:editor-note", "missing:zh"]);
  });
});

describe("two H1 sections in one file", () => {
  const source = front(
    [
      "slug: roadside-stop-basics",
      "translation_key: roadside-stop-basics",
      "locale: bilingual",
      "category_zh: 驾驶指南",
      "category_en: Driving in California",
      "tags_zh: [路边停车, 安全]",
      "tags_en: [Roadside Stop, Safety]",
      'title_zh: "路边临时停车怎么做"',
      'title_en: "How to Make a Roadside Stop"',
      'seo_title_zh: "路边临时停车指南 | Movia"',
      'seo_title_en: "Roadside Stop Guide | Movia"',
      'seo_description_zh: "打灯、靠右、停稳，再处理别的事。"',
      'seo_description_en: "Signal, move right, stop fully, then deal with the rest."',
      'excerpt_zh: "先把车停稳。"',
      'excerpt_en: "Stop the car first."',
      "reviewed_as_of: '2026-11-20'",
    ],
    "<!-- EDITOR / 开发提示：两个语言版本共用同一张图。",
    "不要重复输出 H1。-->",
    "",
    "# 路边临时停车怎么做",
    "",
    "![靠边停车示意图](/images/blog/roadside/cover.webp)",
    "",
    "先打右转向灯，再慢慢靠边。  ",
    "停稳以后再去拿手机，别在车还在动的时候低头找东西。",
    "",
    "## 停在哪里",
    "",
    "选一个前后来车都看得见你的位置，离弯道和坡顶远一点。",
    "",
    "---",
    "",
    "<!-- ENGLISH VERSION -->",
    "",
    "# How to Make a Roadside Stop",
    "",
    "![Illustration of a car pulled over](/images/blog/roadside/cover.webp)",
    "",
    "Signal right, then ease toward the shoulder.",
    "",
    "## Where to stop",
    "",
    "Choose a spot where traffic can see you.",
    "",
    "---",
    "",
    "## Official sources / 官方资料",
    "",
    "*Reviewed in November.*",
    "",
    "1. [State handbook](https://example.org/handbook)",
    "",
  );
  const shared = (heading: string) => [heading, "", "*Reviewed in November.*", "", "1. [State handbook](https://example.org/handbook)"];

  it("splits on the headings and gives the shared block to both languages", () => {
    expect(splitHandoff(source)).toEqual({
      zh: {
        title: "路边临时停车怎么做",
        seoTitle: "路边临时停车指南",
        seoDescription: "打灯、靠右、停稳，再处理别的事。",
        excerpt: "先把车停稳。",
        markdown: text(
          "![靠边停车示意图](/images/blog/roadside/cover.webp)",
          "",
          "先打右转向灯，再慢慢靠边。",
          "停稳以后再去拿手机，别在车还在动的时候低头找东西。",
          "",
          "## 停在哪里",
          "",
          "选一个前后来车都看得见你的位置，离弯道和坡顶远一点。",
          "",
          ...shared("## 官方资料"),
        ),
      },
      en: {
        title: "How to Make a Roadside Stop",
        seoTitle: "Roadside Stop Guide",
        seoDescription: "Signal, move right, stop fully, then deal with the rest.",
        excerpt: "Stop the car first.",
        markdown: text(
          "![Illustration of a car pulled over](/images/blog/roadside/cover.webp)",
          "",
          "Signal right, then ease toward the shoulder.",
          "",
          "## Where to stop",
          "",
          "Choose a spot where traffic can see you.",
          "",
          ...shared("## Official sources"),
        ),
      },
      slug: "roadside-stop-basics",
      category: "driving",
      tags: ["路边停车", "安全", "Roadside Stop", "Safety"],
      images: ["/images/blog/roadside/cover.webp"],
      notes: ["layout:two-h1", "dropped:editor-note"],
    });
  });

  it("keeps a block of sources in its own language when the other language has one too", () => {
    const result = splitHandoff(text("# 路边停车", "", "先打灯，再靠边，停稳以后再做别的事情。", "", "### 参考资料", "", "- 本地手册", "", "---", "", "# Roadside stop", "", "Signal, then pull over.", "", "---", "", "### Sources", "", "- Local handbook"));
    expect(result.zh?.markdown).toBe(text("先打灯，再靠边，停稳以后再做别的事情。", "", "### 参考资料", "", "- 本地手册"));
    expect(result.en?.markdown).toBe(text("Signal, then pull over.", "", "### Sources", "", "- Local handbook"));
  });

  it("returns the first pair and says so when the file holds more articles", () => {
    const result = splitHandoff(text("# 第一篇标题", "", "第一篇的正文写在这里，长度和英文差不多。", "", "# First title", "", "Body of the first article.", "", "# 第二篇标题", "", "第二篇的正文写在这里，长度和英文差不多。", "", "# Second title", "", "Body of the second article."));
    expect(result.zh).toEqual({ title: "第一篇标题", markdown: "第一篇的正文写在这里，长度和英文差不多。" });
    expect(result.en).toEqual({ title: "First title", markdown: "Body of the first article." });
    expect(result.notes).toEqual(["layout:two-h1", "multiple-articles"]);
  });

  it("keeps articles whose titles only sound editorial", () => {
    const result = splitHandoff(text("# 交付车辆前，编辑部同事都会检查什么", "", "上线前的新功能先在这几辆车上试，交车之前再看一遍胎压和电量。", "", "# Vehicle Handoff: What Our Editors Check Before Delivery", "", "New features go to these cars first, and we check tires and charge before delivery."));
    expect(result.zh).toEqual({ title: "交付车辆前，编辑部同事都会检查什么", markdown: "上线前的新功能先在这几辆车上试，交车之前再看一遍胎压和电量。" });
    expect(result.en).toEqual({ title: "Vehicle Handoff: What Our Editors Check Before Delivery", markdown: "New features go to these cars first, and we check tires and charge before delivery." });
    expect(result.notes).toEqual(["layout:two-h1"]);
  });

  it("accepts a terse version in one language next to a long one in the other", () => {
    const long = "Leave before the commute, keep the battery above half, plan one stop for food and one for charging, and give yourself an extra hour for the coast road because every turnout is worth a few minutes.";
    const short = "七点以前出门，电量保持在一半以上，海岸公路多留一个小时。";
    const result = splitHandoff(text("# 早点出发", "", short, "", "# Leave Early", "", long));
    expect(result.zh).toEqual({ title: "早点出发", markdown: short });
    expect(result.en).toEqual({ title: "Leave Early", markdown: long });
    expect(result.notes).toEqual(["layout:two-h1"]);
  });

  it("does not mistake a short list of English links for a second language", () => {
    const body = "这一段中文正文比较长，讲的是出发之前要看的几件事情，包括天气、路况、电量和停车位置，每一件都值得花一分钟确认。";
    const result = splitHandoff(text("# 出发之前", "", body, "", "# Sources", "", "- Handbook"));
    expect(result.en).toBeNull();
    expect(result.zh).toEqual({ title: "出发之前", markdown: text(body, "", "## Sources", "", "- Handbook") });
    expect(result.notes).toEqual(["layout:unknown", "missing:en"]);
  });
});

describe("locale comments with nested frontmatter", () => {
  const source = front(
    [
      "slug: coast-day-trip",
      "translation_key: coast-day-trip",
      "locales: [zh, en]",
      "category:",
      "  zh: 加州旅行",
      "  en: Road Trip Guides",
      "tags:",
      "  zh: [海岸, 一日游]",
      "  en: [Coast, Day Trip, 海岸]",
      "title:",
      '  zh: "沿海一日游怎么排"',
      '  en: "Planning a Coastal Day Trip"',
      "seo_title:",
      '  zh: "沿海一日游路线 | Movia"',
      '  en: "Coastal Day Trip Route | Movia"',
      "excerpt:",
      '  zh: "一条路，三个停靠点。"',
      '  en: "One road, three stops."',
      "reading_time:",
      "  zh: 约 3 分钟",
      "  en: About 3 min",
      'editorial_note: "Split on <!-- LOCALE: zh --> / <!-- LOCALE: en --> if needed."',
    ],
    "<!-- LOCALE: zh -->",
    "",
    "# 沿海一日游怎么排",
    "",
    "早上出发，中午到第一个海湾。",
    "",
    "---",
    "",
    "<!-- LOCALE: en -->",
    "",
    "# Planning a Coastal Day Trip",
    "",
    "Leave in the morning and reach the first cove by noon.",
    "",
  );

  it("splits on the comments and reads one level of nesting", () => {
    expect(splitHandoff(source)).toEqual({
      zh: { title: "沿海一日游怎么排", seoTitle: "沿海一日游路线", seoDescription: "一条路，三个停靠点。", excerpt: "一条路，三个停靠点。", markdown: "早上出发，中午到第一个海湾。" },
      en: { title: "Planning a Coastal Day Trip", seoTitle: "Coastal Day Trip Route", seoDescription: "One road, three stops.", excerpt: "One road, three stops.", markdown: "Leave in the morning and reach the first cove by noon." },
      slug: "coast-day-trip",
      category: "travel",
      tags: ["海岸", "一日游", "Coast", "Day Trip"],
      images: [],
      notes: ["layout:locale-comments"],
    });
  });

  it("ignores locale comments that are only mentioned inside a sentence", () => {
    const result = splitHandoff(text("> Split on <!-- LOCALE: zh --> / <!-- LOCALE: en --> if the site needs one page per language.", "", "<!-- LOCALE: zh -->", "", "# 沿海一日游怎么排", "", "早上出发，中午到第一个海湾。", "", "<!-- LOCALE: en -->", "", "# Planning a Coastal Day Trip", "", "Leave in the morning and reach the first cove by noon."));
    expect(result.zh).toEqual({ title: "沿海一日游怎么排", markdown: "早上出发，中午到第一个海湾。" });
    expect(result.en).toEqual({ title: "Planning a Coastal Day Trip", markdown: "Leave in the morning and reach the first cove by noon." });
    expect(result.notes).toEqual(["layout:locale-comments", "dropped:editor-note"]);
  });
});

describe("language sections under label headings", () => {
  const source = front(
    [
      'title: "雨天开车提醒"',
      'title_en: "Driving in the Rain"',
      'slug: "rain-driving-tips"',
      'category: "Driving Guides"',
      "tags:",
      "  - rain",
      "  - visibility",
      'excerpt: "下雨的时候，先把速度降下来。"',
      'excerpt_en: "When it rains, slow down first."',
      'locale: "bilingual"',
    ],
    "# 中文版",
    "",
    "# 雨天开车提醒",
    "",
    "雨刚开始下的时候，路面最滑。",
    "",
    "#### 一个**小**习惯",
    "",
    "出发前擦一下后视镜。",
    "",
    "### 参考",
    "",
    "- 本地交通部门",
    "",
    "---",
    "",
    "# English Version",
    "",
    "## Driving in the Rain",
    "",
    "Roads are slickest when the rain has just started.",
    "",
    "### Sources",
    "",
    "- Local transport agency",
    "",
  );

  it("drops the label, the nested title and a first heading that repeats it", () => {
    expect(splitHandoff(source)).toEqual({
      zh: {
        title: "雨天开车提醒",
        seoDescription: "下雨的时候，先把速度降下来。",
        excerpt: "下雨的时候，先把速度降下来。",
        markdown: text("雨刚开始下的时候，路面最滑。", "", "**一个小习惯**", "", "出发前擦一下后视镜。", "", "### 参考", "", "- 本地交通部门"),
      },
      en: {
        title: "Driving in the Rain",
        seoDescription: "When it rains, slow down first.",
        excerpt: "When it rains, slow down first.",
        markdown: text("Roads are slickest when the rain has just started.", "", "### Sources", "", "- Local transport agency"),
      },
      slug: "rain-driving-tips",
      tags: ["rain", "visibility"],
      images: [],
      notes: ["layout:sections"],
    });
  });

  it("appends sources that only the last section carries to both bodies", () => {
    const result = splitHandoff(text("# 中文版", "", "# 夜里看海", "", "天黑以后再去海边。", "", "---", "", "# English Version", "", "# The sea at night", "", "Go after dark.", "", "---", "", "## Sources", "", "- Tide tables", "- Publisher: refresh this list before publication."));
    expect(result.zh).toEqual({ title: "夜里看海", markdown: text("天黑以后再去海边。", "", "## Sources", "", "- Tide tables") });
    expect(result.en).toEqual({ title: "The sea at night", markdown: text("Go after dark.", "", "## Sources", "", "- Tide tables") });
    expect(result.notes).toEqual(["layout:sections", "dropped:editor-note"]);
  });

  it("leaves the title empty when a section has neither a field nor an H1 for it", () => {
    const result = splitHandoff(text("# 中文版", "", "正文从这里开始。", "", "# English Version", "", "The body starts here."));
    expect(result.zh).toEqual({ markdown: "正文从这里开始。" });
    expect(result.en).toEqual({ markdown: "The body starts here." });
  });

  it("reports a language that is not there", () => {
    const result = splitHandoff(text("# 中文版", "", "# 只有中文", "", "这一篇还没有英文稿。"));
    expect(result.zh).toEqual({ title: "只有中文", markdown: "这一篇还没有英文稿。" });
    expect(result.en).toBeNull();
    expect(result.notes).toEqual(["layout:sections", "missing:en"]);
  });

  it("pairs an article under its own title with the other language under a label heading", () => {
    const result = splitHandoff(text("# 夜里开车的三个习惯", "", "天黑以后，路还是那条路，只是能看清的东西少了。", "", "## 先看灯光", "", "出发前检查两种灯。", "", "---", "", "# English Version", "", "# Three habits for night driving", "", "The road is the same after dark, but you see less of it.", "", "## Lights first", "", "Check both sets of lights before you leave."));
    expect(result.zh).toEqual({ title: "夜里开车的三个习惯", markdown: text("天黑以后，路还是那条路，只是能看清的东西少了。", "", "## 先看灯光", "", "出发前检查两种灯。") });
    expect(result.en).toEqual({ title: "Three habits for night driving", markdown: text("The road is the same after dark, but you see less of it.", "", "## Lights first", "", "Check both sets of lights before you leave.") });
    expect(result.notes).toEqual(["layout:sections"]);
    const lone = splitHandoff(text("# 稿件说明", "", "图片稍后补。", "", "# English Version", "", "# Night driving", "", "It is harder to judge distance after dark, so slow down and leave more room than you would in daylight."));
    expect(lone.zh).toBeNull();
    expect(lone.en?.title).toBe("Night driving");
    expect(lone.notes).toEqual(["layout:sections", "dropped:editor-note", "missing:zh"]);
  });

  it("drops a first heading that repeats the title when only the cover image comes before it", () => {
    const result = splitHandoff(front(['title: "雨天开车提醒"', 'title_en: "Driving in the Rain"'], "# 中文版", "", "![雨天的公路](/images/blog/rain/cover.webp)", "", "## 雨天开车提醒", "", "雨刚开始下的时候，路面最滑。", "", "# English Version", "", "![A road in the rain](/images/blog/rain/cover.webp)", "*Slow down first.*", "", "## Driving in the Rain", "", "Roads are slickest when the rain has just started.", "", "## Why it matters", "", "Water lifts oil out of the asphalt."));
    expect(result.zh).toEqual({ title: "雨天开车提醒", markdown: text("![雨天的公路](/images/blog/rain/cover.webp)", "", "雨刚开始下的时候，路面最滑。") });
    expect(result.en).toEqual({ title: "Driving in the Rain", markdown: text("![A road in the rain](/images/blog/rain/cover.webp)", "*Slow down first.*", "", "Roads are slickest when the rain has just started.", "", "## Why it matters", "", "Water lifts oil out of the asphalt.") });
  });

  it("keeps later top-level headings of the same language inside a section", () => {
    const result = splitHandoff(text("# 中文版", "", "# 夜里开车", "", "天黑以后，能看清的东西少了。", "", "# 出发前检查", "", "先看灯光，再看胎压。", "", "# English Version", "", "# Night driving", "", "It is harder to judge distance after dark.", "", "# Before you leave", "", "Check the lights, then the tires."));
    expect(result.zh).toEqual({ title: "夜里开车", markdown: text("天黑以后，能看清的东西少了。", "", "## 出发前检查", "", "先看灯光，再看胎压。") });
    expect(result.en).toEqual({ title: "Night driving", markdown: text("It is harder to judge distance after dark.", "", "## Before you leave", "", "Check the lights, then the tires.") });
    expect(result.notes).toEqual(["layout:sections"]);
  });

  it("reads the fields from a table in front of the sections", () => {
    const result = splitHandoff(text("# Rain driving draft", "", "| Field | 中文 | English |", "|---|---|---|", "| SEO title | 雨天开车提醒｜Movia | Rain Driving Tips \\| Movia |", "| Excerpt (optional) | 先把速度降下来。 | Slow down first. |", "| Slug | rain-driving-tips | 同左 |", "", "# 中文版", "", "# 雨天开车", "", "雨刚开始下的时候，路面最滑。", "", "# English Version", "", "# Driving in the rain", "", "Roads are slickest when the rain has just started."));
    expect(result.zh).toEqual({ title: "雨天开车", seoTitle: "雨天开车提醒", seoDescription: "先把速度降下来。", excerpt: "先把速度降下来。", markdown: "雨刚开始下的时候，路面最滑。" });
    expect(result.en).toEqual({ title: "Driving in the rain", seoTitle: "Rain Driving Tips", seoDescription: "Slow down first.", excerpt: "Slow down first.", markdown: "Roads are slickest when the rain has just started." });
    expect(result.slug).toBe("rain-driving-tips");
    expect(result.notes).toEqual(["layout:sections", "dropped:seo-table"]);
  });
});

describe("several articles in one file", () => {
  const source = text(
    "# Blog rewrite｜两篇文章中英文重写稿",
    "",
    "> 用途：替换博客正文和 SEO 摘要。",
    "",
    "---",
    "",
    "# 文章一｜中文",
    "",
    "**建议标题 / H1：** 加油站怎么付款",
    "",
    "**SEO title：** 美国加油站付款方式｜Movia",
    "",
    "**Meta description：** 刷卡、现金和邮编验证，一次说清。",
    "",
    "**分类：** 美国自驾指南",
    "",
    "**建议阅读时长：** 约 3 分钟（上线后重新计算）",
    "",
    "## 加油站怎么付款",
    "",
    "很多加油机会要求输入邮编。",
    "",
    "## 1. 先看油枪",
    "",
    "绿色把手不一定是汽油。",
    "",
    "---",
    "",
    "# Article 1｜English",
    "",
    "**Suggested H1:** How to Pay at a Gas Station",
    "",
    "**SEO title:** Paying at US Gas Stations | Movia",
    "",
    "**Meta description:** Cards, cash and ZIP code prompts, explained.",
    "",
    "**Category:** Driving in California",
    "",
    "**Estimated reading time:** ~3 min; recalculate after publishing.",
    "",
    "## How to Pay at a Gas Station",
    "",
    "Many pumps ask for a ZIP code.",
    "",
    "## 1. Check the nozzle",
    "",
    "A green handle does not always mean gasoline.",
    "",
    "---",
    "",
    "# 文章二｜中文",
    "",
    "**建议标题 / H1：** 第二篇的标题",
    "",
    "**分类：** 租车指南",
    "",
    "## 第二篇的标题",
    "",
    "第二篇的正文。",
    "",
    "---",
    "",
    "# Article 2｜English",
    "",
    "**Suggested H1:** Second article",
    "",
    "## Second article",
    "",
    "Body of the second article.",
    "",
    "---",
    "",
    "# 上线前编辑提醒（不属于文章正文）",
    "",
    "1. 核对价格。",
    "",
  );

  it("returns the first article with the fields from its label lines", () => {
    expect(splitHandoff(source)).toEqual({
      zh: {
        title: "加油站怎么付款",
        seoTitle: "美国加油站付款方式",
        seoDescription: "刷卡、现金和邮编验证，一次说清。",
        excerpt: "刷卡、现金和邮编验证，一次说清。",
        markdown: text("很多加油机会要求输入邮编。", "", "## 1. 先看油枪", "", "绿色把手不一定是汽油。"),
      },
      en: {
        title: "How to Pay at a Gas Station",
        seoTitle: "Paying at US Gas Stations",
        seoDescription: "Cards, cash and ZIP code prompts, explained.",
        excerpt: "Cards, cash and ZIP code prompts, explained.",
        markdown: text("Many pumps ask for a ZIP code.", "", "## 1. Check the nozzle", "", "A green handle does not always mean gasoline."),
      },
      category: "driving",
      tags: [],
      images: [],
      notes: ["layout:sections", "multiple-articles", "dropped:seo-table", "dropped:editor-note"],
    });
  });
});

describe("editor packages with start and end comments", () => {
  const source = text(
    "# Blog Delivery | Tire pressure · Bilingual / 中英双语",
    "",
    "> **EDITORIAL PACKAGE — NOT FOR DIRECT PUBLICATION AS ONE PAGE**  ",
    "> Publish the two articles at separate URLs.",
    ">",
    "> **Sources policy:** External links appear only in the References section.",
    "",
    "---",
    "",
    "## 01 · SEO & publishing fields / SEO 与发布字段",
    "",
    "| Field | 中文版 | English version |",
    "|---|---|---|",
    "| Category / 分类 | 特斯拉租车入门 | Tesla Rental Tips |",
    "| Recommended H1 | **胎压灯亮了怎么办** | **What to Do When the Tire Light Comes On** |",
    "| SEO title | 胎压灯亮了怎么办｜租车指南｜Movia | Tire Pressure Warning: What to Do \\| Movia |",
    "| Meta description | 先停车，再看读数，最后决定要不要补气。 | Pull over, read the numbers, then decide whether to add air. |",
    "| Slug (recommended) | `tire-pressure-warning-guide`（放在 `/zh/blog/` 下） | `tire-pressure-warning-guide`（放在 `/en/blog/` 下） |",
    "| Primary keywords | 胎压、胎压灯 | tire pressure, TPMS |",
    "| Category / recommended tags | **Tesla Rental Tips** / `Tire Pressure`, `Tesla Tips` | **Tesla Rental Tips** / `Tire Pressure`, `Safety` |",
    "",
    "**SEO title alternatives (editorial options, not extra H1s):**",
    "",
    "1. 中文：「胎压灯亮了别慌」",
    "",
    "---",
    "",
    "<!-- START ZH ARTICLE: copy from the next H1 through the Chinese References. -->",
    "",
    "# 胎压灯亮了怎么办",
    "",
    "*2026 年 11 月 23 日 · Movia Journal · 特斯拉租车入门*",
    "",
    "![仪表上的胎压提示](assets/tire-light.jpg)",
    "",
    "*图：提示亮起时先别慌；**示意图**。*",
    "",
    "胎压灯亮了，不一定是爆胎。",
    "",
    "**Q1：要马上停车吗？**  ",
    "找一个安全的地方再停。",
    "",
    "### 参考资料 / References",
    "",
    "1. **手册** — 胎压说明：<https://example.org/manual>",
    "",
    "<!-- END ZH ARTICLE -->",
    "",
    "---",
    "",
    "<!-- START EN ARTICLE: copy from the next H1 through the English References. -->",
    "",
    "# What to Do When the Tire Light Comes On",
    "",
    "*November 23, 2026 · Movia Journal · Tesla Rental Tips*",
    "",
    "![Tire pressure warning on the display](assets/tire-light.jpg)",
    "",
    "*Illustrative photo. This is **not** a real warning screen.*",
    "",
    "A tire light does not always mean a flat.",
    "",
    "![Checking a tire at a station](assets/tire-check.jpg)",
    "",
    "<!-- END EN ARTICLE -->",
    "",
    "---",
    "",
    "## 02 · Images / 图片配置（编辑用，不要发布为正文）",
    "",
    "| File | Purpose |",
    "|---|---|",
    "| `assets/tire-light.jpg` | Cover |",
    "",
  );

  it("takes the bodies between the comments and the fields from the table", () => {
    expect(splitHandoff(source)).toEqual({
      zh: {
        title: "胎压灯亮了怎么办",
        seoTitle: "胎压灯亮了怎么办｜租车指南",
        seoDescription: "先停车，再看读数，最后决定要不要补气。",
        excerpt: "先停车，再看读数，最后决定要不要补气。",
        markdown: text(
          "![仪表上的胎压提示](assets/tire-light.jpg)",
          "*图：提示亮起时先别慌；示意图。*",
          "",
          "胎压灯亮了，不一定是爆胎。",
          "",
          "**Q1：要马上停车吗？**",
          "找一个安全的地方再停。",
          "",
          "### 参考资料 / References",
          "",
          "1. **手册** — 胎压说明：<https://example.org/manual>",
        ),
      },
      en: {
        title: "What to Do When the Tire Light Comes On",
        seoTitle: "Tire Pressure Warning: What to Do",
        seoDescription: "Pull over, read the numbers, then decide whether to add air.",
        excerpt: "Pull over, read the numbers, then decide whether to add air.",
        markdown: text(
          "![Tire pressure warning on the display](assets/tire-light.jpg)",
          "*Illustrative photo. This is not a real warning screen.*",
          "",
          "A tire light does not always mean a flat.",
          "",
          "![Checking a tire at a station](assets/tire-check.jpg)",
        ),
      },
      slug: "tire-pressure-warning-guide",
      category: "tips",
      tags: ["Tire Pressure", "Tesla Tips", "Safety"],
      images: ["assets/tire-light.jpg", "assets/tire-check.jpg"],
      notes: ["layout:markers", "dropped:byline", "dropped:seo-table", "dropped:editor-note"],
    });
  });

  const second = text(
    "# Movia 博客稿｜还车提醒（中英双语）",
    "",
    "> **交付状态：供编辑使用，尚未发布。**",
    "",
    "## 编辑用：标题与 SEO 字段",
    "",
    "| 字段 | 中文页面 | English page |",
    "| --- | --- | --- |",
    "| **SEO title** | 还车前检查清单｜Movia | Return Checklist for Renters \\| Movia |",
    "| **Meta description** | 还车前看电量、物品和照片。 | Check charge, belongings and photos before you return the car. |",
    "| **列表页摘要 / Excerpt** | 三件小事，让还车更快。 | Three small checks that make returns faster. |",
    "| **分类 / Category** | 租车指南 | Rental Advice |",
    "| **建议 slug** | return-checklist-for-renters | return-checklist-for-renters |",
    "| **建议 URL 路径，尚未上线** | `/zh/blog/return-checklist-for-renters` | `/en/blog/return-checklist-for-renters` |",
    "| **封面文件** | `assets/return-check.png` | 同左 |",
    "",
    "### 网站标签 Tags",
    "",
    "| 优先级 | 中文 | English |",
    "| --- | --- | --- |",
    "| 核心 | 还车 | Returns |",
    "| 补充 | 充电 | Charging |",
    "",
    "### 关键词与搜索意图",
    "",
    "| 层级 | 中文建议 | English suggestions |",
    "| --- | --- | --- |",
    "| 核心 | 还车流程 | car return steps |",
    "",
    "---",
    "",
    "# A. 中文文章",
    "",
    "<!-- 以下是中文正文区。发布时保留文章自己的 H1。 -->",
    "",
    "<!-- 中文正文开始；已确认。 -->",
    "",
    "# 还车前，先做这三件事",
    "",
    "**还车前看电量、物品和照片，三件小事让还车更快。**",
    "",
    "![还车前检查后备厢](assets/return-check.png)",
    "",
    "*图注：别把充电线落在车里。*",
    "",
    "电量够不够，先看一眼。[充电说明][Charging-ZH]",
    "",
    "> 我想确认一下［日期］的还车时间。可以帮我看看 [订单] 吗？",
    "",
    "1. 看电量",
    "2. 拿物品",
    "",
    "<!-- 中文正文草稿结束 -->",
    "",
    "---",
    "",
    "# B. English Article",
    "",
    "<!-- English article begins. Confirmed on November 20. -->",
    "",
    "# Three Things to Do Before You Return the Car",
    "",
    "**Check charge, belongings and photos: three small checks that make returns faster.**",
    "",
    "![Checking the trunk before returning](assets/return-check.png)",
    "",
    "*Do not leave the cable behind.*",
    "",
    "Look at the battery first. [Charging notes][charging-en] and the [policy][].",
    "",
    "<!-- English article draft ends. -->",
    "",
    "---",
    "",
    "# C. 编辑与发布说明（不属于公开正文）",
    "",
    "正文之外的说明。[备选][unused]",
    "",
    "```text",
    "# prompt for the picture",
    "<!-- START ZH ARTICLE -->",
    "```",
    "",
    "<!-- 共用链接定义：保留用到的定义。 -->",
    "",
    "[charging-zh]: https://example.org/zh/charging",
    "[charging-en]: https://example.org/en/charging",
    '[policy]: https://example.org/policy "Policy"',
    "[unused]: https://example.org/unused",
    "",
  );

  it("understands the Chinese comment wording, drops the dek and carries the link definitions", () => {
    expect(splitHandoff(second)).toEqual({
      zh: {
        title: "还车前，先做这三件事",
        seoTitle: "还车前检查清单",
        seoDescription: "还车前看电量、物品和照片。",
        excerpt: "三件小事，让还车更快。",
        markdown: text(
          "![还车前检查后备厢](assets/return-check.png)",
          "*图注：别把充电线落在车里。*",
          "",
          "电量够不够，先看一眼。[充电说明][Charging-ZH]",
          "",
          "> 我想确认一下［日期］的还车时间。可以帮我看看 [订单] 吗？",
          "",
          "1. 看电量",
          "2. 拿物品",
          "",
          "[charging-zh]: https://example.org/zh/charging",
        ),
      },
      en: {
        title: "Three Things to Do Before You Return the Car",
        seoTitle: "Return Checklist for Renters",
        seoDescription: "Check charge, belongings and photos before you return the car.",
        excerpt: "Three small checks that make returns faster.",
        markdown: text(
          "![Checking the trunk before returning](assets/return-check.png)",
          "*Do not leave the cable behind.*",
          "",
          "Look at the battery first. [Charging notes][charging-en] and the [policy][].",
          "",
          "[charging-en]: https://example.org/en/charging",
          '[policy]: https://example.org/policy "Policy"',
        ),
      },
      slug: "return-checklist-for-renters",
      category: "rental",
      tags: ["还车", "Returns", "充电", "Charging"],
      images: ["assets/return-check.png"],
      notes: ["layout:markers", "dropped:dek", "dropped:seo-table", "dropped:editor-note"],
    });
  });

  it("keeps a bold opening line that says something else than the summary", () => {
    const result = splitHandoff(text("| Field | English |", "|---|---|", "| Meta description | Check charge, belongings and photos before you return the car. |", "", "<!-- START EN ARTICLE -->", "", "# Returning the car", "", "**Updated for winter opening hours.**", "", "Look at the battery first.", "", "<!-- END EN ARTICLE -->"));
    expect(result.en?.markdown).toBe(text("**Updated for winter opening hours.**", "", "Look at the battery first."));
    expect(result.notes).toEqual(["layout:markers", "dropped:seo-table", "missing:zh"]);
  });

  it("keeps a bold opening line that shares only everyday words with the summary", () => {
    const result = splitHandoff(text("| Field | English |", "|---|---|", "| Meta description | Check charge, belongings and photos before you return the car. |", "| Excerpt | Three small checks that make returns faster. |", "", "<!-- START EN ARTICLE -->", "", "# Returning the car", "", "**Last updated in November. Rates and rules can change before you travel.**", "", "Look at the battery first.", "", "<!-- END EN ARTICLE -->"));
    expect(result.en?.markdown).toBe(text("**Last updated in November. Rates and rules can change before you travel.**", "", "Look at the battery first."));
    expect(result.notes).toEqual(["layout:markers", "dropped:seo-table", "missing:zh"]);
  });

  it("ignores start and end comments that are only quoted inside a sentence", () => {
    const result = splitHandoff(text("> Copy the text between `<!-- START ZH ARTICLE -->` and `<!-- END ZH ARTICLE -->` into the Chinese page.", "", "| Field | 中文 | English |", "|---|---|---|", "| SEO title | 胎压灯亮了怎么办｜Movia | Tire Pressure Warning \\| Movia |", "| Meta description | 先停车，再看读数。 | Pull over, then read the numbers. |", "", "<!-- START ZH ARTICLE -->", "", "# 胎压灯亮了怎么办", "", "胎压灯亮了，不一定是爆胎。", "", "<!-- END ZH ARTICLE -->", "", "<!-- START EN ARTICLE -->", "", "# What to Do When the Tire Light Comes On", "", "A tire light does not always mean a flat.", "", "<!-- END EN ARTICLE -->"));
    expect(result.zh).toEqual({ title: "胎压灯亮了怎么办", seoTitle: "胎压灯亮了怎么办", seoDescription: "先停车，再看读数。", excerpt: "先停车，再看读数。", markdown: "胎压灯亮了，不一定是爆胎。" });
    expect(result.en).toEqual({ title: "What to Do When the Tire Light Comes On", seoTitle: "Tire Pressure Warning", seoDescription: "Pull over, then read the numbers.", excerpt: "Pull over, then read the numbers.", markdown: "A tire light does not always mean a flat." });
    expect(result.notes).toEqual(["layout:markers", "dropped:seo-table", "dropped:editor-note"]);
  });

  it("keeps an italic opening line that is not a byline", () => {
    const result = splitHandoff(text("<!-- START EN ARTICLE -->", "", "# Returning the car", "", "*A short note for first-time renters.*", "", "Look at the battery first.", "", "<!-- END EN ARTICLE -->"));
    expect(result.en?.markdown).toBe(text("*A short note for first-time renters.*", "", "Look at the battery first."));
  });

  it("runs to the next marker when an end comment is missing", () => {
    const result = splitHandoff(text("<!-- 中文正文开始 -->", "", "# 中文标题", "", "中文正文只有这一段。", "", "<!-- 英文正文开始 -->", "", "# English title", "", "The English body is one paragraph.", "", "<!-- 英文正文结束 -->", "", "编辑备注：图片稍后补。"));
    expect(result.zh).toEqual({ title: "中文标题", markdown: "中文正文只有这一段。" });
    expect(result.en).toEqual({ title: "English title", markdown: "The English body is one paragraph." });
    expect(result.notes).toEqual(["layout:markers", "dropped:editor-note"]);
  });

  it("leaves out the label heading of the next section when an end comment is missing", () => {
    const result = splitHandoff(text("# A. 中文文章", "", "<!-- 中文正文开始 -->", "", "# 中文标题", "", "中文正文只有这一段。", "", "---", "", "# B. English Article", "", "<!-- English article begins. -->", "", "# English title", "", "The English body is one paragraph.", "", "<!-- English article draft ends. -->"));
    expect(result.zh).toEqual({ title: "中文标题", markdown: "中文正文只有这一段。" });
    expect(result.en).toEqual({ title: "English title", markdown: "The English body is one paragraph." });
    expect(result.notes).toEqual(["layout:markers"]);
  });
});

describe("fallbacks", () => {
  it("returns nothing for empty input", () => {
    const empty = { zh: null, en: null, tags: [], images: [], notes: ["layout:unknown", "missing:zh", "missing:en"] };
    expect(splitHandoff("")).toEqual(empty);
    expect(splitHandoff(" \n\t\r\n")).toEqual(empty);
    expect(splitHandoff(undefined as unknown as string)).toEqual(empty);
    expect(splitHandoff(42 as unknown as string)).toEqual(empty);
  });

  it("returns the whole text as one body when nothing is recognised", () => {
    const zh = text("周末去海边，记得带外套。", "", "## 几点出发", "", "海边风大，早一点走。");
    const en = text("Bring a jacket to the coast.", "", "It gets windy after four.");
    expect(splitHandoff(zh)).toEqual({ zh: { markdown: zh }, en: null, tags: [], images: [], notes: ["layout:unknown", "missing:en"] });
    expect(splitHandoff(en)).toEqual({ zh: null, en: { markdown: en }, tags: [], images: [], notes: ["layout:unknown", "missing:zh"] });
  });

  it("keeps several same-language H1 parts together and lowers the later ones", () => {
    const result = splitHandoff(text("# First part", "", "Text one.", "", "# Second part", "", "Text two."));
    expect(result.en).toEqual({ title: "First part", markdown: text("Text one.", "", "## Second part", "", "Text two.") });
    expect(result.notes).toEqual(["layout:unknown", "missing:zh"]);
  });

  it("gives back a returned body unchanged", () => {
    const body = text("![Cover](assets/cover.png)", "*A caption.*", "", "First paragraph.", "", "- one", "- two", "", "See the [guide][guide].", "", "[guide]: https://example.org/guide");
    expect(splitHandoff(body).en).toEqual({ markdown: body });
  });

  it("survives broken input", () => {
    for (const source of ["---\ntitle: never closed\n\n# Title\n\nBody text.", "# Title\n\nBody <!-- never closed\n\nMore text.", "# Title\n\n```\ncode never closed\n\nMore text.", "<!-- START ZH ARTICLE -->", "<!-- END EN ARTICLE -->\n\n# Title\n\nBody text.", "---\n__proto__: x\nconstructor: y\ntoString: z\n---\n\n# Title\n\nBody text.", "| a | b |\n|---|---|", ":::callout\nnever closed", "[x]: \n[y]:\n![", "#".repeat(50), "-->"]) {
      const result = splitHandoff(source);
      expect(Array.isArray(result.notes) && result.notes[0].startsWith("layout:")).toBe(true);
      for (const lang of ["zh", "en"] as const) expect(result[lang]?.markdown.includes("<!--") ?? false).toBe(false);
    }
    expect(splitHandoff("# Title\n\nBody <!-- never closed\n\nMore text.").en?.markdown).toBe("Body\n\nMore text.");
    expect(splitHandoff("---\ntitle: never closed\n\n# Title\n\nBody text.").en).toEqual({ title: "Title", markdown: "Body text." });
  });

  it("stays fast on hostile input", () => {
    const shapes = ["*", "[", "![", "](", "](x", "<!--", "<!-- a -->", "|", "> ", "- ", "# ", "`", "**a", "[a][", " ", "\t", "/", "\\|", ":::", "---\n", "a: b\n", "<!-- START ZH -->\n", "1. ", "_", "![a](", "![a](b) ", "[a]: b\n", "[a]: b.c\n[x][a] ", "|a|b|\n", "**a:** b\n", "# 中\n", "> a\n"];
    let slowest = 0;
    for (const shape of shapes) {
      const source = shape.repeat(Math.ceil(200000 / shape.length));
      const flat = source.split("\n").join(" ");
      const cases = [source, `# 标题\n\n${source}\n\n# Title\n\n${source}`, `---\ntitle: ${flat}\n---\n\n# Title\n\n**${flat}`, `| SEO title | ${flat} |\n| Tags | ${flat} |\n\n<!-- START ZH ARTICLE -->\n# 标题\n\n${source}\n<!-- END ZH ARTICLE -->`];
      for (const text of cases) {
        const started = performance.now();
        splitHandoff(text);
        slowest = Math.max(slowest, performance.now() - started);
      }
    }
    expect(slowest).toBeLessThan(1000);
  }, 60000);
});

describe("fields", () => {
  const seoTitle = (value: string) => splitHandoff(text("# Title", "", `**SEO title:** ${value}`, "", "Body text that is long enough to keep this little test article in English.")).en?.seoTitle;

  it("removes a trailing brand from the SEO title", () => {
    expect(seoTitle("Night Driving Guide | Movia")).toBe("Night Driving Guide");
    expect(seoTitle("夜间开车指南｜Movia")).toBe("夜间开车指南");
    expect(seoTitle("Night Driving Guide | Movia Technologies")).toBe("Night Driving Guide");
    expect(seoTitle("Night Driving Guide · Movia Journal")).toBe("Night Driving Guide");
    expect(seoTitle("夜间开车指南｜微智驾租车")).toBe("夜间开车指南");
    expect(seoTitle("Night Driving Guide - Movia")).toBe("Night Driving Guide");
    expect(seoTitle("夜间开车指南｜灯光与车距 | Movia 微智驾")).toBe("夜间开车指南｜灯光与车距");
    expect(seoTitle("**Night Driving Guide \\| Movia**")).toBe("Night Driving Guide");
    expect(seoTitle("Movia News | Movia")).toBe("Movia News");
  });

  it("keeps an SEO title that only mentions the brand", () => {
    expect(seoTitle("Why Movia · A Short Story")).toBe("Why Movia · A Short Story");
    expect(seoTitle("Lights | Distance | Rest")).toBe("Lights | Distance | Rest");
    expect(seoTitle("Movia")).toBe("Movia");
  });

  it("lets the excerpt and the SEO description stand in for each other", () => {
    const onlyExcerpt = splitHandoff(front(["locale: en", "excerpt: Short summary."], "# Title", "", "Body text.")).en;
    const onlyDescription = splitHandoff(front(["locale: en", "seo_description: Search summary."], "# Title", "", "Body text.")).en;
    const neither = splitHandoff(front(["locale: en", "status: draft"], "# Title", "", "Body text.")).en;
    expect(onlyExcerpt).toEqual({ title: "Title", seoDescription: "Short summary.", excerpt: "Short summary.", markdown: "Body text." });
    expect(onlyDescription).toEqual({ title: "Title", seoDescription: "Search summary.", excerpt: "Search summary.", markdown: "Body text." });
    expect(neither).toEqual({ title: "Title", markdown: "Body text." });
  });

  it("prefers a title field over the H1", () => {
    expect(splitHandoff(front(["locale: en", 'title: "Field title"'], "# Heading title", "", "Body text.")).en?.title).toBe("Field title");
    expect(splitHandoff(text("# Heading title", "", "**Suggested H1:** Label title", "", "Body text.")).en?.title).toBe("Label title");
  });

  it("gives unsuffixed frontmatter fields to the language that has no suffix", () => {
    const result = splitHandoff(front(['title: "FSD v14 2026"', 'title_en: "FSD v14 in 2026"', "seo_title: FSD v14 2026 | Movia"], "# 中文版", "", "这是中文正文。", "", "# English Version", "", "This is the English body."));
    expect(result.zh).toEqual({ title: "FSD v14 2026", seoTitle: "FSD v14 2026", markdown: "这是中文正文。" });
    expect(result.en).toEqual({ title: "FSD v14 in 2026", markdown: "This is the English body." });
  });

  it("accepts a slug only in its final shape", () => {
    const slug = (...keys: string[]) => splitHandoff(front(["locale: en", ...keys], "# Title", "", "Body text.")).slug;
    expect(slug("slug: night-drive-basics")).toBe("night-drive-basics");
    expect(slug("slug: /en/blog/night-drive-basics/")).toBe("night-drive-basics");
    expect(slug('slug: "`night-drive-basics`"')).toBe("night-drive-basics");
    expect(slug("slug: Night_Drive", "translation_key: night-drive-basics")).toBe("night-drive-basics");
    expect(slug("translation_key: night-drive-basics")).toBe("night-drive-basics");
    expect(slug("slug: Night Drive Basics")).toBeUndefined();
    expect(slug("slug: night--drive")).toBeUndefined();
    expect(slug("status: draft")).toBeUndefined();
  });

  it("maps category labels in both languages and accepts ids", () => {
    const category = (label: string) => splitHandoff(front(["locale: en", `category: ${label}`], "# Title", "", "Body text.")).category;
    const labels = { fsd: ["FSD 指南", "FSD Guides"], travel: ["加州旅行", "California Travel"], tips: ["特斯拉租车入门", "Tesla Rental Tips"], driving: ["美国自驾指南", "Driving in California"], rental: ["租车指南", "Rental Advice"], news: ["Movia 动态", "Movia News"] };
    for (const [id, names] of Object.entries(labels)) for (const name of names) expect(category(name)).toBe(id);
    expect(category("fsd guides")).toBe("fsd");
    expect(category("MOVIA NEWS")).toBe("news");
    expect(category('"movia 动态"')).toBe("news");
    expect(category("travel")).toBe("travel");
    expect(category("旅行灵感")).toBeUndefined();
    expect(category("Driving Guides")).toBeUndefined();
    expect(category("constructor")).toBeUndefined();
  });

  it("maps a category value that gives the label in both languages", () => {
    expect(splitHandoff(front(["locale: en", "category: Tesla Rental Tips / 特斯拉租车入门"], "# Title", "", "Body text.")).category).toBe("tips");
    expect(splitHandoff(text("**分类 / Category：** **FSD 指南** / FSD Guides", "", "# Title", "", "Body text.")).category).toBe("fsd");
    expect(splitHandoff(front(["locale: en", "category: Road Trips / Travel Ideas"], "# Title", "", "Body text.")).category).toBeUndefined();
  });

  it("collects raw tags once and in order", () => {
    const result = splitHandoff(text("| Field | Value |", "|---|---|", "| Tags | `FSD`, `Road Trip`, `FSD` |", "| 标签 | 自驾、 夜间驾驶 ，FSD |", "", "# Title", "", "Body text."));
    expect(result.tags).toEqual(["FSD", "Road Trip", "自驾", "夜间驾驶"]);
    expect(result.notes).toEqual(["layout:single-language", "dropped:seo-table", "missing:zh"]);
  });

  it("reads title tag and meta description tag labels as SEO fields", () => {
    const result = splitHandoff(text("| Field | Value |", "|---|---|", "| Title tag | Night Driving Guide \\| Movia |", "| Meta description tag | Lights, distance and rest. |", "| Tags | Night Driving, Safety |", "", "# Night driving", "", "It is harder to judge distance after dark."));
    expect(result.en).toEqual({ title: "Night driving", seoTitle: "Night Driving Guide", seoDescription: "Lights, distance and rest.", excerpt: "Lights, distance and rest.", markdown: "It is harder to judge distance after dark." });
    expect(result.tags).toEqual(["Night Driving", "Safety"]);
  });

  it("reads label lines in front of the article and stops at the first line of content", () => {
    const result = splitHandoff(text("**SEO title:** Night Driving Guide | Movia", "**Slug:** `night-drive-basics`", "**Tags:** Night Driving, 夜间驾驶", "", "# Night driving", "", "**Category:** FSD Guides", "", "**Author:** the editorial team", "", "**Tip:** Clean the windshield first.", "", "It is harder to judge distance after dark."));
    expect(result.en).toEqual({ title: "Night driving", seoTitle: "Night Driving Guide", markdown: text("**Tip:** Clean the windshield first.", "", "It is harder to judge distance after dark.") });
    expect([result.slug, result.category, result.tags]).toEqual(["night-drive-basics", "fsd", ["Night Driving", "夜间驾驶"]]);
    expect(result.notes).toEqual(["layout:single-language", "dropped:seo-table", "missing:zh"]);
  });

  it("reads a field table that sits on top of the body", () => {
    const result = splitHandoff(text("# 夜里开车", "", "| 字段 | 内容 |", "| --- | --- |", "| SEO 标题 | 夜间开车指南｜Movia |", "| 摘要 | 慢一点，看远一点。 |", "| Slug | night-drive-basics |", "", "天黑以后，能看清的东西少了。", "", "| 灯 | 用途 |", "| --- | --- |", "| 近光灯 | 城市道路 |"));
    expect(result.zh).toEqual({ title: "夜里开车", seoTitle: "夜间开车指南", seoDescription: "慢一点，看远一点。", excerpt: "慢一点，看远一点。", markdown: text("天黑以后，能看清的东西少了。", "", "| 灯 | 用途 |", "| --- | --- |", "| 近光灯 | 城市道路 |") });
    expect(result.slug).toBe("night-drive-basics");
  });
});

describe("body", () => {
  it("removes notes for the publisher and keeps notes for the reader", () => {
    const zh = splitHandoff(
      text(
        "# 周末路况提醒",
        "",
        "出发前看一眼路况。",
        "",
        "> **这一段属于时效信息，网站建议每周更新或在活动结束后删除。**",
        "",
        "> **先看重点：** 周六上午车最多。",
        "",
        "*以下为编辑时的时间敏感信息；上线后建议每周更新或移除这一段。*",
        "",
        "*本文仅供参考，实际以现场标志为准。*",
        "",
        "> **编辑核对日期：2026 年 11 月 20 日。这不是实时路况播报。**",
        ">",
        "> - 周六上午有单向放行",
        "",
        "- 周五晚上出城方向较堵",
        "- 发布前请核对最新路况",
        "",
        "**Sources policy:** External links appear only at the end.",
      ),
    );
    expect(zh.zh?.markdown).toBe(text("出发前看一眼路况。", "", "> **先看重点：** 周六上午车最多。", "", "*本文仅供参考，实际以现场标志为准。*", "", "> **编辑核对日期：2026 年 11 月 20 日。这不是实时路况播报。**", ">", "> - 周六上午有单向放行", "", "- 周五晚上出城方向较堵"));
    expect(zh.notes).toEqual(["layout:single-language", "dropped:editor-note", "missing:en"]);
    const en = splitHandoff(
      text(
        "# Weekend road notes",
        "",
        "> **EDITORIAL PACKAGE — NOT FOR DIRECT PUBLICATION**",
        "> Internal use.",
        "",
        "Check the roads before you leave.",
        "",
        "> **This is time-sensitive. Update weekly or remove after the event ends.**",
        "",
        "*This snapshot is current to the latest edit. Refresh it weekly or remove it once outdated.*",
        "",
        "> **The short version:** Saturday mornings are busiest.",
        "",
        "*Reviewed in November. Rules can change; check the official pages before you travel.*",
        "",
        "- Friday evenings are slow heading out of town",
        "- Reports should be refreshed before publication.",
        "- Publisher: verify the closure dates before publishing.",
        "",
        "## Before you go",
        "",
        "Fill up the night before.",
        "",
        "### Notes for the layout (do not publish)",
        "",
        "Swap the photo.",
        "",
        "## On the road",
        "",
        "Keep right unless you are passing.",
        "",
        "## Image prompts (for editors only)",
        "",
        "A wide photo of a road.",
        "",
        "## More prompts",
        "",
        "Another photo.",
      ),
    );
    expect(en.en?.markdown).toBe(
      text(
        "Check the roads before you leave.",
        "",
        "> **The short version:** Saturday mornings are busiest.",
        "",
        "*Reviewed in November. Rules can change; check the official pages before you travel.*",
        "",
        "- Friday evenings are slow heading out of town",
        "",
        "## Before you go",
        "",
        "Fill up the night before.",
        "",
        "## On the road",
        "",
        "Keep right unless you are passing.",
      ),
    );
  });

  it("does not read ordinary advice as a note for the publisher", () => {
    const body = text(
      "> Remove the cable after the session ends, then move the car.",
      "",
      "*We update this guide monthly.*",
      "",
      "*Fact-checked before publication on November 20.*",
      "",
      "**Update the car's software when it asks you to.**",
      "",
      "> 具体价格请在网站上核对，出发前再确认一次。",
      "",
      "*以下为时效信息，出发前请再确认。*",
      "",
      "- Check the tire pressure before driving",
      "- 新功能上线前，车辆会先收到更新提示",
      "",
      "**Tip:** Review your route weekly if you commute.",
    );
    const result = splitHandoff(text("# Charging notes", "", body));
    expect(result.en?.markdown).toBe(body);
    expect(result.notes).toEqual(["layout:single-language", "missing:zh"]);
  });

  it("drops a note for the publisher that sits right under a heading", () => {
    const result = splitHandoff(text("# Weekend road notes", "", "Check the roads before you leave.", "", "## Saturday update", "*This snapshot is current to the latest edit. Refresh it weekly or remove it once outdated.*", "", "- Friday evenings are slow heading out of town"));
    expect(result.en?.markdown).toBe(text("Check the roads before you leave.", "", "## Saturday update", "", "- Friday evenings are slow heading out of town"));
    expect(result.notes).toEqual(["layout:single-language", "dropped:editor-note", "missing:zh"]);
  });

  it("keeps advice about releases and charging that only resembles a note for the publisher", () => {
    const zh = text("这一段中文正文讲的是软件更新以后要留意的几件事情。", "", "- 新版本上线后，请留意官方更新说明", "- 第二批发布后，建议先在车机上核对软件版本", "", "**软件发布后，建议及时更新。**");
    const en = text("A few habits make charging stops easier.", "", "- When charging finishes, press the button on the handle and remove it once the light turns white.", "- If you use a sunshade, remove it when you drive.");
    const first = splitHandoff(text("# 更新提醒", "", zh));
    const second = splitHandoff(text("# Charging notes", "", en));
    expect(first.zh?.markdown).toBe(zh);
    expect(first.notes).toEqual(["layout:single-language", "missing:en"]);
    expect(second.en?.markdown).toBe(en);
    expect(second.notes).toEqual(["layout:single-language", "missing:zh"]);
  });

  it("leaves callouts, containers and code blocks as they are", () => {
    const kept = [":::callout Before you walk away", "Check the hours.  ", "---", "# not a heading", "<!-- gone -->", ":::", "", ":::faq", "### Is it free?", "Not always.", ":::", "", "```text", "# sample  ", "<!-- kept -->", "[ref]: https://example.org/ref", "```"];
    const result = splitHandoff(text("# Parking signs", "", "Read every sign on the pole.", "", ...kept, "", "# Second part", "", "More text."));
    expect(result.en).toEqual({
      title: "Parking signs",
      markdown: text("Read every sign on the pole.", "", ":::callout Before you walk away", "Check the hours.", "---", "# not a heading", "", ":::", "", ":::faq", "### Is it free?", "Not always.", ":::", "", "```text", "# sample", "<!-- kept -->", "[ref]: https://example.org/ref", "```", "", "## Second part", "", "More text."),
    });
    expect(result.notes).toEqual(["layout:unknown", "dropped:editor-note", "missing:zh"]);
  });

  it("puts an italic caption on the line after its image and lists each image once", () => {
    const result = splitHandoff(
      text(
        "# Title",
        "",
        "![One](assets/one.png)",
        "",
        "",
        "_Caption with **bold** and *slanted* words._",
        "",
        "![Two](<assets/two two.png> \"Title\")",
        "*Already attached.*",
        "",
        "![Three](https://cdn.example.org/three.webp)",
        "",
        "*Not a caption* because the paragraph goes on.",
        "",
        "![Four](assets/one.png)",
        "Text right after an image.",
        "",
        "Inline ![icon](assets/icon.svg) image and a [link](assets/not-an-image.pdf).",
      ),
    );
    expect(result.en?.markdown).toBe(
      text(
        "![One](assets/one.png)",
        "*Caption with bold and slanted words.*",
        "",
        "![Two](<assets/two two.png> \"Title\")",
        "*Already attached.*",
        "",
        "![Three](https://cdn.example.org/three.webp)",
        "",
        "*Not a caption* because the paragraph goes on.",
        "",
        "![Four](assets/one.png)",
        "Text right after an image.",
        "",
        "Inline ![icon](assets/icon.svg) image and a [link](assets/not-an-image.pdf).",
      ),
    );
    expect(result.images).toEqual(["assets/one.png", "assets/two", "https://cdn.example.org/three.webp", "assets/icon.svg"]);
  });

  it("carries each link definition only with the body that uses it", () => {
    const result = splitHandoff(text("# 中文版", "", "看[手册][Manual]和[地图][]。价格是 [$30] 一天。", "", "# English Version", "", "Read the [manual][manual]. Dates look like [date].", "", "[manual]: https://example.org/manual", "[地图]: https://example.org/map", "[date]: not a link target", "[spare]: https://example.org/spare"));
    expect(result.zh?.markdown).toBe(text("看[手册][Manual]和[地图][]。价格是 [$30] 一天。", "", "[manual]: https://example.org/manual", "[地图]: https://example.org/map"));
    expect(result.en?.markdown).toBe(text("Read the [manual][manual]. Dates look like [date].", "", "[date]: not a link target", "", "[manual]: https://example.org/manual"));
  });

  it("takes a link definition from the section that uses it when both languages reuse a label", () => {
    const result = splitHandoff(text("# 中文版", "", "# 车型怎么选", "", "先看[车型][fleet]，再看[价格][1]和[手册][manual]。", "", "[fleet]: https://example.org/zh/fleet", "[1]: https://example.org/zh/prices", "", "# English Version", "", "# Choosing a car", "", "Start with the [fleet][fleet], then the [prices][1] and the [manual][manual].", "", "[fleet]: https://example.org/en/fleet", "[1]: https://example.org/en/prices", "[manual]: https://example.org/manual"));
    expect(result.zh?.markdown).toBe(text("先看[车型][fleet]，再看[价格][1]和[手册][manual]。", "", "[fleet]: https://example.org/zh/fleet", "[1]: https://example.org/zh/prices", "[manual]: https://example.org/manual"));
    expect(result.en?.markdown).toBe(text("Start with the [fleet][fleet], then the [prices][1] and the [manual][manual].", "", "[fleet]: https://example.org/en/fleet", "[1]: https://example.org/en/prices", "[manual]: https://example.org/manual"));
    const marked = splitHandoff(text("<!-- START ZH ARTICLE -->", "# 车型怎么选", "", "先看[车型][fleet]。", "", "[fleet]: https://example.org/zh/fleet", "<!-- END ZH ARTICLE -->", "", "<!-- START EN ARTICLE -->", "# Choosing a car", "", "Start with the [fleet][fleet].", "", "[fleet]: https://example.org/en/fleet", "<!-- END EN ARTICLE -->"));
    expect(marked.zh?.markdown).toBe(text("先看[车型][fleet]。", "", "[fleet]: https://example.org/zh/fleet"));
    expect(marked.en?.markdown).toBe(text("Start with the [fleet][fleet].", "", "[fleet]: https://example.org/en/fleet"));
  });
});

describe("cover wording", () => {
  it("reads the kicker and the cover line from the field table", () => {
    const result = splitHandoff(
      text(
        "# Rain driving draft",
        "",
        "| Field | 中文 | English |",
        "|---|---|---|",
        "| SEO title | 雨天开车提醒｜Movia | Rain Driving Tips \\| Movia |",
        "| Cover kicker / 封面小标题 | 雨天驾驶 | Rain driving |",
        "| Cover line / 封面标语 | 先慢下来，再看路。 | Slow down first. Then read the road. |",
        "",
        "# 中文版",
        "",
        "# 雨天开车",
        "",
        "雨刚开始下的时候，路面最滑。",
        "",
        "# English Version",
        "",
        "# Driving in the rain",
        "",
        "Roads are slickest when the rain has just started.",
      ),
    );
    expect(result.zh).toMatchObject({ title: "雨天开车", kicker: "雨天驾驶", line: "先慢下来，再看路。" });
    expect(result.en).toMatchObject({ title: "Driving in the rain", kicker: "Rain driving", line: "Slow down first. Then read the road." });
  });

  it("reads them from the frontmatter too", () => {
    const result = splitHandoff(text("---", "title_zh: 雨天开车", "title_en: Driving in the rain", "kicker_zh: 雨天驾驶", "kicker_en: Rain driving", "cover_line_zh: 先慢下来。", "cover_line_en: Slow down first.", "---", "", "# 中文版", "", "雨刚开始下的时候，路面最滑。", "", "# English Version", "", "Roads are slickest when the rain has just started."));
    expect(result.zh).toMatchObject({ kicker: "雨天驾驶", line: "先慢下来。" });
    expect(result.en).toMatchObject({ kicker: "Rain driving", line: "Slow down first." });
  });

  it("does not take a headline or an image caption row for them", () => {
    const result = splitHandoff(text("| Field | 中文 | English |", "|---|---|---|", "| Headline | 雨天开车 | Driving in the rain |", "| Cover image caption | 雨中的公路 | A road in the rain |", "", "# 中文版", "", "雨刚开始下的时候，路面最滑。", "", "# English Version", "", "Roads are slickest when the rain has just started."));
    expect(result.zh?.kicker).toBeUndefined();
    expect(result.zh?.line).toBeUndefined();
    expect(result.en?.kicker).toBeUndefined();
    expect(result.en?.line).toBeUndefined();
  });
});

describe("one file per language", () => {
  const zh = text("---", "title: 雨天开车", "slug: rain-driving-tips", "lang: zh", "tags: [雨天, 安全]", "---", "", "雨刚开始下的时候，路面最滑。", "", "![雨天的公路](assets/rain-cover.jpg)");
  const en = text("---", "title: Driving in the rain", "slug: rain-driving-tips", "lang: en", "category: Driving in California", "tags: [Rain, Safety]", "---", "", "Roads are slickest when the rain has just started.", "", "![A road in the rain](assets/rain-cover.jpg)");

  it("joins the two halves into one article", () => {
    const merged = mergeHandoffs([splitHandoff(zh), splitHandoff(en)]);
    expect(merged.zh?.title).toBe("雨天开车");
    expect(merged.en?.title).toBe("Driving in the rain");
    expect(merged.slug).toBe("rain-driving-tips");
    expect(merged.category).toBe("driving");
    expect(merged.tags).toEqual(["雨天", "安全", "Rain", "Safety"]);
    expect(merged.images).toEqual(["assets/rain-cover.jpg"]);
    expect(merged.notes.some((note) => note.startsWith("missing:"))).toBe(false);
  });

  it("gives the same result whichever file comes first", () => {
    const one = mergeHandoffs([splitHandoff(zh), splitHandoff(en)]);
    const other = mergeHandoffs([splitHandoff(en), splitHandoff(zh)]);
    expect(other.zh).toEqual(one.zh);
    expect(other.en).toEqual(one.en);
    expect(other.slug).toBe(one.slug);
  });

  it("still says which language is missing when both files are in the same one", () => {
    const merged = mergeHandoffs([splitHandoff(zh), splitHandoff(zh)]);
    expect(merged.en).toBeNull();
    expect(merged.notes).toContain("missing:en");
  });
});

describe("package with labelled sections and editor remarks", () => {
  const source = text(
    "# Movia Blog｜周末短途攻略（中英双语）",
    "",
    "> **交付说明（编辑用，不发布）** 事实核查：2026-01-02。",
    "",
    "## 封面文案与 SEO 发布字段",
    "",
    "| Field | 中文 | English |",
    "| --- | --- | --- |",
    "| **Cover kicker / 封面小标题** | 周末短途 | Weekend Escape |",
    "| **Cover line / 封面标语** | 两天也能走得很远。 | Two days can take you far. |",
    "| **推荐 H1** | 周末去哪儿？三条不赶路的路线 | Where to Go This Weekend: Three Unhurried Routes |",
    "| **SEO title** | 周末短途路线推荐 | Weekend Routes Worth the Drive |",
    "| **Meta description** | 三条适合周末的路线，附出发时间建议。 | Three weekend routes with departure tips. |",
    "| **URL slug** | `weekend-routes-guide` | `weekend-routes-worth-the-drive` |",
    "| **Primary keyword** | 周末去哪 | weekend routes |",
    "| **Suggested tags / 网站标签** | Weekend、Road Trips | Weekend, Road Trips |",
    "",
    "### 备选标题（供编辑选择）",
    "",
    "1. 周末不知道去哪？ / *Nowhere to Go This Weekend?*",
    "",
    "**图片插入规则：** 封面见 `assets/weekend-cover.jpg`。",
    "",
    "---",
    "",
    "# 中文正文（发布时从此处提取）",
    "",
    "# 周末去哪儿？三条不赶路的路线",
    "",
    "周末只有两天，路线短一点更舒服。",
    "",
    "![海边公路](assets/weekend-cover.jpg)",
    "*示意图，并非实拍。*",
    "",
    "## 第一条：沿海",
    "",
    "早上出发，中午到。",
    "",
    "### 常见问题 FAQ",
    "",
    "**Q：需要早起吗？** 八点前出发就够了。",
    "",
    "---",
    "",
    "# English Article (publish separately)",
    "",
    "# Where to Go This Weekend: Three Unhurried Routes",
    "",
    "Two days is short, so keep the route short too.",
    "",
    "![Coastal road](assets/weekend-cover.jpg)",
    "*Illustration, not a photograph.*",
    "",
    "## Route one: the coast",
    "",
    "Leave in the morning and arrive by noon.",
    "",
    "---",
    "",
    "## 统一官方参考资料 / Official References（发布时置于各语言文章末尾）",
    "",
    "> 仅保留支持主要事实的官方一手来源；未加入任何其他租车公司的文章或推广链接。",
    "",
    "1. **State Parks** — [Hours](https://example.org/hours)",
    "",
    "## 编辑备注（不发布）",
    "",
    "### 上线核对",
    "",
    "1. 出发前再确认天气。",
    "",
  );

  it("fills every field and keeps only the two articles", () => {
    expect(splitHandoff(source)).toEqual({
      zh: {
        title: "周末去哪儿？三条不赶路的路线",
        seoTitle: "周末短途路线推荐",
        seoDescription: "三条适合周末的路线，附出发时间建议。",
        excerpt: "三条适合周末的路线，附出发时间建议。",
        kicker: "周末短途",
        line: "两天也能走得很远。",
        markdown: text(
          "周末只有两天，路线短一点更舒服。",
          "",
          "![海边公路](assets/weekend-cover.jpg)",
          "*示意图，并非实拍。*",
          "",
          "## 第一条：沿海",
          "",
          "早上出发，中午到。",
          "",
          "### 常见问题 FAQ",
          "",
          "**Q：需要早起吗？** 八点前出发就够了。",
          "",
          "## 官方参考资料",
          "",
          "1. **State Parks** — [Hours](https://example.org/hours)",
        ),
      },
      en: {
        title: "Where to Go This Weekend: Three Unhurried Routes",
        seoTitle: "Weekend Routes Worth the Drive",
        seoDescription: "Three weekend routes with departure tips.",
        excerpt: "Three weekend routes with departure tips.",
        kicker: "Weekend Escape",
        line: "Two days can take you far.",
        markdown: text(
          "Two days is short, so keep the route short too.",
          "",
          "![Coastal road](assets/weekend-cover.jpg)",
          "*Illustration, not a photograph.*",
          "",
          "## Route one: the coast",
          "",
          "Leave in the morning and arrive by noon.",
          "",
          "## Official References",
          "",
          "1. **State Parks** — [Hours](https://example.org/hours)",
        ),
      },
      slug: "weekend-routes-worth-the-drive",
      tags: ["Weekend", "Road Trips"],
      images: ["assets/weekend-cover.jpg"],
      notes: ["layout:sections", "dropped:seo-table", "dropped:editor-note"],
    });
  });

  it("finds the two articles without the label headings", () => {
    const bare = source.replace("# 中文正文（发布时从此处提取）\n\n", "").replace("# English Article (publish separately)\n\n", "");
    const result = splitHandoff(bare);
    expect(result.notes).toEqual(["layout:two-h1", "dropped:seo-table", "dropped:editor-note"]);
    expect([result.zh?.title, result.en?.title, result.zh?.kicker, result.en?.line]).toEqual(["周末去哪儿？三条不赶路的路线", "Where to Go This Weekend: Three Unhurried Routes", "周末短途", "Two days can take you far."]);
    expect(result.zh?.markdown.startsWith("周末只有两天")).toBe(true);
    expect(result.en?.markdown.endsWith("1. **State Parks** — [Hours](https://example.org/hours)")).toBe(true);
    expect(result.en?.markdown.includes("编辑备注")).toBe(false);
  });

  it("keeps a title that only mentions a language", () => {
    const result = splitHandoff(text("# Chinese New Year (publish early)", "", "Lanterns go up a week before.", "", "## Where to look", "", "Old town has the most."));
    expect(result.en?.title).toBe("Chinese New Year (publish early)");
    expect(result.notes).toEqual(["layout:single-language", "missing:zh"]);
  });

  it("treats a remark comment as a note, not as a language marker", () => {
    const result = splitHandoff(text("<!-- 中文：发布前请核对 -->", "", "# 夜里开车", "", "天黑以后慢一点。", "", "## 灯光", "", "先检查近光灯。"));
    expect(result.notes).toEqual(["layout:single-language", "dropped:editor-note", "missing:en"]);
    expect(result.zh?.title).toBe("夜里开车");
  });

  it("drops an editor section under a lower heading", () => {
    const result = splitHandoff(text("# 夜里开车", "", "天黑以后慢一点。", "", "## 灯光", "", "先检查近光灯。", "", "## 编辑备注（不发布）", "", "这一段不要上线。", "", "### 上线核对", "", "1. 再看一遍。"));
    expect(result.zh?.markdown).toBe(text("天黑以后慢一点。", "", "## 灯光", "", "先检查近光灯。"));
    expect(result.notes).toContain("dropped:editor-note");
  });
});
