import { blogCategories, tagPattern, type ArticleBlock, type ArticleDraft, type BlogLocale, type ImageRef, type LiveArticle, type LiveLocale } from "./blocks";
import { compileMarkdown, countWords, h2Ids, headingTexts } from "./markdown";

export type PublishIssue = { level: "error" | "warning"; code: string; locale?: BlogLocale; line?: number; detail?: string };

export type ImageLookup = (src: string) => ImageRef | null;

export const fieldLimits = { excerpt: 180, seoTitle: 64, seoDescription: 170 };

const wide = (code: number) => (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || code >= 0x20000;

export function displayWidth(text: string) {
  let width = 0;
  for (const char of text.trim()) width += wide(char.codePointAt(0) ?? 0) ? 2 : 1;
  return width;
}

const requiredFields = ["title", "excerpt", "kicker", "line"] as const;

function realDate(value: string) {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : Number.NaN;
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export type CompiledLocales = Record<BlogLocale, { blocks: ArticleBlock[]; issues: PublishIssue[] }>;

export const siteLink = (url: string) => /^(?:\/|https?:\/\/|mailto:|tel:)/.test(url);

export const safeLink = (url: string) => /^\/(?![\/\\])/.test(url) || /^https?:\/\/[^\s]+$/.test(url) || /^(mailto|tel):[^\s]+$/.test(url) || /^#[^\s]*$/.test(url);

function inlineTexts(blocks: ArticleBlock[]) {
  return blocks.flatMap((block) => {
    if (block.type === "p" || block.type === "quote" || block.type === "callout") return [block.text];
    if (block.type === "ul" || block.type === "ol") return block.items;
    if (block.type === "table") return [...block.head, ...block.rows.flat()];
    return [];
  });
}

function unsafeLinks(blocks: ArticleBlock[]) {
  const found = new Set<string>();
  for (const text of inlineTexts(blocks)) {
    for (let at = text.indexOf("]("); at !== -1; at = text.indexOf("](", at + 2)) {
      const end = text.indexOf(")", at + 2);
      if (end === -1) break;
      const url = text.slice(at + 2, end);
      if (!safeLink(url)) found.add(url.slice(0, 120));
    }
  }
  return [...found];
}

function longLabels(blocks: ArticleBlock[]) {
  const found = new Set<string>();
  for (const text of inlineTexts(blocks)) {
    for (let at = text.indexOf("]("); at !== -1; at = text.indexOf("](", at + 2)) {
      const near = text.slice(Math.max(0, at - 300), at);
      const open = near.lastIndexOf("[");
      if (open === -1) continue;
      const label = near.slice(open + 1).trim();
      if (label.length > 40 && !label.includes("]") && /^(?:https?:\/\/|www\.)\S+$/i.test(label)) found.add(`${label.slice(0, 48)}…`);
    }
  }
  return [...found];
}

export function compileLocales(draft: ArticleDraft, images: ImageLookup): CompiledLocales {
  const en = compileMarkdown(draft.en.markdown, { locale: "en", images });
  const zh = compileMarkdown(draft.zh.markdown, { locale: "zh", images, headingIds: h2Ids(en.blocks) });
  const result = (issues: PublishIssue[], compiled: ArticleBlock[], locale: BlogLocale) => {
    const answer = (text: string) => compileMarkdown(text, { locale, images }).blocks.filter((inner) => inner.type !== "h2" && inner.type !== "faq");
    const blocks = compiled.flatMap<ArticleBlock>((block) => (block.type === "faq" ? block.items.flatMap<ArticleBlock>((item) => [{ type: "h3", text: item.q }, ...answer(item.a)]) : [block]));
    const own = issues.map((issue) => ({ ...issue, locale }));
    const extra = own.some((issue) => issue.code === "link_url") ? [] : unsafeLinks(blocks).map((detail) => ({ level: "error" as const, code: "link_url", locale, detail }));
    const wordy = longLabels(blocks).map((detail) => ({ level: "warning" as const, code: "link_text", locale, detail }));
    return { blocks, issues: [...own, ...extra, ...wordy] };
  };
  return { zh: result(zh.issues, zh.blocks, "zh"), en: result(en.issues, en.blocks, "en") };
}

function fieldIssues(draft: ArticleDraft, locale: BlogLocale): PublishIssue[] {
  const fields = draft[locale];
  const issues: PublishIssue[] = [];
  for (const name of requiredFields) if (!fields[name].trim()) issues.push({ level: "error", code: `missing_${name}`, locale });
  for (const [name, code] of [["excerpt", "long_excerpt"], ["seoTitle", "long_seo_title"], ["seoDescription", "long_seo_description"]] as const) {
    const width = displayWidth(fields[name]);
    if (width > fieldLimits[name]) issues.push({ level: "warning", code, locale, detail: `${width}/${fieldLimits[name]}` });
  }
  return issues;
}

function brandIssues(draft: ArticleDraft, locale: BlogLocale): PublishIssue[] {
  const fields = draft[locale];
  const text = [fields.title, fields.excerpt, fields.seoTitle, fields.seoDescription, fields.markdown].join("\n");
  const issues: PublishIssue[] = [];
  if (/\bFSD\b|Full Self-Driving/i.test(text) && !/supervised|监督/i.test(text)) issues.push({ level: "warning", code: "brand_fsd", locale });
  if (/cybertruck/i.test(text) && /off-?road|越野/i.test(text)) issues.push({ level: "warning", code: "brand_offroad", locale });
  return issues;
}

function liveLocale(draft: ArticleDraft, locale: BlogLocale, blocks: ArticleBlock[]): LiveLocale {
  const fields = draft[locale];
  const seoTitle = fields.seoTitle.trim();
  const seoDescription = fields.seoDescription.trim();
  return {
    title: fields.title.trim(),
    ...(seoTitle ? { seoTitle } : {}),
    ...(seoDescription ? { seoDescription } : {}),
    excerpt: fields.excerpt.trim(),
    kicker: fields.kicker.trim(),
    line: fields.line.trim(),
    headings: headingTexts(blocks),
    words: countWords(blocks, locale),
    blocks,
  };
}

export function checkDraft(draft: ArticleDraft, images: ImageLookup) {
  const compiled = compileLocales(draft, images);
  const issues: PublishIssue[] = [];
  if (!(blogCategories as readonly string[]).includes(draft.category)) issues.push({ level: "error", code: "category" });
  if (draft.tags.some((tag) => !tagPattern.test(tag))) issues.push({ level: "error", code: "tags" });
  if (!draft.cover) issues.push({ level: "error", code: "missing_cover" });
  else if (draft.cover.width < 1200) issues.push({ level: "warning", code: "small_cover", detail: String(draft.cover.width) });
  if (draft.published && !realDate(draft.published)) issues.push({ level: "error", code: "published" });
  if (draft.updated && !realDate(draft.updated)) issues.push({ level: "error", code: "updated" });
  for (const locale of ["zh", "en"] as const) issues.push(...fieldIssues(draft, locale), ...compiled[locale].issues, ...brandIssues(draft, locale));
  if (h2Ids(compiled.zh.blocks).length !== h2Ids(compiled.en.blocks).length) issues.push({ level: "warning", code: "h2_mismatch", detail: `${h2Ids(compiled.zh.blocks).length} / ${h2Ids(compiled.en.blocks).length}` });
  return { compiled, issues };
}

export function buildLive(draft: ArticleDraft, images: ImageLookup, today: string): { live: LiveArticle | null; issues: PublishIssue[] } {
  const { compiled, issues } = checkDraft(draft, images);
  if (!draft.cover || issues.some((issue) => issue.level === "error")) return { live: null, issues };
  return {
    live: {
      category: draft.category,
      tags: [...new Set(draft.tags)],
      cover: draft.cover,
      published: draft.published ?? today,
      updated: draft.updated && draft.updated > (draft.published ?? today) ? draft.updated : null,
      zh: liveLocale(draft, "zh", compiled.zh.blocks),
      en: liveLocale(draft, "en", compiled.en.blocks),
    },
    issues,
  };
}

export function laDate(instant: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}
