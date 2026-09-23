"use client";

import { SubmitButton } from "@/components/ui/SubmitButton";
import Image from "next/image";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { FileDrop } from "@/components/ui/FileDrop";
import type { Media } from "@/features/portal/garage";
import { createMediaUploads, removeMedia, saveMedia } from "./media-actions";

export function MediaForm({ vehicleId, media, editable: allowed }: { vehicleId: string; media: Media[]; editable: boolean }) {
  const t = useTranslations("fleet.media");
  const common = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const editable = allowed && editing;
  const fileRef = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function upload() {
    const files = Array.from(fileRef.current?.files ?? []).slice(0, 20);
    if (!files.length) return;
    setBusy(true);
    setError(false);
    try {
      const targets = await createMediaUploads(vehicleId, files.map((file) => ({ type: file.type, size: file.size })));
      const uploaded: Array<{ path: string; type: string; size: number }> = [];
      for (let index = 0; index < files.length; index += 1) {
        const target = targets[index];
        if (!target) continue;
        const response = await fetch(target.url, { method: "PUT", headers: { "content-type": files[index].type, "x-upsert": "false" }, body: files[index] });
        if (!response.ok) throw new Error("upload_failed");
        uploaded.push({ path: target.path, type: files[index].type, size: files[index].size });
      }
      const result = await saveMedia(vehicleId, uploaded);
      if (result.error) throw new Error(result.error);
      if (fileRef.current) fileRef.current.value = "";
      setCount(0);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        {allowed && (
          <button type="button" onClick={() => setEditing((value) => !value)} disabled={busy} className={cn("rounded-pill px-3.5 py-1 text-[13px] font-medium", editing ? "bg-ink text-white" : "border border-ink/15 text-charcoal hover:border-ink/30")}>
            {editing ? common("done") : common("edit")}
          </button>
        )}
      </div>
      {media.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2">
          {media.map((item) => (
            <li key={item.id} className="group relative overflow-hidden rounded-lg bg-pearl">
              {item.kind === "VIDEO" ? (
                <video src={item.url} preload="metadata" muted className="aspect-square w-full object-cover" />
              ) : (
                <Image src={item.url} alt="" width={240} height={240} unoptimized className="aspect-square w-full object-cover" />
              )}
              {editable && (
                <form action={removeMedia} className="absolute top-1 right-1">
                  <input type="hidden" name="mediaId" value={item.id} />
                  <input type="hidden" name="vehicleId" value={vehicleId} />
                  <SubmitButton aria-label={t("remove")} className="flex size-6 items-center justify-center rounded-full bg-white/90 text-[12px] text-status-danger shadow hover:bg-white">
                    ×
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">{t("empty")}</p>
      )}
      {editable && (
        <div className="flex flex-col gap-2 border-t border-ink/[0.07] pt-3">
          <FileDrop name="mediaFiles" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple ref={fileRef} onChange={(event) => setCount(event.currentTarget.files?.length ?? 0)} label={t("add")} />
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" variant="secondary" disabled={busy || count === 0} onClick={upload}>
              {t("upload")}
            </Button>
            {error && <span className="text-xs text-status-danger">{t("failed")}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
