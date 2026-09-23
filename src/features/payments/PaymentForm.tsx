"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Appearance, type StripeElementLocale } from "@stripe/stripe-js";
import { Button } from "@/components/ui/Button";
import { formatMoney } from "@/lib/utils/format";
import { finalizeCardSetupAction, finalizePaymentAction } from "@/features/portal/pay-actions";

type Props = { mode: "payment" | "setup"; clientSecret: string; publishableKey: string; locale: "zh" | "en"; number?: string; amountCents?: number; returnPath: string; donePath: string };

const appearance: Appearance = {
  theme: "stripe",
  variables: {
    colorPrimary: "#b58b4b",
    colorText: "#111111",
    colorTextSecondary: "#747474",
    colorTextPlaceholder: "#a3a3a3",
    colorBackground: "#ffffff",
    colorDanger: "#c4463a",
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    fontSizeBase: "15px",
    borderRadius: "12px",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": { border: "1px solid rgba(17,17,17,0.12)", boxShadow: "none", padding: "12px 14px" },
    ".Input:focus": { border: "1px solid #b58b4b", boxShadow: "0 0 0 3px rgba(181,139,75,0.18)" },
    ".Label": { color: "#747474", fontSize: "12px", fontWeight: "500" },
    ".Tab": { border: "1px solid rgba(17,17,17,0.12)", boxShadow: "none" },
    ".Tab--selected": { border: "1px solid #b58b4b", boxShadow: "0 0 0 3px rgba(181,139,75,0.18)" },
  },
};

function Inner({ mode, number, amountCents, returnPath, donePath }: Pick<Props, "mode" | "number" | "amountCents" | "returnPath" | "donePath">) {
  const t = useTranslations("portal.pay");
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const returnUrl = `${window.location.origin}${returnPath}`;
    try {
      if (mode === "payment") {
        const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl }, redirect: "if_required" });
        if (result.error) throw new Error(result.error.message ?? t("errors.generic"));
        const settled = await finalizePaymentAction(number ?? "", result.paymentIntent.id);
        if (settled.error) throw new Error(settled.error === "processing" ? t("errors.processing") : t("errors.generic"));
      } else {
        const result = await stripe.confirmSetup({ elements, confirmParams: { return_url: returnUrl }, redirect: "if_required" });
        if (result.error) throw new Error(result.error.message ?? t("errors.generic"));
        const saved = await finalizeCardSetupAction(result.setupIntent.id, number);
        if (saved.error) throw new Error(t("errors.generic"));
      }
      router.replace(donePath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.generic"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <PaymentElement options={{ layout: "tabs", wallets: { link: "never" } }} onReady={() => setReady(true)} />
      {error && (
        <p className="rounded-xl bg-status-danger/8 px-4 py-3 text-[13px] text-status-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={!stripe || !ready || busy} className="w-full">
        {busy ? t("processing") : mode === "payment" ? t("payAmount", { amount: formatMoney(amountCents ?? 0) }) : t("saveCard")}
      </Button>
      <p className="text-center text-[11px] text-muted">{t("secure")}</p>
    </form>
  );
}

export function PaymentForm(props: Props) {
  const stripePromise = useMemo(() => loadStripe(props.publishableKey, { locale: props.locale as StripeElementLocale }), [props.publishableKey, props.locale]);
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: props.clientSecret, appearance, locale: props.locale as StripeElementLocale }}>
      <Inner mode={props.mode} number={props.number} amountCents={props.amountCents} returnPath={props.returnPath} donePath={props.donePath} />
    </Elements>
  );
}
