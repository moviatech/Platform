import { inflateSync } from "node:zlib";

const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const channels: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export const signatureMaxSide = 2000;

export type SignatureCheck = "ok" | "unsupported" | "bad";

export function inspectSignaturePng(bytes: Buffer): SignatureCheck {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(magic)) return "bad";
  let header: { width: number; height: number; depth: number; color: number; interlace: number } | null = null;
  const data: Buffer[] = [];
  let ended = false;
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const next = at + 12 + length;
    if (next > bytes.length) return "bad";
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      if (header || at !== 8 || length !== 13) return "bad";
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    } else if (!header) {
      return "bad";
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      ended = true;
      break;
    }
    at = next;
  }
  if (!header || !ended || data.length === 0) return "bad";
  if (header.width < 1 || header.height < 1 || header.width > signatureMaxSide || header.height > signatureMaxSide) return "bad";
  const perPixel = channels[header.color];
  if (header.depth !== 8 || !perPixel || header.interlace !== 0) return "unsupported";

  const row = header.width * perPixel + 1;
  const expected = row * header.height;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 });
  } catch {
    return "bad";
  }
  if (raw.length !== expected) return "bad";
  for (let line = 0; line < header.height; line += 1) if (raw[line * row] > 4) return "bad";
  return "ok";
}
