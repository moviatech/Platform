import { describe, expect, it } from "vitest";
import { articleMeta, categoryForSection, decodeEntities, matchesPost, sitemapSlugs } from "./catalog";

describe("sitemapSlugs", () => {
  it("collects each article once across locales and skips the index and tag pages", () => {
    const xml = [
      "<url><loc>https://www.moviatech.ai/en/blog</loc></url>",
      "<url><loc>https://www.moviatech.ai/en/blog/fsd-quick-start</loc></url>",
      "<url><loc>https://www.moviatech.ai/zh/blog/fsd-quick-start</loc></url>",
      "<url><loc>https://www.moviatech.ai/zh/blog/highway-395-fall-road-trip</loc></url>",
      "<url><loc>https://www.moviatech.ai/zh/blog/tag/charging</loc></url>",
      "<url><loc>https://www.moviatech.ai/zh/vehicles/model-3</loc></url>",
    ].join("");
    expect(sitemapSlugs(xml)).toEqual(["fsd-quick-start", "highway-395-fall-road-trip"]);
  });
});

describe("articleMeta", () => {
  const html = `<head><meta property="og:title" content="Tom &amp; Jerry&#x27;s guide"/><meta property="og:image" content="https://www.moviatech.ai/blog/cover.webp"/><meta property="article:published_time" content="2026-11-17"/><meta content="Tesla Rental Tips" property="article:section"/></head>`;

  it("reads the title, cover, date and section", () => {
    expect(articleMeta(html)).toEqual({ title: "Tom & Jerry's guide", image: "https://www.moviatech.ai/blog/cover.webp", published: "2026-11-17", section: "Tesla Rental Tips" });
  });

  it("prefers the structured article data, which carries the real headline", () => {
    const page = `${html}<script type="application/ld+json">{"@type":"Organization","name":"Movia"}</script><script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"The real headline","image":"https://www.moviatech.ai/blog/real.webp","datePublished":"2026-11-16","articleSection":"Rental Advice"}</script>`;
    expect(articleMeta(page)).toEqual({ title: "The real headline", image: "https://www.moviatech.ai/blog/real.webp", published: "2026-11-16", section: "Rental Advice" });
  });

  it("falls back to the meta tags when the structured data is broken", () => {
    expect(articleMeta(`${html}<script type="application/ld+json">{not json</script>`).title).toBe("Tom & Jerry's guide");
  });

  it("drops values it cannot trust", () => {
    const odd = `<meta property="og:image" content="/relative.webp"/><meta property="article:published_time" content="yesterday"/>`;
    expect(articleMeta(odd)).toEqual({ title: null, image: null, published: null, section: null });
  });
});

describe("categoryForSection", () => {
  it("maps the website's section labels in both languages", () => {
    expect(categoryForSection("FSD 指南")).toBe("fsd");
    expect(categoryForSection("California Travel")).toBe("travel");
    expect(categoryForSection("特斯拉租车入门")).toBe("tips");
    expect(categoryForSection("Driving in California")).toBe("driving");
    expect(categoryForSection(" 租车指南 ")).toBe("rental");
    expect(categoryForSection("Movia News")).toBe("news");
  });

  it("leaves unknown labels empty", () => {
    expect(categoryForSection("Something new")).toBeNull();
    expect(categoryForSection(null)).toBeNull();
  });
});

describe("decodeEntities", () => {
  it("handles named and numeric entities", () => {
    expect(decodeEntities("A &amp; B &lt;C&gt; &#39;d&#39; &quot;e&quot; &#x4e2d;")).toBe("A & B <C> 'd' \"e\" 中");
  });
});

describe("matchesPost", () => {
  const post = { slug: "tesla-fsd-v14-2026-updates", title_zh: "Tesla FSD v14 又升级了", title_en: "Tesla FSD v14 Updates" };

  it("searches the slug and both titles without caring about case", () => {
    expect(matchesPost(post, "fsd V14")).toBe(true);
    expect(matchesPost(post, "升级")).toBe(true);
    expect(matchesPost(post, "2026-updates")).toBe(true);
    expect(matchesPost(post, "  ")).toBe(true);
    expect(matchesPost(post, "cybertruck")).toBe(false);
  });
});
