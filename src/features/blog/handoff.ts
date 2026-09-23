import { blogCategories, type BlogCategory } from "./blocks";

export type HandoffLocale = { title?: string; seoTitle?: string; seoDescription?: string; excerpt?: string; kicker?: string; line?: string; markdown: string };

export type Handoff = { zh: HandoffLocale | null; en: HandoffLocale | null; slug?: string; category?: BlogCategory; tags: string[]; images: string[]; notes: string[] };

type Lang = "zh" | "en";
type Field = "title" | "seoTitle" | "seoDescription" | "excerpt" | "kicker" | "line";
type Slot = Field | "slug" | "path" | "category" | "tags";
type Fields = Partial<Record<Field, string>>;
type Leaf = string | string[];
type Front = Map<string, Leaf | Map<string, Leaf>>;
type Range = { start: number; end: number };
type Meta = { zh: Fields; en: Fields; slugs: string[]; paths: string[]; categories: string[]; tags: string[]; found: boolean };
type Aside = { line: number; text: string; alone: boolean };
type Edge = { lang: Lang; edge: "start" | "end" | "locale" };
type Mark = Edge & { line: number };
type Doc = { lines: string[]; code: boolean[]; asides: Aside[]; defs: Map<string, string> };
type Part = Range & { kind: "preamble" | "label" | "editorial" | "title"; lang: Lang };
type Layout = { note: string; zh: Range | null; en: Range | null; outside: Range[]; multiple: boolean; single: Lang | null; paired: boolean };
type Row = { text: string; fixed: boolean };
type Section = { lines: string[]; code: boolean[]; at: number; h1: string; headed: boolean };

const langs: Lang[] = ["zh", "en"];

const fields: Field[] = ["title", "seoTitle", "seoDescription", "excerpt", "kicker", "line"];

const frontKeys: Record<Field, string[]> = {
  title: ["title", "h1", "headline"],
  seoTitle: ["seo_title", "seotitle", "meta_title", "metatitle"],
  seoDescription: ["seo_description", "seodescription", "meta_description", "metadescription", "description"],
  excerpt: ["excerpt", "summary"],
  kicker: ["kicker", "eyebrow", "cover_kicker", "hero_kicker"],
  line: ["cover_line", "hero_line", "overlay_line", "line"],
};

const categoryIds = new Map<string, BlogCategory>([
  ["fsd指南", "fsd"],
  ["fsdguides", "fsd"],
  ["加州旅行", "travel"],
  ["californiatravel", "travel"],
  ["特斯拉租车入门", "tips"],
  ["teslarentaltips", "tips"],
  ["美国自驾指南", "driving"],
  ["drivingincalifornia", "driving"],
  ["租车指南", "rental"],
  ["rentaladvice", "rental"],
  ["movia动态", "news"],
  ["movianews", "news"],
]);

const dropOrder = ["dropped:byline", "dropped:dek", "dropped:seo-table", "dropped:editor-note"];

const hardStops = [";", "；", "。", ".", "\n", "—", "(", "（"];

const softStops = [...hardStops, ":", "：", ",", "，"];

const commonWords = new Set("the and for you your with that this from are was were has have had not but can will its our how what when where why who which before after into about than then they them their all any out more most here there also just over per may".split(" "));

const slugShape = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const zhLabel = /^(?:(?:简体)?中文(?:版本?|正文|文章|部分|稿|内容|翻译|页面)?|chinese(?:\s+(?:version|article|text|copy|section|translation|page))?|zh(?:[-_][a-z]+)?|cn)$/i;

const enLabel = /^(?:(?:英文|英语)(?:版本?|正文|文章|部分|稿|内容|翻译|页面)?|english(?:\s+(?:version|article|text|copy|section|translation|page))?|en(?:[-_][a-z]+)?)$/i;

const counterLabel = /^(?:(?:文章|第)?\s*(?:[一二三四五六七八九十]{1,3}|\d{1,2})\s*(?:篇|部分|章)?|(?:article|part|section|post)\s*(?:\d{1,2}|[a-z]))$/i;

const bulletLabel = /^(?:[a-z]|\d{1,2}|[一二三四五六七八九十]{1,3})[.．、)）]\s*/i;

const packageHeading = /编辑(?:提醒|说明|备注|笔记|用|与发布)|发布说明|交付(?:说明|稿|状态)|不属于.{0,6}正文|博客稿|重写稿|editor(?:ial)?(?:['’]s|s)? (?:notes?|checklist|reminders?)|(?:notes?|instructions?) (?:to|for) (?:the )?(?:editor|publisher|web ?team|developer)s?|for (?:the )?editors?\b|blog delivery|delivery (?:package|notes?)|blog package|editorial (?:package|hand-?off)|publishing notes?|not part of the (?:published )?article|not for publication/i;

const packageTitle = /[（(]\s*(?:中英双语|双语|bilingual|zh\s*[-/&+]\s*en)[^（）()]*[)）]\s*$|^movia blog\s*[|｜:：]|(?:中英双语|bilingual)\s*$/i;

const asideHeading = /编辑用|不发布|不要发布|请勿发布|不属于.{0,6}正文|供编辑|编辑(?:备注|说明|提醒|笔记)|(?:上线|发布)前?核对|not for publication|do not publish|not part of the (?:published )?article|editor(?:ial|['’]s|s)? notes?|for editors? only|internal only/i;

const noteRemark = /仅保留[^。；;]{0,30}(?:来源|链接|引用)|(?:未|不|没有)(?:加入|引用|链接)[^。；;]{0,40}(?:租车公司|竞争对手|竞品|推广链接)|\bno (?:links? to )?(?:competitor|competing)|\bcompetitors?['’]?s?\b[^.]{0,60}\b(?:not |un)?linked\b/i;

const headingRemark =/publi|copy|extract|paste|separate|发布|提取|复制|粘贴|单独|分开|此处|以下/i;

const trailingRemark = /\s*[（(][^（）()]*(?:发布|编辑|publi|editor)[^（）()]*[)）]\s*$/i;

const sourceHeading = /sources?|references?|citations?|further reading|参考|来源|官方资料|延伸阅读/i;

const metaLabel = /reading time|read time|阅读时长|阅读时间|\bauthor\b|作者|\bdate\b|日期|\bkeywords?\b|关键词|word count|字数|\bstatus\b|状态|\bcover\b|封面|search intent|搜索意图/i;

const noteStart = /^(?:editorial package|not for (?:direct )?publication|editorial notes?|notes? (?:to|for) (?:the )?(?:editor|publisher|web ?team|developer)s?|for (?:the )?editors?\b|sources policy|dev(?:eloper)? notes?|publishing notes?|交付状态|交付说明|编辑备注|编辑说明|编辑提示|编辑提醒|编辑口径|编辑用|开发说明|开发提示|发布说明|上线说明|供编辑)/i;

const noteAsk = /(?:^|[\n，,。；;：:、（(])\s*(?:网站|文章|本文|页面|正文|本节|本段|这一段|这段)?(?:上线|发布)(?:后|前|时)[^。；;]{0,6}(?:建议|请|应|需)[^。；;]{0,12}(?:更新|删除|移除|复核|核对|核实|替换)|网站建议[^。；;]{0,12}(?:更新|删除|移除)|(?:删除|移除)(?:这一段|本段|此段|该段)|不要发布|请勿发布|不属于[^。]{0,6}正文|\b(?:update|refresh)\b[^.]{0,40}\b(?:weekly|monthly|regularly|each week|every week)\b[^.]{0,60}\bor (?:remove|delete)\b|\b(?:remove|delete) (?:this|the (?:section|paragraph|block|note|notice))\b[^.]{0,40}\b(?:once|after|when)\b|\b(?:do not|don['’]t) publish\b|\bnot for publication\b|\b(?:should|must|needs? to|please)\b[^.]{0,120}\bbefore (?:publication|publishing)\b|(?:^|[.!?;:]\s+)(?:verify|check|confirm|recheck|review|update|refresh)\b[^.]{0,80}\bbefore (?:publication|publishing)\b/i;

function isHan(code: number) {
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0xf900 && code <= 0xfaff);
}

function hasHan(text: string) {
  for (let index = 0; index < text.length; index += 1) if (isHan(text.charCodeAt(index))) return true;
  return false;
}

function detectLang(text: string): Lang {
  const plain = text.replace(/https?:\/\/\S+/g, " ");
  let han = 0;
  let latin = 0;
  for (let index = 0; index < plain.length; index += 1) {
    const code = plain.charCodeAt(index);
    if (isHan(code)) han += 1;
    else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) latin += 1;
  }
  return han > 0 && han >= (han + latin) * 0.2 ? "zh" : "en";
}

function squash(text: string) {
  return text.toLowerCase().replace(/[\s*_`~#"'“”‘’「」『』《》()（）[\]【】,，.。:：;；!！?？、·|｜/\\–—-]+/g, "");
}

function unwrap(text: string) {
  let value = text.trim();
  while (value.length > 4 && value.startsWith("**") && value.endsWith("**") && !value.slice(2, -2).includes("**")) value = value.slice(2, -2).trim();
  return value;
}

function clean(text: string) {
  return unwrap(text.replace(/\\\|/g, "|")).replace(/\s+/g, " ").trim();
}

function cutAt(text: string, stops: string[]) {
  let cut = text.length;
  for (const stop of stops) {
    const at = text.indexOf(stop);
    if (at >= 0 && at < cut) cut = at;
  }
  return text.slice(0, cut);
}

function skipBlank(lines: string[], at: number, end = lines.length) {
  let next = at;
  while (next < end && !lines[next].trim()) next += 1;
  return next;
}

function headingOf(line: string): { level: number; text: string } | null {
  const text = line.trimStart();
  if (line.length - text.length > 3 || !text.startsWith("#")) return null;
  let level = 0;
  while (level < text.length && text[level] === "#") level += 1;
  if (level > 6 || (level < text.length && text[level] !== " " && text[level] !== "\t")) return null;
  const body = text.slice(level).trim();
  let end = body.length;
  while (end > 0 && body[end - 1] === "#") end -= 1;
  const closed = end < body.length && (end === 0 || body[end - 1] === " ");
  return { level, text: closed ? body.slice(0, end).trim() : body };
}

function isRule(line: string) {
  const text = line.trim();
  const mark = text[0];
  if (text.length < 3 || (mark !== "-" && mark !== "*" && mark !== "_")) return false;
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === mark) count += 1;
    else if (text[index] !== " ") return false;
  }
  return count >= 3;
}

function isItalicLine(text: string) {
  const mark = text[0];
  if (text.length < 3 || (mark !== "*" && mark !== "_") || text[1] === mark || text[text.length - 1] !== mark) return false;
  const inner = text.slice(1, -1);
  return inner === inner.trim() && !inner.split(mark + mark).join("").includes(mark);
}

function isBoldLine(text: string) {
  if (text.length < 5 || !text.startsWith("**") || !text.endsWith("**") || text[2] === "*") return false;
  const inner = text.slice(2, -2);
  return inner === inner.trim() && !inner.includes("**");
}

function labelPair(line: string): { label: string; value: string } | null {
  const text = line.trim();
  if (!text.startsWith("**")) return null;
  const close = text.indexOf("**", 2);
  if (close < 3) return null;
  let label = text.slice(2, close).trim();
  let value = text.slice(close + 2).trim();
  if (label.endsWith(":") || label.endsWith("：")) label = label.slice(0, -1).trim();
  else if (value.startsWith(":") || value.startsWith("：")) value = value.slice(1).trim();
  else return null;
  return label && label.length <= 48 ? { label, value } : null;
}

function codeLang(code: string): Lang | null {
  const text = code.trim().toLowerCase();
  if (/^(?:zh(?:[-_][a-z]+)*|cn|chinese|中文)$/.test(text)) return "zh";
  if (/^(?:en(?:[-_][a-z]+)*|english|英文)$/.test(text)) return "en";
  return null;
}

function labelLang(heading: string, remarks = false): Lang | null {
  let found: Lang | null = null;
  for (const piece of heading.split(/[|｜:：·•—–/()（）]|\s-\s/)) {
    const text = piece.trim().replace(bulletLabel, "").trim();
    if (!text || counterLabel.test(text)) continue;
    const lang = zhLabel.test(text) ? "zh" : enLabel.test(text) ? "en" : null;
    if (!lang && remarks && headingRemark.test(text)) continue;
    if (!lang || (found && found !== lang)) return null;
    found = lang;
  }
  return found;
}

function unquote(text: string) {
  const value = text.trim();
  const quote = value[0];
  if (quote !== '"' && quote !== "'") {
    const note = value.indexOf(" #");
    return (note >= 0 ? value.slice(0, note) : value).trim();
  }
  let out = "";
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quote === '"' && char === "\\" && next !== undefined) {
      out += next === "n" ? "\n" : next === "t" ? "\t" : next;
      index += 1;
    } else if (quote === "'" && char === "'" && next === "'") {
      out += "'";
      index += 1;
    } else if (char === quote) return out;
    else out += char;
  }
  return out;
}

function flowItems(text: string) {
  const inner = text.trim().slice(1, -1);
  const items: string[] = [];
  let item = "";
  let quote = "";
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (quote) {
      item += char;
      if (char === "\\" && quote === '"' && index + 1 < inner.length) {
        item += inner[index + 1];
        index += 1;
      } else if (char === quote) quote = "";
    } else if ((char === '"' || char === "'") && !item.trim()) {
      quote = char;
      item += char;
    } else if (char === ",") {
      items.push(item);
      item = "";
    } else item += char;
  }
  items.push(item);
  return items.map(unquote).filter(Boolean);
}

function readLeaf(text: string): Leaf {
  return text.startsWith("[") && text.endsWith("]") ? flowItems(text) : unquote(text);
}

function splitPair(text: string): { key: string; value: string } | null {
  let at = text.indexOf(":");
  while (at >= 0 && at + 1 < text.length && text[at + 1] !== " " && text[at + 1] !== "\t") at = text.indexOf(":", at + 1);
  if (at <= 0) return null;
  const key = unquote(text.slice(0, at)).toLowerCase().replace(/[\s-]+/g, "_");
  return key ? { key, value: text.slice(at + 1).trim() } : null;
}

function readFront(lines: string[]): Front | null {
  const front: Front = new Map();
  let parent = "";
  let open = "";
  let glue = " ";
  for (const raw of lines) {
    const text = raw.trim();
    if (!text || text.startsWith("#")) continue;
    const nested = raw.length > raw.trimStart().length;
    const item = text === "-" || text.startsWith("- ");
    const pair = item ? null : splitPair(text);
    if (parent && item) {
      const held = front.get(parent);
      const list = Array.isArray(held) ? held : [];
      const entry = unquote(text.slice(1));
      if (entry) list.push(entry);
      front.set(parent, list);
    } else if (parent && nested && pair) {
      const held = front.get(parent);
      const map = held instanceof Map ? held : new Map<string, Leaf>();
      map.set(codeLang(pair.key) ?? pair.key, readLeaf(pair.value));
      front.set(parent, map);
    } else if (nested) {
      const held = open ? front.get(open) : undefined;
      if (typeof held === "string") front.set(open, held ? `${held}${glue}${text}` : text);
    } else if (!pair) return null;
    else {
      const key = pair.key.replace(/_(?:cn|zh_cn|zh_hans)$/, "_zh").replace(/_en_us$/, "_en");
      const block = /^[|>][+-]?$/.test(pair.value);
      const leaf = block ? "" : readLeaf(pair.value);
      parent = pair.value ? "" : key;
      open = pair.value && typeof leaf === "string" ? key : "";
      glue = block && pair.value.startsWith("|") ? "\n" : " ";
      if (pair.value) front.set(key, leaf);
    }
  }
  return front;
}

function takeFront(lines: string[]): { front: Front; rest: string[] } {
  const first = skipBlank(lines, 0);
  if (first < lines.length && lines[first].trim() === "---") {
    for (let index = first + 1; index < lines.length; index += 1) {
      const text = lines[index].trimEnd();
      if (text !== "---" && text !== "...") continue;
      const front = readFront(lines.slice(first + 1, index));
      if (front && front.size) return { front, rest: lines.slice(index + 1) };
      break;
    }
  }
  return { front: new Map(), rest: lines };
}

function plainLang(front: Front): Lang | null {
  const keys = [...front.keys()];
  const zh = keys.some((key) => key.endsWith("_zh"));
  const en = keys.some((key) => key.endsWith("_en"));
  return zh === en ? null : zh ? "en" : "zh";
}

function frontLang(front: Front): Lang | null {
  for (const key of ["lang", "locale", "language"]) {
    const value = front.get(key);
    const lang = typeof value === "string" ? codeLang(value) : null;
    if (lang) return lang;
  }
  return null;
}

function fences(lines: string[]) {
  const code = lines.map(() => false);
  let mark = "";
  let opened = 0;
  lines.forEach((line, index) => {
    const text = line.trimStart();
    const fence = text.startsWith("```") ? "```" : text.startsWith("~~~") ? "~~~" : "";
    if (!mark) {
      if (!fence) return;
      mark = fence;
      opened = index;
    } else if (fence === mark && !text.slice(3).replace(/[`~\s]/g, "")) mark = "";
    code[index] = true;
  });
  if (mark) for (let index = opened; index < lines.length; index += 1) code[index] = false;
  return code;
}

function boxes(lines: string[], code: boolean[]) {
  let opened = -1;
  lines.forEach((line, index) => {
    const text = code[index] ? "" : line.trim();
    if (opened < 0) {
      if (text.startsWith(":::") && text.length > 3) opened = index;
    } else if (text === ":::") {
      for (let at = opened; at <= index; at += 1) code[at] = true;
      opened = -1;
    }
  });
}

function definitionLabel(line: string) {
  const text = line.trimStart();
  if (line.length - text.length > 3 || !text.startsWith("[") || text.startsWith("[^")) return "";
  const close = text.indexOf("]");
  if (close < 2 || text[close + 1] !== ":") return "";
  const label = text.slice(1, close);
  const rest = text.slice(close + 2).trim();
  const gap = rest.search(/\s/);
  const target = gap < 0 ? rest : rest.slice(0, gap);
  const title = gap < 0 ? "" : rest.slice(gap).trim();
  if (label.includes("[") || !/^<?(?:[a-z][a-z0-9+.-]*:|\/|#|\.{1,2}\/)|[./]/i.test(target) || (title && !/^(?:"[^"]*"|'[^']*'|\([^()]*\))$/.test(title))) return "";
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function closesAfter(lines: string[], from: number) {
  for (let index = from; index < lines.length; index += 1) if (lines[index].includes("-->")) return true;
  return false;
}

function scan(raw: string[]): Doc {
  const code = fences(raw);
  const lines: string[] = [];
  const asides: Aside[] = [];
  let open: Aside | null = null;
  let closable = true;
  for (let index = 0; index < raw.length; index += 1) {
    const text = raw[index];
    const first = asides.length;
    let at = 0;
    if (open) {
      const close = text.indexOf("-->");
      if (close < 0) {
        open.text += `\n${text}`;
        lines.push("");
        continue;
      }
      open.text += `\n${text.slice(0, close)}`;
      asides.push(open);
      open = null;
      at = close + 3;
    } else if (code[index]) {
      lines.push(text);
      continue;
    }
    let kept = "";
    for (;;) {
      const start = text.indexOf("<!--", at);
      if (start < 0) {
        kept += text.slice(at);
        break;
      }
      kept += text.slice(at, start);
      const close = text.indexOf("-->", start + 4);
      if (close >= 0) {
        asides.push({ line: index, text: text.slice(start + 4, close), alone: true });
        at = close + 3;
        continue;
      }
      if (closable && closesAfter(raw, index + 1)) open = { line: index, text: text.slice(start + 4), alone: true };
      else closable = false;
      break;
    }
    const bare = !kept.trim();
    if (!bare) {
      for (let item = first; item < asides.length; item += 1) asides[item].alone = false;
      if (open) open.alone = false;
    }
    lines.push(bare ? "" : kept);
  }
  boxes(lines, code);
  const defs = new Map<string, string>();
  lines.forEach((line, index) => {
    const label = code[index] ? "" : definitionLabel(line);
    if (label && !defs.has(label)) defs.set(label, line.trim());
  });
  return { lines, code, asides, defs };
}

function edgeOf(head: string): Edge | null {
  const zh = /(?:^|[^a-z])(?:zh|cn|chinese)(?:[^a-z]|$)|中文|简体|汉语/i.test(head);
  const en = /(?:^|[^a-z])(?:en|eng|english)(?:[^a-z]|$)|英文|英语/i.test(head);
  const start = /(?:^|[^a-z])(?:start|starts|begin|begins|beginning)(?:[^a-z]|$)|开始|起始/i.test(head);
  const end = /(?:^|[^a-z])(?:end|ends|ending|finish|finished)(?:[^a-z]|$)|结束|完毕/i.test(head);
  return zh !== en && start !== end ? { lang: zh ? "zh" : "en", edge: start ? "start" : "end" } : null;
}

function markOf(text: string): Edge | null {
  const tagged = /^(?:locale|lang|language)\s*[:=]\s*([a-z_-]+)$/i.exec(text);
  const locale = tagged ? codeLang(tagged[1]) : labelLang(text);
  if (locale) return { lang: locale, edge: "locale" };
  return edgeOf(cutAt(text, softStops)) ?? edgeOf(cutAt(text, hardStops).slice(0, 48));
}

function sortMarks(asides: Aside[]) {
  const marks: Mark[] = [];
  let notes = false;
  for (const aside of asides) {
    const text = aside.text.trim();
    const mark = text && aside.alone ? markOf(text) : null;
    if (mark) marks.push({ ...mark, line: aside.line });
    else if (text) notes = true;
  }
  return { marks, notes };
}

function complement(ranges: Array<Range | null>, total: number) {
  const taken = ranges.filter((range): range is Range => range !== null).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  let at = 0;
  for (const range of taken) {
    if (range.start > at) out.push({ start: at, end: range.start });
    at = Math.max(at, range.end);
  }
  if (at < total) out.push({ start: at, end: total });
  return out;
}

function markerLayout(marks: Mark[], total: number): Layout | null {
  const starts = marks.filter((mark) => mark.edge === "start");
  if (!starts.length) return null;
  const pick = (lang: Lang): Range | null => {
    const start = starts.find((mark) => mark.lang === lang);
    if (!start) return null;
    const later = marks.filter((mark) => mark.line > start.line && mark.edge !== "locale");
    const end = later.find((mark) => mark.edge === "end" && mark.lang === lang) ?? later[0];
    return { start: start.line + 1, end: end ? end.line : total };
  };
  const zh = pick("zh");
  const en = pick("en");
  const multiple = langs.some((lang) => starts.filter((mark) => mark.lang === lang).length > 1);
  return { note: "layout:markers", zh, en, outside: complement([zh, en], total), multiple, single: null, paired: false };
}

function localeLayout(marks: Mark[], total: number): Layout | null {
  const spots = marks.filter((mark) => mark.edge === "locale");
  if (!langs.every((lang) => spots.some((mark) => mark.lang === lang))) return null;
  const pick = (lang: Lang): Range => {
    const at = spots.findIndex((mark) => mark.lang === lang);
    return { start: spots[at].line + 1, end: at + 1 < spots.length ? spots[at + 1].line : total };
  };
  return { note: "layout:locale-comments", zh: pick("zh"), en: pick("en"), outside: [{ start: 0, end: spots[0].line }], multiple: spots.length > 2, single: null, paired: true };
}

function fieldTable(doc: Doc, range: Range) {
  for (let index = range.start + 1; index < range.end; index += 1) {
    if (doc.code[index] || !doc.lines[index].trimStart().startsWith("|")) continue;
    const table = readTable(doc.lines, index, range.end);
    const columns = (table.headed ? table.rows[0] : []).map(columnLang);
    if (columns.includes("zh") && columns.includes("en") && table.rows.filter((row, at) => at > 0 && slotOf(row[0] ?? "")).length >= 2) return true;
    index = table.end - 1;
  }
  return false;
}

function ownEnd(doc: Doc, start: number, end: number) {
  for (let index = start + 1; index < end; index += 1) {
    const heading = doc.code[index] ? null : headingOf(doc.lines[index]);
    if (!heading || heading.level < 2) continue;
    if (asideHeading.test(heading.text) || (sourceHeading.test(heading.text) && hasHan(heading.text) && /[a-z]{3}/i.test(heading.text))) return index;
  }
  return end;
}

function partsOf(doc: Doc) {
  const cuts: number[] = [];
  doc.lines.forEach((line, index) => {
    if (!doc.code[index] && headingOf(line)?.level === 1) cuts.push(index);
  });
  const parts: Part[] = [];
  if (!cuts.length || cuts[0] > 0) parts.push({ start: 0, end: cuts.length ? cuts[0] : doc.lines.length, kind: "preamble", lang: "en" });
  cuts.forEach((start, at) => {
    const end = at + 1 < cuts.length ? cuts[at + 1] : doc.lines.length;
    const heading = headingOf(doc.lines[start])?.text ?? "";
    const label = labelLang(heading, true);
    if (label) parts.push({ start, end, kind: "label", lang: label });
    else if (packageHeading.test(heading) || packageTitle.test(heading) || (cuts.length - at > 2 && fieldTable(doc, { start, end }))) parts.push({ start, end, kind: "editorial", lang: "en" });
    else parts.push({ start, end, kind: "title", lang: detectLang(doc.lines.slice(start, ownEnd(doc, start, end)).join("\n")) });
  });
  return parts;
}

function weight(doc: Doc, range: Range) {
  let total = 0;
  for (let index = range.start + 1; index < range.end; index += 1) total += doc.lines[index].trim().length;
  return total;
}

function hasProse(doc: Doc, range: Range) {
  for (let index = range.start + 1; index < range.end; index += 1) {
    const text = doc.lines[index].trim();
    if (text && !doc.code[index] && !/^(?:[-*+]\s|\d{1,3}[.)]\s|[#|>![])/.test(text)) return true;
  }
  return false;
}

function headingLayout(doc: Doc, front: Front): Layout {
  const parts = partsOf(doc);
  const outside = parts.filter((part) => part.kind === "preamble" || part.kind === "editorial");
  const labels = parts.filter((part) => part.kind === "label");
  const titles = parts.filter((part) => part.kind === "title");
  if (labels.length) {
    const section = (lang: Lang): Range | null => {
      const at = parts.findIndex((part) => part.kind === "label" && part.lang === lang);
      if (at < 0) return null;
      const next = at + 1 < parts.length ? parts[at + 1] : null;
      const merged = next !== null && next.kind === "title" && (next.lang === lang || weight(doc, parts[at]) === 0);
      let last = merged ? at + 1 : at;
      while (last + 1 < parts.length && parts[last + 1].kind === "title" && parts[last + 1].lang === lang) last += 1;
      return { start: parts[at].start, end: parts[last].end };
    };
    const multiple = langs.some((lang) => labels.filter((part) => part.lang === lang).length > 1);
    const lead = parts.slice(0, parts.indexOf(labels[0])).filter((part) => part.kind === "title");
    const found: Record<Lang, Range | null> = { zh: section("zh"), en: section("en") };
    const only = found.zh ?? found.en;
    const bare = langs.find((lang) => !found[lang]);
    const size = only ? weight(doc, only) : 0;
    const stray = bare ? lead.find((part) => part.lang === bare && hasProse(doc, part) && Math.min(weight(doc, part), size) * 10 >= Math.max(weight(doc, part), size)) : undefined;
    if (bare && stray) found[bare] = stray;
    return { note: "layout:sections", zh: found.zh, en: found.en, outside: [...lead.filter((part) => part !== stray), ...outside], multiple, single: null, paired: true };
  }
  const zh = titles.find((part) => part.lang === "zh");
  const en = titles.find((part) => part.lang === "en");
  if (zh && en && hasProse(doc, zh) && hasProse(doc, en)) {
    const sizes = [weight(doc, zh), weight(doc, en)];
    if (Math.min(...sizes) >= Math.max(...sizes) * 0.1) return { note: "layout:two-h1", zh, en, outside, multiple: titles.length > 2, single: null, paired: true };
  }
  const declared = frontLang(front);
  if (titles.length === 1) {
    const lang = declared ?? titles[0].lang;
    return { note: "layout:single-language", zh: lang === "zh" ? titles[0] : null, en: lang === "en" ? titles[0] : null, outside, multiple: false, single: lang, paired: false };
  }
  const lang = declared ?? detectLang(doc.lines.join("\n"));
  const whole = { start: 0, end: doc.lines.length };
  const note = !titles.length && front.size ? "layout:single-language" : "layout:unknown";
  return { note, zh: lang === "zh" ? whole : null, en: lang === "en" ? whole : null, outside: [], multiple: false, single: lang, paired: false };
}

function splitRow(line: string) {
  const text = line.trim();
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\" && text[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  if (text.startsWith("|")) cells.shift();
  if (cells.length && !cells[cells.length - 1]) cells.pop();
  return cells;
}

function readTable(lines: string[], at: number, end: number) {
  const rows: string[][] = [];
  let next = at;
  let headed = false;
  while (next < end && lines[next].trimStart().startsWith("|")) {
    const cells = splitRow(lines[next]);
    const rule = cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
    if (rule && rows.length === 1) headed = true;
    else if (!rule) rows.push(cells);
    next += 1;
  }
  return { rows, headed, end: next };
}

function columnLang(header: string): Lang | null {
  const text = header.toLowerCase();
  const zh = /中文|简体|chinese|\bzh\b/.test(text);
  const en = /英文|英语|english|\ben\b/.test(text);
  return zh === en ? null : zh ? "zh" : "en";
}

function slotOf(label: string): Slot | null {
  const bare = label.replace(/[*`]/g, "").trim().toLowerCase();
  const text = bare.endsWith(":") || bare.endsWith("：") ? bare.slice(0, -1).trim() : bare;
  if (!text || text.length > 60 || /alternativ|备选|候选|\boptions?\b|\bideas?\b/.test(text)) return null;
  if (/seo\s*(?:title|标题)|meta\s*title|title\s*tag|搜索标题|页面标题/.test(text)) return "seoTitle";
  if (/(?:meta|seo)\s*(?:desc|描述)|元描述|搜索描述/.test(text)) return "seoDescription";
  if (/\bkicker\b|\beyebrow\b|封面小标题/.test(text)) return "kicker";
  if (/\b(?:cover|hero|overlay)\s+(?:line|tagline)\b|封面标语/.test(text)) return "line";
  if (/\btags?\b|标签/.test(text)) return "tags";
  if (/\bslug\b/.test(text)) return "slug";
  if (/\burl\b|路径|permalink/.test(text)) return "path";
  const names = text.split("/").map((name) => name.replace(/[(（][^()（）]*[)）]/g, "").trim());
  if (names.some((name) => /^(?:description|描述)$/.test(name))) return "seoDescription";
  if (names.some((name) => /excerpt|摘要|导语|^summary$|^dek$/.test(name))) return "excerpt";
  if (names.some((name) => /^(?:(?:recommended|suggested|article|post|blog)\s+)?categor(?:y|ies)$|^(?:建议|推荐|文章|博客)?(?:分类|栏目)$/.test(name))) return "category";
  if (names.some((name) => /^(?:(?:recommended|suggested|article|post|page|main)\s+)?(?:h1|title|headline)$|^(?:建议|推荐|文章|正文|主)?\s*(?:标题|h1)$/.test(name))) return "title";
  return null;
}

function tagsOf(cell: string) {
  const coded = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  return coded.length ? coded : cell.split(/[,，、;；]/);
}

function addTags(meta: Meta, cell: string) {
  for (const tag of tagsOf(cell)) meta.tags.push(tag);
}

function store(meta: Meta, slot: Slot, lang: Lang | null, raw: string) {
  const value = clean(raw);
  if (!value) return;
  if (slot === "tags") addTags(meta, raw);
  else if (slot === "slug") meta.slugs[lang === "en" ? "unshift" : "push"](raw);
  else if (slot === "path") meta.paths.push(raw);
  else if (slot === "category") meta.categories.push(value);
  else {
    const target = meta[lang ?? detectLang(value)];
    if (!target[slot]) target[slot] = value;
  }
}

function absorbTable(rows: string[][], headed: boolean, heading: string, fallback: Lang | null, meta: Meta) {
  const columns = (headed ? rows[0] : []).map(columnLang);
  const body = headed ? rows.slice(1) : rows;
  if (/\btags?\b|标签/i.test(heading)) {
    const picked = columns.some((lang) => lang !== null) ? columns.map((lang, index) => (lang ? index : -1)).filter((index) => index >= 0) : [0];
    for (const row of body) for (const index of picked) addTags(meta, row[index] ?? "");
    meta.found = true;
  }
  for (const row of body) {
    const slot = slotOf(row[0] ?? "");
    if (!slot) continue;
    meta.found = true;
    row.slice(1).forEach((cell, offset) => store(meta, slot, columns[offset + 1] ?? (row.length === 2 ? fallback : null), cell));
  }
}

function absorbOutside(doc: Doc, range: Range, meta: Meta) {
  let heading = "";
  let prose = false;
  for (let index = range.start; index < range.end; index += 1) {
    const line = doc.lines[index];
    if (doc.code[index] || !line.trim() || isRule(line) || definitionLabel(line)) continue;
    const found = headingOf(line);
    const pair = found ? null : labelPair(line);
    const slot = pair ? slotOf(pair.label) : null;
    if (found) heading = found.text;
    else if (line.trimStart().startsWith("|")) {
      const table = readTable(doc.lines, index, range.end);
      absorbTable(table.rows, table.headed, heading, null, meta);
      index = table.end - 1;
    } else if (pair && slot && pair.value) {
      store(meta, slot, null, pair.value);
      meta.found = true;
    } else prose = true;
  }
  return prose;
}

function takeLabels(lines: string[], at: number, lang: Lang, meta: Meta) {
  const run: Array<{ label: string; value: string }> = [];
  let next = at;
  for (;;) {
    const here = skipBlank(lines, next);
    const pair = here < lines.length ? labelPair(lines[here]) : null;
    if (!pair || !(slotOf(pair.label) || metaLabel.test(pair.label))) break;
    run.push(pair);
    next = here + 1;
  }
  if (!run.some((pair) => slotOf(pair.label))) return at;
  for (const pair of run) {
    const slot = slotOf(pair.label);
    if (slot) store(meta, slot, lang, pair.value);
  }
  meta.found = true;
  return skipBlank(lines, next);
}

function takeTable(lines: string[], at: number, lang: Lang, meta: Meta) {
  if (at >= lines.length || !lines[at].trimStart().startsWith("|")) return at;
  const table = readTable(lines, at, lines.length);
  const known = table.rows.filter((row, index) => !(table.headed && index === 0) && slotOf(row[0] ?? "")).length;
  if (known < 2) return at;
  absorbTable(table.rows, table.headed, "", lang, meta);
  return skipBlank(lines, table.end);
}

function openSection(doc: Doc, range: Range, lang: Lang, meta: Meta): Section {
  const lines = doc.lines.slice(range.start, range.end);
  const code = doc.code.slice(range.start, range.end);
  let at = skipBlank(lines, 0);
  let h1 = "";
  let headed = false;
  for (let round = 0; round < 6; round += 1) {
    const before = at;
    const heading = at < lines.length && !code[at] ? headingOf(lines[at]) : null;
    if (heading && heading.level === 1) {
      if (!labelLang(heading.text, true)) h1 = heading.text;
      headed = true;
      at = skipBlank(lines, at + 1);
    }
    at = takeTable(lines, takeLabels(lines, at, lang, meta), lang, meta);
    if (at === before) break;
  }
  return { lines, code, at, h1, headed };
}

function isByline(text: string) {
  const plain = text.slice(1, -1).trim();
  if (!plain || plain.length > 120) return false;
  if (/\s[·•|｜]\s|^by\s|^(?:作者|撰文|文|编辑)\s*[:：/｜|]/i.test(plain)) return true;
  return !/[.。!！?？]$/.test(plain) && /(?:19|20)\d{2}|\d{1,2}\s*月\s*\d{1,2}\s*日/.test(plain);
}

function terms(text: string) {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(/[a-z0-9]{3,}/g)) if (!commonWords.has(match[0])) out.add(match[0]);
  for (let index = 0; index + 1 < lower.length; index += 1) {
    if (isHan(lower.charCodeAt(index)) && isHan(lower.charCodeAt(index + 1))) out.add(lower.slice(index, index + 2));
  }
  return out;
}

function repeats(line: string, summaries: string[]) {
  const dek = squash(line);
  const known = summaries.filter(Boolean);
  if (!dek || !known.length) return false;
  if (known.map(squash).some((flat) => flat !== "" && (flat.includes(dek) || dek.includes(flat)))) return true;
  const mine = terms(line);
  const theirs = terms(known.join(" "));
  let shared = 0;
  for (const term of mine) if (theirs.has(term)) shared += 1;
  return mine.size > 0 && shared >= mine.size * 0.25;
}

function trimLead(section: Section, titles: string[], summaries: string[], drops: Set<string>) {
  const { lines, headed } = section;
  const names = titles.map(squash).filter(Boolean);
  const done = new Set<string>();
  let at = skipBlank(lines, section.at);
  for (let round = 0; round < 3 && at < lines.length; round += 1) {
    const text = lines[at].trim();
    const alone = at + 1 >= lines.length || !lines[at + 1].trim();
    const heading = headingOf(lines[at]);
    if (heading && heading.level === 2 && !done.has("title") && names.includes(squash(heading.text))) done.add("title");
    else if (headed && alone && !done.has("dropped:byline") && isItalicLine(text) && isByline(text)) done.add("dropped:byline");
    else if (headed && alone && !done.has("dropped:dek") && isBoldLine(text) && repeats(text, summaries)) done.add("dropped:dek");
    else break;
    at = skipBlank(lines, at + 1);
  }
  let next = at;
  while (next < lines.length && (!lines[next].trim() || isImageLine(lines[next].trim()) || isItalicLine(lines[next].trim()))) next += 1;
  const repeat = done.has("title") || next >= lines.length || section.code[next] ? null : headingOf(lines[next]);
  if (repeat && repeat.level === 2 && names.includes(squash(repeat.text))) lines[next] = "";
  for (const note of done) if (note !== "title") drops.add(note);
  return at;
}

function isEditorNote(block: string) {
  if (noteStart.test(block.replace(/^[\s>*_`#-]+/, ""))) return true;
  const plain = block.replace(/[*_`]/g, "");
  return block.length <= 280 && !block.includes("\n\n") && (noteAsk.test(plain) || noteRemark.test(plain));
}

function localTail(lines: string[], lang: Lang) {
  return lines.map((line) => {
    const heading = headingOf(line);
    if (!heading || heading.level < 2 || heading.level > 3) return line;
    let text = heading.text.replace(trailingRemark, "").trim();
    const halves = text.split(/\s+[/／|｜]\s+/);
    if (halves.length === 2 && hasHan(halves[0]) !== hasHan(halves[1])) text = halves[hasHan(halves[0]) === (lang === "zh") ? 0 : 1].trim();
    if (lang === "zh") text = text.replace(/^统一/, "");
    return text ? `${"#".repeat(heading.level)} ${text}` : line;
  });
}

function tidy(lines: string[], code: boolean[], drops: Set<string>) {
  const rows: Row[] = [];
  let hidden = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const text = raw.trim();
    if (code[index]) {
      if (!hidden) rows.push({ text: raw.trimEnd(), fixed: true });
      continue;
    }
    if (!text) {
      if (!hidden) rows.push({ text: "", fixed: false });
      continue;
    }
    const heading = headingOf(raw);
    if (heading) {
      if (hidden && heading.level < hidden) hidden = 0;
      if (!hidden && (asideHeading.test(heading.text) || (heading.level === 1 && packageHeading.test(heading.text)))) {
        hidden = heading.level;
        drops.add("dropped:editor-note");
      }
      if (hidden || !heading.text || (heading.level === 1 && labelLang(heading.text, true))) continue;
      rows.push({ text: heading.level === 1 ? `## ${heading.text}` : heading.level > 3 ? `**${heading.text.split("**").join("")}**` : raw.trimEnd(), fixed: false });
      continue;
    }
    if (hidden || isRule(raw) || definitionLabel(raw)) continue;
    if (text.startsWith(">")) {
      let end = index;
      while (end + 1 < lines.length && !code[end + 1] && lines[end + 1].trim().startsWith(">")) end += 1;
      const quote = lines.slice(index, end + 1).map((line) => line.trim().slice(1).trim());
      if (isEditorNote(quote.join("\n"))) drops.add("dropped:editor-note");
      else for (let at = index; at <= end; at += 1) rows.push({ text: lines[at].trimEnd(), fixed: false });
      index = end;
      continue;
    }
    const alone = (index === 0 || !lines[index - 1].trim() || headingOf(lines[index - 1]) !== null) && (index + 1 >= lines.length || !lines[index + 1].trim());
    const item =/^(?:[-*+]|\d{1,3}[.)])\s+(.*)$/.exec(text);
    const aside = item ? isEditorNote(item[1]) : alone && (isItalicLine(text) || isBoldLine(text) || labelPair(text) !== null) && isEditorNote(text);
    if (aside) drops.add("dropped:editor-note");
    else rows.push({ text: raw.trimEnd(), fixed: false });
  }
  return rows;
}

function isImageLine(text: string) {
  return text.startsWith("![") && text.endsWith(")") && /^!\[(?:\\.|[^\]\\])*\]\([^()]*(?:\([^()]*\)[^()]*)*\)$/.test(text);
}

function settle(rows: Row[]) {
  const out: string[] = [];
  let plain = false;
  for (let index = 0; index < rows.length; index += 1) {
    const { text, fixed } = rows[index];
    if (fixed || !text) {
      if (fixed || (out.length && out[out.length - 1] !== "")) out.push(text);
      plain = false;
      continue;
    }
    if (plain && /^(?:[-*+]|1[.)])\s+\S/.test(text)) out.push("");
    out.push(text);
    plain = !/^(?:\s|[#>|]|!\[|(?:[-*+]|\d{1,3}[.)])\s)/.test(text);
    if (!isImageLine(text.trim())) continue;
    plain = false;
    let next = index + 1;
    while (next < rows.length && !rows[next].fixed && !rows[next].text) next += 1;
    const follow = next < rows.length && !rows[next].fixed ? rows[next].text.trim() : "";
    const ends = next + 1 >= rows.length || rows[next + 1].fixed || !rows[next + 1].text;
    if (!follow || !ends || !isItalicLine(follow)) continue;
    out.push(`*${follow.slice(1, -1).split("*").join("").split("__").join("").trim()}*`);
    index = next;
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

function sharedBlock(doc: Doc, last: Range, other: Range): { start: number; cut: number } | null {
  let rule = -1;
  let both = -1;
  let level = 0;
  for (let index = last.start; index < last.end; index += 1) {
    if (doc.code[index]) continue;
    if (isRule(doc.lines[index])) rule = index;
    const heading = headingOf(doc.lines[index]);
    if (!heading || heading.level < 2) continue;
    if (sourceHeading.test(heading.text) && hasHan(heading.text) && /[a-z]{3}/i.test(heading.text)) {
      both = index;
      level = heading.level;
    } else if (both >= 0 && heading.level <= level && !asideHeading.test(heading.text)) both = -1;
  }
  const first = rule < 0 ? -1 : skipBlank(doc.lines, rule + 1, last.end);
  if (both >= 0) return { start: both, cut: first === both ? rule : both };
  const heading = first >= 0 && first < last.end ? headingOf(doc.lines[first]) : null;
  if (!heading || heading.level < 2 || !sourceHeading.test(heading.text)) return null;
  for (let index = other.start; index < other.end; index += 1) {
    const found = doc.code[index] ? null : headingOf(doc.lines[index]);
    if (found && sourceHeading.test(found.text)) return null;
  }
  return { start: first, cut: rule };
}

function attach(body: string, defs: Map<string, string>) {
  if (!defs.size) return body;
  const used = new Set<string>();
  for (const match of body.matchAll(/\[([^[\]]+)\](?:\[([^[\]]*)\])?/g)) {
    const next = body[(match.index ?? 0) + match[0].length];
    if (match[2] === undefined && (next === "(" || next === ":")) continue;
    const label = (match[2] || match[1]).trim().replace(/\s+/g, " ").toLowerCase();
    if (defs.has(label)) used.add(label);
  }
  const wanted = [...defs].filter(([label]) => used.has(label)).map(([, line]) => line);
  return wanted.length ? `${body}\n\n${wanted.join("\n")}` : body;
}

function ownDefs(doc: Doc, section: Section) {
  const defs = new Map(doc.defs);
  const seen = new Set<string>();
  section.lines.forEach((line, index) => {
    const label = section.code[index] ? "" : definitionLabel(line);
    if (!label || seen.has(label)) return;
    seen.add(label);
    defs.set(label, line.trim());
  });
  return defs;
}

function leafText(leaf: Leaf | undefined) {
  return leaf === undefined ? "" : Array.isArray(leaf) ? leaf.join(", ") : leaf;
}

function frontLeaf(front: Front, key: string, lang: Lang, owner: Lang | null): Leaf | undefined {
  const own = front.get(`${key}_${lang}`);
  if (own !== undefined && !(own instanceof Map)) return own;
  const plain = front.get(key);
  if (plain === undefined) return undefined;
  if (plain instanceof Map) return plain.get(lang);
  return (owner ?? detectLang(leafText(plain))) === lang ? plain : undefined;
}

function frontLeaves(front: Front, key: string) {
  const out: Leaf[] = [];
  for (const name of [key, `${key}_zh`, `${key}_en`]) {
    const value = front.get(name);
    if (value instanceof Map) out.push(...value.values());
    else if (value !== undefined) out.push(value);
  }
  return out;
}

function stripBrand(title: string) {
  let value = title.trim();
  for (let round = 0; round < 3; round += 1) {
    let cut = -1;
    for (const mark of ["|", "｜", "·", "•", "–", "—", " - "]) cut = Math.max(cut, value.lastIndexOf(mark));
    if (cut <= 0) break;
    const tail = value.slice(cut).replace(/^[|｜·•–—\s-]+/, "");
    if (tail.length > 40 || !/^(?:movia|微智驾)/i.test(tail)) break;
    value = value.slice(0, cut).trimEnd();
  }
  return value;
}

function resolveFields(meta: Meta, front: Front, lang: Lang, owner: Lang | null, h1: string) {
  const found: Fields = {};
  for (const field of fields) found[field] = meta[lang][field] ?? frontKeys[field].map((key) => clean(leafText(frontLeaf(front, key, lang, owner)))).find(Boolean);
  const title = found.title || clean(h1);
  const seoTitle = stripBrand(found.seoTitle ?? "");
  const seoDescription = found.seoDescription || found.excerpt;
  const excerpt = found.excerpt || found.seoDescription;
  return {
    ...(title ? { title } : {}),
    ...(seoTitle ? { seoTitle } : {}),
    ...(seoDescription ? { seoDescription } : {}),
    ...(excerpt ? { excerpt } : {}),
    ...(found.kicker ? { kicker: found.kicker } : {}),
    ...(found.line ? { line: found.line } : {}),
  };
}

function slugOf(raw: string) {
  const coded = /`([^`]+)`/.exec(raw);
  const text = (coded ? coded[1] : raw).trim();
  const stop = text.search(/[?#\s（(]/);
  const path = stop >= 0 ? text.slice(0, stop) : text;
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end -= 1;
  const value = path.slice(path.lastIndexOf("/", end - 1) + 1, end);
  return value.length <= 120 && slugShape.test(value) ? value : "";
}

function categoryOf(label: string): BlogCategory | undefined {
  const key = label.replace(/[\s*`]/g, "").toLowerCase();
  return categoryIds.get(key) ?? blogCategories.find((id) => id === key);
}

function uniqueTags(raw: string[]) {
  const seen = new Set<string>();
  for (const tag of raw) {
    const text = tag.replace(/[`*]/g, "").replace(/\s+/g, " ").trim();
    if (text && text.length <= 60 && /[^\s—–-]/.test(text)) seen.add(text);
  }
  return [...seen];
}

function imagesOf(bodies: string[]) {
  const found = new Set<string>();
  for (const body of bodies) {
    let at = body.indexOf("![");
    while (at >= 0) {
      let close = body.indexOf("]", at + 2);
      while (close > 0 && body[close - 1] === "\\") close = body.indexOf("]", close + 1);
      if (close < 0) break;
      let next = close + 1;
      if (body[next] === "(") {
        let from = close + 2;
        while (body[from] === " ") from += 1;
        if (body[from] === "<") from += 1;
        next = from;
        while (next < body.length && next - from < 2048 && !/[)>\s]/.test(body[next])) next += 1;
        if (next > from && next - from < 2048) found.add(body.slice(from, next));
      }
      at = body.indexOf("![", next);
    }
  }
  return [...found];
}

function split(source: string): Handoff {
  const { front, rest } = takeFront((source.charCodeAt(0) === 0xfeff ? source.slice(1) : source).replace(/\r\n?/g, "\n").split("\n"));
  const doc = scan(rest);
  const { marks, notes } = sortMarks(doc.asides);
  const total = doc.lines.length;
  const layout = markerLayout(marks, total) ?? localeLayout(marks, total) ?? headingLayout(doc, front);
  const owner = layout.single ?? plainLang(front);
  const meta: Meta = { zh: {}, en: {}, slugs: [], paths: [], categories: [], tags: [], found: false };
  const drops = new Set<string>();
  if (notes) drops.add("dropped:editor-note");
  for (const range of layout.outside) if (absorbOutside(doc, range, meta)) drops.add("dropped:editor-note");
  const ranges: Record<Lang, Range | null> = { zh: layout.zh, en: layout.en };
  let tail: string[] = [];
  if (layout.paired && layout.zh && layout.en) {
    const late: Lang = layout.zh.start > layout.en.start ? "zh" : "en";
    const last = late === "zh" ? layout.zh : layout.en;
    const shared = sharedBlock(doc, last, late === "zh" ? layout.en : layout.zh);
    if (shared) {
      ranges[late] = { start: last.start, end: shared.cut };
      tail = settle(tidy(doc.lines.slice(shared.start, last.end), doc.code.slice(shared.start, last.end), drops));
    }
  }
  const opened = langs.map((lang) => {
    const range = ranges[lang];
    return range ? openSection(doc, range, lang, meta) : null;
  });
  const locales = langs.map((lang, index): HandoffLocale | null => {
    const section = opened[index];
    if (!section) return null;
    const found = resolveFields(meta, front, lang, owner, section.h1);
    const at = trimLead(section, [found.title ?? "", section.h1], [found.excerpt ?? "", found.seoDescription ?? ""], drops);
    const own = settle(tidy(section.lines.slice(at), section.code.slice(at), drops));
    if (!own.length) return null;
    return { ...found, markdown: attach([...own, ...(tail.length ? ["", ...localTail(tail, lang)] : [])].join("\n"), ownDefs(doc, section)) };
  });
  const slug = [...meta.slugs, ...meta.paths, ...frontLeaves(front, "slug").flat(), ...frontLeaves(front, "translation_key").flat()].map(slugOf).find(Boolean);
  const category = [...meta.categories, ...frontLeaves(front, "category").flat()].flatMap((label) => [label, ...label.split(/[/｜|]/)]).map(categoryOf).find(Boolean);
  if (meta.found) drops.add("dropped:seo-table");
  return {
    zh: locales[0],
    en: locales[1],
    ...(slug ? { slug } : {}),
    ...(category ? { category } : {}),
    tags: uniqueTags([...meta.tags, ...frontLeaves(front, "tags").flatMap((leaf) => (Array.isArray(leaf) ? leaf : tagsOf(leaf)))]),
    images: imagesOf(locales.map((locale) => locale?.markdown ?? "")),
    notes: [layout.note, ...(layout.multiple ? ["multiple-articles"] : []), ...dropOrder.filter((note) => drops.has(note)), ...langs.filter((_, index) => !locales[index]).map((lang) => `missing:${lang}`)],
  };
}

function fallback(source: string): Handoff {
  const markdown = source.trim();
  const lang = detectLang(markdown);
  const body = markdown ? { markdown } : null;
  return { zh: lang === "zh" ? body : null, en: lang === "en" ? body : null, tags: [], images: [], notes: ["layout:unknown", ...langs.filter((name) => !body || name !== lang).map((name) => `missing:${name}`)] };
}

export function splitHandoff(source: string): Handoff {
  const text = typeof source === "string" ? source : "";
  try {
    return split(text);
  } catch {
    return fallback(text);
  }
}

export function mergeHandoffs(parts: Handoff[]): Handoff {
  const zh = parts.find((part) => part.zh)?.zh ?? null;
  const en = parts.find((part) => part.en)?.en ?? null;
  const slug = parts.find((part) => part.slug)?.slug;
  const category = parts.find((part) => part.category)?.category;
  const tags = [...new Set(parts.flatMap((part) => part.tags))];
  const images = [...new Set(parts.flatMap((part) => part.images))];
  const notes = [...new Set(parts.flatMap((part) => part.notes))].filter((note) => !(note === "missing:zh" && zh) && !(note === "missing:en" && en));
  return { zh, en, ...(slug ? { slug } : {}), ...(category ? { category } : {}), tags, images, notes };
}
