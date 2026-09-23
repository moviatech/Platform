import type { Metadata } from "next";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { CreateForm } from "@/features/blog/CreateForm";
import { marketingMessages } from "@/features/marketing/i18n";
import { requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "New article" };

export default async function NewArticlePage() {
  await requirePagePermission("blog.manage");
  const { messages } = await marketingMessages();
  return (
    <>
      <BackLink href="/marketing/blog" />
      <PageHeader title={messages.blog.create.title} />
      <CreateForm labels={messages.blog.create} categories={messages.blog.category} />
    </>
  );
}
