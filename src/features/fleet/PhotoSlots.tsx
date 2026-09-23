"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";
import { createClassPhotoUpload, removeClassPhoto, saveClassPhoto } from "./class-photo-actions";
import { createPhotoUpload, removePhoto, savePhoto } from "./photo-actions";
import { flawSlot, type PhotoSlot } from "./photo-slots";

export type PhotoOwner = { kind: "vehicle" | "class"; id: string };
type Photo = { id: string; slot: string; url: string; note: string | null };

const accept = "image/jpeg,image/png,image/webp";

async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1500000) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  return blob ?? file;
}

async function send(owner: PhotoOwner, slot: string, file: File, note?: string) {
  const blob = await shrink(file);
  const type = blob.type || file.type;
  const shared = owner.kind === "class";
  const target = shared ? await createClassPhotoUpload(owner.id, slot, { type, size: blob.size }) : await createPhotoUpload(owner.id, slot, { type, size: blob.size });
  if (!target) return false;
  const response = await fetch(target.url, { method: "PUT", headers: { "content-type": type, "x-upsert": "false" }, body: blob });
  if (!response.ok) return false;
  const saved = shared ? await saveClassPhoto({ classId: owner.id, slot, path: target.path, type, size: blob.size }) : await savePhoto({ vehicleId: owner.id, slot, path: target.path, type, size: blob.size, note });
  return Boolean(saved.ok);
}

export function PhotoSlots({ owner, slots, photos, editable: allowed, title, notice }: { owner: PhotoOwner; slots: PhotoSlot[]; photos: Photo[]; editable: boolean; title?: string; notice?: string }) {
  const t = useTranslations("fleet.photos");
  const common = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const editable = allowed && editing;
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const flawInput = useRef<HTMLInputElement>(null);
  const bySlot = new Map(photos.filter((photo) => photo.slot !== flawSlot).map((photo) => [photo.slot, photo]));
  const flaws = photos.filter((photo) => photo.slot === flawSlot);
  const done = slots.filter((slot) => bySlot.has(slot.key)).length;
  const shared = owner.kind === "class";
  const groups = (["showcase", "archive"] as const).filter((group) => slots.some((slot) => slot.group === group));

  const upload = async (slot: string, file: File | undefined, flawNote?: string) => {
    if (!file) return;
    setBusy(slot);
    setFailed(null);
    const ok = await send(owner, slot, file, flawNote).catch(() => false);
    setBusy(null);
    if (!ok) setFailed(slot);
    else {
      if (slot === flawSlot) setNote("");
      router.refresh();
    }
  };

  const remove = async (photoId: string) => {
    if (!confirm(t("confirmRemove"))) return;
    setBusy(photoId);
    await (shared ? removeClassPhoto(owner.id, photoId) : removePhoto(owner.id, photoId)).catch(() => null);
    setBusy(null);
    router.refresh();
  };

  const tile = (slot: PhotoSlot) => {
    const photo = bySlot.get(slot.key);
    return (
      <li key={slot.key}>
        <label className={cn("group relative block aspect-[4/3] overflow-hidden rounded-xl", photo ? "bg-pearl" : "border border-dashed border-ink/20 bg-pearl/50", editable && "cursor-pointer hover:border-gold/60")}>
          {photo?.url ? <Image src={photo.url} alt="" fill unoptimized sizes="12rem" className="object-cover" /> : <span className="absolute inset-0 flex items-center justify-center text-[20px] text-muted">+</span>}
          {busy === slot.key && <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-[12px] text-charcoal">{t("uploading")}</span>}
          {editable && <input type="file" accept={accept} className="sr-only" disabled={busy !== null} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void upload(slot.key, file); }} />}
        </label>
        <p className="mt-1 flex items-center justify-between gap-2 text-[12px]">
          <span className={cn("truncate", photo ? "text-charcoal" : "text-muted")}>{t(`slots.${slot.key}`)}</span>
          {failed === slot.key ? (
            <span className="text-status-danger">{t("failed")}</span>
          ) : photo ? (
            <span className="flex shrink-0 items-center gap-2">
              <a href={photo.url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
                {t("view")}
              </a>
              {editable && (
                <button type="button" disabled={busy !== null} onClick={() => remove(photo.id)} className="text-muted hover:text-status-danger">
                  {t("remove")}
                </button>
              )}
            </span>
          ) : null}
        </p>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold">
          {title ?? t("title")}
          <span className={cn("rounded-pill px-2.5 py-0.5 text-[12px] font-medium tabular-nums", done === slots.length ? "bg-status-available/12 text-status-available" : "bg-status-limited/15 text-[#a87415]")}>
            {done} / {slots.length}
          </span>
          {notice && <span className="text-[12px] font-normal text-muted">{notice}</span>}
        </h2>
        {allowed && (
          <button type="button" onClick={() => setEditing((value) => !value)} disabled={busy !== null} className={cn("rounded-pill px-3.5 py-1 text-[13px] font-medium", editing ? "bg-ink text-white" : "border border-ink/15 text-charcoal hover:border-ink/30")}>
            {editing ? common("done") : common("edit")}
          </button>
        )}
      </div>
      {groups.map((group) => (
        <div key={group}>
          {!shared && <p className="mb-2 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">{t(`groups.${group}`)}</p>}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{slots.filter((slot) => slot.group === group).map(tile)}</ul>
        </div>
      ))}
      {!shared && <div>
        <p className="mb-2 text-[11px] font-medium tracking-[0.12em] text-muted uppercase">{t("groups.flaws")}</p>
        {flaws.length > 0 && (
          <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {flaws.map((photo) => (
              <li key={photo.id}>
                <a href={photo.url} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] overflow-hidden rounded-xl bg-pearl">
                  <Image src={photo.url} alt="" fill unoptimized sizes="12rem" className="object-cover" />
                </a>
                <p className="mt-1 flex items-center justify-between gap-2 text-[12px]">
                  <span className="truncate text-charcoal">{photo.note}</span>
                  {editable && (
                    <button type="button" disabled={busy !== null} onClick={() => remove(photo.id)} className="shrink-0 text-muted hover:text-status-danger">
                      {t("remove")}
                    </button>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder={t("flawNote")} aria-label={t("flawNote")} className="h-9 w-56 rounded-xl border border-ink/10 bg-white px-3 text-[13px] placeholder:text-muted/70 focus:border-gold/60 focus:outline-none" />
            <button type="button" disabled={busy !== null || !note.trim()} onClick={() => flawInput.current?.click()} className="h-9 rounded-pill border border-ink/15 px-3.5 text-[13px] font-medium text-charcoal hover:border-ink/30 disabled:opacity-40">
              {busy === flawSlot ? t("uploading") : t("addFlaw")}
            </button>
            <input ref={flawInput} type="file" accept={accept} className="sr-only" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void upload(flawSlot, file, note.trim()); }} />
            {failed === flawSlot && <span className="text-[12px] text-status-danger">{t("failed")}</span>}
          </div>
        )}
      </div>}
    </div>
  );
}
