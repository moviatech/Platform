import { hasMarkup, plainRich } from "../portal/rich-text";

const entities: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

export function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (match) => entities[match] ?? match)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const cjk = /[⺀-鿿가-힯豈-﫿＀-￯]/;
const listStart = /^(?:[-*•·–—]|\d{1,3}[.)、]|[A-Za-z][.)])\s/;
const labelStart = /^[A-Z][A-Za-z ]{0,18}:\s/;
const sentenceEnd = /[.!?:;。！？：；]$/;
const indented = (line: string) => /^\s/.test(line);

const longest = (lines: string[]) => Math.max(0, ...lines.filter((line) => /\S\s+\S/.test(line)).map((line) => line.length));

export function unwrapText(text: string) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  const plain = longest(lines.filter((line) => !indented(line) && !line.startsWith(">")));
  const nested = longest(lines.filter(indented));
  if (plain > 80 || Math.max(plain, nested) < 60) return text;
  const soft = (tail: string, line: string) => {
    const width = indented(line) ? nested : plain;
    const body = line.trimStart();
    if (width < 60 || width > 80 || !tail || !body || tail.startsWith(">") || line.startsWith(">") || tail === "--" || tail.length > width || indented(tail) !== indented(line)) return false;
    if (listStart.test(body) || labelStart.test(body) || /^\S+:\/\/\S+$/.test(body)) return false;
    const first = body.split(/\s/, 1)[0];
    return tail.length + 1 + (cjk.test(first.charAt(0)) ? 1 : first.length) > width;
  };
  let item = false;
  const breaks = lines.map((line, index) => {
    const body = line.trimStart();
    if (!body || !indented(line)) item = false;
    else if (listStart.test(body)) return !(item = true);
    else if (item) return true;
    return index > 0 && soft(lines[index - 1], line);
  });
  const count = breaks.filter(Boolean).length;
  if (count === 0 || (count === 1 && sentenceEnd.test(lines[breaks.indexOf(true) - 1]))) return text;
  const result: string[] = [];
  lines.forEach((line, index) => {
    if (!breaks[index]) return void result.push(line);
    const body = line.trimStart();
    result[result.length - 1] += (cjk.test(lines[index - 1].slice(-1)) && cjk.test(body.charAt(0)) ? "" : " ") + body;
  });
  return result.join("\n");
}

export function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textToHtml(text: string) {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111111">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</div>`;
}

export function preview(text: string, max = 140, rich = false) {
  const body = splitQuoted(text).body;
  const flat = (rich && hasMarkup(body) ? plainRich(body) : body).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function normalizeSubject(subject: string | null | undefined) {
  return (subject ?? "")
    .replace(/^(\s*(re|fw|fwd|回复|答复|转发)\s*[:：]\s*)+/i, "")
    .trim()
    .toLowerCase();
}

export function replySubject(subject: string | null | undefined) {
  const value = (subject ?? "").trim();
  if (!value) return "Re: Movia";
  return /^(re|回复|答复)\s*[:：]/i.test(value) ? value : `Re: ${value}`;
}

const quoteMarkers = [
  /^On .{6,200} wrote:\s*$/,
  /^在.{4,120}写道[:：]\s*$/,
  /^-{2,}\s*(Original Message|原始邮件|Forwarded message)\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
  /^(From|发件人)[:：]\s.+$/,
];

export function splitQuoted(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (quoteMarkers.some((marker) => marker.test(line))) {
      cut = i;
      break;
    }
    if (line.startsWith(">") && lines.slice(i).every((rest) => rest.trim() === "" || rest.trim().startsWith(">"))) {
      cut = i;
      break;
    }
  }
  if (cut <= 0) return { body: text.trim(), quoted: "" };
  return { body: lines.slice(0, cut).join("\n").trim(), quoted: lines.slice(cut).join("\n").trim() };
}

export function extractMessageIds(...headers: Array<string | null | undefined>) {
  const ids = new Set<string>();
  for (const header of headers) {
    for (const match of (header ?? "").matchAll(/<[^<>\s]+>/g)) ids.add(match[0]);
  }
  return [...ids];
}

export function safeFilename(name: string) {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-80);
  return cleaned || "file";
}

const transcriptRoles: Array<[RegExp, "user" | "bot"]> = [
  [/^(客户|Customer):\s*/, "user"],
  [/^(助理|Assistant):\s*/, "bot"],
];

export function parseTranscript(text: string): Array<{ role: "user" | "bot"; text: string }> | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return null;
  const entries: Array<{ role: "user" | "bot"; text: string }> = [];
  for (const line of lines) {
    const match = transcriptRoles.find(([pattern]) => pattern.test(line));
    if (!match) {
      if (!entries.length) return null;
      entries[entries.length - 1].text += `\n${line}`;
      continue;
    }
    entries.push({ role: match[1], text: line.replace(match[0], "") });
  }
  return entries.length >= 2 ? entries : null;
}
