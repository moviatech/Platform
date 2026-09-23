import type { ReactNode } from "react";
import { exact, percent, type UiLocale } from "../figures";
import type { PlacementLine } from "../overview-math";
import { loadPlacement } from "../placement";
import type { RangeDays } from "../dates";
import { named } from "../text";
import { Panel, Ranked } from "./parts";

type Labels = { title: string; missing: string; none: string; place: string; count: string; share: string; names: Record<string, string> };

export function PlacementShell({ labels, children }: { labels: Pick<Labels, "title">; children?: ReactNode }) {
  return (
    <Panel title={labels.title} className="xl:col-span-2">
      <div data-placement="" className="min-h-10">
        {children}
      </div>
    </Panel>
  );
}

export async function PlacementPanel({ days, locale, labels }: { days: RangeDays; locale: UiLocale; labels: Labels }) {
  const view = await loadPlacement(days);
  const top = view.state === "ok" ? Math.max(1, ...view.lines.map((line) => line.count)) : 1;
  return (
    <PlacementShell labels={labels}>
      {view.state === "ok" ? (
        <Ranked<PlacementLine>
          rows={view.lines}
          rowKey={(line) => line.name}
          name={{ key: "place", label: labels.place, cell: (line) => named(labels.names, line.name) ?? line.name }}
          columns={[
            { key: "count", label: labels.count, cell: (line) => exact(line.count, locale) },
            { key: "share", label: labels.share, cell: (line) => percent(line.share) },
          ]}
          share={(line) => line.count / top}
          empty={labels.none}
        />
      ) : (
        <p className="text-sm text-muted" data-state={view.state}>
          {view.state === "missing" ? labels.missing : labels.none}
        </p>
      )}
    </PlacementShell>
  );
}
