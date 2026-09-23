import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { startGoogle } from "@/features/portal/auth-actions";
import { PasswordLoginForm } from "@/features/portal/AuthForms";
import { getCustomerSession } from "@/lib/auth/customer";
import { safeNext, withNext } from "@/lib/auth/next-url";

export const metadata: Metadata = { title: "Login" };

type Props = { searchParams: Promise<{ error?: string; next?: string }> };

export default async function PortalLoginPage({ searchParams }: Props) {
  const { error, next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  if (await getCustomerSession()) redirect(next);
  const t = await getTranslations("portal.auth");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      {(error === "link" || error === "google") && (
        <p className="mt-4 rounded-xl bg-status-danger/8 px-3.5 py-2.5 text-[13px] text-status-danger" role="alert">
          {t(error === "link" ? "errors.session" : "errors.google")}
        </p>
      )}
      <div className="mt-6">
        <PasswordLoginForm next={next} />
      </div>
      <div className="my-5 flex items-center gap-3 text-[11px] tracking-[0.18em] text-muted uppercase">
        <span className="h-px flex-1 bg-ink/10" />
        {t("or")}
        <span className="h-px flex-1 bg-ink/10" />
      </div>
      <form action={startGoogle}>
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="flex h-12 w-full items-center justify-center gap-3 rounded-pill bg-white text-[15px] font-medium text-ink hairline transition-colors hover:border-ink/25">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.3l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.3 17.7 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" />
            <path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z" />
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.7-4.2-13.6-10l-7.8 6C6.5 42.6 14.6 48 24 48z" />
          </svg>
          {t("google")}
        </button>
      </form>
      <p className="mt-6 text-center text-[13px] text-muted">
        {t("noAccount")}{" "}
        <Link href={withNext("/signup", next)} className="text-ink underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
          {t("signUp")}
        </Link>
      </p>
    </>
  );
}
