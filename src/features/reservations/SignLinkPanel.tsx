"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/Field";
import { issueAgreementLink, type SignLinkState } from "./agreement-link-actions";

const button = "inline-flex h-8 shrink-0 items-center rounded-pill px-3.5 text-[13px] font-medium hairline hover:border-ink/25 disabled:opacity-50";

export function SignLinkPanel({ reservationId, current }: { reservationId: string; current: { url: string; expires: string } | null }) {
  const t = useTranslations("reservations");
  const [link, setLink] = useState<SignLinkState>(current ?? {});
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const issue = (fresh: boolean) => {
    if (fresh && !window.confirm(t("agreementView.renewConfirm"))) return;
    start(async () => {
      const next = await issueAgreementLink(reservationId, fresh);
      setCopied(false);
      setLink(next.url ? next : { ...link, error: next.error });
      if (next.url) await copy(next.url);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {link.url ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 basis-64">
              <Input id="signLink" readOnly value={link.url} onFocus={(event) => event.target.select()} aria-label={t("agreementView.signLink")} />
            </div>
            <button type="button" className={button} onClick={() => copy(link.url ?? "")}>
              {copied ? t("agreementView.copied") : t("agreementView.copy")}
            </button>
            <button type="button" className={button} disabled={pending} onClick={() => issue(true)}>
              {t("agreementView.renew")}
            </button>
          </div>
          <p className="text-[12px] text-muted">{t("agreementView.validUntil", { at: link.expires ?? "" })}</p>
        </>
      ) : (
        <div>
          <button type="button" className={button} disabled={pending} onClick={() => issue(false)}>
            {t("agreementView.createLink")}
          </button>
        </div>
      )}
      {link.error && (
        <p className="text-[12px] text-status-danger" role="alert">
          {t.has(`errors.${link.error}`) ? t(`errors.${link.error}`) : link.error}
        </p>
      )}
    </div>
  );
}
