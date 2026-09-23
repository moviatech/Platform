"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { formatMoney } from "@/lib/utils/format";
import type { ReservationActionState } from "./actions";
import { reviewChangeRequest } from "./change-review";

export type ChangeRequestView = {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  lines: string[];
  pending: boolean;
  preview: { available: number; newTotalCents: number; differenceCents: number; suggestedFeeCents: number; error?: string } | null;
  staffNote: string | null;
  feeCents: number | null;
};

function ReviewForm({ request }: { request: ChangeRequestView }) {
  const t = useTranslations("reservations");
  const [state, action, pending] = useActionState<ReservationActionState, FormData>(reviewChangeRequest, {});
  if (state.ok) return <p className="text-[13px] text-status-available">{t("changeRequests.done")}</p>;
  return (
    <form action={action} className="mt-3 flex flex-col gap-2 border-t border-ink/[0.08] pt-3">
      <input type="hidden" name="requestId" value={request.id} />
      {request.preview && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-charcoal">
          <span>{t("changeRequests.available", { count: request.preview.available })}</span>
          <span className="text-right tabular-nums">
            {t("changeRequests.newTotal")} {formatMoney(request.preview.newTotalCents)} ({request.preview.differenceCents >= 0 ? "+" : "−"}
            {formatMoney(Math.abs(request.preview.differenceCents))})
          </span>
          {request.preview.error && <span className="col-span-2 text-status-danger">{t.has(`errors.${request.preview.error}`) ? t(`errors.${request.preview.error}`) : request.preview.error}</span>}
        </div>
      )}
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
        <Input name="fee" inputMode="decimal" defaultValue={request.preview ? (request.preview.suggestedFeeCents / 100).toFixed(2) : ""} aria-label={t("changeRequests.fee")} placeholder={t("changeRequests.fee")} className="h-9" />
        <Textarea name="note" maxLength={2000} placeholder={t("changeRequests.note")} className="min-h-9 py-1.5" rows={1} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approve" size="sm" disabled={pending || request.preview?.available === 0}>
          {t("changeRequests.approve")}
        </Button>
        <Button type="submit" name="decision" value="need_info" size="sm" variant="secondary" disabled={pending}>
          {t("changeRequests.needInfo")}
        </Button>
        <Button type="submit" name="decision" value="decline" size="sm" variant="danger" disabled={pending}>
          {t("changeRequests.decline")}
        </Button>
      </div>
      {state.error && (
        <p className="text-[12px] text-status-danger" role="alert">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : state.error}
        </p>
      )}
    </form>
  );
}

export function ChangeRequestPanel({ requests }: { requests: ChangeRequestView[] }) {
  const t = useTranslations("reservations");
  const h = useTranslations("portal.help");
  return (
    <ul className="flex flex-col gap-3">
      {requests.map((request) => (
        <li key={request.id} className="rounded-xl border border-ink/[0.07] px-4 py-3 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{h.has(`types.${request.kind}`) ? h(`types.${request.kind}`) : request.kind}</span>
            <span className="flex items-center gap-2">
              <span className="text-[11px] text-muted">{request.createdAt}</span>
              <Badge tone={request.status === "APPROVED" ? "success" : request.status === "DECLINED" ? "danger" : request.pending ? "warning" : "neutral"}>{t(`changeRequests.status.${request.status}`)}</Badge>
            </span>
          </div>
          {request.lines.map((line, index) => (
            <p key={index} className="mt-1 whitespace-pre-wrap text-charcoal">
              {line}
            </p>
          ))}
          {!request.pending && (request.staffNote || (request.feeCents ?? 0) > 0) && (
            <p className="mt-1 text-muted">
              {request.feeCents ? `${t("changeRequests.fee")} ${formatMoney(request.feeCents)}` : ""}
              {request.feeCents && request.staffNote ? " · " : ""}
              {request.staffNote ?? ""}
            </p>
          )}
          {request.pending && <ReviewForm request={request} />}
        </li>
      ))}
    </ul>
  );
}
