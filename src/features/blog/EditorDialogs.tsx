"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { zonedToUtc } from "@/features/booking/time";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import type { RevisionSummary } from "./articles";
import type { PreviewLink } from "./editor-actions";
import { IssueList, type EditorLabels } from "./EditorPanels";
import type { PublishIssue } from "./publish";

const zone = "America/Los_Angeles";

export function Modal({ open, onClose, children, wide, locked }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; locked?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(event) => {
        if (locked) event.preventDefault();
      }}
      className={cn("m-auto w-[calc(100vw-2rem)] rounded-card border border-ink/[0.07] bg-white p-6 shadow-lift backdrop:bg-ink/30", wide ? "max-w-2xl" : "max-w-lg")}>
      {open && children}
    </dialog>
  );
}

export type PublishMode = "first" | "scheduled" | "live";

type PublishProps = {
  mode: PublishMode;
  defaults: { date: string; time: string };
  issues: PublishIssue[];
  pending: boolean;
  labels: EditorLabels;
  issueLabels: Record<string, string>;
  onConfirm: (when: string, markUpdated: boolean) => void;
  onCancel: () => void;
};

export function PublishForm({ mode, defaults, issues, pending, labels, issueLabels, onConfirm, onCancel }: PublishProps) {
  const t = labels.publishDialog;
  const [choice, setChoice] = useState<"now" | "keep" | "schedule">(mode === "first" ? "now" : "keep");
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [markUpdated, setMarkUpdated] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const errors = issues.filter((issue) => issue.level === "error");
  const options = mode === "first" ? (["now", "schedule"] as const) : mode === "scheduled" ? (["keep", "now", "schedule"] as const) : [];
  const confirm = () => {
    if (choice !== "schedule") return onConfirm(choice, markUpdated);
    const instant = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? zonedToUtc(date, time, zone) : null;
    if (!instant || Number.isNaN(instant.getTime()) || instant.getTime() <= Date.now()) return setInvalid(true);
    onConfirm(instant.toISOString(), markUpdated);
  };

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">{mode === "first" ? labels.publish : labels.publishUpdate}</h2>
      {errors.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-status-danger">{t.blocked}</p>
          <div className="max-h-56 overflow-auto">
            <IssueList issues={errors} labels={labels} issueLabels={issueLabels} />
          </div>
        </div>
      )}
      {options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button key={option} type="button" aria-pressed={choice === option} onClick={() => setChoice(option)} className={cn("rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25", choice === option && "bg-ink text-white")}>
              {t[option]}
            </button>
          ))}
        </div>
      )}
      {choice === "schedule" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="publish-date" className="text-xs font-medium tracking-wide text-charcoal">
            {t.at}
          </label>
          <div className="flex gap-2">
            <Input id="publish-date" type="date" value={date} onChange={(event) => { setDate(event.target.value); setInvalid(false); }} />
            <Input type="time" aria-label={t.at} value={time} onChange={(event) => { setTime(event.target.value); setInvalid(false); }} className="w-36" />
          </div>
          {invalid && (
            <p role="alert" className="text-xs text-status-danger">
              {t.invalidTime}
            </p>
          )}
        </div>
      )}
      {mode === "live" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={markUpdated} onChange={(event) => setMarkUpdated(event.target.checked)} className="size-4 accent-[#b58b4b]" />
          {t.markUpdated}
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="button" size="sm" disabled={pending || errors.length > 0} onClick={confirm}>
          {t.confirm}
        </Button>
      </div>
    </div>
  );
}

export function HistoryList({ revisions, pending, labels, onRestore, onClose }: { revisions: RevisionSummary[] | null; pending: boolean; labels: EditorLabels; onRestore: (id: string) => void; onClose: () => void }) {
  const t = labels.historyDialog;
  const kinds: Record<string, string> = t.kinds;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{labels.history}</h2>
      {revisions === null ? (
        <div className="h-24 animate-pulse rounded-xl bg-ink/[0.05]" />
      ) : revisions.length === 0 ? (
        <p className="text-sm text-muted">{t.empty}</p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-ink/[0.06] overflow-auto">
          {revisions.map((revision) => (
            <li key={revision.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="tabular-nums">{formatDateTime(revision.created_at)}</span>
                <span className="ml-2 text-muted">
                  {kinds[revision.kind] ?? revision.kind}
                  {revision.created_by_name ? ` · ${revision.created_by_name}` : ""}
                </span>
              </span>
              <Button type="button" size="sm" variant="secondary" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => onRestore(revision.id)}>
                {t.restore}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t.close}
        </Button>
      </div>
    </div>
  );
}

export function PreviewLinks({ link, issues, labels, issueLabels, onClose }: { link: Extract<PreviewLink, { ok: true }> | null; issues: PublishIssue[]; labels: EditorLabels; issueLabels: Record<string, string>; onClose: () => void }) {
  const t = labels.previewDialog;
  const errors = issues.filter((issue) => issue.level === "error");
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{labels.sitePreview}</h2>
      {errors.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-status-danger">{labels.publishDialog.blocked}</p>
          <div className="max-h-56 overflow-auto">
            <IssueList issues={errors} labels={labels} issueLabels={issueLabels} />
          </div>
        </div>
      ) : link === null ? (
        <div className="h-16 animate-pulse rounded-xl bg-ink/[0.05]" />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {(["zh", "en"] as const).map((locale) => (
              <li key={locale} className="flex items-center justify-between gap-3 rounded-xl border border-ink/10 px-3.5 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  <span className="mr-2 font-medium">{labels.tabs[locale]}</span>
                  <span className="text-muted">{link[locale]}</span>
                </span>
                <a href={link[locale]} target="_blank" rel="noreferrer" className="shrink-0 font-medium text-gold hover:underline">
                  {t.open}
                </a>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{t.expires}</p>
        </>
      )}
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t.close}
        </Button>
      </div>
    </div>
  );
}
