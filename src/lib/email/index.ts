import "server-only";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export type EmailMessage = {
  from?: string;
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
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

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const ses = getClient();
  const from = message.from ?? process.env.EMAIL_FROM;
  if (!ses || !from) {
    console.info("[email:skipped]", message.subject);
    return { sent: false, reason: "not_configured" };
  }
  try {
    const result = await ses.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: Array.isArray(message.to) ? message.to : [message.to] },
        ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: message.text, Charset: "UTF-8" },
              Html: message.html ? { Data: message.html, Charset: "UTF-8" } : undefined,
            },
            Headers: message.headers ? Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })) : undefined,
          },
        },
      }),
    );
    return { sent: true, messageId: result.MessageId ?? "" };
  } catch (cause) {
    console.error("[email:failed]", message.subject, cause instanceof Error ? cause.name : cause);
    return { sent: false, reason: "failed" };
  }
}
