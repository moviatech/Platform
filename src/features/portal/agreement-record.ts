import type { Block, Row } from "./agreement";

export type RecordHints = { termsLabels: string[]; termsEnds: string[]; colonLabels: string[] };

const sectionLine = /^== (.+) ==$/;
const clauseLine = /^\d{1,2}\.\s/;

export function snapshotStructured(version: string) {
  const parts = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(version);
  if (!parts) return false;
  return parts[1] > "2026-11-20" || (parts[1] === "2026-11-20" && Number(parts[2]) >= 2);
}

export function recordBlocks(text: string, signature: { rows: Row[]; image: string | null }, hints: Partial<RecordHints> = {}): Block[] {
  const parts = text.replace(/\r/g, "").split("\n\n");
  const openers = new Set((hints.termsLabels ?? []).map((label) => `${label}:`));
  const closers = new Set(hints.termsEnds ?? []);
  const colonLabels = hints.colonLabels ?? [];
  const pairOf = (line: string): Row | null => {
    const known = colonLabels.find((label) => line.startsWith(`${label}: `));
    if (known) return [known, line.slice(known.length + 2)];
    const at = line.indexOf(": ");
    return at > 0 && at <= 80 ? [line.slice(0, at), line.slice(at + 2)] : null;
  };
  const blocks: Block[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const lines = part.split("\n");
    if (index === 0 && lines.length === 3) {
      blocks.push({ kind: "title", brand: lines[0], text: lines[1], sub: lines[2] });
      continue;
    }
    if (openers.has(lines[0])) {
      let end = -1;
      for (let at = parts.length - 1; at > index && end < 0; at -= 1) if (closers.has(parts[at])) end = at;
      if (end < 0) end = parts.findIndex((candidate, at) => at > index && sectionLine.test(candidate));
      if (end < 0) end = parts.length;
      blocks.push({ kind: "terms", label: lines[0].slice(0, -1), text: [lines.slice(1).join("\n"), ...parts.slice(index + 1, end)].join("\n\n") });
      index = end - 1;
      continue;
    }
    const section = lines.length === 1 ? sectionLine.exec(lines[0]) : null;
    if (section) {
      blocks.push({ kind: "section", text: section[1] });
      continue;
    }
    if (lines.length > 1 && clauseLine.test(lines[0])) {
      blocks.push({ kind: "clause", heading: lines[0], paragraphs: lines.slice(1) });
      continue;
    }
    if (lines.length > 1 && pairOf(lines[0])) {
      const rows: Row[] = [];
      for (const line of lines) {
        const pair = pairOf(line);
        if (pair) rows.push(pair);
        else rows[rows.length - 1][1] += `\n${line}`;
      }
      blocks.push({ kind: "rows", rows });
      continue;
    }
    if (part.trim()) blocks.push({ kind: "paragraph", text: part });
  }
  blocks.push({ kind: "signature", rows: signature.rows, image: signature.image });
  return blocks;
}
