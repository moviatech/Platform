"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { saveClassVideo, type ClassVideoState } from "./class-photo-actions";

export function ClassVideoForm({ classId, videoUrl }: { classId: string; videoUrl: string | null }) {
  const t = useTranslations("fleet");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<ClassVideoState, FormData>(saveClassVideo, {});
  const shown = state.error && state.value !== undefined ? state.value : (videoUrl ?? "");
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="classId" value={classId} />
      <Input key={shown} name="videoUrl" type="url" inputMode="url" defaultValue={shown} maxLength={200} placeholder="https://vimeo.com/..." aria-label={t("fields.video")} className="h-9 max-w-sm flex-1" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {common("save")}
      </Button>
      {state.ok && <span className="text-[13px] text-status-available">{common("saved")}</span>}
      {state.error && (
        <span className="text-[13px] text-status-danger" role="alert">
          {t(`errors.${state.error === "video" ? "video" : state.error === "invalid" ? "invalid" : "failed"}`)}
        </span>
      )}
    </form>
  );
}
