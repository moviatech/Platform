"use client";

import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { articleQueries } from "@/features/marketing/actions";
import type { SearchLine } from "@/features/marketing/analysis";
import type { MarketingMessages } from "@/features/marketing/i18n";
import { fill } from "@/features/marketing/text";
import { cn } from "@/lib/utils/cn";
import type { TagRow } from "./articles";
import type { BlogLocale, ImageRef } from "./blocks";
import { createTag } from "./editor-actions";
import { slugFromText, type TagIdea } from "./intake";
import type { MediaItem } from "./media";
import type { PublishIssue } from "./publish";

export type EditorLabels = MarketingMessages["blog"]["editor"];

const chip = "rounded-pill px-2.5 py-1 text-[12px] font-medium transition-colors";

export function IssueList({ issues, labels, issueLabels, onPick }: { issues: PublishIssue[]; labels: EditorLabels; issueLabels: Record<string, string>; onPick?: (issue: PublishIssue) => void }) {
  if (!issues.length) return <p className="text-sm text-muted">{labels.noIssues}</p>;
  const ordered = [...issues].sort((a, b) => Number(a.level === "warning") - Number(b.level === "warning"));
  return (
    <ul className="flex flex-col gap-1.5">
      {ordered.map((issue, index) => (
        <li key={`${issue.code}-${issue.locale ?? ""}-${issue.line ?? ""}-${index}`}>
          <button type="button" disabled={!onPick || !issue.locale} onClick={() => onPick?.(issue)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-ink/[0.03] disabled:hover:bg-transparent">
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", issue.level === "error" ? "bg-status-danger" : "bg-status-limited")} aria-hidden="true" />
            <span className="min-w-0 text-charcoal">
              {issue.locale && <span className="mr-1.5 text-muted">{labels.tabs[issue.locale]}</span>}
              {fill(issueLabels[issue.code] ?? issue.code, { detail: issue.detail ?? "" })}
              {issue.line ? <span className="ml-1.5 tabular-nums text-muted">L{issue.line}</span> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type MediaProps = {
  media: MediaItem[];
  cover: ImageRef | null;
  uploading: boolean;
  siteOrigin: string;
  labels: EditorLabels["media"];
  onUpload: () => void;
  onInsert: (item: MediaItem) => void;
  onCover: (item: MediaItem) => void;
  onRemove: (item: MediaItem) => void;
};

export function MediaPanel({ media, cover, uploading, siteOrigin, labels, onUpload, onInsert, onCover, onRemove }: MediaProps) {
  const action = "text-[12px] text-muted hover:text-ink";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="secondary" onClick={onUpload}>
          {labels.upload}
        </Button>
        {uploading && <span className="text-[13px] text-muted">{labels.uploading}</span>}
      </div>
      {media.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink/15 bg-pearl/60 px-4 py-8 text-center text-[13px] text-muted">{labels.empty}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {media.map((item) => {
            const isCover = cover?.src === item.src;
            return (
              <li key={item.id}>
                <div className={cn("relative aspect-[16/10] overflow-hidden rounded-xl bg-pearl", isCover && "ring-2 ring-gold")}>
                  <Image src={item.src.startsWith("/") ? `${siteOrigin}${item.src}` : item.src} alt="" fill unoptimized sizes="12rem" className="object-cover" />
                </div>
                <p className="mt-1 truncate text-[11px] text-muted tabular-nums">
                  {item.width}×{item.height}
                  {item.name ? ` · ${item.name}` : ""}
                </p>
                <p className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <button type="button" className={action} onClick={() => onInsert(item)}>
                    {labels.insert}
                  </button>
                  {isCover ? (
                    <span className="text-[12px] text-gold">{labels.isCover}</span>
                  ) : (
                    <button type="button" className={action} onClick={() => onCover(item)}>
                      {labels.setCover}
                    </button>
                  )}
                  <button type="button" className="text-[12px] text-muted hover:text-status-danger" onClick={() => onRemove(item)}>
                    {labels.remove}
                  </button>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function QueryPanel({ slug, labels }: { slug: string; labels: EditorLabels["queries"] }) {
  const [rows, setRows] = useState<SearchLine[] | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void articleQueries(slug)
      .then((found) => {
        if (active) setRows(found);
      })
      .catch(() => {
        if (active) setRows(null);
      });
    return () => {
      active = false;
    };
  }, [slug]);
  if (rows === undefined) return <div className="h-24 animate-pulse rounded-xl bg-ink/[0.05]" />;
  if (!rows?.length) return <p className="text-sm text-muted">{labels.none}</p>;
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-[11px] tracking-wide text-muted">
          <th className="pb-2 text-left font-medium">{labels.query}</th>
          <th className="pb-2 pl-4 text-right font-medium">{labels.clicks}</th>
          <th className="pb-2 pl-4 text-right font-medium">{labels.impressions}</th>
          <th className="pb-2 pl-4 text-right font-medium">{labels.position}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-ink/[0.05]">
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="max-w-0 truncate py-2 text-charcoal" style={{ width: "100%" }}>
              {row.key}
            </td>
            <td className="py-2 pl-4 text-right tabular-nums">{row.clicks}</td>
            <td className="py-2 pl-4 text-right tabular-nums">{row.impressions}</td>
            <td className="py-2 pl-4 text-right tabular-nums">{row.position.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type TagProps = { id: string; tags: TagRow[]; selected: string[]; hints: TagIdea[]; locale: BlogLocale; labels: EditorLabels["settings"]; onChange: (next: string[]) => void; onCreated: (tag: TagRow) => void; onHints: (next: TagIdea[]) => void };

export function TagPicker({ id: fieldId, tags, selected, hints, locale, labels, onChange, onCreated, onHints }: TagProps) {
  const [id, setId] = useState("");
  const [zh, setZh] = useState("");
  const [en, setEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState<TagIdea | null>(null);
  const [pending, start] = useTransition();
  const name = (tag: TagRow) => (locale === "zh" ? tag.label_zh : tag.label_en);
  const without = (hint: TagIdea) => hints.filter((item) => item !== hint);
  const take = (hint: TagIdea) => {
    setUsed(hint);
    setId(slugFromText(hint.en, 40));
    setZh(hint.zh || hint.en);
    setEn(hint.en);
    setError(null);
  };
  const toggle = (tag: string) => onChange(selected.includes(tag) ? selected.filter((item) => item !== tag) : selected.length < 12 ? [...selected, tag] : selected);
  const add = () =>
    start(async () => {
      const result = await createTag({ id, labelZh: zh, labelEn: en }).catch(() => null);
      if (!result?.ok) {
        setError(result?.error === "taken" ? labels.tagTaken : labels.tagInvalid);
        return;
      }
      setError(null);
      setId("");
      setZh("");
      setEn("");
      onCreated(result.tag);
      if (selected.length < 12) onChange([...selected, result.tag.id]);
      if (used && hints.includes(used)) onHints(without(used));
      setUsed(null);
    });
  const small = "h-9 text-[13px]";

  return (
    <details className="group relative">
      <summary id={fieldId} className="flex min-h-11 list-none flex-wrap items-center gap-1.5 rounded-xl border border-ink/10 bg-white px-2.5 py-1.5 text-sm">
        {selected.length === 0 && <span className="px-1 text-muted/70">{labels.tags}</span>}
        {selected.map((tag) => {
          const known = tags.find((item) => item.id === tag);
          return (
            <span key={tag} className={cn(chip, "bg-gold/12 text-gold")}>
              {known ? name(known) : tag}
            </span>
          );
        })}
      </summary>
      <div className="card absolute top-full right-0 left-0 z-20 mt-2 flex max-h-96 flex-col gap-4 overflow-auto p-4">
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <button key={tag.id} type="button" aria-pressed={selected.includes(tag.id)} onClick={() => toggle(tag.id)} className={cn(chip, selected.includes(tag.id) ? "bg-ink text-white" : "bg-ink/5 text-charcoal hover:bg-ink/10")}>
              {name(tag)}
            </button>
          ))}
        </div>
        <div className="border-t border-ink/[0.07] pt-3">
          {hints.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium tracking-wide text-charcoal">{labels.tagHints}</span>
              {hints.map((hint) => (
                <span key={`${hint.zh}|${hint.en}`} className={cn(chip, "flex items-center gap-1 border border-dashed border-ink/25 text-charcoal", used === hint && "border-gold text-gold")}>
                  <button type="button" onClick={() => take(hint)}>
                    {(locale === "zh" ? hint.zh || hint.en : hint.en || hint.zh) || "—"}
                  </button>
                  <button type="button" aria-label={`${labels.dropHint} ${hint.en || hint.zh}`} className="text-muted hover:text-status-danger" onClick={() => onHints(without(hint))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="mb-2 text-xs font-medium tracking-wide text-charcoal">{labels.newTag}</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Input aria-label={labels.tagId} placeholder={labels.tagId} className={small} value={id} maxLength={60} spellCheck={false} onChange={(event) => setId(event.target.value.toLowerCase())} />
            <Input aria-label={labels.tagZh} placeholder={labels.tagZh} className={small} value={zh} maxLength={60} onChange={(event) => setZh(event.target.value)} />
            <Input aria-label={labels.tagEn} placeholder={labels.tagEn} className={small} value={en} maxLength={60} onChange={(event) => setEn(event.target.value)} />
            <Button type="button" size="sm" variant="secondary" disabled={pending || !id || !zh.trim() || !en.trim()} onClick={add}>
              {labels.add}
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-status-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
