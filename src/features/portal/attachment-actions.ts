"use server";

import { randomUUID } from "node:crypto";
import { getCustomerSession } from "@/lib/auth/customer";
import { createAdminClient } from "@/lib/supabase/admin";
import { acceptable, attachmentBucket, maxAttachments } from "./attachments";

export type AttachmentTarget = { path: string; url: string } | null;

export async function createAttachmentUploads(files: Array<{ type: string; size: number }>): Promise<AttachmentTarget[]> {
  const session = await getCustomerSession();
  if (!session || files.length > maxAttachments) return files.map(() => null);
  const storage = createAdminClient().storage.from(attachmentBucket);
  const targets: AttachmentTarget[] = [];
  for (const file of files) {
    if (!acceptable(file.type, file.size)) {
      targets.push(null);
      continue;
    }
    const ext = file.type.split("/")[1].replace("jpeg", "jpg").replace("quicktime", "mov");
    const path = `portal/${session.customerId}/${randomUUID()}.${ext}`;
    const { data } = await storage.createSignedUploadUrl(path);
    targets.push(data ? { path, url: data.signedUrl } : null);
  }
  return targets;
}
