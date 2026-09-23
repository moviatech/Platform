"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input } from "@/components/ui/Field";
import { createStaff, resetStaffPassword, setStaffRoles, type StaffState } from "./actions";
import { staffRoles, type StaffRole } from "@/lib/auth/permissions";

function RoleChecks({ selected, compact }: { selected: StaffRole[]; compact?: boolean }) {
  const t = useTranslations("staff");
  return (
    <div className={compact ? "flex flex-wrap gap-x-3 gap-y-1.5" : "flex flex-wrap gap-x-4 gap-y-2"}>
      {staffRoles.map((role) => (
        <label key={role} className="flex items-center gap-1.5 text-[13px] text-charcoal">
          <input type="checkbox" name="roles" value={role} defaultChecked={selected.includes(role)} className="size-3.5 accent-[#b58b4b]" />
          {t(`roles.${role}`)}
        </label>
      ))}
    </div>
  );
}

export function RolesForm({ userId, roles }: { userId: string; roles: StaffRole[] }) {
  const t = useTranslations("staff");
  const [state, action, pending] = useActionState<StaffState, FormData>(setStaffRoles, {});
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="userId" value={userId} />
      <RoleChecks selected={roles} compact />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="ghost" disabled={pending}>
          {t("save")}
        </Button>
        {state.error && <span className="text-[12px] text-status-danger">{t(`errors.${state.error}`)}</span>}
        {state.ok && <span className="text-[12px] text-status-available">✓</span>}
      </div>
    </form>
  );
}

function Credential({ email, password, linked }: { email?: string; password?: string; linked?: boolean }) {
  const t = useTranslations("staff");
  return (
    <div className="rounded-xl bg-status-available/10 px-4 py-3 text-[13px]">
      <p className="font-medium">{t(linked ? "linkedTitle" : "createdTitle")}</p>
      {email && (
        <p className="mt-1">
          {t("email")}: <span className="font-mono">{email}</span>
        </p>
      )}
      {!linked && (
        <>
          <p>
            {t("tempPassword")}: <span className="font-mono text-[15px]">{password}</span>
          </p>
          <p className="mt-1 text-muted">{t("tempPasswordNote")}</p>
        </>
      )}
    </div>
  );
}

export function NewStaffForm() {
  const t = useTranslations("staff");
  const [state, action, pending] = useActionState<StaffState, FormData>(createStaff, {});
  if (state.ok) return <Credential email={state.email} password={state.password} linked={state.linked} />;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <FieldWrap label={t("name")} htmlFor="displayName">
        <Input id="displayName" name="displayName" required maxLength={80} />
      </FieldWrap>
      <FieldWrap label={t("email")} htmlFor="email">
        <Input id="email" name="email" type="email" required maxLength={200} />
      </FieldWrap>
      <FieldWrap label={t("jobTitle")} htmlFor="jobTitle">
        <Input id="jobTitle" name="jobTitle" maxLength={80} />
      </FieldWrap>
      <div className="sm:col-span-2">
        <p className="mb-1.5 text-[12px] font-medium text-charcoal">{t("role")}</p>
        <RoleChecks selected={["FIELD"]} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {t("create")}
        </Button>
        {state.error && <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span>}
      </div>
    </form>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const t = useTranslations("staff");
  const [state, action, pending] = useActionState<StaffState, FormData>(resetStaffPassword, {});
  if (state.ok) return <Credential password={state.password} />;
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {t("resetPassword")}
      </Button>
    </form>
  );
}
