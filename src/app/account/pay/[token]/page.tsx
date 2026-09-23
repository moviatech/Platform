import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { resolvePayLink } from "@/features/payments/pay-link";

export const metadata: Metadata = { title: "Movia", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

export default async function PayLinkPage({ params }: Props) {
  const { token } = await params;
  const link = await resolvePayLink(token);
  if (!link) notFound();
  if (link.state === "open") redirect(link.url);
  const done = link.state === "done";
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-7 px-6 text-center">
      <Logo />
      <div className="card max-w-md px-8 py-9">
        <p className="eyebrow">Movia</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{done ? "已完成，谢谢！" : "链接已失效"}</h1>
        <p className="mt-2 text-sm text-muted">{done ? "这一步已经办好，无需再次操作。" : "如需帮助，请联系我们。"}</p>
        <h2 className="mt-6 text-lg font-semibold tracking-tight">{done ? "All set, thank you." : "This link has expired"}</h2>
        <p className="mt-2 text-sm text-muted">{done ? "This step is already complete. There is nothing more to do." : "Contact us if you need help."}</p>
      </div>
      <a href="https://www.moviatech.ai/contact" className="text-sm underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
        contact@moviatech.ai
      </a>
    </main>
  );
}
