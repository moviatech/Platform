import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ops/PageHeader";
import { resetStaffMfa, setStaffActive } from "@/features/staff/actions";
import { listStaff } from "@/features/staff/queries";
import { EditToggle, LocationsForm, NewStaffForm, ResetPasswordForm, RolesForm } from "@/features/staff/StaffForms";
import { listLocationChoices } from "@/features/locations/queries";
import { requirePagePermission } from "@/lib/auth/staff";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const session = await requirePagePermission("staff.view");
  const locale = await getLocale();
  const [t, staff, locations] = await Promise.all([getTranslations("staff"), listStaff(), listLocationChoices(null, false)]);
  const locationName = (id: string) => {
    const location = locations.find((item) => item.id === id);
    return location ? (locale === "zh" ? (location.name_zh ?? location.name) : location.name) : id;
  };
  const manage = session.permissions.has("staff.manage");
  const grid = "md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_5rem_9rem_5rem]";

  return (
    <>
      <PageHeader title={t("title")} />
      <div className="card overflow-hidden">
        <div className={cn("hidden gap-4 border-b border-ink/[0.07] bg-pearl/60 px-5 py-2.5 text-[11px] font-medium tracking-[0.12em] text-muted uppercase md:grid", grid)}>
          <span>{t("name")}</span>
          <span>{t("email")}</span>
          <span>{t("role")}</span>
          <span>{t("locations")}</span>
          <span>{t("status")}</span>
          <span>{t("lastLogin")}</span>
          <span />
        </div>
        <ul className="divide-y divide-ink/[0.06]">
          {staff.map((member) => {
            const self = member.user_id === session.userId;
            return (
              <li key={member.user_id} className={cn("grid gap-x-4 gap-y-2 px-5 py-3.5 text-sm md:items-center", grid, !member.active && "opacity-60")}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{member.display_name}</span>
                  {member.job_title && <span className="block truncate text-[12px] text-muted">{member.job_title}</span>}
                </span>
                <span className="truncate text-[13px] text-charcoal">{member.email}</span>
                <span className="text-[13px]">{member.roles.map((role) => t(`roles.${role}`)).join(" · ") || "—"}</span>
                <span className="text-[13px]">{member.locations.length ? member.locations.map(locationName).join(" · ") : t("allLocations")}</span>
                <span>
                  <Badge tone={member.active ? "success" : "neutral"}>{member.active ? t("active") : t("inactive")}</Badge>
                </span>
                <span className="text-[13px] text-muted">{member.last_login_at ? formatDateTime(member.last_login_at) : "—"}</span>
                {manage && !self ? (
                  <EditToggle>
                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <p className="mb-1.5 text-[12px] font-medium text-charcoal">{t("role")}</p>
                        <RolesForm userId={member.user_id} roles={member.roles} />
                      </div>
                      <div>
                        <p className="mb-1.5 text-[12px] font-medium text-charcoal">{t("locations")}</p>
                        <LocationsForm userId={member.user_id} options={locations} selected={member.locations} />
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink/[0.07] pt-4">
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
                    </div>
                  </EditToggle>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {manage && (
        <section className="card mt-5 max-w-3xl p-6">
          <h2 className="mb-4 text-base font-semibold">{t("add")}</h2>
          <NewStaffForm locations={locations} />
        </section>
      )}
    </>
  );
}
