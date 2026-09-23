import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

const control =
  "h-11 w-full rounded-xl border border-ink/10 bg-white px-3.5 text-sm text-ink placeholder:text-muted/70 transition-[border-color,box-shadow] focus:border-gold/60 focus:outline-none focus:ring-4 focus:ring-gold/10 disabled:opacity-60 aria-[invalid=true]:border-status-danger/60";

type WrapProps = {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
};

export function FieldWrap({ label, htmlFor, error, hint, children, className }: WrapProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium tracking-wide text-charcoal">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-status-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "h-auto min-h-28 resize-y py-2.5", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}
