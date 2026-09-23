import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/utils/format";

const actions = ["investor.signed_in", "investor.login_failed", "investor.code_failed", "investor.mfa_failed", "investor.mfa_verified", "investor.password_email_requested", "investor.step_up_verified"];

export async function InvestorSignInHistory({ email }: { email: string }) {
  const t = await getTranslations("investor.account.activity");
  const { data } = await createAdminClient().from("audit_events").select("action, ip_address, created_at").eq("entity_type", "investor_email").eq("entity_id", email).in("action", actions).order("created_at", { ascending: false }).limit(10);
  const rows = data ?? [];
  if (rows.length === 0) return <p className="px-2 py-1 text-[12px] text-muted">{t("empty")}</p>;
  return (
    <ul className="divide-y divide-ink/[0.06] px-2 text-[13px]">
      {rows.map((row, index) => {
        const key = row.action.replace("investor.", "");
        return (
          <li key={`${row.created_at}-${index}`} className="flex items-center justify-between gap-3 py-2">
            <span className={row.action.endsWith("failed") ? "text-status-danger" : "text-charcoal"}>{t.has(key) ? t(key) : row.action}</span>
            <span className="text-right text-[12px] text-muted">
              {formatDateTime(row.created_at)}
              {row.ip_address ? ` · ${row.ip_address}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
