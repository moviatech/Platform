"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { staffRoles } from "@/lib/auth/permissions";
import { createStaff, resetStaffPassword, type StaffState } from "./actions";

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
      <FieldWrap label={t("role")} htmlFor="role">
        <Select id="role" name="role" defaultValue="STAFF">
          {staffRoles.map((role) => (
            <option key={role} value={role}>
              {t(`roles.${role}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
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
