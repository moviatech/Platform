"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { searchTransferTargets, transferReservation, type TransferState, type TransferTarget } from "./transfer-actions";

export function TransferCustomer({ reservationId }: { reservationId: string }) {
  const t = useTranslations("reservations");
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [targets, setTargets] = useState<TransferTarget[] | null>(null);
  const [searching, startSearch] = useTransition();
  const [state, action, pending] = useActionState<TransferState, FormData>(async (previous, form) => {
    const next = await transferReservation(previous, form);
    if (next.ok) {
      setTargets(null);
      setTerm("");
    }
    return next;
  }, {});

  const search = () => startSearch(async () => setTargets(await searchTransferTargets(reservationId, term)));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 text-[12px] text-muted hover:text-ink">
        {t("transfer.open")}
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5 border-t border-ink/[0.08] pt-3">
      <div className="flex gap-2">
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              search();
            }
          }}
          placeholder={t("transfer.search")}
          aria-label={t("transfer.search")}
          maxLength={60}
          className="h-9"
        />
        <Button type="button" size="sm" variant="secondary" disabled={searching || term.trim().length < 2} onClick={search}>
          {t("transfer.find")}
        </Button>
      </div>
      {targets && targets.length === 0 && <p className="text-[12px] text-muted">{t("transfer.none")}</p>}
      {targets && targets.length > 0 && (
        <ul className="flex flex-col divide-y divide-ink/[0.06]">
          {targets.map((target) => (
            <li key={target.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {target.fullName}
                  {target.registered && (
                    <Badge tone="info" className="ml-2">
                      {t("transfer.registered")}
                    </Badge>
                  )}
                  {target.blocked && (
                    <Badge tone="danger" className="ml-2">
                      DNR
                    </Badge>
                  )}
                </span>
                <span className="block truncate text-[12px] text-muted">{[target.email, target.phone].filter(Boolean).join(" · ") || "—"}</span>
              </span>
              <form action={action}>
                <input type="hidden" name="reservationId" value={reservationId} />
                <input type="hidden" name="customerId" value={target.id} />
                <Button type="submit" size="sm" variant="secondary" disabled={pending || target.blocked} onClick={(event) => !confirm(t("transfer.confirm", { name: target.fullName })) && event.preventDefault()}>
                  {t("transfer.to")}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {state.ok && (
        <div className="flex flex-col gap-1 text-[12px]" role="status">
          <p className="text-status-available">{t("transfer.done")}</p>
          {(state.notices ?? []).map((notice) => (
            <p key={notice} className="text-status-limited">
              {t.has(`transfer.notices.${notice}`) ? t(`transfer.notices.${notice}`) : notice}
            </p>
          ))}
        </div>
      )}
      {state.error && (
        <p className="text-[12px] text-status-danger" role="alert">
          {t.has(`transfer.errors.${state.error}`) ? t(`transfer.errors.${state.error}`) : t("transfer.errors.failed")}
        </p>
      )}
      <button type="button" onClick={() => setOpen(false)} className="self-start text-[12px] text-muted hover:text-ink">
        {t("transfer.close")}
      </button>
    </div>
  );
}
