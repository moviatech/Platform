import Image from "next/image";
import { cn } from "@/lib/utils/cn";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} role="img" aria-label="Movia">
      <Image src="/brand/movia-mark.46a2955f.webp" alt="" width={320} height={97} className="h-5 w-auto" aria-hidden="true" priority />
      <Image src="/brand/movia-wordmark.3a350853.webp" alt="" width={480} height={98} className="h-6 w-auto" aria-hidden="true" priority />
    </span>
  );
}
