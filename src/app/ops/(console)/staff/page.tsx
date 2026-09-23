import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ops/PageHeader";
import { resetStaffMfa, setStaffActive, setStaffRole } from "@/features/staff/actions";
import { listStaff } from "@/features/staff/queries";
import { NewStaffForm, ResetPasswordForm } from "@/features/staff/StaffForms";
import { staffRoles } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const session = await requirePagePermission("staff.view");
  const [t, locale, staff] = await Promise.all([getTranslations("staff"), getLocale(), listStaff()]);
  const manage = session.permissions.has("staff.manage");

  return (
    <>
      <PageHeader title={t("title")} />
      <div className="card overflow-hidden">
        <div className="hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_10rem_6rem_9rem_minmax(0,1.6fr)]">
          <span>{t("name")}</span>
          <span>{t("email")}</span>
          <span>{t("role")}</span>
          <span>{t("status")}</span>
          <span>{t("lastLogin")}</span>
          <span />
        </div>
        <ul className="divide-y divide-ink/[0.06]">
          {staff.map((member) => {
            const self = member.user_id === session.userId;
            return (
              <li key={member.user_id} className={cn("grid gap-x-4 gap-y-2 px-5 py-4 text-sm md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_10rem_6rem_9rem_minmax(0,1.6fr)] md:items-center", !member.active && "opacity-60")}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{member.display_name}</span>
                  {member.job_title && <span className="block truncate text-[12px] text-muted">{member.job_title}</span>}
                </span>
                <span className="truncate text-[13px] text-charcoal">{member.email}</span>
                <span>
                  {manage && !self ? (
                    <form action={setStaffRole} className="flex items-center gap-1.5">
                      <input type="hidden" name="userId" value={member.user_id} />
                      <Select name="role" defaultValue={member.roles[0] ?? "STAFF"} className="h-8 text-[13px]">
                        {staffRoles.map((role) => (
                          <option key={role} value={role}>
                            {t(`roles.${role}`)}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" size="sm" variant="ghost">
                        {t("save")}
                      </Button>
                    </form>
                  ) : (
                    <span className="text-[13px]">{member.roles.map((role) => t(`roles.${role}`)).join(" · ") || "—"}</span>
                  )}
                </span>
                <span>
                  <Badge tone={member.active ? "success" : "neutral"}>{member.active ? t("active") : t("inactive")}</Badge>
                </span>
                <span className="text-[13px] text-muted">{member.last_login_at ? formatDateTime(member.last_login_at, locale) : "—"}</span>
                <span className="flex flex-wrap items-center gap-2 md:justify-end">
                  {manage && !self && (
                    <>
                      <form action={setStaffActive}>
                        <input type="hidden" name="userId" value={member.user_id} />
                        <input type="hidden" name="active" value={member.active ? "0" : "1"} />
                        <Button type="submit" size="sm" variant={member.active ? "danger" : "secondary"}>
                          {member.active ? t("deactivate") : t("activate")}
                        </Button>
                      </form>
                      <ResetPasswordForm userId={member.user_id} />
                      <form action={resetStaffMfa}>
                        <input type="hidden" name="userId" value={member.user_id} />
                        <Button type="submit" size="sm" variant="ghost">
                          {t("resetMfa")}
                        </Button>
                      </form>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {manage && (
        <section className="card mt-5 max-w-3xl p-6">
          <h2 className="mb-4 text-base font-semibold">{t("add")}</h2>
          <NewStaffForm />
        </section>
      )}
    </>
  );
}
