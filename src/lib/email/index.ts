import "server-only";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { createAdminClient } from "@/lib/supabase/admin";

export type EmailAudience = "customer" | "staff" | "investor";

export type EmailMessage = {
  log: EmailAudience | false;
  ref?: { reservationId?: string | null; customerId?: string | null };
  redact?: string[];
  from?: string;
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; contentType: string; content: Uint8Array }>;
};

export type EmailResult = { sent: true; messageId: string } | { sent: false; reason: "not_configured" | "failed" };

let client: SESv2Client | undefined;

function getClient() {
  const region = process.env.SES_REGION;
  if (!region) return undefined;
  if (!client) {
    const accessKeyId = process.env.SES_ACCESS_KEY_ID;
    const secretAccessKey = process.env.SES_SECRET_ACCESS_KEY;
    client = new SESv2Client({
      region,
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
  }
  return client;
}

export function sesMessageIdHeader(messageId: string) {
  const region = process.env.SES_REGION ?? "us-east-1";
  const domain = region === "us-east-1" ? "email.amazonses.com" : `${region}.amazonses.com`;
  return `<${messageId}@${domain}>`;
}

async function record(message: EmailMessage, recipients: string[], messageId: string | null) {
  if (!message.log) return;
  const hide = (value: string) => (message.redact ?? []).reduce((out, secret) => (secret ? out.split(secret).join("…") : out), value);
  try {
    await createAdminClient()
      .from("email_log")
      .insert({
        audience: message.log,
        recipients: recipients.join(", ").slice(0, 1000),
        subject: message.subject.slice(0, 500),
        body_text: hide(message.text),
        body_html: message.html ? hide(message.html) : null,
        attachments: (message.attachments ?? []).map((item) => item.filename),
        sent: messageId !== null,
        message_id: messageId,
        reservation_id: message.ref?.reservationId ?? null,
        customer_id: message.ref?.customerId ?? null,
      });
  } catch {}
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const ses = getClient();
  const from = message.from ?? process.env.EMAIL_FROM;
  if (!ses || !from) {
    console.info("[email:skipped]", message.subject);
    return { sent: false, reason: "not_configured" };
  }
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  try {
    const result = await ses.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: recipients },
        ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: message.text, Charset: "UTF-8" },
              Html: message.html ? { Data: message.html, Charset: "UTF-8" } : undefined,
            },
            Headers: message.headers ? Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })) : undefined,
            Attachments: message.attachments?.map((item) => ({ FileName: item.filename, ContentType: item.contentType, RawContent: item.content, ContentDisposition: "ATTACHMENT" as const, ContentTransferEncoding: "BASE64" as const })),
          },
        },
      }),
    );
    await record(message, recipients, result.MessageId ?? "");
    return { sent: true, messageId: result.MessageId ?? "" };
  } catch (cause) {
    console.error("[email:failed]", message.subject, cause instanceof Error ? cause.name : cause);
    await record(message, recipients, null);
    return { sent: false, reason: "failed" };
  }
}
