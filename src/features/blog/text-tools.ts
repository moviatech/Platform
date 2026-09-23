export type Selection = { value: string; start: number; end: number };

export type Edit = { from: number; to: number; text: string; selectFrom: number; selectTo: number };

const marker = /^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/;

export function wrapSelection({ value, start, end }: Selection, before: string, after: string, placeholder: string): Edit {
  const selected = value.slice(start, end) || placeholder;
  return { from: start, to: end, text: `${before}${selected}${after}`, selectFrom: start + before.length, selectTo: start + before.length + selected.length };
}

export function prefixLines({ value, start, end }: Selection, prefix: (index: number) => string, placeholder: string): Edit {
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const from = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const next = value.indexOf("\n", Math.max(last, from));
  const to = next === -1 ? value.length : next;
  const lines = value.slice(from, to).split("\n");
  let count = 0;
  const text = lines.map((line) => (lines.length > 1 && !line.trim() ? line : `${prefix(count++)}${line.replace(marker, "") || placeholder}`)).join("\n");
  return { from, to, text, selectFrom: from + prefix(0).length, selectTo: from + text.length };
}

export function insertBlock({ value, start, end }: Selection, block: string, selectStart = block.length, selectLength = 0): Edit {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const at = start + lead.length + selectStart;
  return { from: start, to: end, text: `${lead}${block}${trail}`, selectFrom: at, selectTo: at + selectLength };
}

export function lineOffset(value: string, line: number) {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = value.indexOf("\n", offset);
    if (next === -1) return value.length;
    offset = next + 1;
  }
  return offset;
}
