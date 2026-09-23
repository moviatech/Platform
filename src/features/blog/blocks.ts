export const blogCategories = ["fsd", "travel", "tips", "driving", "rental", "news"] as const;

export type BlogCategory = (typeof blogCategories)[number];

export const blogLocales = ["zh", "en"] as const;

export type BlogLocale = (typeof blogLocales)[number];

export type ImageRef = { src: string; width: number; height: number; blur?: string };

export type ArticleBlock =
  | { type: "p"; text: string }
  | { type: "h2"; id: string; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "callout"; title: string; text: string }
  | { type: "quote"; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "figure"; image: ImageRef; alt: string; caption?: string }
  | { type: "faq"; items: Array<{ q: string; a: string }> };

export type LocaleDraft = {
  title: string;
  seoTitle: string;
  seoDescription: string;
  excerpt: string;
  kicker: string;
  line: string;
  markdown: string;
};

export type ArticleDraft = {
  category: BlogCategory;
  tags: string[];
  cover: ImageRef | null;
  coverHint?: string;
  tagHints?: Array<{ zh: string; en: string }>;
  published: string | null;
  updated: string | null;
  zh: LocaleDraft;
  en: LocaleDraft;
};

export type LiveLocale = {
  title: string;
  seoTitle?: string;
  seoDescription?: string;
  excerpt: string;
  kicker: string;
  line: string;
  headings: string[];
  words: number;
  blocks: ArticleBlock[];
};

export type LiveArticle = {
  category: BlogCategory;
  tags: string[];
  cover: ImageRef;
  published: string;
  updated: string | null;
  zh: LiveLocale;
  en: LiveLocale;
};

export const emptyLocaleDraft: LocaleDraft = { title: "", seoTitle: "", seoDescription: "", excerpt: "", kicker: "", line: "", markdown: "" };

export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const reservedSlugs = ["tag", "preview", "new"];

export const tagPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
