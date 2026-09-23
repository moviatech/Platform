const idPattern = /^[A-Za-z0-9_-]{11}$/;

export function youtubeId(value: string | null | undefined) {
  const text = (value ?? "").trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") id = url.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(first)) id = second ?? null;
  }
  return id && idPattern.test(id) ? id : null;
}

export const youtubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1`;
