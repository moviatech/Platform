"use client";

import { useActionState, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select } from "@/components/ui/Field";
import { FileDrop } from "@/components/ui/FileDrop";
import { createDocumentUpload, deleteDocument, finalizeDocument, type DocumentState } from "./document-actions";

type AllocationOption = { id: string; label: string };

export function DocumentUploadForm({ investorId, allocations, kinds }: { investorId: string; allocations: AllocationOption[]; kinds: string[] }) {
  const t = useTranslations("investors.documents");
  const [state, action, pending] = useActionState<DocumentState, FormData>(finalizeDocument, {});
  const [stage, setStage] = useState<"idle" | "uploading" | "failed">("idle");
  const [progress, setProgress] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const hidden = useRef<{ path: string; contentType: string; size: number } | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    if (hidden.current) return;
    event.preventDefault();
    const input = form.querySelector<HTMLInputElement>("input[type=file]");
    const file = input?.files?.[0];
    if (!file) return;
    setStage("uploading");
    setProgress(0);
    const target = await createDocumentUpload(investorId, { type: file.type, size: file.size, name: file.name });
    if (!target) {
      setStage("failed");
      return;
    }
    const ok = await new Promise<boolean>((resolve) => {
      const request = new XMLHttpRequest();
      request.open("PUT", target.url);
      request.setRequestHeader("Content-Type", file.type);
      request.upload.onprogress = (progressEvent) => {
        if (progressEvent.lengthComputable) setProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
      };
      request.onload = () => resolve(request.status >= 200 && request.status < 300);
      request.onerror = () => resolve(false);
      request.send(file);
    });
    if (!ok) {
      setStage("failed");
      return;
    }
    hidden.current = { path: target.path, contentType: file.type, size: file.size };
    setStage("idle");
    form.requestSubmit();
  };

  if (state.ok) return <p className="rounded-xl bg-status-available/10 px-4 py-3 text-[13px]">{t("uploaded")}</p>;
  return (
    <form
      ref={formRef}
      action={(data) => {
        if (hidden.current) {
          data.set("path", hidden.current.path);
          data.set("contentType", hidden.current.contentType);
          data.set("size", String(hidden.current.size));
          hidden.current = null;
        }
        return action(data);
      }}
      onSubmit={onSubmit}
      className="grid gap-3 sm:grid-cols-2"
    >
      <input type="hidden" name="investorId" value={investorId} />
      <FieldWrap label={t("titleField")} htmlFor="docTitle">
        <Input id="docTitle" name="title" required maxLength={160} />
      </FieldWrap>
      <FieldWrap label={t("kind")} htmlFor="docKind">
        <Select id="docKind" name="kind" defaultValue="AGREEMENT">
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {t(`kinds.${kind}`)}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("allocation")} htmlFor="docAllocation">
        <Select id="docAllocation" name="allocationId" defaultValue="">
          <option value="">{t("allAssets")}</option>
          {allocations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      </FieldWrap>
      <FieldWrap label={t("signedOn")} htmlFor="docSigned">
        <Input id="docSigned" name="signedOn" type="date" />
      </FieldWrap>
      <div className="sm:col-span-2">
        <FileDrop name="file" accept="application/pdf,image/jpeg,image/png,image/webp" label={t("file")} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending || stage === "uploading"}>
          {stage === "uploading" ? `${t("uploading")} ${progress}%` : t("upload")}
        </Button>
        {stage === "failed" && <span className="text-[13px] text-status-danger">{t("errors.upload")}</span>}
        {state.error && <span className="text-[13px] text-status-danger">{t(`errors.${state.error}`)}</span>}
      </div>
    </form>
  );
}

export function DeleteDocumentButton({ id }: { id: string }) {
  const t = useTranslations("investors.documents");
  const [state, action, pending] = useActionState<DocumentState, FormData>(deleteDocument, {});
  if (state.ok) return <span className="text-[12px] text-muted">{t("deleted")}</span>;
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-[12px] text-muted hover:text-status-danger" onClick={(event) => !confirm(t("confirmDelete")) && event.preventDefault()}>
        {t("delete")}
      </button>
    </form>
  );
}
