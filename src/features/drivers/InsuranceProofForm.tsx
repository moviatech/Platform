"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FileDrop } from "@/components/ui/FileDrop";
import { createProofUpload, submitInsuranceProof, type ProofState } from "./portal-actions";

export function InsuranceProofForm({ number }: { number: string }) {
  const t = useTranslations("portal.trip.insurance");
  const [state, dispatch, pending] = useActionState<ProofState, FormData>(submitInsuranceProof, {});
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("file_required");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const target = await createProofUpload(number, { type: file.type, size: file.size });
      if (!target) throw new Error("upload_failed");
      const response = await fetch(target.url, { method: "PUT", headers: { "content-type": file.type, "x-upsert": "false" }, body: file });
      if (!response.ok) throw new Error("upload_failed");
      const form = new FormData();
      form.set("number", number);
      form.set("path", target.path);
      startTransition(() => dispatch(form));
    } catch {
      setError("upload_failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
      <FileDrop id="insuranceProof" name="insuranceProof" accept="image/*,application/pdf" ref={fileRef} label={t("file")} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending || uploading} className="self-start">
        {uploading || pending ? t("uploading") : t("upload")}
      </Button>
      {(error || state.error) && (
        <p className="text-[13px] text-status-danger" role="alert">
          {t(`errors.${error ?? state.error}`)}
        </p>
      )}
    </form>
  );
}
