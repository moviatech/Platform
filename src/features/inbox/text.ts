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

export function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textToHtml(text: string) {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111111">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</div>`;
}

export function preview(text: string, max = 140) {
  const flat = splitQuoted(text).body.replace(/\s+/g, " ").trim();
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
