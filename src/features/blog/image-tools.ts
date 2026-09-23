import { mediaMaxBytes } from "./media";

export type ProcessedImage = { blob: Blob; width: number; height: number; blur: string | null };

const attempts = [
  ["image/webp", 0.82],
  ["image/webp", 0.7],
  ["image/jpeg", 0.8],
] as const;

function draw(bitmap: ImageBitmap, width: number, fill?: string) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
  const context = canvas.getContext("2d");
  if (context && fill) {
    context.fillStyle = fill;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const jpegHead = "data:image/jpeg;base64,";

export function stripProfile(dataUrl: string) {
  if (!dataUrl.startsWith(jpegHead)) return dataUrl;
  const bytes = Uint8Array.from(atob(dataUrl.slice(jpegHead.length)), (char) => char.charCodeAt(0));
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return dataUrl;
  const kept: number[] = [0xff, 0xd8];
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff && bytes[at + 1] !== 0xda) {
    const size = (bytes[at + 2] << 8) + bytes[at + 3] + 2;
    if (bytes[at + 1] !== 0xe2) kept.push(...bytes.subarray(at, at + size));
    at += size;
  }
  kept.push(...bytes.subarray(at));
  return jpegHead + btoa(String.fromCharCode(...kept));
}

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

export async function processImage(file: File, maxWidth = 1800): Promise<ProcessedImage | "unsupported" | "too_large"> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return "unsupported";
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap || !bitmap.width || !bitmap.height) return "unsupported";
  const width = Math.min(bitmap.width, maxWidth);
  let blob: Blob | null = null;
  let height = 0;
  for (const [type, quality] of attempts) {
    const canvas = draw(bitmap, width, type === "image/jpeg" ? "#ffffff" : undefined);
    const made = await encode(canvas, type, quality);
    if (made && made.type === type && made.size <= mediaMaxBytes) {
      blob = made;
      height = canvas.height;
      break;
    }
  }
  const blur = stripProfile(draw(bitmap, 24, "#ffffff").toDataURL("image/jpeg", 0.5));
  bitmap.close();
  if (!blob) return "too_large";
  return { blob, width, height, blur: blur.startsWith("data:image/jpeg") && blur.length <= 6000 ? blur : null };
}
