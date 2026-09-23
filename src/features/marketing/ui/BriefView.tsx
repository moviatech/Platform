import type { Brief } from "../brief-math";

export type BriefLabels = { points: string; actions: string; flagged: string };

export function BriefFlag({ flags, label }: { flags: string[]; label: string }) {
  if (!flags.includes("numbers")) return null;
  return (
    <span data-flag="numbers" className="rounded-pill bg-status-danger/10 px-2 py-0.5 text-[11px] font-medium text-status-danger">
      {label}
    </span>
  );
}

export function BriefView({ brief, labels }: { brief: Brief; labels: BriefLabels }) {
  return (
    <div data-brief-body="" className="min-w-0 text-sm leading-relaxed">
      <h3 className="text-base font-semibold" data-brief-headline="">
        {brief.headline}
      </h3>
      <p className="mt-2 whitespace-pre-line text-ink/80">{brief.summary}</p>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <h4 className="mb-2 text-[12px] font-medium tracking-wide text-muted">{labels.points}</h4>
          <ul className="list-disc space-y-1.5 pl-5" data-brief-points="">
            {brief.points.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <h4 className="mb-2 text-[12px] font-medium tracking-wide text-muted">{labels.actions}</h4>
          <ol className="list-decimal space-y-2 pl-5" data-brief-actions="">
            {brief.actions.map((action, index) => (
              <li key={index}>
                <p className="font-medium">{action.title}</p>
                <p className="text-ink/70">{action.reason}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
