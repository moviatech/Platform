import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ops/BackLink";
import { getArticle, listMedia, listTags } from "@/features/blog/articles";
import { slugPattern } from "@/features/blog/blocks";
import { draftSchema } from "@/features/blog/draft";
import { currentTime } from "@/features/booking/time";
import { Editor } from "@/features/blog/Editor";
import { editorWidth } from "@/features/blog/layout";
import { blogSiteEnabled } from "@/features/marketing/config";
import { googleStatus } from "@/features/marketing/google/config";
import { marketingMessages } from "@/features/marketing/i18n";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { websiteOrigin } from "@/lib/env";

export const metadata: Metadata = { title: "Article" };

type Props = { params: Promise<{ slug: string }> };

export default async function ArticlePage({ params }: Props) {
  const session = await requirePagePermission("blog.manage");
  const { slug } = await params;
  if (!slugPattern.test(slug) || slug.length > 120) notFound();
  const [article, media, tags, { locale, messages }] = await Promise.all([getArticle(slug), listMedia(slug), listTags(), marketingMessages()]);
  const draft = draftSchema.safeParse(article?.draft);
  if (!article || !draft.success) notFound();
  const scheduled = article.status === "PUBLISHED" && Boolean(article.publish_at) && new Date(article.publish_at as string).getTime() > currentTime();

  return (
    <div className={editorWidth}>
      <BackLink href="/marketing/blog" />
      <Editor
        key={slug}
        article={{ slug: article.slug, status: article.status, publishAt: article.publish_at, scheduled, rev: article.rev, liveRev: article.live_rev, draft: draft.data }}
        media={media}
        tags={tags}
        labels={messages.blog.editor}
        issueLabels={messages.blog.issues}
        categoryLabels={messages.blog.category}
        uiLocale={locale}
        siteEnabled={blogSiteEnabled()}
        siteOrigin={websiteOrigin}
        searchTab={can(session, "marketing.view") && googleStatus().search}
      />
    </div>
  );
}
