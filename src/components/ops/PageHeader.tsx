import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  lead?: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, lead, actions }: Props) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-[1.65rem] leading-tight font-semibold tracking-tight">{title}</h1>
        {lead && <p className="mt-1.5 text-sm text-muted">{lead}</p>}
      </div>
      {actions}
    </header>
  );
}
