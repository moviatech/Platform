import type { BadgeTone } from "@/components/ui/Badge";

export const conversationStatuses = ["OPEN", "PENDING_CUSTOMER", "RESOLVED", "SPAM"] as const;
export type ConversationStatus = (typeof conversationStatuses)[number];

export const mailboxes = ["contact", "support"] as const;
export type Mailbox = (typeof mailboxes)[number];

export type MessageDirection = "INBOUND" | "OUTBOUND" | "INTERNAL";
export type MessageChannel = "EMAIL" | "WEB_FORM" | "NOTE" | "PORTAL";
export type DeliveryStatus = "RECEIVED" | "SENT" | "DELIVERED" | "BOUNCED" | "COMPLAINED" | "FAILED";

export const conversationStatusTone: Record<ConversationStatus, BadgeTone> = {
  OPEN: "gold",
  PENDING_CUSTOMER: "info",
  RESOLVED: "success",
  SPAM: "danger",
};

export type ReplyChannel = "PORTAL" | "CHAT" | "EMAIL";

export function replyChannelFor(conversation: { customer_id: string | null; customer_email: string | null }): ReplyChannel {
  return conversation.customer_id ? "PORTAL" : conversation.customer_email ? "EMAIL" : "CHAT";
}

export type Conversation = {
  id: string;
  token: string;
  mailbox: Mailbox;
  subject: string | null;
  customer_email: string | null;
  customer_name: string | null;
  customer_id: string | null;
  locale: string | null;
  status: ConversationStatus;
  unread: boolean;
  assigned_to: string | null;
  lead_id: string | null;
  reservation_id: string | null;
  reservation?: { id: string; number: string } | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_direction: MessageDirection | null;
  created_at: string;
};

export type Attachment = {
  id: string;
  message_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
};

export type Message = {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  channel: MessageChannel;
  from_email: string | null;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  body_text: string;
  delivery_status: DeliveryStatus;
  delivery_error: string | null;
  sent_by: string | null;
  created_at: string;
  attachments: Attachment[];
};
