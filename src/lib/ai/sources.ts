export type AiSource = { url: string; title: string };

export type AiOutputItem = { type: string; content?: Array<{ type: string; text?: string; annotations?: Array<{ type: string; url?: string; title?: string }> | null }> };

function cleanUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.search = url.search
      .slice(1)
      .split("&")
      .filter((pair) => pair !== "utm_source=openai")
      .join("&");
    if (url.hash.startsWith("#:~:")) url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function outputText(output: AiOutputItem[] | undefined) {
  return (output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

export function citedSources(output: AiOutputItem[] | undefined): AiSource[] {
  const found = new Map<string, AiSource>();
  for (const item of output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      for (const note of part.annotations ?? []) {
        if (note.type !== "url_citation" || !note.url) continue;
        const url = cleanUrl(note.url);
        if (!url) continue;
        const key = url.split("#")[0];
        if (!found.has(key)) found.set(key, { url, title: (note.title ?? "").trim() });
      }
    }
  }
  return [...found.values()];
}
