import { z } from "zod";
import { blogCategories, emptyLocaleDraft, tagPattern, type ArticleDraft, type BlogCategory } from "./blocks";

const text = (max: number) => z.string().max(max);

const localeSchema = z.object({
  title: text(200),
  seoTitle: text(200),
  seoDescription: text(400),
  excerpt: text(600),
  kicker: text(80),
  line: text(160),
  markdown: text(200000),
});

const imageSchema = z.object({
  src: z.string().min(1).max(500),
  width: z.number().int().min(1).max(20000),
  height: z.number().int().min(1).max(20000),
  blur: z.string().max(6000).optional(),
});

const dateSchema = z.iso.date().nullable();

export const draftSchema = z.object({
  category: z.enum(blogCategories),
  tags: z.array(z.string().max(60).regex(tagPattern)).max(12),
  cover: imageSchema.nullable(),
  coverHint: z.string().max(200).optional(),
  tagHints: z.array(z.object({ zh: text(60), en: text(60) })).max(12).optional(),
  published: dateSchema,
  updated: dateSchema,
  zh: localeSchema,
  en: localeSchema,
});

export const isCategory = (value: unknown): value is BlogCategory => (blogCategories as readonly unknown[]).includes(value);

export function emptyDraft(category: BlogCategory): ArticleDraft {
  return { category, tags: [], cover: null, published: null, updated: null, zh: { ...emptyLocaleDraft }, en: { ...emptyLocaleDraft } };
}
