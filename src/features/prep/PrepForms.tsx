"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FileDrop } from "@/components/ui/FileDrop";
import { FieldWrap, Input, Textarea } from "@/components/ui/Field";
import { createPrepUploads, createPrepVideoUpload, reportPrepIssue, savePrepTask, type PrepState } from "./actions";
import { prepItems, type PrepChecklist } from "./template";

const maxVideoBytes = 200 * 1024 * 1024;
const maxVideoSeconds = 90;

function ErrorText({ code }: { code?: string }) {
  const t = useTranslations("prep");
  if (!code) return null;
  return (
    <p className="text-[13px] text-status-danger" role="alert">
      {t.has(`errors.${code}`) ? t(`errors.${code}`) : code}
    </p>
  );
}

function videoDuration(file: File) {
  return new Promise<number>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    video.src = url;
  });
}

function put(url: string, file: File, onProgress: (ratio: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("content-type", file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("upload_failed")));
    request.onerror = () => reject(new Error("upload_failed"));
    request.send(file);
  });
}


export function PrepTaskForm({ taskId, checklist, notes, videoEnabled, done }: { taskId: string; checklist: PrepChecklist; notes: string | null; videoEnabled: boolean; done: boolean }) {
  const t = useTranslations("prep");
  const [state, action, pending] = useActionState<PrepState, FormData>(savePrepTask, {});
  const formRef = useRef<HTMLFormElement>(null);
  const beforeRef = useRef<HTMLInputElement>(null);
  const afterRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function upload(phase: "BEFORE" | "AFTER", input: HTMLInputElement | null) {
    const files = Array.from(input?.files ?? []).slice(0, 16);
    if (!files.length) return [];
    const targets = await createPrepUploads(taskId, phase, files.map((file) => ({ type: file.type, size: file.size })));
    const uploaded: Array<{ path: string; type: string; size: number }> = [];
    for (let index = 0; index < files.length; index += 1) {
      const target = targets[index];
      if (!target) continue;
      const response = await fetch(target.url, { method: "PUT", headers: { "content-type": files[index].type, "x-upsert": "false" }, body: files[index] });
      if (!response.ok) throw new Error("upload_failed");
      uploaded.push({ path: target.path, type: files[index].type, size: files[index].size });
    }
    return uploaded;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const form = new FormData(event.currentTarget);
    form.set("complete", submitter?.value === "1" ? "1" : "0");
    form.delete("photosBeforeFiles");
    form.delete("photosAfterFiles");
    form.delete("videoFile");
    setBusy(true);
    setUploadError(null);
    try {
      const video = videoRef.current?.files?.[0] ?? null;
      const videos: Array<{ key: string; type: string; size: number; duration: number }> = [];
      if (video) {
        const duration = await videoDuration(video);
        if (video.size > maxVideoBytes) throw new Error("video_too_big");
        if (duration > maxVideoSeconds) throw new Error("video_too_long");
        const target = await createPrepVideoUpload(taskId, { type: video.type, size: video.size });
        if (!target) throw new Error("upload_failed");
        setProgress(0);
        await put(target.url, video, setProgress);
        videos.push({ key: target.key, type: video.type, size: video.size, duration });
      }
      form.set("photosBefore", JSON.stringify(await upload("BEFORE", beforeRef.current)));
      form.set("photosAfter", JSON.stringify(await upload("AFTER", afterRef.current)));
      form.set("videos", JSON.stringify(videos));
      startTransition(() => action(form));
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "upload_failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const checkAll = () => {
    formRef.current?.querySelectorAll<HTMLInputElement>('input[name^="item_"]').forEach((input) => {
      input.checked = true;
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="taskId" value={taskId} />
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium tracking-wide text-charcoal">{t("checklist")}</p>
          {!done && (
            <button type="button" onClick={checkAll} className="text-[12px] text-charcoal underline decoration-gold/50 underline-offset-2 hover:decoration-gold">
              {t("checkAll")}
            </button>
          )}
        </div>
        {prepItems.map((item) => (
          <label key={item} className="flex items-start gap-2.5 text-[13px] text-charcoal">
            <input type="checkbox" name={`item_${item}`} defaultChecked={Boolean(checklist[item]?.done)} disabled={done} className="mt-0.5 size-4 shrink-0 accent-[#b58b4b]" />
            <span>
              {t(`items.${item}`)}
              {checklist[item]?.done && checklist[item]?.by ? <span className="ml-2 text-[11px] text-muted">{checklist[item]?.by}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {!done && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldWrap label={t("photosBefore")} htmlFor="photosBeforeFiles">
              <FileDrop id="photosBeforeFiles" name="photosBeforeFiles" accept="image/*" multiple ref={beforeRef} />
            </FieldWrap>
            <FieldWrap label={t("photosAfter")} htmlFor="photosAfterFiles">
              <FileDrop id="photosAfterFiles" name="photosAfterFiles" accept="image/*" multiple ref={afterRef} />
            </FieldWrap>
          </div>
          {videoEnabled && (
            <FieldWrap label={t("video")} htmlFor="videoFile">
              <FileDrop id="videoFile" name="videoFile" accept="video/*" ref={videoRef} />
              {progress !== null && <p className="text-xs text-muted">{t("uploading", { percent: Math.round(progress * 100) })}</p>}
            </FieldWrap>
          )}
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <FieldWrap label={t("battery")} htmlFor="battery">
              <Input id="battery" name="battery" type="number" inputMode="numeric" min={0} max={100} />
            </FieldWrap>
            <FieldWrap label={t("notes")} htmlFor="notes">
              <Textarea id="notes" name="notes" maxLength={2000} defaultValue={notes ?? ""} className="min-h-16" />
            </FieldWrap>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" name="complete" value="0" variant="secondary" disabled={pending || busy}>
              {t("save")}
            </Button>
            <Button type="submit" name="complete" value="1" disabled={pending || busy}>
              {t("complete")}
            </Button>
            {state.ok && <span className="text-[12px] text-status-available">✓</span>}
          </div>
          <ErrorText code={uploadError ?? state.error} />
        </>
      )}
    </form>
  );
}

export function IssueForm({ taskId }: { taskId: string }) {
  const t = useTranslations("prep");
  const [state, action, pending] = useActionState<PrepState, FormData>(reportPrepIssue, {});
  if (state.ok) return <p className="text-[13px] text-status-available">{t("issueSent")}</p>;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="taskId" value={taskId} />
      <FieldWrap label={t("issue")} htmlFor="issue">
        <Textarea id="issue" name="issue" required maxLength={2000} className="min-h-16" />
      </FieldWrap>
      <div>
        <Button type="submit" size="sm" variant="danger" disabled={pending}>
          {t("report")}
        </Button>
      </div>
      <ErrorText code={state.error} />
    </form>
  );
}
