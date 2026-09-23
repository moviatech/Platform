"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { deleteVehicle, type FleetFormState } from "./actions";

export function DeleteVehicleButton({ id }: { id: string }) {
  const t = useTranslations("fleet");
  const [state, action, pending] = useActionState<FleetFormState, FormData>(deleteVehicle, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3 px-1">
      <input type="hidden" name="id" value={id} />
      <SubmitButton disabled={pending} className="text-[13px] text-muted hover:text-status-danger" onClick={(event) => !confirm(t("confirmDelete")) && event.preventDefault()}>
        {t("delete")}
      </SubmitButton>
      {state.error && (
        <span className="text-[13px] text-status-danger" role="alert">
          {t(`errors.${state.error}`)}
        </span>
      )}
    </form>
  );
}
