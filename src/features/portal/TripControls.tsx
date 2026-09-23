"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input } from "@/components/ui/Field";
import { formatMoney } from "@/lib/utils/format";
import { SignaturePad } from "./SignaturePad";
import { cancelTrip, signAgreement, updateProfile, type TripActionState } from "./trip-actions";

function ErrorText({ code, ns }: { code?: string; ns: "portal.trip" | "portal.agreement" | "portal.profile" }) {
  const t = useTranslations(ns);
  if (!code) return null;
  return (
    <p className="text-[13px] text-status-danger" role="alert">
      {t.has(`errors.${code}`) ? t(`errors.${code}`) : code}
    </p>
  );
}

export function CancelForm({ number, feeCents }: { number: string; feeCents: number }) {
  const t = useTranslations("portal.trip");
  const [state, action, pending] = useActionState<TripActionState, FormData>(cancelTrip, {});
  if (state.ok) {
    return (
      <p className="text-[13px] text-charcoal">
        {t("cancelled")}
        {state.settlement && state.settlement.refundedCents > 0 ? ` · ${t("refunded", { amount: formatMoney(state.settlement.refundedCents) })}` : ""}
        {state.settlement && state.settlement.chargedCents > 0 ? ` · ${t("feeCharged", { amount: formatMoney(state.settlement.chargedCents) })}` : ""}
      </p>
    );
  }
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(feeCents > 0 ? t("confirmCancelFee", { amount: formatMoney(feeCents) }) : t("confirmCancelFree"))) event.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="number" value={number} />
      <p className="text-[13px] text-muted">{feeCents > 0 ? t("cancelFee", { amount: formatMoney(feeCents) }) : t("cancelFree")}</p>
      <div>
        <Button type="submit" size="sm" variant="danger" disabled={pending}>
          {t("cancel")}
        </Button>
      </div>
      <ErrorText code={state.error} ns="portal.trip" />
    </form>
  );
}

export function SignForm({ number, defaultName, longTerm }: { number: string; defaultName: string; longTerm: boolean }) {
  const t = useTranslations("portal.agreement");
  const [state, action, pending] = useActionState<TripActionState, FormData>(signAgreement, {});
  const [signed, setSigned] = useState(false);
  if (state.ok) {
    return <p className="rounded-xl bg-status-available/10 px-4 py-3 text-sm text-ink">{t("signed")}</p>;
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="number" value={number} />
      <SignaturePad onChange={setSigned} />
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <FieldWrap label={t("signerName")} htmlFor="signerName">
          <Input id="signerName" name="signerName" defaultValue={defaultName} required minLength={2} maxLength={120} autoComplete="name" />
        </FieldWrap>
        <FieldWrap label={t("initials")} htmlFor="initials">
          <Input id="initials" name="initials" required maxLength={6} autoCapitalize="characters" />
        </FieldWrap>
      </div>
      <label className="flex items-start gap-2.5 text-[13px] text-charcoal">
        <input type="checkbox" name="waiverAck" required className="mt-0.5 size-4 shrink-0 accent-[#b58b4b]" />
        {t("waiverAck")}
      </label>
      <label className="flex items-start gap-2.5 text-[13px] text-charcoal">
        <input type="checkbox" name="locationAck" required className="mt-0.5 size-4 shrink-0 accent-[#b58b4b]" />
        {t("locationAck")}
      </label>
      {longTerm && (
        <label className="flex items-start gap-2.5 text-[13px] text-charcoal">
          <input type="checkbox" name="longTermAck" required className="mt-0.5 size-4 shrink-0 accent-[#b58b4b]" />
          {t("longTermAck")}
        </label>
      )}
      <label className="flex items-start gap-2.5 text-[13px] text-charcoal">
        <input type="checkbox" name="electronicComms" defaultChecked className="mt-0.5 size-4 shrink-0 accent-[#b58b4b]" />
        {t("electronic")}
      </label>
      <label className="flex items-start gap-2.5 text-[13px] text-charcoal">
        <input type="checkbox" name="agree" required className="mt-0.5 size-4 shrink-0 accent-[#b58b4b]" />
        {t("agree")}
      </label>
      <div>
        <Button type="submit" size="lg" variant="gold" disabled={pending || !signed}>
          {t("sign")}
        </Button>
      </div>
      <ErrorText code={state.error} ns="portal.agreement" />
    </form>
  );
}

type Profile = { fullName: string; phone: string | null; wechat: string | null; dateOfBirth: string | null; address: string | null; language: "zh" | "en"; email: string };

export function ProfileForm({ profile }: { profile: Profile }) {
  const t = useTranslations("portal.profile");
  const [state, action, pending] = useActionState<TripActionState, FormData>(updateProfile, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <FieldWrap label={t("email")} htmlFor="email" className="sm:col-span-2">
        <Input id="email" value={profile.email} disabled readOnly />
      </FieldWrap>
      <FieldWrap label={t("name")} htmlFor="fullName">
        <Input id="fullName" name="fullName" defaultValue={profile.fullName} required maxLength={120} autoComplete="name" />
      </FieldWrap>
      <FieldWrap label={t("phone")} htmlFor="phone">
        <Input id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} maxLength={40} autoComplete="tel" />
      </FieldWrap>
      <FieldWrap label={t("dob")} htmlFor="dateOfBirth">
        <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={profile.dateOfBirth ?? ""} autoComplete="bday" />
      </FieldWrap>
      <FieldWrap label={t("address")} htmlFor="address" className="sm:col-span-2">
        <Input id="address" name="address" defaultValue={profile.address ?? ""} maxLength={200} autoComplete="street-address" />
      </FieldWrap>
      <FieldWrap label={t("wechat")} htmlFor="wechat">
        <Input id="wechat" name="wechat" defaultValue={profile.wechat ?? ""} maxLength={60} />
      </FieldWrap>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="gold" disabled={pending}>
          {t("save")}
        </Button>
        {state.ok && <span className="text-[13px] text-status-available">{t("saved")}</span>}
        <ErrorText code={state.error} ns="portal.profile" />
      </div>
    </form>
  );
}
