import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BackLink, safeBack } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { getEmail } from "@/features/audit/email-queries";
import { requirePagePermission } from "@/lib/auth/staff";
import { formatFullDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Sent email" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AuditEmailPage({ params, searchParams }: Props) {
  await requirePagePermission("audit.view");
  const [{ id }, { back }] = await Promise.all([params, searchParams]);
  if (!uuid.test(id)) notFound();
  const [t, email] = await Promise.all([getTranslations("audit"), getEmail(id)]);
  if (!email) notFound();

  return (
    <>
      <BackLink href={safeBack(back, "/audit/emails")} />
      <PageHeader eyebrow={t("tabs.emails")} title={email.subject} />
      <section className="card mb-5 p-5 text-[13px]">
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("time")}</dt>
            <dd>{formatFullDateTime(email.created_at)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("emails.status")}</dt>
            <dd>
              <Badge tone={email.sent ? "success" : "danger"}>{email.sent ? t("emails.sent") : t("emails.failed")}</Badge>
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-muted">{t("emails.recipient")}</dt>
            <dd className="min-w-0 break-all text-right">{email.recipients}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t("emails.order")}</dt>
            <dd>
              {email.reservation ? (
                <Link href={`/reservations/${email.reservation.id}`} className="hover:text-gold">
                  {email.reservation.number}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
          {email.attachments.length > 0 && (
            <div className="flex justify-between gap-4 sm:col-span-2">
              <dt className="shrink-0 text-muted">{t("emails.attachments")}</dt>
              <dd className="min-w-0 break-all text-right">{email.attachments.join(", ")}</dd>
            </div>
          )}
        </dl>
      </section>
      {email.body_html ? (
        <iframe title={email.subject} sandbox="" srcDoc={email.body_html} className="card h-[46rem] w-full bg-white" />
      ) : (
        <article className="card p-6">
          <pre className="font-sans text-[14px] leading-relaxed whitespace-pre-wrap text-charcoal">{email.body_text}</pre>
        </article>
      )}
      {email.body_html && (
        <details className="mt-5 text-[13px]">
          <summary className="cursor-pointer px-1 py-2 text-muted hover:text-ink">{t("emails.text")}</summary>
          <article className="card mt-3 p-6">
            <pre className="font-sans text-[14px] leading-relaxed whitespace-pre-wrap text-charcoal">{email.body_text}</pre>
          </article>
        </details>
      )}
    </>
  );
}
