"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { startNavigation } from "@/components/ui/NavigationProgress";
import { zonedParts } from "@/features/booking/time";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import type { RevisionSummary, TagRow } from "./articles";
import { ArticlePreview } from "./ArticlePreview";
import { blogCategories, type ArticleDraft, type BlogCategory, type BlogLocale, type LocaleDraft } from "./blocks";
import { useFileDrop } from "./file-drop";
import { DropVeil } from "./DropVeil";
import {
  createMediaUpload,
  createPreviewLink,
  currentRev,
  deleteArticle,
  discardChanges,
  fetchRevisions,
  publishArticle,
  reimportArticle,
  removeMedia,
  restoreRevision,
  saveCheckpoint,
  saveDraft,
  saveMedia,
  unpublishArticle,
  type PreviewLink,
} from "./editor-actions";
import { HistoryList, Modal, PreviewLinks, PublishForm, type PublishMode } from "./EditorDialogs";
import { IssueList, MediaPanel, QueryPanel, TagPicker, type EditorLabels } from "./EditorPanels";
import { processImage } from "./image-tools";
import { fileKind, readSources, sourceMaxBytes } from "./intake";
import { baseName, coverName, relinkImages, toImageRef, type MediaItem } from "./media";
import { takeFiles } from "./pending";
import { checkDraft, displayWidth, fieldLimits, type PublishIssue } from "./publish";
import { insertBlock, lineOffset, prefixLines, wrapSelection, type Edit, type Selection } from "./text-tools";

type Article = { slug: string; status: "DRAFT" | "PUBLISHED"; publishAt: string | null; scheduled: boolean; rev: number; liveRev: number | null; draft: ArticleDraft };

type Props = {
  article: Article;
  media: MediaItem[];
  tags: TagRow[];
  labels: EditorLabels;
  issueLabels: Record<string, string>;
  categoryLabels: Record<string, string>;
  uiLocale: BlogLocale;
  siteEnabled: boolean;
  siteOrigin: string;
  searchTab: boolean;
};

type SaveState = "saved" | "dirty" | "saving" | "error" | "stale";

type Dialog = "publish" | "history" | "preview" | null;

const zone = "America/Los_Angeles";

const tab = "rounded-pill px-3.5 py-1.5 text-[13px] hairline hover:border-ink/25";

const tool = "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-[13px] text-charcoal hover:bg-ink/5";

const compact = { minHeight: "4.25rem" };

const gone = (error: string) => error === "stale" || error === "missing";

function dropLine(markdown: string, mark: string) {
  const at = markdown.indexOf(mark);
  if (at === -1) return markdown;
  const end = at + mark.length;
  if (markdown.slice(end, end + 2) === "\n\n") return markdown.slice(0, at) + markdown.slice(end + 2);
  if (markdown.slice(Math.max(0, at - 2), at) === "\n\n") return markdown.slice(0, at - 2) + markdown.slice(end);
  return markdown.slice(0, at) + markdown.slice(end);
}

function Field({ id, label, count, limit, className, children }: { id: string; label: string; count?: number; limit?: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium tracking-wide text-charcoal">
          {label}
        </label>
        {limit !== undefined && count !== undefined && (
          <span className={cn("text-[11px] tabular-nums", count > limit ? "text-status-danger" : "text-muted")}>
            {count}/{limit}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function Editor({ article, media: initialMedia, tags: initialTags, labels, issueLabels, categoryLabels, uiLocale, siteEnabled, siteOrigin, searchTab }: Props) {
  const slug = article.slug;
  const router = useRouter();
  const [draft, setDraft] = useState(article.draft);
  const [rev, setRev] = useState(article.rev);
  const [liveRev, setLiveRev] = useState(article.liveRev);
  const [status, setStatus] = useState(article.status);
  const [publishAt, setPublishAt] = useState(article.publishAt);
  const [scheduled, setScheduled] = useState(article.scheduled);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [locale, setLocale] = useState<BlogLocale>("zh");
  const [side, setSide] = useState<"preview" | "issues" | "media" | "queries">("preview");
  const [media, setMedia] = useState(initialMedia);
  const [tags, setTags] = useState(initialTags);
  const [uploading, setUploading] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [defaults, setDefaults] = useState({ date: "", time: "08:00" });
  const [serverIssues, setServerIssues] = useState<PublishIssue[] | null>(null);
  const [revisions, setRevisions] = useState<RevisionSummary[] | null>(null);
  const [link, setLink] = useState<Extract<PreviewLink, { ok: true }> | null>(null);

  const draftRef = useRef(article.draft);
  const revRef = useRef(article.rev);
  const dirtyRef = useRef(false);
  const staleRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const sequence = useRef(0);
  const body = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const inline = useRef(false);
  const sending = useRef(0);

  const goStale = useCallback(() => {
    staleRef.current = true;
    setSaveState("stale");
    setNotice(labels.stale);
    setDialog(null);
  }, [labels.stale]);

  const hold = useCallback(<Result,>(call: Promise<Result>) => {
    const done = call.then(
      () => true,
      () => false,
    );
    saving.current = done;
    void done.finally(() => {
      if (saving.current === done) saving.current = null;
    });
    return call;
  }, []);

  const flush = useCallback(
    async (checkpoint = false): Promise<boolean> => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      while (saving.current) await saving.current;
      if (staleRef.current) return false;
      if (!dirtyRef.current && !checkpoint) return true;
      const changed = dirtyRef.current;
      dirtyRef.current = false;
      setSaveState("saving");
      const sent = changed ? saveDraft({ slug, rev: revRef.current, draft: draftRef.current }) : Promise.resolve({ ok: true as const, rev: revRef.current });
      const run = sent
        .then(async (result) => {
          if (result.ok) {
            revRef.current = result.rev;
            setRev(result.rev);
            if (checkpoint) await saveCheckpoint({ slug, rev: result.rev }).catch(() => null);
            setSaveState(dirtyRef.current ? "dirty" : "saved");
            return true;
          }
          if (gone(result.error)) {
            goStale();
            return false;
          }
          dirtyRef.current = true;
          setSaveState("error");
          return false;
        })
        .catch(() => {
          dirtyRef.current = true;
          setSaveState("error");
          return false;
        });
      saving.current = run;
      const ok = await run;
      if (saving.current === run) saving.current = null;
      return ok;
    },
    [slug, goStale],
  );

  const change = useCallback(
    (next: ArticleDraft) => {
      draftRef.current = next;
      dirtyRef.current = true;
      setDraft(next);
      setSaveState((current) => (current === "stale" ? current : "dirty"));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 2500);
    },
    [flush],
  );

  const adopt = useCallback((next: ArticleDraft, nextRev: number) => {
    draftRef.current = next;
    revRef.current = nextRev;
    dirtyRef.current = false;
    setDraft(next);
    setRev(nextRev);
    setSaveState("saved");
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || saving.current || sending.current > 0) event.preventDefault();
    };
    const hide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", hide);
      void flush();
    };
  }, [flush]);

  useEffect(() => {
    let active = true;
    void currentRev(slug)
      .then((latest) => {
        if (!active || latest === null || latest <= revRef.current) return;
        if (dirtyRef.current || saving.current) goStale();
        else location.reload();
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [slug, article.rev, goStale]);

  const lookup = useMemo(() => {
    const known = new Map(media.map((item) => [item.src, toImageRef(item)]));
    return (src: string) => known.get(src) ?? null;
  }, [media]);
  const deferred = useDeferredValue(draft);
  const check = useMemo(() => checkDraft(deferred, lookup), [deferred, lookup]);
  const errorCount = check.issues.filter((issue) => issue.level === "error").length;

  const fields = draft[locale];
  const live = status === "PUBLISHED";
  const dirtyLive = live && liveRev !== null && rev !== liveRev;
  const stale = saveState === "stale";
  const frozen = busy || stale;
  const patch = (part: Partial<ArticleDraft>) => change({ ...draftRef.current, ...part });
  const patchLocale = (part: Partial<LocaleDraft>) => change({ ...draftRef.current, [locale]: { ...draftRef.current[locale], ...part } });

  const applyEdit = (make: (selection: Selection) => Edit) => {
    const area = body.current;
    if (!area) return;
    const edit = make({ value: area.value, start: area.selectionStart, end: area.selectionEnd });
    area.focus();
    area.setSelectionRange(edit.from, edit.to);
    if (!document.execCommand("insertText", false, edit.text)) {
      area.setRangeText(edit.text, edit.from, edit.to, "end");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    }
    area.setSelectionRange(edit.selectFrom, edit.selectTo);
  };

  const rewrite = (transform: (markdown: string) => string, extra: Partial<ArticleDraft> = {}) => {
    const current = draftRef.current;
    const zh = transform(current.zh.markdown);
    const en = transform(current.en.markdown);
    if (zh === current.zh.markdown && en === current.en.markdown && Object.keys(extra).length === 0) return;
    const area = body.current;
    const caret = area && document.activeElement === area ? [transform(area.value.slice(0, area.selectionStart)).length, transform(area.value.slice(0, area.selectionEnd)).length] : null;
    change({ ...current, ...extra, zh: { ...current.zh, markdown: zh }, en: { ...current.en, markdown: en } });
    if (!caret) return;
    requestAnimationFrame(() => {
      const target = body.current;
      if (target && document.activeElement === target) target.setSelectionRange(caret[0], caret[1]);
    });
  };

  const insertImage = (src: string) => applyEdit((selection) => insertBlock(selection, `![${labels.toolbar.alt}](${src})`, 2, labels.toolbar.alt.length));

  const upload = async (files: File[], insert: boolean) => {
    if (!files.length || staleRef.current) return;
    sending.current += files.length;
    const marks = files.map(() => (insert ? `![${labels.media.uploading} ${(sequence.current += 1)}](uploading)` : null));
    const placed = marks.filter((mark): mark is string => mark !== null);
    if (placed.length) applyEdit((selection) => insertBlock(selection, placed.join("\n\n")));
    for (const [index, file] of files.entries()) {
      const mark = marks[index];
      const fail = (message: string) => {
        setNotice(message);
        if (mark) rewrite((markdown) => dropLine(markdown, mark));
      };
      setUploading((count) => count + 1);
      try {
        const processed = await processImage(file);
        if (typeof processed === "string") {
          fail(processed === "unsupported" ? labels.media.unsupported : labels.media.tooLarge);
          continue;
        }
        const target = await createMediaUpload({ slug, type: processed.blob.type, size: processed.blob.size });
        const sent = target ? await fetch(target.url, { method: "PUT", headers: { "content-type": processed.blob.type, "x-upsert": "false" }, body: processed.blob }) : null;
        const item = target && sent?.ok ? await saveMedia({ slug, path: target.path, width: processed.width, height: processed.height, blur: processed.blur, name: file.name.slice(0, 200) || null }) : null;
        if (!item) {
          fail(labels.media.failed);
          continue;
        }
        setMedia((list) => [item, ...list]);
        const current = draftRef.current;
        const relink = (markdown: string) => relinkImages(markdown, file.name, item.src);
        const relinked = relink(current.zh.markdown) !== current.zh.markdown || relink(current.en.markdown) !== current.en.markdown;
        const named = current.coverHint ? baseName(file.name) === current.coverHint : coverName.test(file.name);
        const cover = !current.cover && named ? toImageRef(item) : null;
        rewrite(
          (markdown) => {
            const linked = relink(markdown);
            if (!mark) return linked;
            return relinked || cover ? dropLine(linked, mark) : linked.split(mark).join(`![${labels.toolbar.alt}](${item.src})`);
          },
          cover ? { cover } : {},
        );
      } catch {
        fail(labels.media.failed);
      } finally {
        sending.current -= 1;
        setUploading((count) => count - 1);
      }
    }
  };

  const startHeld = useEffectEvent((files: File[]) => void upload(files, false));

  useEffect(() => {
    const files = takeFiles(slug);
    if (files.length) queueMicrotask(() => startHeld(files));
  }, [slug]);

  const images = (list: FileList | null | undefined) => Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));

  const pick = (insert: boolean) => {
    inline.current = insert;
    picker.current?.click();
  };

  const dropMedia = async (item: MediaItem) => {
    if (!confirm(labels.media.confirmRemove)) return;
    if (!(await flush())) return setNotice(labels.failed);
    const result = await removeMedia({ slug, id: item.id }).catch(() => null);
    if (result?.ok) setMedia((list) => list.filter((entry) => entry.id !== item.id));
    else setNotice(result && !result.ok && result.error === "in_use" ? labels.media.inUse : labels.failed);
  };

  const jump = (issue: PublishIssue) => {
    if (!issue.locale) return;
    setLocale(issue.locale);
    const line = issue.line;
    if (!line) return;
    requestAnimationFrame(() => {
      const area = body.current;
      if (!area) return;
      const at = lineOffset(area.value, line);
      area.setSelectionRange(at, at);
      area.blur();
      area.focus();
    });
  };

  const closeMenu = () => menu.current?.removeAttribute("open");

  const openPublish = () => {
    const tomorrow = zonedParts(new Date(Date.now() + 86400000), zone);
    setDefaults({ date: tomorrow.date, time: "08:00" });
    setServerIssues(null);
    setDialog("publish");
  };

  const publish = async (when: string, markUpdated: boolean) => {
    setBusy(true);
    const saved = await flush();
    const result = saved ? await hold(publishArticle({ slug, rev: revRef.current, when, markUpdated })).catch(() => null) : null;
    setBusy(false);
    if (!result) return staleRef.current ? undefined : setNotice(labels.failed);
    if (!result.ok) {
      if (result.error === "issues") return setServerIssues(result.issues ?? []);
      if (gone(result.error)) return goStale();
      setDialog(null);
      return setNotice(result.error === "disabled" ? labels.publishDialog.disabled : labels.failed);
    }
    if (dirtyRef.current) {
      revRef.current = result.rev;
      setRev(result.rev);
    } else adopt(result.draft, result.rev);
    setLiveRev(result.rev);
    setStatus("PUBLISHED");
    setPublishAt(result.publishAt);
    setScheduled(new Date(result.publishAt).getTime() > Date.now());
    setDialog(null);
  };

  const settle = (result: { ok: false; error: string } | null) => (result && gone(result.error) ? goStale() : staleRef.current ? undefined : setNotice(labels.failed));

  const unpublish = async () => {
    closeMenu();
    if (!confirm(labels.confirmUnpublish)) return;
    setBusy(true);
    const saved = await flush();
    const result = saved ? await hold(unpublishArticle({ slug, rev: revRef.current })).catch(() => null) : null;
    setBusy(false);
    if (!result?.ok) return settle(result);
    adopt(result.draft, result.rev);
    setStatus("DRAFT");
    setLiveRev(null);
    setPublishAt(null);
    setScheduled(false);
  };

  const remove = async () => {
    closeMenu();
    if (!confirm(labels.confirmDelete)) return;
    setBusy(true);
    const saved = await flush();
    const result = saved ? await hold(deleteArticle({ slug, rev: revRef.current })).catch(() => null) : null;
    if (result?.ok) {
      staleRef.current = true;
      startNavigation();
      return router.push("/marketing/blog");
    }
    setBusy(false);
    settle(result);
  };

  const discard = async () => {
    closeMenu();
    if (!confirm(labels.confirmDiscard)) return;
    setBusy(true);
    const saved = await flush();
    const result = saved ? await hold(discardChanges({ slug, rev: revRef.current })).catch(() => null) : null;
    setBusy(false);
    if (!result?.ok) return settle(result);
    adopt(result.draft, result.rev);
    setLiveRev(result.rev);
  };

  const openHistory = () => {
    closeMenu();
    setRevisions(null);
    setDialog("history");
    void fetchRevisions(slug)
      .then(setRevisions)
      .catch(() => setRevisions([]));
  };

  const restore = async (id: string) => {
    if (!confirm(labels.confirmRestore)) return;
    setBusy(true);
    const saved = await flush();
    const result = saved ? await hold(restoreRevision({ slug, rev: revRef.current, id })).catch(() => null) : null;
    setBusy(false);
    if (!result?.ok) return settle(result);
    adopt(result.draft, result.rev);
    setDialog(null);
  };

  const openPreview = async () => {
    setLink(null);
    setDialog("preview");
    if (errorCount > 0) return;
    const saved = await flush();
    const result = saved ? await createPreviewLink(slug).catch(() => null) : null;
    if (result?.ok) return setLink(result);
    setDialog(null);
    if (!staleRef.current) setNotice(labels.failed);
  };

  const replaceText = async (sources: File[], pictures: File[]) => {
    if (sources.length > 2) return setNotice(labels.reimport.many);
    if (sources.some((file) => file.size > sourceMaxBytes)) return setNotice(labels.reimport.tooLarge);
    const intake = readSources(await Promise.all(sources.map(async (file) => ({ name: file.name, text: await file.text() }))));
    if (intake.many) return setNotice(labels.reimport.many);
    if (!intake.handoff?.zh && !intake.handoff?.en) return setNotice(labels.reimport.none);
    if (!confirm(labels.reimport.confirm)) return;
    setBusy(true);
    const saved = await flush();
    const result = saved ? await hold(reimportArticle({ slug, rev: revRef.current, sources: intake.used.map((source) => source.text) })).catch(() => null) : null;
    setBusy(false);
    if (!result?.ok) return settle(result);
    adopt(result.draft, result.rev);
    setNotice(null);
    void upload(pictures, false);
  };

  const over = useFileDrop((files, target) => {
    if (staleRef.current || busy) return;
    const sources = files.filter((file) => fileKind(file.name, file.type) === "source");
    const pictures = files.filter((file) => fileKind(file.name, file.type) === "image");
    if (sources.length) void replaceText(sources, pictures);
    else void upload(pictures, target === body.current);
  });

  const saveLabel = { saved: labels.saved, dirty: labels.unsaved, saving: labels.saving, error: labels.saveFailed, stale: labels.stale }[saveState];
  const heading = draft[uiLocale].title || draft.zh.title || draft.en.title || slug;
  const mode: PublishMode = !live ? "first" : scheduled ? "scheduled" : "live";
  const dates = [draft.published ? `${labels.published} ${draft.published}` : "", draft.updated ? `${labels.updated} ${draft.updated}` : ""].filter(Boolean).join(" · ");
  const tools: Array<{ key: string; face: string; title: string; run: (selection: Selection) => Edit }> = [
    { key: "bold", face: "B", title: labels.toolbar.bold, run: (selection) => wrapSelection(selection, "**", "**", labels.toolbar.boldText) },
    { key: "italic", face: "I", title: labels.toolbar.italic, run: (selection) => wrapSelection(selection, "*", "*", labels.toolbar.italicText) },
    { key: "h2", face: "H2", title: labels.toolbar.h2, run: (selection) => prefixLines(selection, () => "## ", labels.toolbar.heading) },
    { key: "h3", face: "H3", title: labels.toolbar.h3, run: (selection) => prefixLines(selection, () => "### ", labels.toolbar.heading) },
    { key: "ul", face: "•", title: labels.toolbar.ul, run: (selection) => prefixLines(selection, () => "- ", labels.toolbar.item) },
    { key: "ol", face: "1.", title: labels.toolbar.ol, run: (selection) => prefixLines(selection, (index) => `${index + 1}. `, labels.toolbar.item) },
    { key: "quote", face: "❝", title: labels.toolbar.quote, run: (selection) => prefixLines(selection, () => "> ", labels.toolbar.quoteText) },
    {
      key: "table",
      face: labels.toolbar.table,
      title: labels.toolbar.table,
      run: (selection) => insertBlock(selection, `| ${labels.toolbar.tableHead} | ${labels.toolbar.tableHead} |\n| --- | --- |\n| ${labels.toolbar.tableCell} | ${labels.toolbar.tableCell} |`, 2, labels.toolbar.tableHead.length),
    },
    {
      key: "callout",
      face: labels.toolbar.callout,
      title: labels.toolbar.callout,
      run: (selection) => insertBlock(selection, `:::callout ${labels.toolbar.calloutTitle}\n${labels.toolbar.calloutBody}\n:::`, 11, labels.toolbar.calloutTitle.length),
    },
  ];
  const addLink = () => {
    const url = prompt(labels.toolbar.linkPrompt, "https://");
    if (url) applyEdit((selection) => wrapSelection(selection, "[", `](${url.trim()})`, labels.toolbar.linkText));
  };

  return (
    <div>
      <DropVeil show={over} label={labels.media.drop} />
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="truncate text-[1.35rem] leading-tight font-semibold tracking-tight">{heading}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span className="font-mono">/blog/{slug}</span>
            <Badge tone={!live ? "neutral" : scheduled ? "info" : "success"}>{!live ? labels.status.draft : scheduled ? labels.status.scheduled : labels.status.published}</Badge>
            {scheduled && publishAt && <span className="tabular-nums">{formatDateTime(publishAt)}</span>}
            {dirtyLive && <Badge tone="gold">{labels.status.dirty}</Badge>}
            {live && !scheduled && (
              <a href={`${siteOrigin}/${uiLocale}/blog/${slug}`} target="_blank" rel="noreferrer" className="hover:text-ink">
                {labels.open} ↗
              </a>
            )}
          </p>
        </div>
        <span aria-live="polite" className={cn("text-[13px]", saveState === "error" || stale ? "text-status-danger" : "text-muted")}>
          {saveLabel}
        </span>
        {stale ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => location.reload()}>
            {labels.reload}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="secondary" disabled={frozen} onClick={() => void flush(true)}>
            {labels.save}
          </Button>
        )}
        {siteEnabled && (
          <Button type="button" size="sm" variant="secondary" disabled={frozen} onClick={() => void openPreview()}>
            {labels.sitePreview}
          </Button>
        )}
        {!siteEnabled && <span className="text-[12px] text-muted">{labels.publishDialog.disabled}</span>}
        <Button type="button" size="sm" disabled={frozen || !siteEnabled || (live && !dirtyLive && !scheduled)} onClick={openPublish}>
          {live ? labels.publishUpdate : labels.publish}
        </Button>
        <details ref={menu} className="relative">
          <summary aria-label={labels.more} className="flex h-9 w-9 list-none items-center justify-center rounded-pill text-lg hairline hover:border-ink/25">
            ⋯
          </summary>
          <div className="card absolute top-full right-0 z-20 mt-2 flex w-40 flex-col p-1.5 text-sm">
            <button type="button" className="rounded-lg px-3 py-2 text-left hover:bg-ink/5" onClick={openHistory}>
              {labels.history}
            </button>
            {dirtyLive && (
              <button type="button" disabled={frozen} className="rounded-lg px-3 py-2 text-left hover:bg-ink/5" onClick={() => void discard()}>
                {labels.discard}
              </button>
            )}
            {live ? (
              <button type="button" disabled={frozen} className="rounded-lg px-3 py-2 text-left text-status-danger hover:bg-status-danger/5" onClick={() => void unpublish()}>
                {labels.unpublish}
              </button>
            ) : (
              <button type="button" disabled={frozen} className="rounded-lg px-3 py-2 text-left text-status-danger hover:bg-status-danger/5" onClick={() => void remove()}>
                {labels.remove}
              </button>
            )}
          </div>
        </details>
      </div>

      {notice && (
        <button type="button" role="alert" onClick={() => setNotice(null)} className="mb-4 block w-full rounded-xl border border-status-danger/25 bg-status-danger/5 px-4 py-2.5 text-left text-sm text-status-danger">
          {notice}
        </button>
      )}

      <fieldset disabled={stale} className="m-0 min-w-0 border-0 p-0">
        <div className="card mb-5 grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-[11rem_minmax(0,1fr)_10.5rem_10.5rem_9rem]">
          <Field id="category" label={labels.settings.category}>
            <Select id="category" value={draft.category} onChange={(event) => patch({ category: event.target.value as BlogCategory })}>
              {blogCategories.map((key) => (
                <option key={key} value={key}>
                  {categoryLabels[key] ?? key}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="tags" label={labels.settings.tags}>
            <TagPicker id="tags" tags={tags} selected={draft.tags} hints={draft.tagHints ?? []} locale={uiLocale} labels={labels.settings} onChange={(next) => patch({ tags: next })} onHints={(next) => patch({ tagHints: next })} onCreated={(tag) => setTags((list) => [...list, tag].sort((a, b) => a.id.localeCompare(b.id)))} />
          </Field>
          <Field id="published" label={labels.settings.published}>
            <Input id="published" type="date" max="9999-12-31" value={draft.published ?? ""} onChange={(event) => patch({ published: event.target.value || null })} />
          </Field>
          <Field id="updated" label={labels.settings.updated}>
            <Input id="updated" type="date" max="9999-12-31" value={draft.updated ?? ""} onChange={(event) => patch({ updated: event.target.value || null })} />
          </Field>
          <Field id="cover" label={labels.settings.cover}>
            <button id="cover" type="button" onClick={() => setSide("media")} className="relative flex h-11 items-center justify-center overflow-hidden rounded-xl border border-ink/10 bg-pearl text-[13px] text-muted hover:border-gold/60">
              {draft.cover ? <Image src={draft.cover.src.startsWith("/") ? `${siteOrigin}${draft.cover.src}` : draft.cover.src} alt="" fill unoptimized sizes="9rem" className="object-cover" /> : labels.settings.choose}
            </button>
          </Field>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="card flex min-w-0 flex-col gap-4 p-5">
            <nav className="flex flex-wrap gap-2">
              {(["zh", "en"] as const).map((key) => (
                <button key={key} type="button" aria-pressed={locale === key} onClick={() => setLocale(key)} className={cn(tab, locale === key && "bg-ink text-white")}>
                  {labels.tabs[key]}
                </button>
              ))}
            </nav>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="title" label={labels.fields.title} className="sm:col-span-2">
                <Input id="title" value={fields.title} maxLength={200} onChange={(event) => patchLocale({ title: event.target.value })} />
              </Field>
              <Field id="excerpt" label={labels.fields.excerpt} count={displayWidth(fields.excerpt)} limit={fieldLimits.excerpt} className="sm:col-span-2">
                <Textarea id="excerpt" rows={2} style={compact} value={fields.excerpt} maxLength={600} onChange={(event) => patchLocale({ excerpt: event.target.value })} />
              </Field>
              <Field id="seoTitle" label={labels.fields.seoTitle} count={displayWidth(fields.seoTitle)} limit={fieldLimits.seoTitle}>
                <Input id="seoTitle" value={fields.seoTitle} maxLength={200} onChange={(event) => patchLocale({ seoTitle: event.target.value })} />
              </Field>
              <Field id="kicker" label={labels.fields.kicker}>
                <Input id="kicker" value={fields.kicker} maxLength={80} onChange={(event) => patchLocale({ kicker: event.target.value })} />
              </Field>
              <Field id="seoDescription" label={labels.fields.seoDescription} count={displayWidth(fields.seoDescription)} limit={fieldLimits.seoDescription}>
                <Textarea id="seoDescription" rows={2} style={compact} value={fields.seoDescription} maxLength={400} onChange={(event) => patchLocale({ seoDescription: event.target.value })} />
              </Field>
              <Field id="line" label={labels.fields.line}>
                <Input id="line" value={fields.line} maxLength={160} onChange={(event) => patchLocale({ line: event.target.value })} />
              </Field>
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-0.5 rounded-xl border border-ink/10 bg-pearl/50 p-1">
                {tools.map((item) => (
                  <button key={item.key} type="button" title={item.title} aria-label={item.title} className={cn(tool, item.key === "bold" && "font-semibold", item.key === "italic" && "italic")} onClick={() => applyEdit(item.run)}>
                    {item.face}
                  </button>
                ))}
                <button type="button" title={labels.toolbar.link} className={tool} onClick={addLink}>
                  {labels.toolbar.link}
                </button>
                <button type="button" title={labels.toolbar.image} className={tool} onClick={() => pick(true)}>
                  {labels.toolbar.image}
                </button>
                {uploading > 0 && <span className="ml-2 text-[12px] text-muted">{labels.media.uploading}</span>}
              </div>
              <textarea
                key={locale}
                ref={body}
                aria-label={labels.fields.body}
                spellCheck={false}
                value={fields.markdown}
                maxLength={200000}
                onChange={(event) => patchLocale({ markdown: event.target.value })}
                onPaste={(event) => {
                  const files = images(event.clipboardData.files);
                  if (!files.length || event.clipboardData.getData("text/plain").trim()) return;
                  event.preventDefault();
                  void upload(files, true);
                }}
                className="block min-h-[60vh] w-full resize-y rounded-xl border border-ink/10 bg-white px-4 py-3 text-[15px] leading-[1.75] text-ink focus:border-gold/60 focus:ring-4 focus:ring-gold/10 focus:outline-none disabled:opacity-60"
              />
            </div>
          </section>

          <section className="card min-w-0 p-5 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:self-start xl:overflow-auto">
            <nav className="mb-5 flex flex-wrap gap-2">
              {(searchTab && status === "PUBLISHED" ? (["preview", "issues", "media", "queries"] as const) : (["preview", "issues", "media"] as const)).map((key) => (
                <button key={key} type="button" aria-pressed={side === key} onClick={() => setSide(key)} className={cn(tab, side === key && "bg-ink text-white")}>
                  {labels.tabs[key]}
                  {key === "issues" && check.issues.length > 0 && <span className={cn("ml-1.5 tabular-nums", errorCount > 0 && side !== key && "text-status-danger")}>{check.issues.length}</span>}
                  {key === "media" && media.length > 0 && <span className="ml-1.5 tabular-nums">{media.length}</span>}
                </button>
              ))}
            </nav>
            {side === "preview" && (
              <ArticlePreview
                category={categoryLabels[deferred.category] ?? deferred.category}
                title={deferred[locale].title}
                excerpt={deferred[locale].excerpt}
                kicker={deferred[locale].kicker}
                line={deferred[locale].line}
                cover={deferred.cover}
                dates={dates}
                blocks={check.compiled[locale].blocks}
                siteOrigin={siteOrigin}
                locale={locale}
                empty={labels.previewEmpty}
              />
            )}
            {side === "issues" && <IssueList issues={check.issues} labels={labels} issueLabels={issueLabels} onPick={jump} />}
            {side === "queries" && <QueryPanel slug={slug} labels={labels.queries} />}
            {side === "media" && (
              <MediaPanel
                media={media}
                cover={draft.cover}
                uploading={uploading > 0}
                siteOrigin={siteOrigin}
                labels={labels.media}
                onUpload={() => pick(false)}
                onInsert={(item) => insertImage(item.src)}
                onCover={(item) => patch({ cover: toImageRef(item) })}
                onRemove={(item) => void dropMedia(item)}
              />
            )}
          </section>
        </div>
      </fieldset>

      <input
        ref={picker}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        aria-label={labels.media.upload}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const files = images(event.currentTarget.files);
          event.currentTarget.value = "";
          void upload(files, inline.current);
        }}
      />

      <Modal open={dialog === "publish"} locked={busy} onClose={() => setDialog(null)}>
        <PublishForm mode={mode} defaults={defaults} issues={serverIssues ?? check.issues} pending={busy} labels={labels} issueLabels={issueLabels} onConfirm={(when, markUpdated) => void publish(when, markUpdated)} onCancel={() => setDialog(null)} />
      </Modal>
      <Modal open={dialog === "history"} locked={busy} onClose={() => setDialog(null)}>
        <HistoryList revisions={revisions} pending={busy} labels={labels} onRestore={(id) => void restore(id)} onClose={() => setDialog(null)} />
      </Modal>
      <Modal open={dialog === "preview"} onClose={() => setDialog(null)} wide>
        <PreviewLinks link={link} issues={check.issues} labels={labels} issueLabels={issueLabels} onClose={() => setDialog(null)} />
      </Modal>
    </div>
  );
}
