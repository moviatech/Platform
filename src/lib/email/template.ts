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

function renderBlock(block: EmailBlock) {
  switch (block.type) {
    case "heading":
      return `<p style="margin:28px 0 8px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:${gold};font-weight:600">${escapeHtml(block.text)}</p>`;
    case "paragraph":
      return `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:${ink}">${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`;
    case "code":
      return `<p style="margin:18px 0 22px;font-size:32px;letter-spacing:0.28em;font-weight:600;color:${ink};font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(block.text)}</p>`;
    case "button":
      return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 26px"><tr><td style="border-radius:999px;background:${ink}"><a href="${escapeHtml(block.href)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;border-radius:999px">${escapeHtml(block.label)}</a></td></tr></table>`;
    case "rows":
      return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;margin:8px 0 18px;border-collapse:collapse">${block.rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:9px 0;font-size:13px;color:${muted};border-bottom:1px solid #ecece9;vertical-align:top;width:38%">${escapeHtml(label)}</td><td style="padding:9px 0;font-size:14px;color:${ink};border-bottom:1px solid #ecece9;text-align:right">${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>`;
    case "divider":
      return `<hr style="border:0;border-top:1px solid #ecece9;margin:24px 0">`;
  }
}

export function renderEmail(email: BrandedEmail) {
  const site = `https://www.${rootDomain}`;
  const body = email.blocks.map(renderBlock).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(email.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f3f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif">
${email.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(email.preheader)}</div>` : ""}
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;background:#f3f3f1"><tr><td align="center" style="padding:36px 16px">
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px">
<tr><td style="padding:0 8px 18px"><a href="${site}" style="text-decoration:none"><img src="${supabaseUrl}/storage/v1/object/public/public-assets/brand/movia-logo-email.png" alt="Movia" width="120" style="display:block;width:120px;height:auto;border:0"></a></td></tr>
<tr><td style="background:#ffffff;border-radius:20px;padding:36px 36px 30px;border:1px solid rgba(17,17,17,0.06)">
<div style="width:36px;height:2px;background:${gold};margin-bottom:22px"></div>
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.35;font-weight:600;color:${ink}">${escapeHtml(email.title)}</h1>
${body}
</td></tr>
<tr><td style="padding:22px 8px 0;font-size:12px;line-height:1.7;color:${muted}">${escapeHtml(email.footer ?? `Movia Technologies · Irvine, CA · contact@${rootDomain}`)}</td></tr>
</table></td></tr></table></body></html>`;

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
