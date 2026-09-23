import type { Metadata } from "next";
import { Logo } from "@/components/ui/Logo";

export const metadata: Metadata = { title: "Movia" };

type Props = { searchParams: Promise<{ r?: string; m?: string }> };

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const { r, m } = await searchParams;
  const number = /^MV-[A-Z0-9]{6}$/.test(r ?? "") ? r : null;
  const card = m === "card";
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-7 px-6 text-center">
      <Logo />
      <div className="card max-w-md px-8 py-9">
        <p className="eyebrow">{number ?? "Movia"}</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{card ? "卡已保存，谢谢！" : "已收到，谢谢！"}</h1>
        <p className="mt-2 text-sm text-muted">{card ? "现在不会扣款，租金在取车时收取。" : "我们正在确认您的订单，确认邮件会在几分钟内发送到您的邮箱。"}</p>
        <h2 className="mt-6 text-lg font-semibold tracking-tight">{card ? "Your card is saved, thank you." : "Thank you, we have it."}</h2>
        <p className="mt-2 text-sm text-muted">{card ? "Nothing has been charged. The rental is charged at pickup." : "We are confirming your reservation. A confirmation email will reach you within a few minutes."}</p>
      </div>
      <a href="https://www.moviatech.ai" className="text-sm underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
        moviatech.ai
      </a>
    </main>
  );
}
