"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { documentBucket, documentKinds, documentTypes, getDocument, maxDocumentBytes } from "./documents";
import { notifyInvestorEvent } from "./notify";

export type DocumentState = { ok?: boolean; error?: "invalid" | "failed" | "type" | "size" };
export type UploadTarget = { path: string; url: string; token: string } | null;

const uuid = z.uuid();
const trimmed = (value: FormDataEntryValue | null) => String(value ?? "").trim();

export async function createDocumentUpload(investorId: string, file: { type: string; size: number; name: string }): Promise<UploadTarget> {
  await requirePermission("investor.manage");
  if (!uuid.safeParse(investorId).success || !documentTypes.test(file.type) || file.size > maxDocumentBytes || file.size <= 0) return null;
  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${investorId}/${randomUUID()}.${ext}`;
  const { data } = await createAdminClient().storage.from(documentBucket).createSignedUploadUrl(path);
  return data ? { path, url: data.signedUrl, token: data.token } : null;
}

const finalizeInput = z.object({
  investorId: uuid,
  path: z.string().min(10).max(300),
  contentType: z.string().regex(documentTypes),
  size: z.number().int().positive().max(maxDocumentBytes),
  kind: z.enum(documentKinds),
  title: z.string().trim().min(1).max(160),
  allocationId: uuid.optional(),
  signedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function finalizeDocument(_: DocumentState, form: FormData): Promise<DocumentState> {
  const session = await requirePermission("investor.manage");
  const parsed = finalizeInput.safeParse({
    investorId: form.get("investorId"),
    path: trimmed(form.get("path")),
    contentType: trimmed(form.get("contentType")),
    size: Number(trimmed(form.get("size"))),
    kind: form.get("kind"),
    title: trimmed(form.get("title")),
    allocationId: trimmed(form.get("allocationId")) || undefined,
    signedOn: trimmed(form.get("signedOn")) || undefined,
  });
  if (!parsed.success) return { error: "invalid" };
  if (!parsed.data.path.startsWith(`${parsed.data.investorId}/`)) return { error: "invalid" };
  const admin = createAdminClient();
  if (parsed.data.allocationId) {
    const { data: allocation } = await admin.from("investor_allocations").select("id").eq("id", parsed.data.allocationId).eq("investor_id", parsed.data.investorId).maybeSingle();
    if (!allocation) return { error: "invalid" };
  }
  const { data, error } = await admin
    .from("investor_documents")
    .insert({ investor_id: parsed.data.investorId, allocation_id: parsed.data.allocationId ?? null, kind: parsed.data.kind, title: parsed.data.title, storage_key: parsed.data.path, content_type: parsed.data.contentType, size_bytes: parsed.data.size, signed_on: parsed.data.signedOn ?? null, uploaded_by: session.userId })
    .select("id")
    .single();
  if (error || !data) return { error: "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.document_added", entityType: "investor_document", entityId: data.id, metadata: { by: session.displayName, kind: parsed.data.kind, title: parsed.data.title } });
  await notifyInvestorEvent(parsed.data.investorId, "document_added", { title: parsed.data.title }, `/documents?doc=${data.id}`, { dedupeKey: `document_added:${data.id}` });
  revalidatePath(`/ops/investors/${parsed.data.investorId}`);
  return { ok: true };
}

export async function deleteDocument(_: DocumentState, form: FormData): Promise<DocumentState> {
  const session = await requirePermission("investor.manage");
  const id = uuid.safeParse(form.get("id"));
  if (!id.success) return { error: "invalid" };
  const document = await getDocument(id.data);
  if (!document) return { error: "invalid" };
  const admin = createAdminClient();
  const { error } = await admin.from("investor_documents").delete().eq("id", document.id);
  if (error) return { error: "failed" };
  await admin.storage.from(documentBucket).remove([document.storage_key]).catch(() => undefined);
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "investor.document_deleted", entityType: "investor_document", entityId: document.id, metadata: { by: session.displayName, title: document.title } });
  revalidatePath(`/ops/investors/${document.investor_id}`);
  return { ok: true };
}
