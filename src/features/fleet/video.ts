const idPattern = /^[A-Za-z0-9_-]{11}$/;
const vimeoId = /^\d{6,12}$/;
const vimeoHash = /^[A-Za-z0-9]{6,24}$/;

function parse(value: string | null | undefined) {
  const text = (value ?? "").trim();
  if (!text) return null;
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

export function youtubeId(value: string | null | undefined) {
  const url = parse(value);
  if (!url) return null;
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

export type VideoRef = { provider: "youtube"; id: string } | { provider: "vimeo"; id: string; hash: string | null };

function vimeoRef(value: string | null | undefined): VideoRef | null {
  const url = parse(value);
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  let hash = url.searchParams.get("h");
  if (host === "player.vimeo.com" && segments[0] === "video") id = segments[1] ?? null;
  else if (host === "vimeo.com") {
    const at = segments.findIndex((segment) => vimeoId.test(segment));
    if (at >= 0) {
      id = segments[at];
      if (!hash && segments[at + 1]) hash = segments[at + 1];
    }
  }
  if (!id || !vimeoId.test(id)) return null;
  return { provider: "vimeo", id, hash: hash && vimeoHash.test(hash) ? hash : null };
}

export function videoRef(value: string | null | undefined): VideoRef | null {
  const id = youtubeId(value);
  return id ? { provider: "youtube", id } : vimeoRef(value);
}

export const videoLink = (ref: VideoRef) => (ref.provider === "youtube" ? `https://youtu.be/${ref.id}` : `https://vimeo.com/${ref.id}${ref.hash ? `/${ref.hash}` : ""}`);

export const videoEmbed = (ref: VideoRef) => (ref.provider === "youtube" ? youtubeEmbed(ref.id) : `https://player.vimeo.com/video/${ref.id}?${ref.hash ? `h=${ref.hash}&` : ""}dnt=1&title=0&byline=0&portrait=0&playsinline=1`);
