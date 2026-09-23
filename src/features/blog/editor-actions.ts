"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { blogSiteEnabled } from "@/features/marketing/config";
import { audit } from "@/lib/audit";
import { requirePermission, type StaffSession } from "@/lib/auth/staff";
import { supabaseUrl, websiteOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { getArticle, imageLookup, listRevisions, revisionLimit, type ArticleRow, type RevisionSummary } from "./articles";
import { blogCategories, emptyLocaleDraft, reservedSlugs, slugPattern, tagPattern, type ArticleDraft, type BlogCategory, type LiveArticle, type LocaleDraft } from "./blocks";
import { draftSchema, emptyDraft } from "./draft";
import { mergeHandoffs, splitHandoff, type HandoffLocale } from "./handoff";
import { matchTags, pairTags, sourceMaxChars } from "./intake";
import { baseName, mediaBucket, mediaMaxBytes, mediaPublicBase, mediaTypes, relinkImages, splitLeadImage, type MediaItem } from "./media";
import { buildLive, laDate, type PublishIssue } from "./publish";

const listPath = "/ops/marketing/blog";

type Admin = ReturnType<typeof createAdminClient>;

const who = (session: StaffSession) => ({ actorUserId: session.userId, actorType: "STAFF" as const, entityType: "blog_article" });

async function addRevision(supabase: Admin, session: StaffSession, slug: string, kind: "SAVE" | "PUBLISH" | "RESTORE" | "IMPORT", draft: ArticleDraft) {
  await supabase.from("blog_article_revisions").insert({ slug, kind, draft, created_by: session.userId, created_by_name: session.displayName });
  const { data: old } = await supabase.from("blog_article_revisions").select("id").eq("slug", slug).order("created_at", { ascending: false }).range(revisionLimit, revisionLimit + 200);
  if (old?.length) await supabase.from("blog_article_revisions").delete().in("id", old.map((row) => row.id));
}

export type CreateResult = { ok: true; slug: string } | { ok: false; error: "invalid" | "taken" | "failed" };

function localeFromHandoff(source: HandoffLocale | null): { fields: LocaleDraft; lead: string | null } {
  if (!source) return { fields: { ...emptyLocaleDraft }, lead: null };
  const body = splitLeadImage(source.markdown);
  return {
    fields: {
      ...emptyLocaleDraft,
      title: (source.title ?? "").slice(0, 200),
      seoTitle: (source.seoTitle ?? "").slice(0, 200),
      seoDescription: (source.seoDescription ?? "").slice(0, 400),
      excerpt: (source.excerpt ?? "").slice(0, 600),
      kicker: (source.kicker ?? "").slice(0, 80),
      line: (source.line ?? "").slice(0, 160),
      markdown: body.markdown.slice(0, 200000),
    },
    lead: body.lead,
  };
}

async function draftFromHandoff(supabase: Admin, category: BlogCategory, sources: string[]): Promise<ArticleDraft> {
  const handoff = mergeHandoffs(sources.map(splitHandoff));
  const { data: known } = await supabase.from("blog_tags").select("id, label_zh, label_en").limit(500);
  const { tags, hints } = matchTags(pairTags(handoff.tags), (known ?? []) as Array<{ id: string; label_zh: string; label_en: string }>);
  const zh = localeFromHandoff(handoff.zh);
  const en = localeFromHandoff(handoff.en);
  const hint = baseName(zh.lead ?? en.lead ?? "").slice(0, 200);
  return { ...emptyDraft(category), tags, ...(hint ? { coverHint: hint } : {}), ...(hints.length ? { tagHints: hints } : {}), zh: zh.fields, en: en.fields };
}

const createInput = z.object({ slug: z.string().regex(slugPattern).max(120), category: z.enum(blogCategories), sources: z.array(z.string().max(sourceMaxChars)).max(2) });

export async function createArticle(input: { slug: string; category: string; sources: string[] }): Promise<CreateResult> {
  const session = await requirePermission("blog.manage");
  const parsed = createInput.safeParse({ slug: String(input.slug ?? "").trim().toLowerCase(), category: input.category, sources: input.sources });
  if (!parsed.success || reservedSlugs.includes(parsed.data.slug)) return { ok: false, error: "invalid" };
  const { slug, category } = parsed.data;
  const sources = parsed.data.sources.filter((source) => source.trim());
  const supabase = createAdminClient();
  const [{ data: article }, { data: post }] = await Promise.all([supabase.from("blog_articles").select("slug").eq("slug", slug).maybeSingle(), supabase.from("blog_posts").select("slug").eq("slug", slug).eq("source", "site").maybeSingle()]);
  if (article || post) return { ok: false, error: "taken" };
  const draft = sources.length ? await draftFromHandoff(supabase, category, sources) : emptyDraft(category);
  const { error } = await supabase.from("blog_articles").insert({ slug, category, title_zh: draft.zh.title, title_en: draft.en.title, draft, created_by: session.userId, updated_by: session.userId });
  if (error) return { ok: false, error: error.code === "23505" ? "taken" : "failed" };
  if (sources.length) await addRevision(supabase, session, slug, "IMPORT", draft);
  await audit({ ...who(session), action: "blog.article_created", entityId: slug, metadata: { by: session.displayName, category } });
  revalidatePath(listPath, "layout");
  return { ok: true, slug };
}

type Failure = "invalid" | "stale" | "missing" | "failed";

export type SaveResult = { ok: true; rev: number } | { ok: false; error: Failure };

const slugInput = z.string().regex(slugPattern).max(120);

const revInput = z.object({ slug: slugInput, rev: z.number().int().min(1) });

async function writeDraft(supabase: Admin, session: StaffSession, slug: string, rev: number, draft: ArticleDraft, extra: Record<string, unknown> = {}): Promise<SaveResult> {
  const { data, error } = await supabase
    .from("blog_articles")
    .update({ draft, category: draft.category, title_zh: draft.zh.title.trim(), title_en: draft.en.title.trim(), rev: rev + 1, updated_by: session.userId, updated_at: new Date().toISOString(), ...extra })
    .eq("slug", slug)
    .eq("rev", rev)
    .select("rev")
    .maybeSingle();
  if (error) return { ok: false, error: "failed" };
  if (data) return { ok: true, rev: data.rev as number };
  const { data: exists } = await supabase.from("blog_articles").select("slug").eq("slug", slug).maybeSingle();
  return { ok: false, error: exists ? "stale" : "missing" };
}

export async function saveDraft(input: { slug: string; rev: number; draft: unknown }): Promise<SaveResult> {
  const session = await requirePermission("blog.manage");
  const meta = revInput.safeParse({ slug: input.slug, rev: input.rev });
  const draft = draftSchema.safeParse(input.draft);
  if (!meta.success || !draft.success) return { ok: false, error: "invalid" };
  return writeDraft(createAdminClient(), session, meta.data.slug, meta.data.rev, draft.data);
}

export async function saveCheckpoint(input: { slug: string; rev: number }): Promise<SaveResult> {
  const session = await requirePermission("blog.manage");
  const parsed = revInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const row = await getArticle(parsed.data.slug);
  if (!row) return { ok: false, error: "missing" };
  if (row.rev !== parsed.data.rev) return { ok: false, error: "stale" };
  await addRevision(createAdminClient(), session, row.slug, "SAVE", row.draft);
  return { ok: true, rev: row.rev };
}

export async function currentRev(rawSlug: string): Promise<number | null> {
  await requirePermission("blog.manage");
  const slug = slugInput.safeParse(rawSlug);
  if (!slug.success) return null;
  const { data } = await createAdminClient().from("blog_articles").select("rev").eq("slug", slug.data).maybeSingle();
  return (data?.rev as number | undefined) ?? null;
}

export type PublishResult =
  | { ok: true; rev: number; publishAt: string; draft: ArticleDraft }
  | { ok: false; error: Failure | "issues" | "disabled"; issues?: PublishIssue[] };

const publishInput = z.object({
  slug: slugInput,
  rev: z.number().int().min(1),
  when: z.union([z.literal("now"), z.literal("keep"), z.iso.datetime({ offset: true })]),
  markUpdated: z.boolean(),
});

function summaryOf(live: LiveArticle) {
  const strip = (locale: LiveArticle["zh"]) => Object.fromEntries(Object.entries(locale).filter(([key]) => key !== "blocks"));
  return { ...live, zh: strip(live.zh), en: strip(live.en) };
}

function publishInstant(row: ArticleRow, when: string, now: Date) {
  if (when === "keep" && row.publish_at) return new Date(row.publish_at);
  if (when === "now" || when === "keep") return now;
  const chosen = new Date(when);
  const ahead = chosen.getTime() - now.getTime();
  return Number.isNaN(ahead) || ahead > 366 * 86400000 ? null : ahead < 0 ? now : chosen;
}

export async function publishArticle(input: { slug: string; rev: number; when: string; markUpdated: boolean }): Promise<PublishResult> {
  const session = await requirePermission("blog.manage");
  if (!blogSiteEnabled()) return { ok: false, error: "disabled" };
  const parsed = publishInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { slug, rev, when, markUpdated } = parsed.data;
  const row = await getArticle(slug);
  if (!row) return { ok: false, error: "missing" };
  if (row.rev !== rev || (when === "keep" && row.status !== "PUBLISHED")) return { ok: false, error: "stale" };
  const now = new Date();
  const wasLive = row.status === "PUBLISHED" && Boolean(row.publish_at) && new Date(row.publish_at as string) <= now;
  const publishAt = wasLive ? new Date(row.publish_at as string) : publishInstant(row, when, now);
  if (!publishAt) return { ok: false, error: "invalid" };
  const today = laDate(now);
  const goLive = laDate(publishAt);
  const planned = !wasLive && row.status === "PUBLISHED" && row.publish_at ? laDate(new Date(row.publish_at)) : null;
  const typed = row.draft.published && row.draft.published !== planned ? row.draft.published : null;
  const lookup = await imageLookup(slug);
  const draft: ArticleDraft = {
    ...row.draft,
    cover: row.draft.cover ? lookup(row.draft.cover.src) : null,
    published: wasLive ? (row.draft.published ?? goLive) : typed && typed <= goLive ? typed : goLive,
    updated: wasLive && markUpdated ? today : row.draft.updated,
  };
  const { live, issues } = buildLive(draft, lookup, today);
  if (!live) return { ok: false, error: "issues", issues };
  const supabase = createAdminClient();
  const saved = await writeDraft(supabase, session, slug, rev, draft, { status: "PUBLISHED", live, live_summary: summaryOf(live), live_draft: draft, publish_at: publishAt.toISOString(), live_rev: rev + 1, catalog_synced: false });
  if (!saved.ok) return { ok: false, error: saved.error };
  await supabase.rpc("blog_sync_catalog");
  await addRevision(supabase, session, slug, "PUBLISH", draft);
  await audit({ ...who(session), action: wasLive ? "blog.article_updated" : publishAt > now ? "blog.article_scheduled" : "blog.article_published", entityId: slug, metadata: { by: session.displayName, publishAt: publishAt.toISOString() } });
  revalidatePath(listPath, "layout");
  return { ok: true, rev: saved.rev, publishAt: publishAt.toISOString(), draft };
}

export type DraftResult = { ok: true; rev: number; draft: ArticleDraft } | { ok: false; error: Failure };

export async function unpublishArticle(input: { slug: string; rev: number }): Promise<DraftResult> {
  const session = await requirePermission("blog.manage");
  const parsed = revInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { slug, rev } = parsed.data;
  const row = await getArticle(slug);
  if (!row || row.status !== "PUBLISHED") return { ok: false, error: "missing" };
  if (row.rev !== rev) return { ok: false, error: "stale" };
  const neverLive = Boolean(row.publish_at) && new Date(row.publish_at as string) > new Date();
  const draft: ArticleDraft = neverLive && row.draft.published === laDate(new Date(row.publish_at as string)) ? { ...row.draft, published: null } : row.draft;
  const supabase = createAdminClient();
  const saved = await writeDraft(supabase, session, slug, rev, draft, { status: "DRAFT", live: null, live_summary: null, live_draft: null, publish_at: null, live_rev: null, catalog_synced: false });
  if (!saved.ok) return saved;
  await supabase.from("blog_posts").update({ hidden: true, featured: false, featured_at: null }).eq("slug", slug).eq("source", "cms");
  await audit({ ...who(session), action: "blog.article_unpublished", entityId: slug, metadata: { by: session.displayName } });
  revalidatePath(listPath, "layout");
  return { ok: true, rev: saved.rev, draft };
}

export type SimpleResult = { ok: true } | { ok: false; error: Failure | "published" | "in_use" };

export async function deleteArticle(input: { slug: string; rev: number }): Promise<SimpleResult> {
  const session = await requirePermission("blog.manage");
  const parsed = revInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { slug, rev } = parsed.data;
  const supabase = createAdminClient();
  const { data: row } = await supabase.from("blog_articles").select("status, rev, title_zh, title_en").eq("slug", slug).maybeSingle();
  if (!row) return { ok: false, error: "missing" };
  if (row.status !== "DRAFT") return { ok: false, error: "published" };
  if (row.rev !== rev) return { ok: false, error: "stale" };
  const { data: removed, error } = await supabase.from("blog_articles").delete().eq("slug", slug).eq("status", "DRAFT").eq("rev", rev).select("slug");
  if (error) return { ok: false, error: "failed" };
  if (!removed?.length) return { ok: false, error: "stale" };
  const { data: files } = await supabase.storage.from(mediaBucket).list(slug, { limit: 1000 });
  if (files?.length) await supabase.storage.from(mediaBucket).remove(files.map((file) => `${slug}/${file.name}`));
  await audit({ ...who(session), action: "blog.article_deleted", entityId: slug, metadata: { by: session.displayName, title: row.title_zh || row.title_en } });
  revalidatePath(listPath, "layout");
  return { ok: true };
}

export async function fetchRevisions(rawSlug: string): Promise<RevisionSummary[]> {
  await requirePermission("blog.manage");
  const slug = slugInput.safeParse(rawSlug);
  return slug.success ? listRevisions(slug.data) : [];
}

const revisionInput = z.object({ slug: slugInput, rev: z.number().int().min(1), id: z.uuid() });

export async function restoreRevision(input: { slug: string; rev: number; id: string }): Promise<DraftResult> {
  const session = await requirePermission("blog.manage");
  const parsed = revisionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = createAdminClient();
  const [{ data: revision }, row] = await Promise.all([supabase.from("blog_article_revisions").select("draft").eq("id", parsed.data.id).eq("slug", parsed.data.slug).maybeSingle(), getArticle(parsed.data.slug)]);
  const draft = draftSchema.safeParse(revision?.draft);
  if (!row || !revision || !draft.success) return { ok: false, error: "missing" };
  if (row.rev !== parsed.data.rev) return { ok: false, error: "stale" };
  await addRevision(supabase, session, parsed.data.slug, "SAVE", row.draft);
  const saved = await writeDraft(supabase, session, parsed.data.slug, parsed.data.rev, draft.data);
  if (!saved.ok) return saved;
  await addRevision(supabase, session, parsed.data.slug, "RESTORE", draft.data);
  await audit({ ...who(session), action: "blog.article_restored", entityId: parsed.data.slug, metadata: { by: session.displayName, revision: parsed.data.id } });
  return { ok: true, rev: saved.rev, draft: draft.data };
}

const reimportInput = z.object({ slug: slugInput, rev: z.number().int().min(1), sources: z.array(z.string().max(sourceMaxChars)).min(1).max(2) });

export async function reimportArticle(input: { slug: string; rev: number; sources: string[] }): Promise<DraftResult> {
  const session = await requirePermission("blog.manage");
  const parsed = reimportInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { slug, rev } = parsed.data;
  const row = await getArticle(slug);
  if (!row) return { ok: false, error: "missing" };
  if (row.rev !== rev) return { ok: false, error: "stale" };
  const supabase = createAdminClient();
  const fresh = await draftFromHandoff(supabase, row.draft.category, parsed.data.sources);
  if (!fresh.zh.markdown.trim() && !fresh.en.markdown.trim()) return { ok: false, error: "invalid" };
  const { data: media } = await supabase.from("blog_media").select("src, name").eq("slug", slug).limit(200);
  const relink = (markdown: string) => (media ?? []).reduce((text, item) => (item.name ? relinkImages(text, item.name as string, item.src as string) : text), markdown);
  const merge = (old: LocaleDraft, next: LocaleDraft): LocaleDraft =>
    next.markdown.trim()
      ? { title: next.title || old.title, seoTitle: next.seoTitle || old.seoTitle, seoDescription: next.seoDescription || old.seoDescription, excerpt: next.excerpt || old.excerpt, kicker: next.kicker || old.kicker, line: next.line || old.line, markdown: relink(next.markdown) }
      : old;
  const draft: ArticleDraft = { ...row.draft, ...(fresh.coverHint ? { coverHint: fresh.coverHint } : {}), ...(fresh.tagHints ? { tagHints: fresh.tagHints } : {}), zh: merge(row.draft.zh, fresh.zh), en: merge(row.draft.en, fresh.en) };
  await addRevision(supabase, session, slug, "SAVE", row.draft);
  const saved = await writeDraft(supabase, session, slug, rev, draft);
  if (!saved.ok) return saved;
  await addRevision(supabase, session, slug, "IMPORT", draft);
  await audit({ ...who(session), action: "blog.article_reimported", entityId: slug, metadata: { by: session.displayName } });
  return { ok: true, rev: saved.rev, draft };
}

export async function discardChanges(input: { slug: string; rev: number }): Promise<DraftResult> {
  const session = await requirePermission("blog.manage");
  const parsed = revInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = createAdminClient();
  const { data: row } = await supabase.from("blog_articles").select("rev, status, live_draft").eq("slug", parsed.data.slug).maybeSingle();
  const draft = draftSchema.safeParse(row?.live_draft);
  if (!row || row.status !== "PUBLISHED" || !draft.success) return { ok: false, error: "missing" };
  if (row.rev !== parsed.data.rev) return { ok: false, error: "stale" };
  const saved = await writeDraft(supabase, session, parsed.data.slug, parsed.data.rev, draft.data, { live_rev: parsed.data.rev + 1 });
  return saved.ok ? { ok: true, rev: saved.rev, draft: draft.data } : saved;
}

export type UploadTarget = { path: string; url: string } | null;

const uploadInput = z.object({ slug: slugInput, type: z.enum(mediaTypes), size: z.number().int().min(1).max(mediaMaxBytes) });

export async function createMediaUpload(input: { slug: string; type: string; size: number }): Promise<UploadTarget> {
  await requirePermission("blog.manage");
  const parsed = uploadInput.safeParse(input);
  if (!parsed.success) return null;
  const supabase = createAdminClient();
  const { data: article } = await supabase.from("blog_articles").select("slug").eq("slug", parsed.data.slug).maybeSingle();
  if (!article) return null;
  const { count } = await supabase.from("blog_media").select("id", { count: "exact", head: true }).eq("slug", parsed.data.slug);
  if ((count ?? 0) >= 120) return null;
  const path = `${parsed.data.slug}/${randomUUID()}.${parsed.data.type.split("/")[1].replace("jpeg", "jpg")}`;
  const { data } = await supabase.storage.from(mediaBucket).createSignedUploadUrl(path);
  return data ? { path, url: data.signedUrl } : null;
}

const mediaInput = z.object({
  width: z.number().int().min(1).max(20000),
  height: z.number().int().min(1).max(20000),
  blur: z.string().max(6000).regex(/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/).nullable(),
  name: z.string().max(200).nullable(),
});

export async function saveMedia(input: { slug: string; path: string; width: number; height: number; blur: string | null; name: string | null }): Promise<MediaItem | null> {
  const session = await requirePermission("blog.manage");
  const located = z.object({ slug: slugInput, path: z.string().max(200) }).safeParse({ slug: input.slug, path: input.path });
  if (!located.success) return null;
  const { slug, path } = located.data;
  const file = path.slice(slug.length + 1);
  if (!path.startsWith(`${slug}/`) || !/^[0-9a-f-]{36}\.(webp|jpg|png)$/.test(file)) return null;
  const supabase = createAdminClient();
  const discard = async () => {
    await supabase.storage.from(mediaBucket).remove([path]);
    return null;
  };
  const parsed = mediaInput.safeParse({ width: input.width, height: input.height, blur: input.blur, name: input.name });
  if (!parsed.success) return discard();
  const { data: listed } = await supabase.storage.from(mediaBucket).list(slug, { search: file, limit: 5 });
  const stored = listed?.find((item) => item.name === file);
  if (!stored) return null;
  const bytes = Number((stored.metadata as { size?: number } | null)?.size ?? 0);
  if (bytes > mediaMaxBytes) return discard();
  const { data, error } = await supabase
    .from("blog_media")
    .insert({ slug, src: `${mediaPublicBase(supabaseUrl)}${path}`, path, bytes, created_by: session.userId, ...parsed.data })
    .select("id, src, width, height, blur, name, bytes")
    .maybeSingle();
  if (error?.code === "23505") return null;
  return error || !data ? discard() : (data as MediaItem);
}

export async function removeMedia(input: { slug: string; id: string }): Promise<SimpleResult> {
  await requirePermission("blog.manage");
  const parsed = z.object({ slug: slugInput, id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = createAdminClient();
  const [{ data: media }, { data: article }] = await Promise.all([
    supabase.from("blog_media").select("id, src, path").eq("id", parsed.data.id).eq("slug", parsed.data.slug).maybeSingle(),
    supabase.from("blog_articles").select("draft, live, live_draft").eq("slug", parsed.data.slug).maybeSingle(),
  ]);
  if (!media || !article) return { ok: false, error: "missing" };
  if (JSON.stringify([article.draft, article.live, article.live_draft]).includes(media.src as string)) return { ok: false, error: "in_use" };
  const { error } = await supabase.from("blog_media").delete().eq("id", media.id);
  if (error) return { ok: false, error: "failed" };
  if (media.path) await supabase.storage.from(mediaBucket).remove([media.path as string]);
  return { ok: true };
}

export type PreviewLink = { ok: true; zh: string; en: string; expiresAt: string } | { ok: false; error: "invalid" | "missing" | "disabled" | "failed" };

export async function createPreviewLink(rawSlug: string): Promise<PreviewLink> {
  await requirePermission("blog.manage");
  if (!blogSiteEnabled()) return { ok: false, error: "disabled" };
  const slug = slugInput.safeParse(rawSlug);
  if (!slug.success) return { ok: false, error: "invalid" };
  const supabase = createAdminClient();
  const { data: row } = await supabase.from("blog_articles").select("preview_token, preview_expires_at").eq("slug", slug.data).maybeSingle();
  if (!row) return { ok: false, error: "missing" };
  const left = row.preview_expires_at ? new Date(row.preview_expires_at as string).getTime() - Date.now() : 0;
  const kept = row.preview_token && left > 3600000 ? { token: row.preview_token as string, expiresAt: row.preview_expires_at as string } : null;
  const link = kept ?? { token: randomBytes(24).toString("base64url"), expiresAt: new Date(Date.now() + 86400000).toISOString() };
  if (!kept) {
    const { error } = await supabase.from("blog_articles").update({ preview_token: link.token, preview_expires_at: link.expiresAt }).eq("slug", slug.data);
    if (error) return { ok: false, error: "failed" };
  }
  return { ok: true, zh: `${websiteOrigin}/zh/blog/preview/${link.token}`, en: `${websiteOrigin}/en/blog/preview/${link.token}`, expiresAt: link.expiresAt };
}

export type TagResult = { ok: true; tag: { id: string; label_zh: string; label_en: string } } | { ok: false; error: "invalid" | "taken" | "failed" };

const tagInput = z.object({ id: z.string().regex(tagPattern).max(60), labelZh: z.string().trim().min(1).max(60), labelEn: z.string().trim().min(1).max(60) });

export async function createTag(input: { id: string; labelZh: string; labelEn: string }): Promise<TagResult> {
  const session = await requirePermission("blog.manage");
  const parsed = tagInput.safeParse({ ...input, id: input.id.trim().toLowerCase() });
  if (!parsed.success || reservedSlugs.includes(parsed.data.id)) return { ok: false, error: "invalid" };
  const { data, error } = await createAdminClient().from("blog_tags").insert({ id: parsed.data.id, label_zh: parsed.data.labelZh, label_en: parsed.data.labelEn }).select("id, label_zh, label_en").maybeSingle();
  if (error || !data) return { ok: false, error: error?.code === "23505" ? "taken" : "failed" };
  await audit({ actorUserId: session.userId, actorType: "STAFF", action: "blog.tag_created", entityType: "blog_tag", entityId: parsed.data.id, metadata: { by: session.displayName } });
  return { ok: true, tag: data as { id: string; label_zh: string; label_en: string } };
}
