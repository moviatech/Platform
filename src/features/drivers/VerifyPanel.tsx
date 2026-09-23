"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FileDrop } from "@/components/ui/FileDrop";
import { cn } from "@/lib/utils/cn";
import { createPhotoUploads } from "@/features/handover/actions";
import { setLicenseKindOnsite, verifyDriverOnsite, verifyInsurance, verifyLicenseOnsite, type VerifyState } from "./ops-actions";
import { driverDone, type DriverRow, type InsuranceGate } from "./types";

type Action = (state: VerifyState, form: FormData) => Promise<VerifyState>;

export function KindSelect({ licenseKind, confirmed, compact, onPick }: { licenseKind: string; confirmed: boolean; compact?: boolean; onPick?: (kind: string) => void }) {
  const t = useTranslations("handover");
  const r = useTranslations("reservations");
  const preset = confirmed || licenseKind !== "US" ? licenseKind : "";
  return (
    <select key={preset} name="licenseKind" defaultValue={preset} required onChange={onPick ? (event) => onPick(event.target.value) : undefined} aria-label={t("licenseKind")} className={cn("max-w-full self-start rounded-pill border border-ink/10 bg-white", compact ? "h-7 px-2 text-[12px]" : "h-9 px-3 text-[13px]")}>
      <option value="" disabled>
        {t("licenseKind")}
      </option>
      {(["US", "TRANSLATED", "INTERNATIONAL"] as const).map((kind) => (
        <option key={kind} value={kind}>
          {r(`licenseKind.${kind}`)}
        </option>
      ))}
    </select>
  );
}

const maxOnsitePhotos = 6;

function PhotoForm({ reservationId, action, fields, label, photoOptional, multiple, children }: { reservationId: string; action: Action; fields: Record<string, string>; label: string; photoOptional?: boolean; multiple?: boolean; children?: ReactNode }) {
  const t = useTranslations("handover");
  const [state, dispatch, pending] = useActionState<VerifyState, FormData>(action, {});
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = Object.values(fields).join("-");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.delete("photoFile");
    const files = Array.from(fileRef.current?.files ?? []).slice(0, multiple ? maxOnsitePhotos : 1);
    if (!files.length && !photoOptional) {
      setError("photo_required");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      if (files.length) {
        const targets = await createPhotoUploads(reservationId, "PICKUP", files.map((file) => ({ type: file.type, size: file.size })));
        const paths: string[] = [];
        for (let index = 0; index < files.length; index += 1) {
          const target = targets[index];
          if (!target) throw new Error("upload_failed");
          const response = await fetch(target.url, { method: "PUT", headers: { "content-type": files[index].type, "x-upsert": "false" }, body: files[index] });
          if (!response.ok) throw new Error("upload_failed");
          paths.push(target.path);
        }
        form.set("photo", paths[0]);
        form.set("photos", JSON.stringify(paths));
      }
      startTransition(() => dispatch(form));
    } catch {
      setError("upload_failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-2.5">
      <input type="hidden" name="reservationId" value={reservationId} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <FileDrop id={`photo-${id}`} name="photoFile" accept="image/*" multiple={multiple} max={maxOnsitePhotos} ref={fileRef} label={label} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending || uploading} className="self-start">
        {uploading || pending ? t("verifying") : t("verifyPass")}
      </Button>
      {(error || state.error) && (
        <p className="text-[13px] text-status-danger" role="alert">
          {t(`errors.${error ?? state.error}`)}
        </p>
      )}
    </form>
  );
}

function LicenseKindForm({ reservationId, licenseKind }: { reservationId: string; licenseKind: string }) {
  const t = useTranslations("handover");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<VerifyState, FormData>(setLicenseKindOnsite, {});
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="reservationId" value={reservationId} />
      <KindSelect licenseKind={licenseKind} confirmed />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {common("save")}
      </Button>
      {state.error && (
        <span className="text-[13px] text-status-danger" role="alert">
          {t(`errors.${state.error}`)}
        </span>
      )}
    </form>
  );
}

type Props = {
  reservationId: string;
  licenseVerified: boolean;
  licenseKind: string;
  licenseKindConfirmed: boolean;
  drivers: DriverRow[];
  insurance: { state: InsuranceGate; proofPath: string | null };
};

export function VerifyPanel({ reservationId, licenseVerified, licenseKind, licenseKindConfirmed, drivers, insurance }: Props) {
  const t = useTranslations("handover");
  const proofHref = (path: string) => `/reservations/${reservationId}/proof?path=${encodeURIComponent(path)}`;
  return (
    <div className="mt-5 flex flex-col gap-5 border-t border-ink/[0.07] pt-5 text-[13px]">
      <section>
        <p className="font-medium">{t("license")}</p>
        {licenseVerified ? (
          <LicenseKindForm reservationId={reservationId} licenseKind={licenseKind} />
        ) : (
          <PhotoForm reservationId={reservationId} action={verifyLicenseOnsite} fields={{}} label={t("licensePhoto")} multiple>
            <KindSelect licenseKind={licenseKind} confirmed={licenseKindConfirmed} />
          </PhotoForm>
        )}
      </section>
      {drivers.map((driver) => (
        <section key={driver.id}>
          <p className="flex items-center gap-2 font-medium">
            {t("driverSlot", { n: driver.position })}
            {driver.spouse && <Badge tone="info">{t("driverSpouse")}</Badge>}
            {driver.full_name ? <span className="font-normal text-muted">{driver.full_name}</span> : null}
            <Badge tone={driverDone(driver.status) ? "success" : "warning"}>{t(`driverStatus.${driver.status}`)}</Badge>
            {driver.international && <span className="text-muted">{t("driverInternational")}</span>}
          </p>
          {!driverDone(driver.status) && <PhotoForm reservationId={reservationId} action={verifyDriverOnsite} fields={{ driverId: driver.id }} label={t("driverPhoto")} multiple />}
        </section>
      ))}
      {insurance.state === "UPGRADE" && (
        <section>
          <p className="flex items-center gap-2 font-medium">
            {t("insurance")}
            <Badge tone="danger">{t("insuranceStatus.UPGRADE")}</Badge>
          </p>
        </section>
      )}
      {insurance.state !== "NOT_REQUIRED" && insurance.state !== "VERIFIED" && insurance.state !== "UPGRADE" && (
        <section>
          <p className="flex items-center gap-2 font-medium">
            {t("insurance")}
            <Badge tone="warning">{t(`insuranceStatus.${insurance.state}`)}</Badge>
            {insurance.proofPath && (
              <a href={proofHref(insurance.proofPath)} target="_blank" rel="noreferrer" className="font-normal text-charcoal underline decoration-gold/50 underline-offset-2 hover:decoration-gold">
                {t("viewFile")}
              </a>
            )}
          </p>
          <PhotoForm reservationId={reservationId} action={verifyInsurance} fields={{ kind: "insurance" }} label={t("insurancePhoto")} photoOptional={Boolean(insurance.proofPath)} />
        </section>
      )}
    </div>
  );
}
