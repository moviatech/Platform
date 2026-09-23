"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";
import { createInsuranceUpload, saveInsuranceProof } from "./ops-actions";

export function InsuranceUpload({ reservationId, replace }: { reservationId: string; replace: boolean }) {
  const t = useTranslations("reservations");
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const onChange = async () => {
    const file = ref.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const target = await createInsuranceUpload(reservationId, { type: file.type, size: file.size });
      if (!target) throw new Error("file_invalid");
      const response = await fetch(target.url, { method: "PUT", headers: { "content-type": file.type, "x-upsert": "false" }, body: file });
      if (!response.ok) throw new Error("upload_failed");
      const saved = await saveInsuranceProof(reservationId, target.path);
      if (saved.error) throw new Error("upload_failed");
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "file_invalid" ? "file_invalid" : "upload_failed");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <>
      <label className={cn("cursor-pointer whitespace-nowrap rounded-pill px-2 py-0.5 text-[11px] text-charcoal underline decoration-gold/50 underline-offset-2 hover:decoration-gold", busy && "pointer-events-none opacity-50")}>
        {busy ? t("detail.uploading") : replace ? t("detail.replaceFile") : t("detail.uploadFile")}
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" className="sr-only" onChange={onChange} disabled={busy} aria-label={t("detail.insurance")} />
      </label>
      {error && (
        <span className="text-[11px] text-status-danger" role="alert">
          {t(`errors.${error}`)}
        </span>
      )}
    </>
  );
}
