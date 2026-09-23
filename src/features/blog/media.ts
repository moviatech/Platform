import type { ImageRef } from "./blocks";

export const mediaBucket = "blog-media";

export const mediaMaxBytes = 5 * 1024 * 1024;

export const mediaTypes = ["image/webp", "image/jpeg", "image/png"] as const;

export type MediaItem = { id: string; src: string; width: number; height: number; blur: string | null; name: string | null; bytes: number };

export const mediaPublicBase = (supabaseUrl: string) => `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${mediaBucket}/`;

export const toImageRef = (item: Pick<MediaItem, "src" | "width" | "height" | "blur">): ImageRef => ({ src: item.src, width: item.width, height: item.height, ...(item.blur ? { blur: item.blur } : {}) });

export function baseName(path: string) {
  const file = path.split(/[\\/]/).pop() ?? "";
  const dot = file.lastIndexOf(".");
  return decodeName(dot > 0 ? file.slice(0, dot) : file).toLowerCase();
}

function decodeName(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const leadImage = /^\s*!\[(?:\\.|[^\]\\])*\]\(\s*<?([^)\s>]+)>?(?:[ \t]+"(?:\\.|[^"\\])*")?[ \t]*\)[ \t]*(?:\r?\n[ \t]*(?:\*[^*\n]+\*|_[^_\n]+_)[ \t]*)?(?:\r?\n|$)/;

const imageLine = /^!\[(?:\\.|[^\]\\])*\]\(\s*<?([^)\s>]+)>?(?:[ \t]+"(?:\\.|[^"\\])*")?[ \t]*\)$/;

const captionLine = /^(?:\*[^*\n]+\*|_[^_\n]+_)$/;

export const coverName = /(^|[^a-z])cover([^a-z]|$)/i;

export function splitLeadImage(markdown: string): { markdown: string; lead: string | null } {
  const match = markdown.match(leadImage);
  if (match) return { markdown: markdown.slice(match[0].length).replace(/^\s+/, ""), lead: match[1] };
  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length && index < 60; index += 1) {
    const text = lines[index].trim();
    if (text.startsWith("#") || text.startsWith("```") || text.startsWith("~~~") || text.startsWith(":::")) break;
    const found = imageLine.exec(text);
    if (!found) continue;
    if (!coverName.test(found[1].split(/[\\/]/).pop() ?? "")) break;
    let end = index + 1;
    if (end < lines.length && captionLine.test(lines[end].trim())) end += 1;
    while (end < lines.length && !lines[end].trim()) end += 1;
    return { markdown: [...lines.slice(0, index), ...lines.slice(end)].join("\n").trimEnd(), lead: found[1] };
  }
  return { markdown, lead: null };
}

export function relinkImages(markdown: string, fileName: string, src: string) {
  const wanted = baseName(fileName);
  if (!wanted) return markdown;
  return markdown.replace(/(!\[(?:\\.|[^\]\\])*\]\(\s*)<?([^)\s>]+)>?/g, (whole, head: string, target: string) => (/^(https?:)?\/\//i.test(target) || target.startsWith("/") || baseName(target) !== wanted ? whole : `${head}${src}`));
}
