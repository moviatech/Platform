"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { attachReceipt, createReceiptUpload } from "./expense-actions";
import { maxReceiptBytes, receiptTypes } from "./report";

export function ReceiptUpload({ expenseId }: { expenseId: string }) {
  const t = useTranslations("expenses");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<"idle" | "busy" | "failed">("idle");

  const onChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!receiptTypes.test(file.type) || file.size <= 0 || file.size > maxReceiptBytes) {
      setStage("failed");
      return;
    }
    setStage("busy");
    const target = await createReceiptUpload(expenseId, { type: file.type, size: file.size });
    if (!target) {
      setStage("failed");
      return;
    }
    const response = await fetch(target.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file }).catch(() => null);
    if (!response?.ok) {
      setStage("failed");
      return;
    }
    const done = await attachReceipt(expenseId, target.path, file.type, file.size);
    setStage(done.ok ? "idle" : "failed");
    if (done.ok) router.refresh();
  };

  return (
    <>
      <input ref={input} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" onChange={onChange} />
      <button type="button" disabled={stage === "busy"} onClick={() => input.current?.click()} className={stage === "failed" ? "text-[12px] text-status-danger hover:underline" : "text-[12px] text-gold hover:underline"}>
        {stage === "busy" ? "…" : stage === "failed" ? t("attachFailed") : t("attach")}
      </button>
    </>
  );
}
