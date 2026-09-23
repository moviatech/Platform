import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { listDocuments, type InvestorDocument } from "@/features/investor/documents";
import { Icon, type IconName } from "@/features/portal/icons";
import { goldPill, IconBadge, PageIntro, whitePill } from "@/features/portal/ui";
import { requireInvestor } from "@/lib/auth/investor";
import { rootDomain } from "@/lib/env";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Documents" };

type Props = { searchParams: Promise<{ kind?: string; q?: string; doc?: string; asset?: string }> };

const tabs = ["all", "AGREEMENT", "VEHICLE", "TAX", "OTHER"] as const;
const iconFor = (document: InvestorDocument): IconName => (document.content_type === "application/pdf" ? "doc" : "image");
const sizeOf = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export default async function DocumentsPage({ searchParams }: Props) {
  const session = await requireInvestor();
  const { kind: rawKind, q, doc, asset } = await searchParams;
  const [t, documents] = await Promise.all([getTranslations("investor.documents"), listDocuments(session.investorId)]);
  const kind = (tabs as readonly string[]).includes(rawKind ?? "") ? (rawKind as (typeof tabs)[number]) : "all";
  const term = (q ?? "").trim().toLowerCase();
  const visible = documents.filter((item) => (kind === "all" || (kind === "OTHER" ? item.kind === "OTHER" || item.kind === "STATEMENT" : item.kind === kind)) && (!asset || item.allocation_id === asset) && (!term || item.title.toLowerCase().includes(term)));
  const selected = visible.find((item) => item.id === doc) ?? visible[0] ?? null;
  const counts = { AGREEMENT: documents.filter((item) => item.kind === "AGREEMENT").length, VEHICLE: documents.filter((item) => item.kind === "VEHICLE").length, OTHER: documents.filter((item) => item.kind === "TAX" || item.kind === "OTHER" || item.kind === "STATEMENT").length };
  const cards: Array<{ icon: IconName; label: string; sub: string; value: number }> = [
    { icon: "doc", label: t("cards.agreements"), sub: "Agreements", value: counts.AGREEMENT },
    { icon: "car", label: t("cards.vehicle"), sub: "Vehicle Documents", value: counts.VEHICLE },
    { icon: "list", label: t("cards.other"), sub: "Other Documents", value: counts.OTHER },
  ];
  const href = (next: Partial<{ kind: string; q: string; doc: string; asset: string }>) => {
    const params = new URLSearchParams();
    const merged = { kind, q: q ?? "", doc: doc ?? "", asset: asset ?? "", ...next };
    if (merged.kind && merged.kind !== "all") params.set("kind", merged.kind);
    if (merged.q) params.set("q", merged.q);
    if (merged.doc) params.set("doc", merged.doc);
    if (merged.asset) params.set("asset", merged.asset);
    const search = params.toString();
    return search ? `/documents?${search}` : "/documents";
  };
  const statusOf = (item: InvestorDocument) => (item.signed_on ? { label: t("signed"), tone: "bg-status-available/12 text-status-available" } : { label: t("archived"), tone: "bg-ink/5 text-charcoal" });
  return (
    <>
      <PageIntro title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.2fr)]">
        {cards.map((card) => (
          <section key={card.label} className="card flex items-center gap-4 p-5">
            <IconBadge name={card.icon} size={10} />
            <div>
              <p className="text-[13px] font-medium">{card.label}</p>
              <p className="text-[11px] text-muted">{card.sub}</p>
              <p className="mt-1 text-[1.5rem] leading-tight font-semibold tracking-tight">{t("count", { count: card.value })}</p>
            </div>
          </section>
        ))}
        <form action="/documents" className="card flex items-center gap-2 px-4">
          {kind !== "all" && <input type="hidden" name="kind" value={kind} />}
          {asset && <input type="hidden" name="asset" value={asset} />}
          <Icon name="search" size={16} className="text-muted" />
          <input name="q" defaultValue={q ?? ""} placeholder={t("search")} className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted" />
        </form>
      </div>
      {asset && (
        <p className="mt-4 text-[13px] text-muted">
          {t("filteredByAsset")}{" "}
          <Link href={href({ asset: "" })} className="text-ink underline decoration-gold/50 underline-offset-4">
            {t("clear")}
          </Link>
        </p>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="card overflow-hidden">
          <div className="flex gap-1 border-b border-ink/[0.07] px-4">
            {tabs.map((tab) => (
              <Link key={tab} href={href({ kind: tab, doc: "" })} className={cn("-mb-px border-b-2 px-3 py-3 text-[13px] font-medium", kind === tab ? "border-gold text-ink" : "border-transparent text-muted hover:text-ink")}>
                {tab === "all" ? t("tabs.all", { count: visible.length }) : t(`tabs.${tab}`)}
              </Link>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="px-5 py-12 text-center text-[13px] text-muted">{t("empty")}</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] tracking-[0.12em] text-muted uppercase">
                  <th className="px-5 py-2.5 font-medium">{t("columns.name")}</th>
                  <th className="py-2.5 pr-3 font-medium">{t("columns.asset")}</th>
                  <th className="py-2.5 pr-3 font-medium">{t("columns.status")}</th>
                  <th className="py-2.5 pr-5 font-medium">{t("columns.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/[0.06]">
                {visible.map((item) => {
                  const status = statusOf(item);
                  return (
                    <tr key={item.id} className={cn(selected?.id === item.id && "bg-gold/[0.06]")}>
                      <td className="px-5 py-3">
                        <Link href={href({ doc: item.id })} className="flex items-center gap-3 hover:text-gold">
                          <Icon name={iconFor(item)} size={18} className={item.content_type === "application/pdf" ? "text-status-danger" : "text-charcoal"} />
                          <span className="font-medium">{item.title}</span>
                        </Link>
                      </td>
                      <td className="py-3 pr-3 text-charcoal">{item.allocation?.vehicle?.fleet_number ?? t("allAssets")}</td>
                      <td className="py-3 pr-3">
                        <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-pill px-2.5 text-[11px] font-medium", status.tone)}>
                          <span className="size-1.5 rounded-full bg-current" />
                          {status.label}
                        </span>
                      </td>
                      <td className="py-3 pr-5 whitespace-nowrap">
                        <Link href={href({ doc: item.id })} className="text-gold hover:text-gold-light">
                          {t("view")}
                        </Link>
                        <span className="mx-2 text-ink/15">|</span>
                        <a href={`/documents/${item.id}/file?download=1`} className="text-gold hover:text-gold-light">
                          {t("download")}
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <section className="card flex flex-col p-5">
          <h2 className="mb-3 text-[17px] font-semibold tracking-tight">{t("preview")}</h2>
          {!selected ? (
            <p className="text-[13px] text-muted">{t("noPreview")}</p>
          ) : (
            <>
              <div className="relative min-h-72 flex-1 overflow-hidden rounded-xl bg-pearl">
                {selected.content_type === "application/pdf" ? (
                  <a href={`/documents/${selected.id}/file`} target="_blank" rel="noreferrer" className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-charcoal hover:text-gold">
                    <Icon name="doc" size={44} className="text-status-danger" />
                    <span className="text-[13px] font-medium">{selected.title}</span>
                    <span className="text-[12px] text-muted">PDF · {sizeOf(selected.size_bytes)}</span>
                  </a>
                ) : (
                  <Image src={`/documents/${selected.id}/file`} alt={selected.title} fill unoptimized sizes="30rem" className="object-contain" />
                )}
              </div>
              <dl className="mt-4 grid grid-cols-[6rem_minmax(0,1fr)] gap-y-1.5 text-[13px]">
                <dt className="text-muted">{t("meta.name")}</dt>
                <dd className="truncate">{selected.title}</dd>
                <dt className="text-muted">{t("meta.asset")}</dt>
                <dd>{selected.allocation?.vehicle?.fleet_number ?? t("allAssets")}</dd>
                <dt className="text-muted">{t("meta.kind")}</dt>
                <dd>{t(`kinds.${selected.kind}`)}</dd>
                <dt className="text-muted">{selected.signed_on ? t("meta.signedOn") : t("meta.addedOn")}</dt>
                <dd>{selected.signed_on ?? formatDate(selected.created_at)}</dd>
                <dt className="text-muted">{t("meta.size")}</dt>
                <dd>{sizeOf(selected.size_bytes)}</dd>
              </dl>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <a href={`/documents/${selected.id}/file`} target="_blank" rel="noreferrer" className={whitePill}>
                  {t("open")}
                </a>
                <a href={`/documents/${selected.id}/file?download=1`} className={goldPill}>
                  {t("download")}
                </a>
              </div>
            </>
          )}
          <Link href="/messages" className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-[#f7f4ee] px-4 py-3 text-[13px] hover:bg-pearl">
            <span className="flex items-center gap-2">
              <Icon name="help" size={16} className="text-gold" />
              {t("missing")}
            </span>
            <Icon name="chevron" size={14} className="text-muted" />
          </Link>
          <p className="mt-3 text-[11px] text-muted">contact@{rootDomain}</p>
        </section>
      </div>
    </>
  );
}
