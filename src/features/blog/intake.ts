import { reservedSlugs, slugPattern, type BlogCategory } from "./blocks";
import { mergeHandoffs, splitHandoff, type Handoff } from "./handoff";
import { baseName, coverName, splitLeadImage } from "./media";

export const sourceMaxChars = 400000;

export const sourceMaxBytes = 300 * 1024;

export const intakeMaxFiles = 80;

export type FileKind = "source" | "image" | "other";

export type Source = { name: string; text: string };

export type Intake = { handoff: Handoff | null; used: Source[]; many: boolean };

const sourceName = /\.(?:md|markdown|mdx|txt)$/i;

const imageName = /\.(?:jpe?g|png|webp)$/i;

const imageType = /^image\/(?:jpeg|png|webp)$/;

const lastPart = (path: string) => path.split(/[\\/]/).pop() ?? "";

export function fileKind(name: string, type = ""): FileKind {
  const file = lastPart(name);
  if (!file || file.startsWith(".")) return "other";
  if (imageName.test(file) || imageType.test(type)) return "image";
  if (!sourceName.test(file)) return "other";
  return /^readme(?![a-z])/i.test(file) ? "other" : "source";
}

export function readSources(sources: Source[]): Intake {
  if (sources.length === 0) return { handoff: null, used: [], many: false };
  if (sources.length === 1) return { handoff: splitHandoff(sources[0].text), used: sources, many: false };
  if (sources.length === 2) {
    const parts = sources.map((source) => splitHandoff(source.text));
    const only = parts.map((part) => (part.zh && !part.en ? "zh" : part.en && !part.zh ? "en" : "both"));
    if (only.includes("zh") && only.includes("en")) return { handoff: mergeHandoffs(parts), used: sources, many: false };
  }
  return { handoff: null, used: [], many: true };
}

export function slugFromText(text: string, limit = 60) {
  const plain = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (plain.length <= limit) return plain;
  const head = plain.slice(0, limit + 1);
  const at = head.lastIndexOf("-");
  return at > 0 ? head.slice(0, at) : plain.slice(0, limit);
}

export function slugFromFileName(name: string) {
  const stem = lastPart(name)
    .replace(sourceName, "")
    .replace(/\s*\(\d+\)$/, "")
    .replace(/\.(?:bilingual|zh-en|zh|en|cn)$/i, "")
    .replace(/^\d{6,8}[\s_-]*/, "")
    .replace(/\s+\d{6,8}$/, "")
    .replace(/[-_ ](?:zh[-_ ]?en|bilingual|blog|draft|final)(?=$|[-_ .])/gi, "");
  return slugFromText(stem);
}

const usable = (slug: string) => slug.length >= 3 && slug.length <= 120 && slugPattern.test(slug) && !reservedSlugs.includes(slug);

export function suggestSlug(handoff: Handoff | null, names: string[]) {
  const options = [handoff?.slug ?? "", slugFromText(handoff?.en?.title ?? ""), ...names.map(slugFromFileName)];
  return options.find(usable) ?? "";
}

const categoryWords: Array<[BlogCategory, RegExp]> = [
  ["fsd", /\bfsd\b|full self-driving|autopilot|robotaxi|reality view|智驾|辅助驾驶|自动驾驶/g],
  ["travel", /road[- ]trip|things to do|weekend|itinerar|getaway|festival|holiday|thanksgiving|christmas|scenic|coastal?|national park|grand prix|bioluminescence|diner|攻略|去哪|值得去|玩法|周末|旅行|旅游|景点|公路自驾|海岸|灯光节|感恩节|圣诞|假期|追/g],
  ["driving", /driving (?:in|guide)|driver['’]s guide|road rules?|traffic|parking|toll|police|sheriff|pulled over|speed limit|freeway|carpool|situations|在[^，。？！]{0,8}开车|路况|交规|交通规则|停车|收费公路|警察|警灯|罚单|限速|冬季驾驶/g],
  ["tips", /charging|supercharger|how to|first tesla|rental car|renting|insurance|waiver|deposit|licen[cs]es?|checklist|充电|超充|上手|第一次开|租车|保险|押金|驾照/g],
  ["news", /movia (?:news|update|launch)|announc|now open|new location|动态|公告|开业/g],
];

const hits = (text: string, pattern: RegExp) => text.toLowerCase().match(pattern)?.length ?? 0;

export function suggestCategory(handoff: Handoff | null): BlogCategory | null {
  if (!handoff) return null;
  if (handoff.category) return handoff.category;
  const titles = [handoff.zh?.title, handoff.en?.title].filter(Boolean).join("\n");
  const rest = [handoff.slug?.replace(/-/g, " "), handoff.zh?.kicker, handoff.en?.kicker, handoff.zh?.seoTitle, handoff.en?.seoTitle, ...handoff.tags].filter(Boolean).join("\n");
  let best: BlogCategory | null = null;
  let top = 0;
  for (const [category, pattern] of categoryWords) {
    const score = hits(titles, pattern) * 3 + hits(rest, pattern);
    if (score > top) {
      top = score;
      best = category;
    }
  }
  return best;
}

export type TagIdea = { zh: string; en: string };

const hasHan = (text: string) => /[㐀-鿿豈-﫿]/.test(text);

export function pairTags(tags: string[]): TagIdea[] {
  const han = tags.filter(hasHan);
  const latin = tags.filter((tag) => !hasHan(tag));
  const kinds = tags.map(hasHan);
  const alternating = kinds.every((kind, index) => kind === (index % 2 === 0));
  const blocked = kinds.every((kind, index) => kind === index < han.length);
  const ideas = han.length > 0 && han.length === latin.length && (alternating || blocked) ? han.map((zh, index) => ({ zh, en: latin[index] })) : tags.map((tag) => ({ zh: tag, en: hasHan(tag) ? "" : tag }));
  return ideas.slice(0, 12);
}

const tagKey = (text: string) => text.trim().toLowerCase();

export function matchTags(ideas: TagIdea[], known: Array<{ id: string; label_zh: string; label_en: string }>): { tags: string[]; hints: TagIdea[] } {
  const tags: string[] = [];
  const hints: TagIdea[] = [];
  for (const idea of ideas) {
    const names = [idea.zh, idea.en].map(tagKey).filter(Boolean);
    const ids = [idea.en, idea.zh].map((name) => slugFromText(name)).filter(Boolean);
    const found = known.find((tag) => ids.includes(tag.id) || names.includes(tagKey(tag.label_zh)) || names.includes(tagKey(tag.label_en)));
    if (found) {
      if (!tags.includes(found.id)) tags.push(found.id);
    } else if (names.length) hints.push({ zh: idea.zh.slice(0, 60), en: idea.en.slice(0, 60) });
  }
  return { tags: tags.slice(0, 12), hints: hints.slice(0, 8) };
}

const external = (target: string) => /^(?:https?:)?\/\//i.test(target) || target.startsWith("/");

export function missingImages(referenced: string[], provided: string[]) {
  const have = new Set(provided.map(baseName));
  const missing = new Set<string>();
  for (const target of referenced) if (!external(target) && !have.has(baseName(target))) missing.add(lastPart(target));
  return [...missing];
}

export function coverFile(handoff: Handoff | null, provided: string[]) {
  const lead = [handoff?.zh?.markdown, handoff?.en?.markdown].map((body) => (body ? splitLeadImage(body).lead : null)).find(Boolean);
  const hint = lead ? baseName(lead) : "";
  if (hint) return provided.find((name) => baseName(name) === hint) ?? null;
  return provided.find((name) => coverName.test(lastPart(name))) ?? null;
}
