import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { formatFullDateTime } from "@/lib/utils/format";
import { reviewSelfServiceAction } from "./actions";
import { AccessForm } from "./AccessForm";
import { checklistFor, listSelfServicePhotos, type SelfServiceRow } from "./service";

const tone: Record<SelfServiceRow["self_service_state"], BadgeTone> = { NONE: "neutral", REQUESTED: "warning", APPROVED: "info", DECLINED: "neutral", FALLBACK: "neutral", STARTED: "success", RETURNED: "gold" };

export async function SelfServicePanel({ row, canEdit }: { row: SelfServiceRow; canEdit: boolean }) {
  const [t, photos] = await Promise.all([getTranslations("selfService"), listSelfServicePhotos(row.id)]);
  const list = checklistFor(row);
  const rows: Array<[string, boolean]> = [
    [list.payment && !list.paid ? t("check.card") : t("check.payment"), list.payment],
    [t("check.license"), list.license],
    [t("check.agreement"), list.agreement],
    [t("check.hold"), list.hold],
    [t("check.link"), Boolean(row.access_link)],
  ];
  const phase = (kind: "PICKUP" | "RETURN") => photos.filter((photo) => photo.phase === kind);
  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <Badge tone={tone[row.self_service_state]}>{t(`state.${row.self_service_state}`)}</Badge>
      </div>
      {row.delivery_address && <p className="mt-2 text-[13px] text-charcoal">{t("location")}: {row.delivery_address}</p>}
      <ul className="mt-3 flex flex-col gap-1 text-[13px]">
        {rows.map(([label, done]) => (
          <li key={label} className="flex items-center gap-2">
            <span className={done ? "text-status-available" : "text-muted"}>{done ? "✓" : "…"}</span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      {row.self_service_note && <p className="mt-2 text-[12px] text-muted">{row.self_service_note}</p>}
      {row.self_started_at && <p className="mt-2 text-[12px] text-muted">{t("startedAt", { at: formatFullDateTime(row.self_started_at) })}</p>}
      {row.self_returned_at && (
        <p className="mt-1 text-[12px] text-muted">
          {t("returnedAt", { at: formatFullDateTime(row.self_returned_at) })} · {row.self_return_key_card ? t("keyCardYes") : t("keyCardNo")}
        </p>
      )}
      {canEdit && ["REQUESTED", "APPROVED", "DECLINED", "FALLBACK"].includes(row.self_service_state) && (
        <form action={reviewSelfServiceAction} className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink/[0.08] pt-4">
          <input type="hidden" name="reservationId" value={row.id} />
          <Input name="note" maxLength={500} placeholder={t("note")} className="h-8 w-48 text-[13px]" />
          <Button type="submit" name="decision" value="approve" size="sm" disabled={row.self_service_state === "APPROVED"}>
            {t("approve")}
          </Button>
          <Button type="submit" name="decision" value="decline" size="sm" variant="danger" disabled={row.self_service_state === "DECLINED"}>
            {t("decline")}
          </Button>
        </form>
      )}
      {canEdit && ["APPROVED", "STARTED"].includes(row.self_service_state) && (
        <AccessForm reservationId={row.id} link={row.access_link ?? ""} note={row.access_note ?? ""} />
      )}
      {(["PICKUP", "RETURN"] as const).map((kind) =>
        phase(kind).length ? (
          <div key={kind} className="mt-4 border-t border-ink/[0.08] pt-4">
            <p className="text-xs font-medium tracking-wide text-charcoal">{t(kind === "PICKUP" ? "pickupPhotos" : "returnPhotos")}</p>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {phase(kind).map((photo) => (
                <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-pearl">
                  <Image src={photo.url} alt="" width={240} height={240} unoptimized className="aspect-square w-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </section>
  );
}
