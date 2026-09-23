import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const documentBucket = "investor-documents";
export const documentKinds = ["AGREEMENT", "VEHICLE", "TAX", "STATEMENT", "OTHER"] as const;
export type DocumentKind = (typeof documentKinds)[number];
export const maxDocumentBytes = 20 * 1024 * 1024;
export const documentTypes = /^(application\/pdf|image\/(jpeg|png|webp|heic))$/;

export type InvestorDocument = {
  id: string;
  investor_id: string;
  allocation_id: string | null;
  kind: DocumentKind;
  title: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  signed_on: string | null;
  created_at: string;
  allocation: { vehicle: { fleet_number: string } | null } | null;
  uploader?: { display_name: string } | null;
};

const columns = "id, investor_id, allocation_id, kind, title, storage_key, content_type, size_bytes, signed_on, created_at, allocation:investor_allocations(vehicle:vehicles(fleet_number)), uploader:staff_members!investor_documents_uploaded_by_fkey(display_name)";

export async function listDocuments(investorId: string): Promise<InvestorDocument[]> {
  const { data } = await createAdminClient().from("investor_documents").select(columns).eq("investor_id", investorId).order("created_at", { ascending: false }).limit(200);
  return (data ?? []) as unknown as InvestorDocument[];
}

export async function getDocument(id: string, investorId?: string): Promise<InvestorDocument | null> {
  let query = createAdminClient().from("investor_documents").select(columns).eq("id", id);
  if (investorId) query = query.eq("investor_id", investorId);
  const { data } = await query.maybeSingle();
  return (data as unknown as InvestorDocument | null) ?? null;
}

export async function downloadDocument(document: InvestorDocument) {
  const { data, error } = await createAdminClient().storage.from(documentBucket).download(document.storage_key);
  if (error || !data) return null;
  return data;
}
