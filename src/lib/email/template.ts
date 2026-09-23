import { rootDomain, supabaseUrl } from "@/lib/env";
import { escapeHtml } from "@/features/inbox/text";

export type EmailBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "code"; text: string }
  | { type: "button"; label: string; href: string }
  | { type: "rows"; rows: Array<[string, string]> }
  | { type: "divider" };

export type BrandedEmail = {
  preheader?: string;
  title: string;
  blocks: EmailBlock[];
  footer?: string;
};

const gold = "#b58b4b";
const ink = "#111111";
const muted = "#747474";
const line = "#ecece9";
const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

function renderBlock(block: EmailBlock) {
  switch (block.type) {
    case "heading":
      return `<p style="margin:28px 0 8px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:${gold};font-weight:600;font-family:${font}">${escapeHtml(block.text)}</p>`;
    case "paragraph":
      return `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:${ink};font-family:${font}">${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`;
    case "code":
      return `<p style="margin:18px 0 22px;font-size:32px;letter-spacing:0.28em;font-weight:600;color:${ink};font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(block.text)}</p>`;
    case "button": {
      const width = Math.max(112, Math.ceil((Array.from(block.label).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? 15 : 8), 0) + 56) / 4) * 4);
      return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:22px 0 26px"><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(block.href)}" style="height:48px;v-text-anchor:middle;width:${width}px" arcsize="50%" stroke="f" fillcolor="${ink}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,'Microsoft YaHei',sans-serif;font-size:15px;font-weight:500">${escapeHtml(block.label)}</center></v:roundrect><![endif]--><a href="${escapeHtml(block.href)}" style="display:inline-block;padding:14px 28px;background-color:${ink};border-radius:999px;font-size:15px;line-height:20px;font-weight:500;color:#ffffff;text-decoration:none;white-space:nowrap;font-family:${font};mso-hide:all">${escapeHtml(block.label)}</a></td></tr></table>`;
    }
    case "rows":
      return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;margin:8px 0 18px;border-collapse:collapse">${block.rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:9px 0;font-size:13px;color:${muted};font-family:${font};border-bottom:1px solid ${line};vertical-align:top;width:38%">${escapeHtml(label)}</td><td style="padding:9px 0;font-size:14px;color:${ink};font-family:${font};border-bottom:1px solid ${line};text-align:right">${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>`;
    case "divider":
      return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%"><tr><td style="padding:12px 0"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%"><tr><td style="border-top:1px solid ${line};font-size:0;line-height:0;padding:0"></td></tr></table></td></tr></table>`;
  }
}

export function renderEmail(email: BrandedEmail) {
  const site = `https://www.${rootDomain}`;
  const body = email.blocks.map(renderBlock).join("");
  const html = `<!doctype html><html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="x-apple-disable-message-reformatting"><!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--><title>${escapeHtml(email.title)}</title></head>
<body style="margin:0;padding:0;background-color:#f3f3f1;font-family:${font}" bgcolor="#f3f3f1">
${email.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f3f3f1">${escapeHtml(email.preheader)}</div>` : ""}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="#f3f3f1" style="width:100%;background-color:#f3f3f1"><tr><td align="center" style="padding:36px 16px">
<!--[if mso]><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" align="center"><tr><td><![endif]-->
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;max-width:560px">
<tr><td style="padding:0 8px 18px"><a href="${site}" style="text-decoration:none"><img src="${supabaseUrl}/storage/v1/object/public/public-assets/brand/movia-logo-email.png" alt="Movia" width="120" height="auto" border="0" style="display:block;width:120px;height:auto;border:0;outline:none;text-decoration:none"></a></td></tr>
<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:20px;padding:36px 36px 30px;border:1px solid ${line}">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:0 0 22px"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="36" style="width:36px"><tr><td width="36" style="width:36px;border-top:2px solid ${gold};font-size:0;line-height:0;padding:0"></td></tr></table></td></tr></table>
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.35;font-weight:600;color:${ink};font-family:${font}">${escapeHtml(email.title)}</h1>
${body}
</td></tr>
<tr><td style="padding:22px 8px 0;font-size:12px;line-height:1.7;color:${muted};font-family:${font}">${escapeHtml(email.footer ?? `Movia Technologies · Irvine, CA · contact@${rootDomain}`)}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;

  const text = email.blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return `\n${block.text.toUpperCase()}`;
        case "paragraph":
          return block.text;
        case "code":
          return block.text;
        case "button":
          return `${block.label}: ${block.href}`;
        case "rows":
          return block.rows.map(([label, value]) => `${label}: ${value}`).join("\n");
        case "divider":
          return "—";
      }
    })
    .join("\n\n");
  return { html, text: `${email.title}\n\n${text}\n\n${email.footer ?? `Movia Technologies · contact@${rootDomain}`}` };
}
