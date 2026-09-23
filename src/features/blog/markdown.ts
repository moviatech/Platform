import type { ArticleBlock, BlogLocale, ImageRef } from "./blocks";

export type IssueLevel = "error" | "warning";
export type CompileIssue = { level: IssueLevel; code: string; line?: number; detail?: string };
export type CompileOptions = { locale: BlogLocale; images: (src: string) => ImageRef | null; headingIds?: string[] };
export type CompileResult = { blocks: ArticleBlock[]; issues: CompileIssue[] };

type Line = { text: string; raw: string; indent: number; no: number };
type Kind = "blank" | "container" | "fence" | "heading" | "break" | "quote" | "list" | "table" | "figure" | "text";
type Fence = { mark: string; size: number; info: string };
type Finder = (mark: string, from: number) => number;
type Piece = { kind: "text" | "code" | "url" | "link" | "ref" | "image"; at: number; end: number; label: string; target: string; loose: boolean };
type Mark = { kind: "bold" | "em" | "code"; at: number; end: number };
type Run = { at: number; size: number };
type Links = Map<string, string>;
type Registry = ReturnType<typeof idRegistry>;
type Reader = { lines: Line[]; blocks: ArticleBlock[]; issues: CompileIssue[]; links: Links; ids: Registry; open: number[]; image: (src: string) => ImageRef | null };

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const wordChar = /[A-Za-z0-9\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f\u0370-\u03ff\u0400-\u04ff]/;
const htmlStart = /^<(?:!|\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/>]|$))/;
const ownOrigin = /^https?:\/\/(?:www\.)?moviatech\.ai(?=[/?#]|$)/i;
const openTarget = /^(?:https?:\/\/|mailto:|tel:)\S/;
const knownTarget = /^(?:[/#]|https?:\/\/|mailto:|tel:)/i;
const linkTitle = /^(?:"[^"]*"|'[^']*'|\([^()]*\))$/;
const inlineMark = /[[`<_*]|https?:\/\//;
const dividerRow = /^[\s|:-]+$/;
const dividerCell = /^:?-+:?$/;
const escapable = /[!-\/:-@[-`{-~\d]/;
const maxColumns = 32;
const maxDepth = 32;
const maxPasses = 5;

const isBlank = (ch: string | undefined) => ch === " " || ch === "\t" || ch === "\n";
const isSolid = (ch: string | undefined) => ch !== undefined && ch !== "" && !/\s/.test(ch);
const isWord = (ch: string | undefined) => ch !== undefined && wordChar.test(ch);
const fits = (columns: number) => columns > 0 && columns <= maxColumns;
const leadOf = (raw: string) => raw.length - raw.trimStart().length;
const refKey = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();
const rooted = (path: string) => (path.startsWith("/") ? path : `/${path}`);
const lineOrder = (found: CompileIssue) => found.line ?? Number.MAX_SAFE_INTEGER;

function issue(level: IssueLevel, code: string, line?: number, detail?: string): CompileIssue {
  return { level, code, ...(line === undefined ? {} : { line }), ...(detail === undefined ? {} : { detail }) };
}

export function slugifyHeading(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug.length <= 40) return slug;
  const cut = slug.lastIndexOf("-", 40);
  return (cut > 0 ? slug.slice(0, cut) : slug.slice(0, 40)).replace(/-$/, "");
}

export function h2Ids(blocks: ArticleBlock[]): string[] {
  return blocks.flatMap((block) => (block.type === "h2" ? [block.id] : []));
}

export function headingTexts(blocks: ArticleBlock[]): string[] {
  return blocks.flatMap((block) => (block.type === "h2" || block.type === "h3" ? [block.text] : []));
}

function plainText(blocks: ArticleBlock[]) {
  return blocks
    .map((block) => {
      if (block.type === "p" || block.type === "h2" || block.type === "h3" || block.type === "quote") return block.text;
      if (block.type === "ul" || block.type === "ol") return block.items.join(" ");
      if (block.type === "callout") return `${block.title} ${block.text}`;
      if (block.type === "table") return [...block.head, ...block.rows.flat()].join(" ");
      if (block.type === "faq") return block.items.map((item) => `${item.q} ${item.a}`).join(" ");
      return block.caption ?? "";
    })
    .join(" ");
}

export function countWords(blocks: ArticleBlock[], locale: BlogLocale): number {
  const text = plainText(blocks);
  return locale === "zh" ? text.replace(/\s/g, "").length : text.split(/\s+/).filter(Boolean).length;
}

function finder(text: string): Finder {
  const tables = new Map<string, Int32Array>();
  return (mark, from) => {
    if (from < 0 || from >= text.length) return -1;
    let table = tables.get(mark);
    if (!table) {
      table = new Int32Array(text.length + 1).fill(-1);
      for (let at = text.length - 1; at >= 0; at -= 1) table[at] = text[at] === mark ? at : table[at + 1];
      tables.set(mark, table);
    }
    return table[from];
  };
}

function runsOf(text: string, mark: string): Run[] {
  const runs: Run[] = [];
  for (let at = text.indexOf(mark); at >= 0; ) {
    let end = at + 1;
    while (text[end] === mark) end += 1;
    runs.push({ at, size: end - at });
    at = text.indexOf(mark, end);
  }
  return runs;
}

function edges(rows: string[]): [number, number] {
  let from = 0;
  let to = rows.length;
  while (from < to && !rows[from]) from += 1;
  while (to > from && !rows[to - 1]) to -= 1;
  return [from, to];
}

const escapes = (row: string) => row[0] === "\\" && row.length > 1 && escapable.test(row[1]);

function decodeLine(text: string) {
  let line = text.trim();
  if (line.endsWith("\\")) line = line.slice(0, -1).trimEnd();
  return escapes(line) ? line.slice(1) : line;
}

function guard(row: string, risky: boolean) {
  if (!row) return "\\";
  return `${risky || escapes(row) ? "\\" : ""}${row}${row.endsWith("\\") ? "\\" : ""}`;
}

function headingOf(text: string): { level: number; text: string } | null {
  let level = 0;
  while (level < 7 && text[level] === "#") level += 1;
  if (level < 1 || level > 6 || (level < text.length && !isBlank(text[level]))) return null;
  return { level, text: text.slice(level).trim() };
}

function dropClosingHashes(text: string) {
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end === text.length || (end > 0 && !isBlank(text[end - 1]))) return text;
  return text.slice(0, end).trimEnd();
}

function idSuffix(text: string): { text: string; id: string } | null {
  const open = text.endsWith("}") ? text.lastIndexOf("{#") : -1;
  const id = open < 0 ? "" : text.slice(open + 2, -1);
  return idPattern.test(id) ? { text: text.slice(0, open).trimEnd(), id } : null;
}

function titleParts(raw: string): { text: string; id: string } {
  const bare = dropClosingHashes(raw);
  const tagged = idSuffix(bare);
  if (!tagged) return { text: bare, id: "" };
  return { text: bare === raw ? dropClosingHashes(tagged.text) : tagged.text, id: tagged.id };
}

function isBreak(text: string) {
  const mark = text[0];
  if (mark !== "-" && mark !== "*" && mark !== "_") return false;
  let count = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === mark) count += 1;
    else if (text[at] !== " " && text[at] !== "\t") return false;
  }
  return count >= 3;
}

function listItemOf(text: string): { ordered: boolean; text: string } | null {
  let at = 0;
  if (text[0] === "-" || text[0] === "*" || text[0] === "+") at = 1;
  else {
    while (at < 9 && text[at] >= "0" && text[at] <= "9") at += 1;
    if (!at || (text[at] !== "." && text[at] !== ")")) return null;
    at += 1;
  }
  if (text[at] !== " " && text[at] !== "\t") return null;
  const body = text.slice(at + 1).trim();
  return body ? { ordered: at > 1, text: body } : null;
}

function fenceOf(text: string): Fence | null {
  const mark = text[0];
  if (mark !== "`" && mark !== "~") return null;
  let size = 1;
  while (text[size] === mark) size += 1;
  const info = text.slice(size).trim();
  return size < 3 || (mark === "`" && info.includes("`")) ? null : { mark, size, info };
}

function closesFence(text: string, fence: Fence) {
  const end = fenceOf(text);
  return end !== null && end.mark === fence.mark && end.size >= fence.size && !end.info;
}

function containerOf(text: string): { name: string; title: string } | null {
  if (!text.startsWith(":::")) return null;
  let at = 3;
  while (text[at] === ":") at += 1;
  const rest = text.slice(at).trim();
  const gap = rest.search(/\s/);
  return gap < 0 ? { name: rest.toLowerCase(), title: "" } : { name: rest.slice(0, gap).toLowerCase(), title: rest.slice(gap).trim() };
}

function closesContainer(text: string) {
  const box = containerOf(text);
  return box !== null && !box.name;
}

function hasPipe(text: string) {
  for (let at = text.indexOf("|"); at >= 0; at = text.indexOf("|", at + 1)) if (text[at - 1] !== "\\") return true;
  return false;
}

function cellsOf(text: string): string[] {
  const cells: string[] = [];
  let from = text[0] === "|" ? 1 : 0;
  for (let at = text.indexOf("|", from); at >= 0; at = text.indexOf("|", at + 1)) {
    if (text[at - 1] === "\\") continue;
    cells.push(text.slice(from, at));
    from = at + 1;
  }
  if (from < text.length) cells.push(text.slice(from));
  return cells.map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isDivider(text: string) {
  if (!text.includes("|") || !dividerRow.test(text)) return false;
  const cells = cellsOf(text);
  return cells.length > 0 && cells.every((cell) => dividerCell.test(cell));
}

function scanTarget(text: string, from: number): { url: string; title: string; end: number } | null {
  let at = from;
  while (isBlank(text[at])) at += 1;
  let stop = at;
  let url = "";
  if (text[at] === "<") {
    stop = at + 1;
    while (stop < text.length && text[stop] !== ">" && text[stop] !== "<" && text[stop] !== "\n") stop += 1;
    if (text[stop] !== ">") return null;
    url = text.slice(at + 1, stop);
    at = stop + 1;
  } else {
    let depth = 0;
    for (; stop < text.length && !isBlank(text[stop]); stop += 1) {
      if (text[stop] === "(") depth += 1;
      else if (text[stop] === ")") {
        if (!depth) break;
        depth -= 1;
      }
      if (depth > maxDepth) return null;
    }
    if (depth) return null;
    url = text.slice(at, stop);
    at = stop;
  }
  const gap = at;
  while (isBlank(text[at])) at += 1;
  const quote = text[at];
  let title = "";
  if (at > gap && (quote === '"' || quote === "'" || quote === "(")) {
    stop = at + 1;
    while (stop < text.length && text[stop] !== (quote === "(" ? ")" : quote)) stop += text[stop] === "\\" ? 2 : 1;
    if (stop >= text.length) return null;
    title = text.slice(at + 1, stop).replace(/\\(["'()\\])/g, "$1");
    at = stop + 1;
    while (isBlank(text[at])) at += 1;
  }
  return text[at] === ")" ? { url, title, end: at + 1 } : null;
}

function imageOf(text: string): { alt: string; src: string; title: string } | null {
  if (!text.startsWith("![")) return null;
  let alt = "";
  let at = 2;
  while (at < text.length && !(text[at] === "]" && text[at + 1] === "(")) {
    const escaped = text[at] === "\\" && (text[at + 1] === "]" || text[at + 1] === "[" || text[at + 1] === "\\");
    alt += text[escaped ? at + 1 : at];
    at += escaped ? 2 : 1;
  }
  const target = at < text.length ? scanTarget(text, at + 2) : null;
  return target && target.end === text.length ? { alt: alt.trim(), src: target.url, title: target.title.trim() } : null;
}

function captionOf(text: string): string | null {
  const mark = text[0];
  if ((mark !== "*" && mark !== "_") || text.length < 3 || text[text.length - 1] !== mark) return null;
  const inner = text.slice(1, -1);
  return inner.includes(mark) || inner !== inner.trim() ? null : inner;
}

function definitionOf(text: string): { key: string; url: string } | null {
  if (text[0] !== "[" || text[1] === "^") return null;
  const close = text.indexOf("]");
  if (close < 2 || text[close + 1] !== ":") return null;
  const rest = text.slice(close + 2).trim();
  const angled = rest[0] === "<";
  const stop = angled ? rest.indexOf(">") : rest.search(/\s/);
  if (angled && stop < 0) return null;
  const url = angled ? rest.slice(1, stop) : stop < 0 ? rest : rest.slice(0, stop);
  const title = stop < 0 ? "" : rest.slice(angled ? stop + 1 : stop).trim();
  const key = refKey(text.slice(1, close));
  return key && knownTarget.test(url) && !/[`[\]]/.test(url) && (!title || linkTitle.test(title)) ? { key, url } : null;
}

function kindOf(text: string, below?: string): Kind {
  if (!text) return "blank";
  if (text.startsWith(":::")) return "container";
  if (fenceOf(text)) return "fence";
  if (headingOf(text)) return "heading";
  if (isBreak(text)) return "break";
  if (text[0] === ">") return "quote";
  if (listItemOf(text)) return "list";
  if (below && hasPipe(text) && isDivider(below) && fits(cellsOf(text).length)) return "table";
  return imageOf(text) ? "figure" : "text";
}

function scanLink(text: string, at: number, find: Finder, links: Links, bare = false): Omit<Piece, "at"> | null {
  const close = find("]", at + 1);
  if (close < at + 1 || (close === at + 1 && !bare)) return null;
  const label = text.slice(at + 1, close);
  if (text[close + 1] === "(") {
    const strict = scanTarget(text, close + 2);
    if (strict) return { kind: "link", end: strict.end, label, target: strict.url, loose: false };
    const stop = find(")", close + 2);
    return stop < 0 ? null : { kind: "link", end: stop + 1, label, target: text.slice(close + 2, stop), loose: true };
  }
  if (text[close + 1] !== "[" || label.includes("[")) return null;
  const end = find("]", close + 2);
  if (end < 0) return null;
  const name = text.slice(close + 2, end) || label;
  const url = links.get(refKey(name));
  return url === undefined ? { kind: "ref", end: at + 1, label, target: name, loose: false } : { kind: "link", end: end + 1, label, target: url, loose: false };
}

function scanAutolink(text: string, at: number): Omit<Piece, "at"> | null {
  if (!text.startsWith("<http://", at) && !text.startsWith("<https://", at)) return null;
  let end = at + 1;
  while (end < text.length && text[end] !== ">" && text[end] !== "<" && !/\s/.test(text[end])) end += 1;
  const url = text.slice(at + 1, end);
  return text[end] !== ">" || /[`[\]]/.test(url) ? null : { kind: "link", end: end + 1, label: url, target: url, loose: false };
}

function urlEnd(text: string, at: number) {
  let end = at;
  while (end < text.length && text.charCodeAt(end) > 32 && text.charCodeAt(end) < 127 && !'<>"`*'.includes(text[end])) end += 1;
  return end;
}

function piecesOf(text: string, links: Links): Piece[] {
  const find = finder(text);
  const pieces: Piece[] = [];
  let from = 0;
  let at = 0;
  const cut = (piece: Omit<Piece, "at">) => {
    if (at > from) pieces.push({ kind: "text", at: from, end: at, label: "", target: "", loose: false });
    pieces.push({ ...piece, at });
    from = piece.end;
    at = piece.end;
  };
  while (at < text.length) {
    const ch = text[at];
    let found: Omit<Piece, "at"> | null = null;
    if (ch === "`") {
      const close = find("`", at + 1);
      if (close > at + 1) found = { kind: "code", end: close + 1, label: "", target: "", loose: false };
    } else if (ch === "!" && text[at + 1] === "[") {
      const link = scanLink(text, at + 1, find, links, true);
      if (link && link.kind === "link" && text[link.end - 1] === ")") found = { ...link, kind: "image" };
    } else if (ch === "[") {
      const link = scanLink(text, at, find, links);
      found = link && link.label.includes("![") ? null : link;
    } else if (ch === "<") found = scanAutolink(text, at);
    else if (ch === "h" && (text.startsWith("http://", at) || text.startsWith("https://", at))) found = { kind: "url", end: urlEnd(text, at), label: "", target: "", loose: false };
    if (found) cut(found);
    else at += 1;
  }
  if (from < text.length) pieces.push({ kind: "text", at: from, end: text.length, label: "", target: "", loose: false });
  return pieces;
}

function localeEnd(path: string) {
  let at = 0;
  while (path[at] === "/" && (path.startsWith("zh", at + 1) || path.startsWith("en", at + 1)) && (at + 3 >= path.length || "/?#".includes(path[at + 3]))) at += 3;
  return at;
}

function targetOf(raw: string): { href: string; anchor: boolean } | null {
  let href = raw.trim().replace(/^(?:https?|mailto|tel):/i, (scheme) => scheme.toLowerCase());
  const own = ownOrigin.exec(href);
  if (own) href = rooted(href.slice(own[0].length));
  const skip = localeEnd(href);
  if (skip) href = rooted(href.slice(skip));
  const anchor = href.startsWith("#");
  if (!anchor && !(href.startsWith("/") ? !/^\/[/\\]/.test(href) : openTarget.test(href))) return null;
  return { href: href.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29"), anchor };
}

function mergeStars(text: string) {
  if (!text.includes("***")) return text;
  const runs = runsOf(text, "*");
  let out = "";
  let from = 0;
  for (let k = 0; k + 1 < runs.length; k += 1) {
    if (runs[k].size !== 3 || runs[k + 1].size !== 3) continue;
    out += `${text.slice(from, runs[k].at)}**${text.slice(runs[k].at + 3, runs[k + 1].at)}**`;
    from = runs[k + 1].at + 3;
    k += 1;
  }
  return out + text.slice(from);
}

function wraps(inner: string, size: number) {
  if (!inner.includes("*")) return inner.length > 0;
  const edge = size === 1 ? "**" : "*";
  return inner.length > edge.length * 2 && inner.startsWith(edge) && inner.endsWith(edge) && !inner.slice(edge.length, -edge.length).includes("*");
}

function starUnderscores(text: string, before: string | undefined, after: string | undefined) {
  if (!text.includes("_")) return text;
  const runs = runsOf(text, "_");
  const left = (run: Run) => (run.at > 0 ? text[run.at - 1] : before);
  const right = (run: Run) => (run.at + run.size < text.length ? text[run.at + run.size] : after);
  const opens = (run: Run) => run.size <= 2 && !isWord(left(run)) && isSolid(right(run));
  const closes = (run: Run, size: number) => run.size === size && isSolid(left(run)) && !isWord(right(run));
  const swapped = new Set<number>();
  let k = 0;
  while (k < runs.length) {
    const open = runs[k];
    let m = k + 1;
    if (opens(open)) while (m < runs.length && !closes(runs[m], open.size) && isWord(left(runs[m])) && isWord(right(runs[m]))) m += 1;
    else m = runs.length;
    if (m < runs.length && closes(runs[m], open.size) && wraps(text.slice(open.at + open.size, runs[m].at), open.size)) {
      swapped.add(k).add(m);
      k = m + 1;
    } else k = opens(open) ? Math.max(m, k + 1) : k + 1;
  }
  if (!swapped.size) return text;
  let out = "";
  let from = 0;
  runs.forEach((run, index) => {
    if (!swapped.has(index)) return;
    out += text.slice(from, run.at) + "*".repeat(run.size);
    from = run.at + run.size;
  });
  return out + text.slice(from);
}

function fixEmphasis(text: string, before: string | undefined, after: string | undefined) {
  if (!text.includes("_") && !text.includes("***")) return text;
  let current = text;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const next = mergeStars(starUnderscores(mergeStars(current), before, after));
    if (next === current) break;
    current = next;
  }
  return current;
}

function marksOf(text: string, from: number, to: number, find: Finder): Mark[] {
  const marks: Mark[] = [];
  let at = from;
  while (at < to) {
    const ch = text[at];
    let end = -1;
    let kind: Mark["kind"] = "em";
    if (ch === "*" && text[at + 1] === "*" && at + 2 < to && text[at + 2] !== "*") {
      const close = find("*", at + 2);
      if (close >= 0 && close + 1 < to && text[close + 1] === "*") {
        end = close + 2;
        kind = "bold";
      }
    }
    if (end < 0 && (ch === "*" || ch === "`") && at + 1 < to && text[at + 1] !== ch) {
      const close = find(ch, at + 1);
      if (close >= 0 && close < to) {
        end = close + 1;
        kind = ch === "*" ? "em" : "code";
      }
    }
    if (end < 0) at += 1;
    else {
      marks.push({ kind, at, end });
      at = end;
    }
  }
  return marks;
}

function siteLinks(text: string, find: Finder): Array<{ at: number; mid: number; end: number }> {
  const spans: Array<{ at: number; mid: number; end: number }> = [];
  for (let at = find("[", 0); at >= 0; at = find("[", at + 1)) {
    const mid = find("]", at + 1);
    if (mid <= at + 1 || text[mid + 1] !== "(") continue;
    const end = find(")", mid + 2);
    if (end <= mid + 2) continue;
    spans.push({ at, mid, end: end + 1 });
    at = end;
  }
  return spans;
}

function printsStars(text: string) {
  if (!text.includes("**")) return false;
  const find = finder(text);
  const state = new Uint8Array(text.length);
  let from = 0;
  const cover = (to: number) => {
    for (const mark of marksOf(text, from, to, find)) {
      if (mark.kind === "code") state.fill(1, mark.at, mark.end);
      else if (mark.kind === "bold") state[mark.at] = state[mark.end - 2] = 1;
    }
  };
  for (const link of siteLinks(text, find)) {
    cover(link.at);
    state.fill(1, link.mid, link.end);
    from = link.end;
  }
  cover(text.length);
  return runsOf(text, "*").some((run) => run.size === 2 && !state[run.at] && (isSolid(text[run.at - 1]) || isSolid(text[run.at + 2])));
}

function unmark(text: string) {
  const marks = marksOf(text, 0, text.length, finder(text));
  let out = "";
  let from = 0;
  for (const mark of marks) {
    const edge = mark.kind === "bold" ? 2 : 1;
    out += text.slice(from, mark.at) + text.slice(mark.at + edge, mark.end - edge);
    from = mark.end;
  }
  return out + text.slice(from);
}

function plainHeading(text: string, links: Links) {
  let current = text.trim();
  for (let pass = 0; pass < maxPasses && inlineMark.test(current); pass += 1) {
    let next = "";
    for (const piece of piecesOf(current, links)) {
      const raw = current.slice(piece.at, piece.end);
      next += piece.kind === "text" ? fixEmphasis(raw, current[piece.at - 1], current[piece.end]) : piece.kind === "link" ? piece.label : raw;
    }
    next = unmark(next).trim();
    if (next === current) break;
    current = next;
  }
  return current;
}

function tracker(text: string, numbers: number[]) {
  let seen = 0;
  let row = 0;
  return (offset: number) => {
    for (; seen < offset; seen += 1) if (text[seen] === "\n") row += 1;
    return numbers[Math.min(row, numbers.length - 1)];
  };
}

function linkText(piece: Piece, raw: string, line: number | undefined, issues: CompileIssue[]) {
  if (piece.kind === "ref") {
    issues.push(issue("warning", "ref_missing", line, piece.target));
    return raw;
  }
  const target = piece.loose && /[\s"<>]/.test(piece.target.trim()) ? null : targetOf(piece.target);
  if (!target) {
    issues.push(issue("error", "link_url", line, piece.target.trim()));
    return raw.endsWith("]") ? `[${piece.label}](${piece.target.trim()})` : raw;
  }
  if (target.anchor) issues.push(issue("warning", "link_anchor", line, target.href));
  return `[${piece.label}](${target.href})`;
}

function inlinePass(text: string, numbers: number[], links: Links, issues: CompileIssue[], seen: number[]) {
  const lineAt = tracker(text, numbers);
  let out = "";
  for (const piece of piecesOf(text, links)) {
    const raw = text.slice(piece.at, piece.end);
    if (piece.kind === "link") seen.push(out.length);
    if (piece.kind === "text") out += fixEmphasis(raw, text[piece.at - 1], text[piece.end]);
    else if (piece.kind === "code" || piece.kind === "url") out += raw;
    else if (piece.kind === "image") {
      issues.push(issue("error", "image_inline", lineAt(piece.at), piece.target.trim()));
      seen.push(out.length + 1);
      out += raw;
    } else out += linkText(piece, raw, lineAt(piece.at), issues);
  }
  return out;
}

function auditLinks(text: string, numbers: number[], seen: number[], issues: CompileIssue[]) {
  if (!text.includes("](")) return;
  const lineAt = tracker(text, numbers);
  let k = 0;
  for (const link of siteLinks(text, finder(text))) {
    while (k < seen.length && seen[k] < link.at) k += 1;
    if (seen[k] === link.at) continue;
    const url = text.slice(link.mid + 2, link.end - 1);
    if (url.startsWith("#") && !/\s/.test(url)) issues.push(issue("warning", "link_anchor", lineAt(link.at), url));
    else if (/\s/.test(url) || !(url.startsWith("/") ? !/^\/[/\\]/.test(url) : openTarget.test(url))) issues.push(issue("error", "link_url", lineAt(link.at), url));
  }
}

function inline(reader: Reader, text: string, numbers: number[]) {
  let current = text;
  let issues: CompileIssue[] = [];
  let seen: number[] = [];
  for (let pass = 0; pass < maxPasses && inlineMark.test(current); pass += 1) {
    issues = [];
    seen = [];
    const next = inlinePass(current, numbers, reader.links, issues, seen);
    const settled = next === current;
    current = next;
    if (settled) break;
  }
  auditLinks(current, numbers, seen, issues);
  for (const found of issues) reader.issues.push(found);
  if (printsStars(current)) reader.issues.push(issue("warning", "emphasis", numbers[0]));
  return current;
}

function idRegistry(preset: string[] | undefined) {
  const used = new Set<string>();
  const tails = new Map<string, number>();
  return {
    fallback: (text: string) => preset?.[used.size] || slugifyHeading(text) || `section-${used.size + 1}`,
    free: (wanted: string) => {
      if (!used.has(wanted)) return wanted;
      let tail = tails.get(wanted) ?? 2;
      while (used.has(`${wanted}-${tail}`)) tail += 1;
      tails.set(wanted, tail);
      return `${wanted}-${tail}`;
    },
    take: (id: string) => {
      used.add(id);
    },
  };
}

function readHeading(reader: Reader, at: number) {
  const line = reader.lines[at];
  const heading = headingOf(line.text);
  if (!heading || heading.level === 1) {
    reader.issues.push(issue("warning", "h1", line.no));
    return at + 1;
  }
  const parts = heading.level === 2 ? titleParts(heading.text) : { text: dropClosingHashes(heading.text), id: "" };
  const picture = parts.text.includes("![") ? piecesOf(parts.text, reader.links).find((piece) => piece.kind === "image") : undefined;
  if (picture) reader.issues.push(issue("error", "image_inline", line.no, picture.target.trim()));
  const text = plainHeading(parts.text, reader.links);
  if (!text) reader.issues.push(issue("error", "heading_empty", line.no));
  else if (heading.level === 2) {
    const wanted = parts.id || reader.ids.fallback(text);
    const id = reader.ids.free(wanted);
    if (id !== wanted) reader.issues.push(issue("warning", "duplicate_id", line.no, wanted));
    reader.ids.take(id);
    reader.blocks.push({ type: "h2", id, text });
  } else if (heading.level === 3) reader.blocks.push({ type: "h3", text });
  else {
    const bold = `**${text}**`;
    const late = picture ? undefined : piecesOf(bold, reader.links).find((piece) => piece.kind === "image");
    if (late) reader.issues.push(issue("error", "image_inline", line.no, late.target.trim()));
    auditLinks(bold, [line.no], [], reader.issues);
    if (printsStars(bold)) reader.issues.push(issue("warning", "emphasis", line.no));
    reader.blocks.push({ type: "p", text: bold });
  }
  return at + 1;
}

function readList(reader: Reader, at: number) {
  const { lines } = reader;
  const first = listItemOf(lines[at].text);
  const base = lines[at].indent;
  const items: string[] = [];
  const numbers: number[] = [];
  let nested = false;
  let end = at;
  for (; end < lines.length; end += 1) {
    const line = lines[end];
    if (!line.text) continue;
    const deep = line.indent >= base + 2;
    const item = isBreak(line.text) ? null : listItemOf(line.text);
    if (item && (deep || item.ordered === first?.ordered)) {
      if (deep && !nested) reader.issues.push(issue("warning", "nested_list", line.no));
      nested = nested || deep;
      items.push(decodeLine(item.text));
      numbers.push(line.no);
    } else if (!item && deep && !isBreak(line.text)) {
      const more = decodeLine(line.text);
      if (more) items[items.length - 1] = items[items.length - 1] ? `${items[items.length - 1]} ${more}` : more;
    } else break;
  }
  if (items.length) reader.blocks.push({ type: first?.ordered ? "ol" : "ul", items: items.map((item, index) => inline(reader, item, [numbers[index]])) });
  return Math.max(end, at + 1);
}

function readQuote(reader: Reader, at: number) {
  const { lines } = reader;
  const rows: string[] = [];
  const numbers: number[] = [];
  let end = at;
  for (; end < lines.length && lines[end].text[0] === ">"; end += 1) {
    const body = lines[end].text.slice(lines[end].text[1] === " " ? 2 : 1);
    rows.push(decodeLine(body.startsWith("- ") || body.startsWith("* ") ? `• ${body.slice(2).trimStart()}` : body));
    numbers.push(lines[end].no);
  }
  const [from, to] = edges(rows);
  if (to > from) reader.blocks.push({ type: "quote", text: inline(reader, rows.slice(from, to).join("\n"), numbers.slice(from, to)) });
  return end;
}

function readTable(reader: Reader, at: number) {
  const { lines } = reader;
  const head = cellsOf(lines[at].text).map((cell) => inline(reader, cell, [lines[at].no]));
  const rows: string[][] = [];
  let odd = cellsOf(lines[at + 1].text).length === head.length ? 0 : lines[at + 1].no;
  let end = at + 2;
  for (; end < lines.length && hasPipe(lines[end].text); end += 1) {
    const cells = cellsOf(lines[end].text);
    if (!odd && cells.length !== head.length) odd = lines[end].no;
    rows.push(head.map((_, column) => (cells[column] ? inline(reader, cells[column], [lines[end].no]) : "")));
  }
  if (odd) reader.issues.push(issue("warning", "table_shape", odd));
  reader.blocks.push({ type: "table", head, rows });
  return end;
}

function readFigure(reader: Reader, at: number) {
  const { lines } = reader;
  const picture = imageOf(lines[at].text);
  if (!picture) return at + 1;
  const below = at + 1 < lines.length ? captionOf(lines[at + 1].text) : null;
  const caption = below ?? picture.title;
  const image = reader.image(picture.src);
  if (!picture.alt) reader.issues.push(issue("error", "image_alt", lines[at].no));
  if (!image) reader.issues.push(issue("error", "image_unknown", lines[at].no, picture.src));
  else reader.blocks.push(caption ? { type: "figure", image, alt: picture.alt, caption } : { type: "figure", image, alt: picture.alt });
  return below === null ? at + 1 : at + 2;
}

function readFence(reader: Reader, at: number) {
  const { lines } = reader;
  const fence = fenceOf(lines[at].text);
  const rows: string[] = [];
  const numbers: number[] = [];
  let end = at + 1;
  for (; end < lines.length && !(fence && closesFence(lines[end].text, fence)); end += 1) {
    const body = lines[end].raw.slice(Math.min(leadOf(lines[at].raw), leadOf(lines[end].raw))).trimEnd();
    rows.push(lines[end].text ? `\`${body}\`` : "");
    numbers.push(lines[end].no);
  }
  reader.issues.push(issue("warning", "code_block", lines[at].no));
  const [from, to] = edges(rows);
  if (to > from) reader.blocks.push({ type: "p", text: inline(reader, rows.slice(from, to).join("\n"), numbers.slice(from, to)) });
  return Math.min(end + 1, lines.length);
}

function addCallout(reader: Reader, line: Line, title: string, inner: Line[]) {
  const rows = inner.map((row) => decodeLine(row.text)).filter(Boolean);
  if (!title) reader.issues.push(issue("error", "callout_title", line.no));
  reader.blocks.push({ type: "callout", title, text: inline(reader, rows.join(" "), [inner.find((row) => row.text)?.no ?? line.no]) });
}

function addFaq(reader: Reader, line: Line, inner: Line[]) {
  const entries: Array<{ q: string; rows: string[]; no: number }> = [];
  for (const row of inner) {
    const heading = headingOf(row.text);
    if (heading?.level === 3) {
      const q = plainHeading(dropClosingHashes(heading.text), reader.links);
      if (!q) reader.issues.push(issue("error", "heading_empty", row.no));
      entries.push({ q, rows: [], no: row.no });
    } else if (entries.length) entries[entries.length - 1].rows.push(decodeLine(row.text));
    else if (row.text) {
      reader.issues.push(issue("error", "faq_entry", row.no));
      entries.push({ q: "", rows: [decodeLine(row.text)], no: row.no });
    }
  }
  const items = entries.map((entry) => {
    const [from, to] = edges(entry.rows);
    if (to === from) reader.issues.push(issue("error", "faq_entry", entry.no));
    return { q: entry.q, a: entry.rows.slice(from, to).join("\n") };
  });
  if (items.length) reader.blocks.push({ type: "faq", items });
  else reader.issues.push(issue("error", "faq_entry", line.no));
}

function readContainer(reader: Reader, at: number) {
  const { lines } = reader;
  const line = lines[at];
  const box = containerOf(line.text);
  if (!box || !box.name) {
    if (!reader.open.pop()) reader.issues.push(issue("warning", "container", line.no));
    return at + 1;
  }
  if (box.name !== "callout" && box.name !== "faq") {
    reader.issues.push(issue("warning", "container", line.no, box.name));
    reader.open.push(line.no);
    return at + 1;
  }
  let end = at + 1;
  while (end < lines.length && !closesContainer(lines[end].text)) end += 1;
  if (end === lines.length) reader.issues.push(issue("error", "container_open", line.no));
  if (box.name === "callout") addCallout(reader, line, box.title, lines.slice(at + 1, end));
  else addFaq(reader, line, lines.slice(at + 1, end));
  return Math.min(end + 1, lines.length);
}

function readParagraph(reader: Reader, at: number) {
  const { lines } = reader;
  const rows: string[] = [];
  const numbers: number[] = [];
  let end = at;
  for (; end < lines.length && (end === at || kindOf(lines[end].text, lines[end + 1]?.text) === "text"); end += 1) {
    if (htmlStart.test(lines[end].text)) reader.issues.push(issue("warning", "html", lines[end].no));
    rows.push(decodeLine(lines[end].text));
    numbers.push(lines[end].no);
  }
  const [from, to] = edges(rows);
  if (to > from) reader.blocks.push({ type: "p", text: inline(reader, rows.slice(from, to).join("\n"), numbers.slice(from, to)) });
  return end;
}

const skip = (_reader: Reader, at: number) => at + 1;

const readers: Record<Kind, (reader: Reader, at: number) => number> = {
  blank: skip,
  break: skip,
  container: readContainer,
  fence: readFence,
  heading: readHeading,
  quote: readQuote,
  list: readList,
  table: readTable,
  figure: readFigure,
  text: readParagraph,
};

function dropComments(source: string) {
  let out = "";
  let from = 0;
  let closable = true;
  for (let open = source.indexOf("<!--"); open >= 0; open = source.indexOf("<!--", open + 4)) {
    const escaped = source[open - 1] === "\\" && open > from;
    const close = escaped || !closable ? -1 : source.indexOf("-->", open + 4);
    if (escaped) {
      out += `${source.slice(from, open - 1)}<!--`;
      from = open + 4;
    } else if (close >= 0) {
      out += source.slice(from, open) + source.slice(open, close).replace(/[^\n]+/g, "");
      from = close + 3;
      open = close - 1;
    } else closable = false;
  }
  return out + source.slice(from);
}

function toLines(source: string): Line[] {
  return source.split("\n").map((raw, index) => {
    const text = raw.trim();
    let indent = 0;
    for (let at = 0; text && (raw[at] === " " || raw[at] === "\t"); at += 1) indent += raw[at] === "\t" ? 4 : 1;
    return { text, raw, indent, no: index + 1 };
  });
}

function takeLinks(lines: Line[]): { links: Links; kept: Line[] } {
  const links: Links = new Map();
  const kept: Line[] = [];
  let fence: Fence | null = null;
  for (const line of lines) {
    const wasOpen = fence !== null;
    if (fence && closesFence(line.text, fence)) fence = null;
    else if (!fence) fence = fenceOf(line.text);
    const link = wasOpen || fence || line.indent > 3 ? null : definitionOf(line.text);
    if (!link) kept.push(line);
    else if (!links.has(link.key)) links.set(link.key, link.url);
  }
  return { links, kept };
}

export function compileMarkdown(source: string, options: CompileOptions): CompileResult {
  const { links, kept } = takeLinks(toLines(dropComments((source.charCodeAt(0) === 0xfeff ? source.slice(1) : source).replace(/\r\n?/g, "\n"))));
  const image = (src: string) => {
    try {
      return options.images(src) ?? null;
    } catch {
      return null;
    }
  };
  const reader: Reader = { lines: kept, blocks: [], issues: [], links, ids: idRegistry(options.headingIds), open: [], image };
  for (let at = 0; at < kept.length; ) at = readers[kindOf(kept[at].text, kept[at + 1]?.text)](reader, at);
  for (const line of reader.open) reader.issues.push(issue("error", "container_open", line));
  if (!reader.blocks.length) reader.issues.push(issue("error", "empty"));
  return { blocks: reader.blocks, issues: reader.issues.sort((a, b) => lineOrder(a) - lineOrder(b)) };
}

const rowsOf = (text: string) => {
  const rows = text.replace(/\r\n?/g, "\n").split("\n").map((row) => row.trim());
  const [from, to] = edges(rows);
  return rows.slice(from, to);
};

const flat = (text: string) => (/[\r\n]/.test(text) ? rowsOf(text).filter(Boolean).join(" ") : text.trim());

const startsBlock = (row: string) => kindOf(row) !== "text" || isDivider(row) || definitionOf(row) !== null;

const startsEntry = (row: string) => headingOf(row)?.level === 3 || row.startsWith(":::") || definitionOf(row) !== null;

function headingLine(marks: string, text: string, id: string) {
  return `${marks} ${text}${dropClosingHashes(text) === text ? "" : " #"}${id ? ` {#${id}}` : ""}`.trimEnd();
}

function sectionLine(text: string, id: string, ids: Registry) {
  const wanted = ids.fallback(plainHeading(text, new Map()));
  const auto = ids.free(wanted);
  const guarded = idSuffix(text) !== null;
  const explicit = (id !== auto || guarded) && idPattern.test(id);
  ids.take(explicit ? ids.free(id) : auto);
  return headingLine("##", text, explicit ? id : guarded ? auto : "");
}

function tableRow(cells: string[]) {
  return `| ${cells.map((cell) => flat(cell).replace(/\|/g, "\\|")).join(" | ")} |`;
}

function figureLine(block: Extract<ArticleBlock, { type: "figure" }>) {
  const src = /[\s()]/.test(block.image.src) ? `<${block.image.src}>` : block.image.src;
  const caption = flat(block.caption ?? "").replace(/[\\"]/g, "\\$&");
  return `![${flat(block.alt).replace(/[\\\]]/g, "\\$&")}](${src}${caption ? ` "${caption}"` : ""})`;
}

function faqLines(items: Array<{ q: string; a: string }>) {
  const entries = items.map((item) => [headingLine("###", flat(item.q), ""), ...rowsOf(item.a).map((row) => (row ? guard(row, startsEntry(row)) : ""))].join("\n"));
  return [":::faq", entries.join("\n\n"), ":::"].join("\n");
}

function markdownOf(block: ArticleBlock, ids: Registry, before: ArticleBlock | undefined): string {
  if (block.type === "p") return rowsOf(block.text).map((row) => guard(row, startsBlock(row))).join("\n");
  if (block.type === "h2" || block.type === "h3") {
    const text = flat(block.text);
    if (!plainHeading(text, new Map())) return "";
    return block.type === "h2" ? sectionLine(text, block.id, ids) : headingLine("###", text, "");
  }
  if (block.type === "ul" || block.type === "ol") {
    const rows = block.items.map((item, index) => (block.type === "ol" ? `${index + 1}. ${guard(flat(item), false)}` : `- ${guard(flat(item), isBreak(`- ${flat(item)}`))}`));
    return rows.length && before?.type === block.type ? ["---", "", ...rows].join("\n") : rows.join("\n");
  }
  if (block.type === "quote") return rowsOf(block.text).map((row) => (row ? `> ${guard(row, row.startsWith("- ") || row.startsWith("* "))}` : ">")).join("\n");
  if (block.type === "table") return block.head.length ? [tableRow(block.head), tableRow(block.head.map(() => "---")), ...block.rows.map(tableRow)].join("\n") : "";
  if (block.type === "figure") return figureLine(block);
  if (block.type === "callout") {
    const text = flat(block.text);
    return [`:::callout ${flat(block.title)}`.trimEnd(), ...(text ? [guard(text, startsEntry(text))] : []), ":::"].join("\n");
  }
  return block.items.length ? faqLines(block.items) : "";
}

export function serializeBlocks(blocks: ArticleBlock[], options?: { headingIds?: string[] }): string {
  const ids = idRegistry(options?.headingIds);
  const parts: string[] = [];
  let before: ArticleBlock | undefined;
  for (const block of blocks) {
    const part = markdownOf(block, ids, before);
    if (!part) continue;
    parts.push(part);
    before = block;
  }
  return parts.join("\n\n").replace(/<!--/g, "\\<!--");
}
