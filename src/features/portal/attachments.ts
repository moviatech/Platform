import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export const attachmentBucket = "message-attachments";
export const imageTypes = /^image\/(jpeg|png|webp|heic|heif)$/;
export const videoTypes = /^video\/(mp4|webm|quicktime)$/;
export const maxImageBytes = 10 * 1024 * 1024;
export const maxVideoBytes = 50 * 1024 * 1024;
export const maxAttachments = 6;

export type UploadedAttachment = { path: string; name: string; type: string; size: number };

const schema = z.array(z.object({ path: z.string().max(200), name: z.string().max(200), type: z.string().max(80), size: z.number().int().min(0) })).max(maxAttachments);

export function acceptable(type: string, size: number) {
  return (imageTypes.test(type) && size <= maxImageBytes) || (videoTypes.test(type) && size <= maxVideoBytes);
}

export function parseAttachments(raw: FormDataEntryValue | null, customerId: string): UploadedAttachment[] | null {
  let parsed: unknown = [];
  try {
    parsed = raw ? JSON.parse(String(raw)) : [];
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) return null;
  const prefix = `portal/${customerId}/`;
  return result.data.every((item) => item.path.startsWith(prefix) && /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(item.path.slice(prefix.length)) && acceptable(item.type, item.size)) ? result.data : null;
}

export async function attachToMessage(messageId: string, attachments: UploadedAttachment[]) {
  if (!attachments.length) return;
  await createAdminClient()
    .from("message_attachments")
    .insert(attachments.map((item) => ({ message_id: messageId, storage_path: item.path, filename: item.name.slice(0, 200), mime_type: item.type, size_bytes: item.size })));
}
