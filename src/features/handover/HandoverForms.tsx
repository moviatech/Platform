"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select, Textarea } from "@/components/ui/Field";
import { SignaturePad } from "@/features/portal/SignaturePad";
import { formatMoney } from "@/lib/utils/format";
import { completePickup, completeReturn, createPhotoUploads, signOnDevice } from "./actions";
import { computeReturnFees, feeTotal, type FeeLine } from "./fees";
import { maxPhotos, type HandoverState, type InspectionKind, type ReturnParams, type UploadedPhoto } from "./types";

function ErrorText({ code }: { code?: string }) {
  const t = useTranslations("handover");
  const r = useTranslations("reservations");
  if (!code) return null;
  const text = t.has(`errors.${code}`) ? t(`errors.${code}`) : r.has(`errors.${code}`) ? r(`errors.${code}`) : code;
  return (
    <p className="text-[13px] text-status-danger" role="alert">
      {text}
    </p>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-start gap-2.5 text-[13px] text-charcoal">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 shrink-0 accent-[#b58b4b]" />
      {label}
    </label>
  );
}

function usePhotoSubmit(reservationId: string, kind: InspectionKind, action: (form: FormData) => void) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.delete("photoFiles");
    const files = Array.from(fileRef.current?.files ?? []).slice(0, maxPhotos);
    setUploading(true);
    setUploadError(false);
    try {
      const targets = await createPhotoUploads(reservationId, kind, files.map((file) => ({ type: file.type, size: file.size })));
      const uploaded: UploadedPhoto[] = [];
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
      setUploadError(true);
    } finally {
      setUploading(false);
    }
  }

  const picker = (label: string, selected: string) => (
    <FieldWrap label={label} htmlFor="photoFiles">
      <Input
        id="photoFiles"
        name="photoFiles"
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        ref={fileRef}
        onChange={(event) => setCount(event.currentTarget.files?.length ?? 0)}
        className="h-auto py-2 file:mr-3 file:rounded-pill file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
      />
      {count > 0 && <p className="text-xs text-muted">{selected}</p>}
    </FieldWrap>
  );

  return { onSubmit, picker, uploading, uploadError };
}

type PickupProps = {
  reservationId: string;
  licenseVerified: boolean;
  hasExtraDriver: boolean;
  hasChildSeat: boolean;
  odometer: number | null;
  battery: number | null;
  canOverride: boolean;
};

export function PickupForm({ reservationId, licenseVerified, hasExtraDriver, hasChildSeat, odometer, battery, canOverride }: PickupProps) {
  const t = useTranslations("handover");
  const [state, action, pending] = useActionState<HandoverState, FormData>(completePickup, {});
  const photo = usePhotoSubmit(reservationId, "PICKUP", action);

  return (
    <form onSubmit={photo.onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="reservationId" value={reservationId} />
      <div className="grid grid-cols-2 gap-3">
        <FieldWrap label={t("odometer")} htmlFor="odometer">
          <Input id="odometer" name="odometer" type="number" inputMode="numeric" min={0} defaultValue={odometer ?? ""} required />
        </FieldWrap>
        <FieldWrap label={t("battery")} htmlFor="batteryLevel">
          <Input id="batteryLevel" name="batteryLevel" type="number" inputMode="numeric" min={0} max={100} defaultValue={battery ?? ""} required />
        </FieldWrap>
      </div>
      {photo.picker(t("photos"), t("photosSelected", { count: 0 }))}
      <div className="flex flex-col gap-2.5">
        <p className="text-xs font-medium tracking-wide text-charcoal">{t("checks")}</p>
        {!licenseVerified && <Check name="chk_license" label={t("chkLicense")} />}
        <Check name="chk_fsd" label={t("chkFsd")} />
        <Check name="chk_returnRules" label={t("chkReturnRules")} />
        {hasExtraDriver && <Check name="chk_extraDriver" label={t("chkExtraDriver")} />}
      </div>
      <div className="flex flex-col gap-2.5">
        <p className="text-xs font-medium tracking-wide text-charcoal">{t("accessories")}</p>
        <Check name="acc_keyCard" label={t("keyCard")} defaultChecked />
        <Check name="acc_charger" label={t("charger")} defaultChecked />
        {hasChildSeat && <Check name="acc_childSeat" label={t("childSeat")} defaultChecked />}
      </div>
      <FieldWrap label={t("damageNotes")} htmlFor="damageNotes">
        <Textarea id="damageNotes" name="damageNotes" maxLength={2000} className="min-h-20" />
      </FieldWrap>
      <FieldWrap label={t("renterRemarks")} htmlFor="renterRemarks">
        <Textarea id="renterRemarks" name="renterRemarks" maxLength={2000} className="min-h-16" />
      </FieldWrap>
      {canOverride && state.collection && state.collection.outstandingCents > state.collection.chargedCents && <Check name="allowUnpaid" label={t("allowUnpaid")} />}
      <div>
        <Button type="submit" size="lg" disabled={pending || photo.uploading}>
          {t("start")}
        </Button>
      </div>
      <ErrorText code={photo.uploadError ? "upload_failed" : state.error} />
    </form>
  );
}

type ReturnProps = { reservationId: string; params: ReturnParams; hasChildSeat: boolean };

const cleaningPresets: Record<string, number> = { none: 0, special: 10000, smoke: 40000 };

export function ReturnForm({ reservationId, params, hasChildSeat }: ReturnProps) {
  const t = useTranslations("handover");
  const [state, action, pending] = useActionState<HandoverState, FormData>(completeReturn, {});
  const photo = usePhotoSubmit(reservationId, "RETURN", action);
  const [estimate, setEstimate] = useState<FeeLine[] | null>(null);
  const [cleaning, setCleaning] = useState("none");
  const formRef = useRef<HTMLFormElement>(null);

  function recompute() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const num = (name: string) => Number(data.get(name) ?? 0) || 0;
    setEstimate(
      computeReturnFees({
        ...params,
        endOdometer: num("odometer"),
        batteryLevel: num("batteryLevel"),
        actualReturnAt: new Date().toISOString(),
        lateNotice: data.get("lateNotice") === "UNANNOUNCED" ? "UNANNOUNCED" : "NOTIFIED",
        cleaningCents: Math.round(num("cleaningCents") * 100),
        otherCents: Math.round(num("otherCents") * 100),
      }),
    );
  }

  return (
    <form ref={formRef} onSubmit={photo.onSubmit} onChange={recompute} className="flex flex-col gap-5">
      <input type="hidden" name="reservationId" value={reservationId} />
      <div className="grid grid-cols-2 gap-3">
        <FieldWrap label={t("odometer")} htmlFor="odometer">
          <Input id="odometer" name="odometer" type="number" inputMode="numeric" min={params.startOdometer} defaultValue={params.startOdometer} required />
        </FieldWrap>
        <FieldWrap label={t("battery")} htmlFor="batteryLevel">
          <Input id="batteryLevel" name="batteryLevel" type="number" inputMode="numeric" min={0} max={100} required />
        </FieldWrap>
        <FieldWrap label={t("lateNotice")} htmlFor="lateNotice">
          <Select id="lateNotice" name="lateNotice" defaultValue="NOTIFIED">
            <option value="NOTIFIED">{t("lateNotified")}</option>
            <option value="UNANNOUNCED">{t("lateUnannounced")}</option>
          </Select>
        </FieldWrap>
      </div>
      {photo.picker(t("photos"), t("photosSelected", { count: 0 }))}
      <div className="grid grid-cols-2 gap-3">
        <FieldWrap label={t("cleaning")} htmlFor="cleaning">
          <Select
            id="cleaning"
            value={cleaning}
            onChange={(event) => {
              setCleaning(event.target.value);
              const input = formRef.current?.elements.namedItem("cleaningCents") as HTMLInputElement | null;
              if (input) input.value = String(cleaningPresets[event.target.value] / 100);
            }}
          >
            <option value="none">{t("cleaningNone")}</option>
            <option value="special">{t("cleaningSpecial")}</option>
            <option value="smoke">{t("cleaningSmoke")}</option>
          </Select>
        </FieldWrap>
        <FieldWrap label={t("amount")} htmlFor="cleaningCents">
          <Input id="cleaningCents" name="cleaningCents" inputMode="decimal" defaultValue="0" />
        </FieldWrap>
        <FieldWrap label={t("otherLabel")} htmlFor="otherLabel">
          <Input id="otherLabel" name="otherLabel" maxLength={120} />
        </FieldWrap>
        <FieldWrap label={t("amount")} htmlFor="otherCents">
          <Input id="otherCents" name="otherCents" inputMode="decimal" defaultValue="0" />
        </FieldWrap>
      </div>
      <FieldWrap label={t("damageNotes")} htmlFor="damageNotes">
        <Textarea id="damageNotes" name="damageNotes" maxLength={2000} className="min-h-20" />
      </FieldWrap>
      <FieldWrap label={t("damageAmount")} htmlFor="damageCents">
        <Input id="damageCents" name="damageCents" inputMode="decimal" />
      </FieldWrap>
      <div className="flex flex-col gap-2.5">
        <p className="text-xs font-medium tracking-wide text-charcoal">{t("returned")}</p>
        <Check name="acc_keyCard" label={t("keyCard")} defaultChecked />
        <Check name="acc_charger" label={t("charger")} defaultChecked />
        {hasChildSeat && <Check name="acc_childSeat" label={t("childSeat")} defaultChecked />}
      </div>
      <FieldWrap label={t("renterRemarks")} htmlFor="renterRemarks">
        <Textarea id="renterRemarks" name="renterRemarks" maxLength={2000} className="min-h-16" />
      </FieldWrap>
      <section className="rounded-xl bg-pearl px-4 py-3">
        <p className="text-xs font-medium tracking-wide text-charcoal">{t("estimate")}</p>
        {estimate ? <FeeList lines={estimate} /> : <p className="mt-1 text-[13px] text-muted">—</p>}
      </section>
      <div>
        <Button type="submit" size="lg" disabled={pending || photo.uploading}>
          {t("complete")}
        </Button>
      </div>
      <ErrorText code={photo.uploadError ? "upload_failed" : state.error} />
    </form>
  );
}

export function FeeList({ lines }: { lines: FeeLine[] }) {
  const t = useTranslations("handover");
  if (!lines.length) return <p className="mt-1 text-[13px] text-charcoal">{t("noFees")}</p>;
  return (
    <dl className="mt-1 flex flex-col gap-1 text-[13px]">
      {lines.map((line) => (
        <div key={line.code} className="flex justify-between gap-4">
          <dt className="text-charcoal">
            {t(`fee.${line.code}`)}
            {line.quantity > 1 ? <span className="text-muted"> · {line.quantity} × {formatMoney(line.unitCents)}</span> : null}
          </dt>
          <dd className="tabular-nums">{formatMoney(line.amountCents)}</dd>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-ink/[0.08] pt-1.5 font-semibold">
        <dt>{t("total")}</dt>
        <dd className="tabular-nums">{formatMoney(feeTotal(lines))}</dd>
      </div>
    </dl>
  );
}

export function OpsSignForm({ reservationId, defaultName }: { reservationId: string; defaultName: string }) {
  const t = useTranslations("portal.agreement");
  const h = useTranslations("handover");
  const [state, action, pending] = useActionState<HandoverState, FormData>(signOnDevice, {});
  const [signed, setSigned] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="reservationId" value={reservationId} />
      <SignaturePad onChange={setSigned} />
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <FieldWrap label={t("signerName")} htmlFor="signerName">
          <Input id="signerName" name="signerName" defaultValue={defaultName} required minLength={2} maxLength={120} autoComplete="off" />
        </FieldWrap>
        <FieldWrap label={t("initials")} htmlFor="initials">
          <Input id="initials" name="initials" required maxLength={6} autoCapitalize="characters" autoComplete="off" />
        </FieldWrap>
      </div>
      <Check name="electronicComms" label={t("electronic")} defaultChecked />
      <label className="flex items-start gap-2.5 text-[13px] text-charcoal">
        <input type="checkbox" name="agree" required className="mt-0.5 size-4 shrink-0 accent-[#b58b4b]" />
        {t("agree")}
      </label>
      <div>
        <Button type="submit" size="lg" disabled={pending || !signed}>
          {h("customerSigns")}
        </Button>
      </div>
      <ErrorText code={state.error} />
    </form>
  );
}
