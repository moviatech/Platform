import { getTranslations } from "next-intl/server";

export async function AuditAction({ action }: { action: string }) {
  const t = await getTranslations("auditActions");
  const key = action.replace(/\./g, "_");
  return <>{t.has(key) ? t(key) : action}</>;
}
