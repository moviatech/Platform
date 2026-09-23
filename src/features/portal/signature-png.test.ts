import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { inspectSignaturePng, signatureMaxSide } from "./signature-png";

const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  return Buffer.concat([head, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}

function header(width: number, height: number, color = 6, depth = 8, interlace = 0) {
  const body = Buffer.alloc(13);
  body.writeUInt32BE(width, 0);
  body.writeUInt32BE(height, 4);
  body[8] = depth;
  body[9] = color;
  body[12] = interlace;
  return chunk("IHDR", body);
}

function pixels(width: number, height: number, perPixel = 4) {
  return deflateSync(Buffer.alloc((width * perPixel + 1) * height));
}

const png = (...parts: Buffer[]) => Buffer.concat([magic, ...parts, chunk("IEND", Buffer.alloc(0))]);

describe("inspectSignaturePng", () => {
  it("accepts an ordinary canvas export", () => {
    expect(inspectSignaturePng(png(header(60, 20), chunk("IDAT", pixels(60, 20))))).toBe("ok");
    expect(inspectSignaturePng(png(header(60, 20, 2), chunk("IDAT", pixels(60, 20, 3))))).toBe("ok");
  });

  it("accepts image data split across several chunks", () => {
    const data = pixels(60, 20);
    expect(inspectSignaturePng(png(header(60, 20), chunk("IDAT", data.subarray(0, 9)), chunk("tEXt", Buffer.from("a")), chunk("IDAT", data.subarray(9))))).toBe("ok");
  });

  it("refuses image data that does not decompress or has the wrong size", () => {
    expect(inspectSignaturePng(png(header(60, 20), chunk("IDAT", Buffer.alloc(300, 7))))).toBe("bad");
    expect(inspectSignaturePng(png(header(60, 20), chunk("IDAT", pixels(60, 19))))).toBe("bad");
    expect(inspectSignaturePng(png(header(60, 20), chunk("IDAT", pixels(60, 400))))).toBe("bad");
  });

  it("refuses a row with an unknown filter", () => {
    const raw = Buffer.alloc((60 * 4 + 1) * 20);
    raw[241] = 9;
    expect(inspectSignaturePng(png(header(60, 20), chunk("IDAT", deflateSync(raw))))).toBe("bad");
  });

  it("refuses declared sizes beyond the limit however small the file is", () => {
    expect(inspectSignaturePng(png(header(30000, 30000), chunk("IDAT", deflateSync(Buffer.alloc(64)))))).toBe("bad");
    expect(inspectSignaturePng(png(header(signatureMaxSide + 1, 10), chunk("IDAT", pixels(10, 10))))).toBe("bad");
    expect(inspectSignaturePng(png(header(0, 10), chunk("IDAT", pixels(10, 10))))).toBe("bad");
  });

  it("refuses a second header, a missing end, and anything that is not a PNG", () => {
    expect(inspectSignaturePng(png(header(60, 20), header(30000, 30000), chunk("IDAT", pixels(60, 20))))).toBe("bad");
    expect(inspectSignaturePng(Buffer.concat([magic, header(60, 20), chunk("IDAT", pixels(60, 20))]))).toBe("bad");
    expect(inspectSignaturePng(Buffer.concat([magic, chunk("IDAT", pixels(60, 20)), header(60, 20), chunk("IEND", Buffer.alloc(0))]))).toBe("bad");
    expect(inspectSignaturePng(Buffer.alloc(400, 1))).toBe("bad");
    expect(inspectSignaturePng(png(header(60, 20)))).toBe("bad");
  });

  it("marks formats it does not decode as unsupported", () => {
    expect(inspectSignaturePng(png(header(60, 20, 6, 8, 1), chunk("IDAT", Buffer.alloc(300, 7))))).toBe("unsupported");
    expect(inspectSignaturePng(png(header(60, 20, 3), chunk("IDAT", pixels(60, 20, 1))))).toBe("unsupported");
    expect(inspectSignaturePng(png(header(60, 20, 6, 16), chunk("IDAT", pixels(60, 20, 8))))).toBe("unsupported");
  });
});
