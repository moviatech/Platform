import "server-only";
import { sendEmail } from "@/lib/email";
import { rootDomain } from "@/lib/env";
import type { LeadKind } from "./types";

const labels: Record<LeadKind, string> = {
  CONTACT: "新咨询 / New inquiry",
  BOOKING_REQUEST: "新订车请求 / New booking request",
  ASSISTANT: "客服转人工 / Assistant handoff",
};

type NotifyInput = {
  id: string;
  kind: LeadKind;
  name: string | null;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  summary: string | null;
};

export async function notifyNewLead(lead: NotifyInput) {
  const to = process.env.NOTIFY_EMAIL;
  if (!to) return;
  const lines = [
    labels[lead.kind],
    "",
    lead.name && `Name: ${lead.name}`,
    lead.phone && `Phone: ${lead.phone}`,
    lead.email && `Email: ${lead.email}`,
    lead.wechat && `WeChat: ${lead.wechat}`,
    lead.summary && `\n${lead.summary}`,
    "",
    `https://ops.${rootDomain}/leads/${lead.id}`,
  ].filter((line): line is string => typeof line === "string");

  await sendEmail({
    to: to.split(",").map((item) => item.trim()).filter(Boolean),
    subject: `[Movia] ${labels[lead.kind]}${lead.name ? ` · ${lead.name}` : ""}`,
    text: lines.join("\n"),
    replyTo: lead.email ?? undefined,
  });
}
