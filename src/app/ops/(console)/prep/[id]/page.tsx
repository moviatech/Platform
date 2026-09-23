import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { resolvePrepIssue } from "@/features/prep/actions";
import { IssueForm, PrepTaskForm } from "@/features/prep/PrepForms";
import { getPrepTask } from "@/features/prep/queries";
import { can, requirePagePermission } from "@/lib/auth/staff";
import { r2Configured } from "@/lib/media/r2";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Prep task" };

type Props = { params: Promise<{ id: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PrepTaskPage({ params }: Props) {
  const session = await requirePagePermission("prep.view");
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const [t, locale, task] = await Promise.all([getTranslations("prep"), getLocale(), getPrepTask(id)]);
  if (!task) notFound();
  const done = task.status === "DONE";
  const vehicleName = task.vehicle ? `${task.vehicle.fleet_number} · ${(locale === "zh" ? task.vehicle.vehicle_class?.name_zh : null) ?? task.vehicle.vehicle_class?.name ?? ""}` : "";
  const photos = (phase: "BEFORE" | "AFTER") => task.photos.filter((photo) => photo.phase === phase);

  return (
    <>
      <BackLink href="/prep" />
      <PageHeader eyebrow={vehicleName} title={t(`status.${task.status}`)} lead={task.due_at ? `${t("nextPickup")} · ${formatDateTime(task.due_at)}` : undefined} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card p-6">
          {can(session, "prep.manage") || done ? <PrepTaskForm taskId={task.id} checklist={task.checklist} notes={task.notes} videoEnabled={r2Configured()} done={done} /> : null}
          {done && (
            <p className="mt-4 text-[12px] text-muted">
              {t("completedAt", { at: task.completed_at ? formatDateTime(task.completed_at) : "—" })}
              {task.assignee ? ` · ${task.assignee.display_name}` : ""}
            </p>
          )}
        </section>
        <div className="flex flex-col gap-5">
          {(task.issue || task.issue_open) && (
            <section className="card p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{t("issue")}</h2>
                <Badge tone={task.issue_open ? "danger" : "neutral"}>{task.issue_open ? t("issueOpen") : t("issueResolved")}</Badge>
              </div>
              <p className="mt-2 text-[13px] whitespace-pre-wrap text-charcoal">{task.issue}</p>
              {task.issue_open && can(session, "vehicle.edit") && (
                <form action={resolvePrepIssue} className="mt-3">
                  <input type="hidden" name="taskId" value={task.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    {t("resolve")}
                  </Button>
                </form>
              )}
            </section>
          )}
          {!done && can(session, "prep.manage") && (
            <section className="card p-6">
              <IssueForm taskId={task.id} />
            </section>
          )}
          {(["BEFORE", "AFTER"] as const).map((phase) =>
            photos(phase).length ? (
              <section key={phase} className="card p-6">
                <h2 className="text-sm font-semibold">{t(phase === "BEFORE" ? "photosBefore" : "photosAfter")}</h2>
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos(phase).map((photo) => (
                    <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-pearl">
                      <Image src={photo.url} alt="" width={240} height={240} unoptimized className="aspect-square w-full object-cover" />
                    </a>
                  ))}
                </div>
              </section>
            ) : null,
          )}
          {task.videos.length > 0 && (
            <section className="card p-6">
              <h2 className="text-sm font-semibold">{t("video")}</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {task.videos.map((video, index) => (
                  <li key={video.id}>
                    <a href={video.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[12px] hairline hover:border-ink/25">
                      ▶ {t("video")} {index + 1}
                      {video.duration ? <span className="text-muted">· {video.duration}s</span> : null}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
