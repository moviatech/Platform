"use client";

import { startTransition, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/Field";
import { createAttachmentUploads } from "./attachment-actions";
import { Icon } from "./icons";

const maxFiles = 6;

export function useAttachmentSubmit(action: (form: FormData) => void) {
  const t = useTranslations("portal.messages");
  const fileRef = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.delete("attachmentFiles");
    const files = Array.from(fileRef.current?.files ?? []).slice(0, maxFiles);
    setUploading(true);
    setError(null);
    try {
      const targets = files.length ? await createAttachmentUploads(files.map((file) => ({ type: file.type, size: file.size }))) : [];
      const uploaded: Array<{ path: string; name: string; type: string; size: number }> = [];
      for (let index = 0; index < files.length; index += 1) {
        const target = targets[index];
        if (!target) {
          setError("attachment_rejected");
          continue;
        }
        const response = await fetch(target.url, { method: "PUT", headers: { "content-type": files[index].type, "x-upsert": "false" }, body: files[index] });
        if (!response.ok) throw new Error("upload_failed");
        uploaded.push({ path: target.path, name: files[index].name, type: files[index].type, size: files[index].size });
      }
      form.set("attachments", JSON.stringify(uploaded));
      startTransition(() => action(form));
    } catch {
      setError("upload_failed");
    } finally {
      setUploading(false);
    }
  }

  const accept = "image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/webm,video/quicktime";

  const field = (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="attachmentFiles" className="text-xs font-medium tracking-wide text-charcoal">
        {t("attachments")}
      </label>
      <Input
        id="attachmentFiles"
        name="attachmentFiles"
        type="file"
        accept={accept}
        multiple
        ref={fileRef}
        onChange={(event) => setCount(event.currentTarget.files?.length ?? 0)}
        className="h-auto py-2 file:mr-3 file:rounded-pill file:border-0 file:bg-gold file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
      />
      <p className="text-xs text-muted">{count > 0 ? t("attachmentsSelected", { count }) : t("attachmentsHint")}</p>
    </div>
  );

  const compact = (
    <label className="relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-ink/10 bg-white text-charcoal hover:border-gold" aria-label={t("attachments")} title={t("attachmentsHint")}>
      <Icon name="paperclip" size={17} />
      {count > 0 && <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-gold text-[10px] font-semibold text-white">{count}</span>}
      <input name="attachmentFiles" type="file" accept={accept} multiple ref={fileRef} onChange={(event) => setCount(event.currentTarget.files?.length ?? 0)} className="sr-only" />
    </label>
  );

  return { onSubmit, field, compact, uploading, error };
}
