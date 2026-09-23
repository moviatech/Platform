import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div>
        <p className="eyebrow">404</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">页面不存在 · Page not found</h1>
      </div>
      <Link href="/" className="text-sm underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
        返回 · Back
      </Link>
    </main>
  );
}
