"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Select } from "@/components/ui/Field";
import { startNavigation } from "@/components/ui/NavigationProgress";
import type { MarketingMessages } from "@/features/marketing/i18n";
import { fill } from "@/features/marketing/text";
import { cn } from "@/lib/utils/cn";
import { blogCategories } from "./blocks";
import { useFileDrop } from "./file-drop";
import { DropVeil, newArticleKey } from "./DropVeil";
import { createArticle } from "./editor-actions";
import { coverFile, fileKind, intakeMaxFiles, missingImages, readSources, sourceMaxBytes, suggestCategory, suggestSlug, type Source } from "./intake";
import { holdFiles, takeFiles } from "./pending";

type Labels = MarketingMessages["blog"]["create"];

type Picture = { file: File; url: string };

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function CreateForm({ labels, categories }: { labels: Labels; categories: Record<string, string> }) {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]);
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [pending, start] = useTransition();
  const filePicker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const made = urls.current;
    return () => {
      for (const url of made) URL.revokeObjectURL(url);
      made.clear();
    };
  }, []);

  const intake = useMemo(() => readSources(sources), [sources]);
  const handoff = intake.handoff;
  const names = pictures.map((picture) => picture.file.name);
  const slugValue = slug ?? suggestSlug(handoff, sources.map((source) => source.name));
  const categoryValue = category ?? suggestCategory(handoff) ?? "tips";
  const sizes = { zh: handoff?.zh?.markdown.length ?? 0, en: handoff?.en?.markdown.length ?? 0 };
  const titles = [handoff?.zh?.title, handoff?.en?.title].filter((title): title is string => Boolean(title));
  const missing = handoff ? missingImages(handoff.images, names) : [];
  const cover = coverFile(handoff, names);
  const busy = pending || leaving;

  const add = async (incoming: File[]) => {
    const texts = new Map<string, Source>();
    const shots = new Map<string, Picture>();
    let problem: string | null = null;
    for (const file of incoming.slice(0, intakeMaxFiles)) {
      const kind = fileKind(file.name, file.type);
      if (kind === "source") {
        if (file.size > sourceMaxBytes) problem = labels.errors.tooLarge;
        else texts.set(file.name.toLowerCase(), { name: file.name, text: await file.text() });
      } else if (kind === "image") {
        const url = URL.createObjectURL(file);
        urls.current.add(url);
        shots.set(file.name.toLowerCase(), { file, url });
      }
    }
    const nextSources = [...texts.values()];
    const nextPictures = [...shots.values()];
    if (nextSources.length) setSources((current) => [...current.filter((source) => !nextSources.some((next) => sameName(next.name, source.name))), ...nextSources]);
    if (nextPictures.length) setPictures((current) => [...current.filter((picture) => !nextPictures.some((next) => sameName(next.file.name, picture.file.name))), ...nextPictures]);
    setError(problem);
  };

  const over = useFileDrop((files) => void add(files));

  const addHeld = useEffectEvent((files: File[]) => void add(files));

  useEffect(() => {
    const files = takeFiles(newArticleKey);
    if (files.length) queueMicrotask(() => addHeld(files));
  }, []);

  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void add(files);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || intake.many) return;
    setError(null);
    start(async () => {
      const result = await createArticle({ slug: slugValue, category: categoryValue, sources: intake.used.map((source) => source.text) }).catch(() => null);
      if (!result?.ok) {
        setError(labels.errors[result?.error ?? "failed"]);
        return;
      }
      holdFiles(
        result.slug,
        pictures.map((picture) => picture.file),
      );
      setLeaving(true);
      startNavigation();
      router.push(`/marketing/blog/${result.slug}`);
    });
  };

  return (
    <form onSubmit={submit} autoComplete="off" className="card flex max-w-3xl flex-col gap-5 p-6">
      <DropVeil show={over} label={labels.drop} />
      <div className={cn("flex flex-col items-center gap-3 rounded-xl border border-dashed px-5 py-8 text-center transition-colors", over ? "border-gold bg-gold/5" : "border-ink/15 bg-pearl/60")}>
        <p className="text-sm text-charcoal">{labels.drop}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => filePicker.current?.click()}>
            {labels.chooseFiles}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => folderPicker.current?.click()}>
            {labels.chooseFolder}
          </Button>
        </div>
      </div>

      {sources.length > 0 && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2">
            {sources.map((source) => (
              <li key={source.name} className="flex items-center justify-between gap-3 rounded-xl border border-ink/10 px-3.5 py-2.5 text-sm">
                <span className="min-w-0 truncate font-medium">{source.name}</span>
                <button type="button" aria-label={`${labels.remove} ${source.name}`} onClick={() => setSources((current) => current.filter((item) => item.name !== source.name))} className="shrink-0 px-1 text-base leading-none text-muted hover:text-status-danger">
                  ×
                </button>
              </li>
            ))}
          </ul>
          {intake.many ? (
            <p role="alert" className="text-sm text-status-danger">
              {labels.errors.many}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5 text-[13px] text-muted">
              {titles.map((title, index) => (
                <p key={`${index}:${title}`} className="truncate text-charcoal">
                  {title}
                </p>
              ))}
              <p>{sizes.zh || sizes.en ? fill(labels.found, sizes) : labels.foundNone}</p>
            </div>
          )}
        </div>
      )}

      {pictures.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-muted">{fill(labels.pictures, { count: pictures.length })}</p>
          <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
            {pictures.map((picture) => {
              const isCover = picture.file.name === cover;
              return (
                <li key={picture.url} className="relative min-w-0">
                  <div className={cn("relative aspect-[16/10] overflow-hidden rounded-lg bg-pearl", isCover && "ring-2 ring-gold")}>
                    <Image src={picture.url} alt="" fill unoptimized sizes="9rem" className="object-cover" />
                    {isCover && <span className="absolute bottom-1 left-1 rounded-pill bg-gold px-1.5 py-0.5 text-[10px] font-medium text-white">{labels.cover}</span>}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted">{picture.file.name}</p>
                  <button type="button" aria-label={`${labels.remove} ${picture.file.name}`} onClick={() => setPictures((current) => current.filter((item) => item.url !== picture.url))} className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-ink/60 text-xs leading-none text-white hover:bg-ink">
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {missing.length > 0 && <p className="text-[13px] text-status-limited">{fill(labels.missing, { count: missing.length, names: missing.join("、") })}</p>}

      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <FieldWrap label={labels.slug} htmlFor="slug">
          <div className="flex h-11 items-center rounded-xl border border-ink/10 bg-white text-sm transition-[border-color,box-shadow] focus-within:border-gold/60 focus-within:ring-4 focus-within:ring-gold/10">
            <span className="pl-3.5 text-muted select-none">/blog/</span>
            <input id="slug" name="slug" required maxLength={120} pattern="[a-z0-9]+(-[a-z0-9]+)*" spellCheck={false} value={slugValue} onChange={(event) => setSlug(event.target.value.toLowerCase())} className="h-full min-w-0 flex-1 rounded-r-xl bg-transparent pr-3.5 text-ink focus:outline-none" />
          </div>
        </FieldWrap>
        <FieldWrap label={labels.category} htmlFor="category">
          <Select id="category" name="category" value={categoryValue} onChange={(event) => setCategory(event.target.value)}>
            {blogCategories.map((key) => (
              <option key={key} value={key}>
                {categories[key] ?? key}
              </option>
            ))}
          </Select>
        </FieldWrap>
      </div>

      {error && (
        <p role="alert" className="text-sm text-status-danger">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" disabled={busy || intake.many}>
          {labels.submit}
        </Button>
      </div>

      <input ref={filePicker} type="file" multiple accept=".md,.markdown,.mdx,.txt,image/jpeg,image/png,image/webp" aria-label={labels.chooseFiles} className="sr-only" tabIndex={-1} onChange={picked} />
      <input ref={folderPicker} type="file" multiple aria-label={labels.chooseFolder} className="sr-only" tabIndex={-1} onChange={picked} {...{ webkitdirectory: "" }} />
    </form>
  );
}
