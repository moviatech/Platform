"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FileDrop } from "@/components/ui/FileDrop";
import { FieldWrap, Textarea } from "@/components/ui/Field";
import { createSelfServiceUploads, finishSelfReturnAction, startSelfPickupAction, type SelfServiceActionState } from "./portal-actions";
import { maxSelfServicePhotos, minSelfServicePhotos, type SelfServiceChecklist, type SelfServiceState } from "./types";

type Props = {
  number: string;
  state: SelfServiceState;
  status: string;
  checklist: SelfServiceChecklist;
  canStart: boolean;
  windowOpen: boolean;
  accessLink: string | null;
  accessNote: string | null;
  note: string | null;
};


function usePhotoForm(number: string, phase: "PICKUP" | "RETURN", action: (form: FormData) => void) {
  const t = useTranslations("portal.trip.selfService");
  const fileInput = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.delete("photoFiles");
    const files = Array.from(fileInput.current?.files ?? []).slice(0, maxSelfServicePhotos);
    if (files.length < minSelfServicePhotos) {
      setUploadError("photos_required");
      return;
    }
    setBusy(true);
    setUploadError(null);
    try {
      const targets = await createSelfServiceUploads(number, phase, files.map((file) => ({ type: file.type, size: file.size })));
      const uploaded: Array<{ path: string; type: string; size: number }> = [];
      for (let index = 0; index < files.length; index += 1) {
        const target = targets[index];
        if (!target) continue;
        const response = await fetch(target.url, { method: "PUT", headers: { "content-type": files[index].type, "x-upsert": "false" }, body: files[index] });
        if (!response.ok) throw new Error("upload_failed");
        uploaded.push({ path: target.path, type: files[index].type, size: files[index].size });
      }
      form.set("photos", JSON.stringify(uploaded));
      startTransition(() => action(form));
    } catch {
      setUploadError("upload_failed");
    } finally {
      setBusy(false);
    }
  }
  const picker = (id: string) => (
    <FieldWrap label={t("photos")} htmlFor={id}>
      <FileDrop id={id} name="photoFiles" accept="image/*" multiple ref={fileInput} onChange={(event) => setCount(event.currentTarget.files?.length ?? 0)} />
      {count > 0 && <p className="text-xs text-muted">{t("selected", { count })}</p>}
    </FieldWrap>
  );
  return { picker, busy, uploadError, onSubmit };
}

export function SelfServiceCard({ number, state, status, checklist, canStart, windowOpen, accessLink, accessNote, note }: Props) {
  const t = useTranslations("portal.trip.selfService");
  const [start, startAction, starting] = useActionState<SelfServiceActionState, FormData>(startSelfPickupAction, {});
  const [finish, finishAction, finishing] = useActionState<SelfServiceActionState, FormData>(finishSelfReturnAction, {});
  const pickup = usePhotoForm(number, "PICKUP", startAction);
  const ret = usePhotoForm(number, "RETURN", finishAction);
  const errorText = (code?: string | null) => (code ? (t.has(`errors.${code}`) ? t(`errors.${code}`) : code) : null);

  const items: Array<[string, boolean]> = [
    [checklist.payment && !checklist.paid ? t("check.card") : t("check.payment"), checklist.payment],
    [t("check.license"), checklist.license],
    [t("check.agreement"), checklist.agreement],
  ];

  if (state === "STARTED" || start.ok) {
    if (status === "ACTIVE" && !finish.ok) {
      return (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-charcoal">{t("started")}</p>
          {accessLink && (
            <a href={accessLink} target="_blank" rel="noreferrer" className="inline-flex h-10 w-fit items-center rounded-pill bg-gold px-5 text-sm font-medium text-white">
              {t("openAccess")}
            </a>
          )}
          {accessNote && <p className="rounded-xl bg-pearl px-3.5 py-2.5 text-[13px] whitespace-pre-wrap text-charcoal">{accessNote}</p>}
          <form onSubmit={ret.onSubmit} className="mt-2 flex flex-col gap-3 border-t border-ink/[0.08] pt-4">
            <input type="hidden" name="number" value={number} />
            <p className="text-sm font-semibold">{t("returnTitle")}</p>
            <p className="text-[13px] text-muted">{t("returnIntro", { min: minSelfServicePhotos })}</p>
            {ret.picker("returnPhotos")}
            <label className="flex items-start gap-2.5 text-[13px] text-charcoal">
              <input type="checkbox" name="keyCard" required className="mt-0.5 size-4 shrink-0 accent-[#b58b4b]" />
              {t("keyCard")}
            </label>
            <FieldWrap label={t("note")} htmlFor="returnNote">
              <Textarea id="returnNote" name="note" maxLength={1000} className="min-h-16" />
            </FieldWrap>
            <div>
              <Button type="submit" size="sm" disabled={finishing || ret.busy}>
                {t("finishReturn")}
              </Button>
            </div>
            {errorText(ret.uploadError ?? finish.error) && (
              <p className="text-[13px] text-status-danger" role="alert">
                {errorText(ret.uploadError ?? finish.error)}
              </p>
            )}
          </form>
        </div>
      );
    }
    return <p className="text-sm text-charcoal">{finish.ok || state === "RETURNED" ? t("returned") : t("started")}</p>;
  }
  if (state === "RETURNED") return <p className="text-sm text-charcoal">{t("returned")}</p>;
  if (state === "DECLINED" || state === "FALLBACK") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-charcoal">{t(state === "DECLINED" ? "declined" : "fallback")}</p>
        {note && <p className="text-[13px] text-muted">{note}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-charcoal">{state === "APPROVED" ? t("approved") : t("requested")}</p>
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {items.map(([label, done]) => (
          <li key={label} className="flex items-center gap-2">
            <span className={done ? "text-status-available" : "text-muted"}>{done ? "✓" : "○"}</span>
            <span className={done ? "text-muted line-through" : "text-charcoal"}>{label}</span>
          </li>
        ))}
        {state === "APPROVED" && (
          <li className="flex items-center gap-2">
            <span className={checklist.hold ? "text-status-available" : "text-muted"}>{checklist.hold ? "✓" : "○"}</span>
            <span className={checklist.hold ? "text-muted line-through" : "text-charcoal"}>{t("check.hold")}</span>
          </li>
        )}
      </ul>
      {state === "APPROVED" && checklist.complete && (
        <form onSubmit={pickup.onSubmit} className="flex flex-col gap-3 border-t border-ink/[0.08] pt-4">
          <input type="hidden" name="number" value={number} />
          <p className="text-sm font-semibold">{t("startTitle")}</p>
          <p className="text-[13px] text-muted">{canStart ? t("startIntro", { min: minSelfServicePhotos }) : windowOpen ? t("startBlocked") : t("startLater")}</p>
          {canStart && (
            <>
              {pickup.picker("pickupPhotos")}
              <div>
                <Button type="submit" size="lg" variant="gold" disabled={starting || pickup.busy}>
                  {t("start")}
                </Button>
              </div>
            </>
          )}
          {errorText(pickup.uploadError ?? start.error) && (
            <p className="text-[13px] text-status-danger" role="alert">
              {errorText(pickup.uploadError ?? start.error)}
            </p>
          )}
        </form>
      )}
      <p className="flex items-center gap-2 border-t border-ink/[0.08] pt-3 text-[13px] text-muted">
        <span>○</span>
        {t("returnLater")}
      </p>
    </div>
  );
}
