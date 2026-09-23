import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { Block, Row } from "./agreement";
import { parseRich } from "./rich-text";
import { inspectSignaturePng } from "./signature-png";

export type AgreementPdfInput = {
  title: string;
  author: string;
  footer: string;
  blocks: Block[];
};

type Doc = InstanceType<typeof PDFDocument>;

const page = { width: 612, height: 792, top: 56, bottom: 64, side: 54 };
const width = page.width - page.side * 2;
const usable = page.height - page.top - page.bottom;
const ink = "#141414";
const body = "#2b2b2b";
const muted = "#6f6f6f";
const rule = "#d6d6d6";
const pngPrefix = "data:image/png;base64,";
const features = { liga: false, clig: false } as unknown as PDFKit.Mixins.OpenTypeFeatures[];

let fonts: { regular: Buffer; bold: Buffer } | undefined;

function loadFonts() {
  fonts ??= {
    regular: readFileSync(path.join(process.cwd(), "assets/fonts/NotoSansSC-400.woff")),
    bold: readFileSync(path.join(process.cwd(), "assets/fonts/NotoSansSC-700.woff")),
  };
  return fonts;
}

const replacements: Array<[RegExp, string]> = [
  [/\r/g, ""],
  [/\t/g, " "],
  [/→/g, "—"],
  [/≤/g, "<="],
  [/≥/g, ">="],
  [/☑/g, "[x]"],
  [/☐/g, "[ ]"],
  [/(?<=[A-Za-z0-9])[‘’](?=[A-Za-z])/g, "'"],
  [/(?<=[A-Za-z0-9.,])’(?=[\s.,;:)]|$)/g, "'"],
  [/“([\x20-\x7e]*?)”/g, '"$1"'],
  [/‘([\x20-\x7e]*?)’/g, "'$1'"],
];

function clean(text: string) {
  return replacements.reduce((value, [pattern, to]) => value.replace(pattern, to), text);
}

function remaining(doc: Doc) {
  return page.height - page.bottom - doc.y;
}

function ensure(doc: Doc, height: number) {
  if (remaining(doc) < Math.min(height, usable)) doc.addPage();
}

function drawBox(doc: Doc, x: number, y: number, ticked: boolean) {
  doc.save().lineWidth(0.8).strokeColor(ink).rect(x, y, 7.5, 7.5).stroke();
  if (ticked) {
    doc
      .lineWidth(1.3)
      .moveTo(x + 1.6, y + 4)
      .lineTo(x + 3.3, y + 5.9)
      .lineTo(x + 6.1, y + 1.7)
      .stroke();
  }
  doc.restore();
}

function drawRows(doc: Doc, rows: Row[]) {
  const labelWidth = 148;
  const gap = 14;
  const valueLeft = page.side + labelWidth + gap;
  for (const [label, raw] of rows) {
    const mark = raw.startsWith("☑ ") ? "on" : raw.startsWith("☐ ") ? "off" : null;
    const value = clean(mark ? raw.slice(2) : raw) || " ";
    const name = clean(label) || " ";
    const indent = mark ? 13 : 0;
    const valueWidth = width - labelWidth - gap - indent;
    doc.font("regular").fontSize(9);
    if (!mark && (value.length > 260 || value.split("\n").length > 5)) {
      ensure(doc, 44);
      doc.fillColor(muted).text(name, page.side, doc.y, { width, lineGap: 2, features });
      doc.y += 3;
      doc.fillColor(ink).text(value, page.side, doc.y, { width, lineGap: 2.5, features });
      doc.y += 7;
      doc.x = page.side;
      continue;
    }
    const height = Math.max(doc.heightOfString(name, { width: labelWidth, lineGap: 2, features }), doc.heightOfString(value, { width: valueWidth, lineGap: 2, features }));
    ensure(doc, height);
    const y = doc.y;
    const pagesBefore = doc.bufferedPageRange().count;
    doc.fillColor(muted).text(name, page.side, y, { width: labelWidth, lineGap: 2, features });
    if (mark) drawBox(doc, valueLeft, y + 2.4, mark === "on");
    doc.fillColor(ink).text(value, valueLeft + indent, y, { width: valueWidth, lineGap: 2, features });
    doc.y = doc.bufferedPageRange().count === pagesBefore ? Math.max(doc.y, y + height) + 5 : doc.y + 5;
    doc.x = page.side;
  }
  doc.y += 4;
}

function drawRich(doc: Doc, text: string) {
  for (const line of parseRich(text)) {
    if (line.kind === "gap") {
      doc.y += 5;
      continue;
    }
    if (line.spans.length === 0) continue;
    const title = line.kind === "heading";
    const indent = line.kind === "bullet" ? 12 : 0;
    if (title) doc.y += 3;
    ensure(doc, title ? 34 : 14);
    const y = doc.y;
    if (indent) doc.font("regular").fontSize(9.5).fillColor(body).text("•", page.side + 2, y, { lineBreak: false, features });
    line.spans.forEach((span, index) => {
      const strong = title || span.bold;
      const options = { lineGap: 2.5, continued: index < line.spans.length - 1, features };
      doc.font(strong ? "bold" : "regular").fontSize(title ? 10 : 9.5).fillColor(strong ? ink : body);
      if (index === 0) doc.text(clean(span.text), page.side + indent, y, { ...options, width: width - indent });
      else doc.text(clean(span.text), options);
    });
    doc.x = page.side;
    doc.y += title ? 2.5 : 1.5;
  }
  doc.y += 8;
}

function drawParagraph(doc: Doc, text: string, tone?: "warning" | "muted" | "strong") {
  const value = clean(text);
  if (tone === "warning") {
    doc.font("bold").fontSize(9.5);
    const height = doc.heightOfString(value, { width: width - 12, lineGap: 2.5, features });
    ensure(doc, height);
    const y = doc.y;
    const pagesBefore = doc.bufferedPageRange().count;
    doc.fillColor(ink).text(value, page.side + 12, y, { width: width - 12, lineGap: 2.5, features });
    if (doc.bufferedPageRange().count === pagesBefore) doc.save().rect(page.side, y + 1, 2.5, doc.y - y - 3).fill(ink).restore();
    doc.x = page.side;
    doc.y += 8;
    return;
  }
  doc
    .font(tone === "strong" ? "bold" : "regular")
    .fontSize(tone === "muted" ? 8.5 : 9.5)
    .fillColor(tone === "muted" ? muted : tone === "strong" ? ink : body)
    .text(value, page.side, doc.y, { width, lineGap: 2.5, features });
  doc.y += tone === "strong" ? 3 : 8;
}

function drawSignature(doc: Doc, rows: Row[], image?: string | null) {
  ensure(doc, image ? 190 : 110);
  doc.y += 6;
  doc.save().moveTo(page.side, doc.y).lineTo(page.side + width, doc.y).lineWidth(0.5).strokeColor(rule).stroke().restore();
  doc.y += 12;
  const picture = image?.startsWith(pngPrefix) ? Buffer.from(image.slice(pngPrefix.length), "base64") : null;
  if (picture && inspectSignaturePng(picture) === "ok") {
    const y = doc.y;
    doc.image(picture, page.side, y, { fit: [210, 66] });
    doc.y = y + 76;
  }
  drawRows(doc, rows);
}

function drawBlock(doc: Doc, block: Block) {
  switch (block.kind) {
    case "title":
      doc.font("bold").fontSize(8).fillColor(muted).text(clean(block.brand), page.side, doc.y, { width, characterSpacing: 1.6, features });
      doc.y += 4;
      doc.font("bold").fontSize(17).fillColor(ink).text(clean(block.text), page.side, doc.y, { width, features });
      doc.y += 3;
      doc.font("regular").fontSize(8).fillColor(muted).text(clean(block.sub), page.side, doc.y, { width, features });
      doc.y += 14;
      return;
    case "meta":
    case "rows":
      drawRows(doc, block.rows);
      return;
    case "signature":
      drawSignature(doc, block.rows, block.image);
      return;
    case "terms":
      ensure(doc, 48);
      doc.font("regular").fontSize(9).fillColor(muted).text(clean(block.label), page.side, doc.y, { width, lineGap: 2, features });
      doc.y += 4;
      drawRich(doc, block.text);
      return;
    case "section":
      ensure(doc, 70);
      doc.y += 8;
      doc.font("bold").fontSize(11.5).fillColor(ink).text(clean(block.text), page.side, doc.y, { width, features });
      doc.y += 4;
      doc.save().moveTo(page.side, doc.y).lineTo(page.side + width, doc.y).lineWidth(0.5).strokeColor(rule).stroke().restore();
      doc.y += 10;
      return;
    case "clause":
      ensure(doc, 54);
      doc.font("bold").fontSize(10).fillColor(ink).text(clean(block.heading), page.side, doc.y, { width, features });
      doc.y += 3;
      for (const paragraph of block.paragraphs) {
        doc.font("regular").fontSize(9.5).fillColor(body).text(clean(paragraph), page.side, doc.y, { width, lineGap: 2.5, features });
        doc.y += 5;
      }
      doc.y += 5;
      return;
    case "paragraph":
      drawParagraph(doc, block.text, block.tone);
      return;
  }
}

export function agreementPdf(input: AgreementPdfInput): Promise<Buffer> {
  const files = loadFonts();
  const doc = new PDFDocument({
    size: [page.width, page.height],
    margins: { top: page.top, bottom: page.bottom, left: page.side, right: page.side },
    bufferPages: true,
    info: { Title: input.title, Author: input.author, Creator: input.author, Producer: input.author },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.registerFont("regular", files.regular);
  doc.registerFont("bold", files.bold);
  doc.font("regular");
  for (const block of input.blocks) drawBlock(doc, block);

  const range = doc.bufferedPageRange();
  const footer = clean(input.footer);
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    doc.page.margins.bottom = 0;
    const y = page.height - 38;
    doc.font("regular").fontSize(7.5).fillColor(muted);
    doc.text(footer, page.side, y, { width: width - 70, lineBreak: false, features });
    doc.text(`${index + 1} / ${range.count}`, page.side, y, { width, align: "right", lineBreak: false, features });
    doc.page.margins.bottom = page.bottom;
  }
  doc.flushPages();
  doc.end();
  return done;
}
