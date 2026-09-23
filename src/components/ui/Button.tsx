import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "gold" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-pill font-medium whitespace-nowrap transition-[transform,box-shadow,background-color,border-color,color] duration-200 ease-out-quart disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-white shadow-soft hover:bg-charcoal hover:shadow-[0_8px_30px_-8px_rgba(181,139,75,0.55)]",
  secondary: "bg-white text-ink hairline hover:border-ink/25",
  ghost: "text-ink hover:bg-ink/5",
  gold: "bg-gold text-white hover:bg-gold-light",
  danger: "bg-white text-status-danger border border-status-danger/30 hover:bg-status-danger/5",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-[13px]",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

type Common = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
};

type ButtonProps = Common & Omit<ComponentProps<"button">, "className" | "children">;

export function Button({ variant = "primary", size = "md", className, children, ...props }: ButtonProps) {
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  );
}

type LinkProps = Common & Omit<ComponentProps<typeof Link>, "className" | "children">;

export function ButtonLink({ variant = "primary", size = "md", className, children, ...props }: LinkProps) {
  return (
    <Link className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </Link>
  );
}
