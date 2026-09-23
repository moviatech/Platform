import type { Metadata } from "next";
import { Logo } from "@/components/ui/Logo";

export const metadata: Metadata = { title: "Payment not completed" };

export default function CheckoutCancelledPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-7 px-6 text-center">
      <Logo />
      <div className="card max-w-md px-8 py-9">
        <p className="eyebrow">Movia</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">付款尚未完成</h1>
        <p className="mt-2 text-sm text-muted">您的卡没有被扣款。可以重新打开我们发给您的链接继续，或直接联系我们。</p>
        <h2 className="mt-6 text-lg font-semibold tracking-tight">Payment not completed</h2>
        <p className="mt-2 text-sm text-muted">Your card was not charged. Reopen the link we sent you to continue, or contact us and we will help.</p>
      </div>
      <a href="https://www.moviatech.ai/contact" className="text-sm underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
        contact@moviatech.ai
      </a>
    </main>
  );
}
