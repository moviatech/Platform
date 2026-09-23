export type RichSpan = { text: string; bold: boolean };

export type RichLine = { kind: "heading" | "bullet" | "text" | "gap"; spans: RichSpan[] };

const blank = /\s/;
const titleStart = /^(\p{Lu}|[⺀-鿿＀-￯]|\d{1,2}[.)][ \t])/u;
const numbered = /^\d{1,2}[.)][ \t]+\S/;
const closingMark = /[.;:,，。；：]$/;

function spansOf(text: string): RichSpan[] {
  const spans: RichSpan[] = [];
  let plain = "";
  let at = 0;
  while (at < text.length) {
    if (text[at] !== "*") {
      plain += text[at];
      at += 1;
      continue;
    }
    let end = at;
    while (end < text.length && text[end] === "*") end += 1;
    const next = end - at === 2 && end < text.length && !blank.test(text[end]) ? text.indexOf("*", end) : -1;
    if (next > end) {
      let close = next;
      while (close < text.length && text[close] === "*") close += 1;
      if (close - next === 2 && !blank.test(text[next - 1])) {
        if (plain) spans.push({ text: plain, bold: false });
        plain = "";
        spans.push({ text: text.slice(end, next), bold: true });
        at = close;
        continue;
      }
    }
    plain += text.slice(at, end);
    at = end;
  }
  if (plain) spans.push({ text: plain, bold: false });
  return spans;
}

function headingOf(line: string): string | null {
  const start = line.trimStart();
  if (line.length - start.length > 3) return null;
  let hashes = 0;
  while (hashes < start.length && start[hashes] === "#") hashes += 1;
  if (hashes < 1 || hashes > 6 || (start[hashes] !== " " && start[hashes] !== "\t")) return null;
  const title = start.slice(hashes).trim();
  if (!title || (hashes === 1 && !titleStart.test(title))) return null;
  return title;
}

function bulletOf(line: string): string | null {
  const start = line.trimStart();
  if (start.length < 3 || !"-*•".includes(start[0]) || (start[1] !== " " && start[1] !== "\t")) return null;
  return start.slice(1).trim() || null;
}

const strong = (spans: RichSpan[]) => spans.map((span) => ({ text: span.text, bold: true }));
const flat = (line: RichLine | undefined) => (line ? line.spans.map((span) => span.text).join("") : "");

type Draft = RichLine & { item?: string };

function scan(text: string): Draft[] {
  const lines: Draft[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      if (lines.length && lines[lines.length - 1].kind !== "gap") lines.push({ kind: "gap", spans: [] });
      continue;
    }
    const title = headingOf(line);
    if (title !== null) {
      lines.push({ kind: "heading", spans: strong(spansOf(title)) });
      continue;
    }
    const spans = spansOf(line);
    if (spans.length === 1 && spans[0].bold) {
      lines.push({ kind: "heading", spans });
      continue;
    }
    const item = bulletOf(line);
    lines.push(item !== null ? { kind: "bullet", spans, item } : { kind: "text", spans });
  }
  while (lines.length && lines[lines.length - 1].kind === "gap") lines.pop();
  return lines;
}

export function parseRich(text: string): RichLine[] {
  const drafts = scan(text);
  const listed = drafts.filter((line) => line.kind === "bullet").length > 1;
  const lines: RichLine[] = drafts.map((line) => (line.kind !== "bullet" ? { kind: line.kind, spans: line.spans } : listed ? { kind: "bullet", spans: spansOf(line.item ?? "") } : { kind: "text", spans: line.spans }));
  const solid = lines.map((line, index) => (line.kind === "gap" ? -1 : index)).filter((index) => index >= 0);
  return lines.map((line, index) => {
    if (line.kind !== "text") return line;
    const text = flat(line).trim();
    if (!numbered.test(text) || text.length > 84 || closingMark.test(text)) return line;
    const place = solid.indexOf(index);
    const before = lines[solid[place - 1]];
    const after = lines[solid[place + 1]];
    if (!after || numbered.test(flat(before).trim()) || numbered.test(flat(after).trim())) return line;
    return { kind: "heading" as const, spans: strong(line.spans) };
  });
}

export function hasMarkup(text: string) {
  let bullets = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (headingOf(line) !== null) return true;
    if (spansOf(line).some((span) => span.bold)) return true;
    if (bulletOf(line) !== null) {
      bullets += 1;
      if (bullets > 1) return true;
    }
  }
  return false;
}

export function plainRich(text: string) {
  return parseRich(text)
    .map((line) => (line.kind === "gap" ? "" : `${line.kind === "bullet" ? "• " : ""}${flat(line)}`))
    .join("\n");
}
