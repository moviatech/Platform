import type { Metadata } from "next";
import { PageHeader } from "@/components/ops/PageHeader";
import { aiState } from "@/features/marketing/ai";
import { loadBriefs, type StoredBrief } from "@/features/marketing/brief";
import { loadTopics } from "@/features/marketing/topics";
import { TopicCards } from "@/features/marketing/ui/TopicCards";
import { TopicButtons } from "@/features/marketing/ui/TopicControls";
import { formatDateTime } from "@/lib/utils/format";
import { exact } from "@/features/marketing/figures";
import { marketingMessages } from "@/features/marketing/i18n";
import { fill } from "@/features/marketing/text";
import { AiControls } from "@/features/marketing/ui/AiControls";
import { BriefFlag, BriefView } from "@/features/marketing/ui/BriefView";
import { Panel } from "@/features/marketing/ui/parts";
import { can, requirePagePermission } from "@/lib/auth/staff";

export const metadata: Metadata = { title: "AI insights" };

export default async function InsightsPage() {
  const session = await requirePagePermission("marketing.view");
  const { locale, messages } = await marketingMessages();
  const t = messages.insights;
  const g = messages.google;
  const [briefs, state, topics] = await Promise.all([loadBriefs(13), aiState(), loadTopics()]);
  const tt = t.topics;
  const manage = can(session, "marketing.manage");
  const [latest, ...older] = briefs;
  const labels = { points: t.points, actions: t.actions, flagged: t.flagged };
  const week = (brief: StoredBrief) => fill(t.week, { start: brief.start, end: brief.end });

  return (
    <>
      <PageHeader title={t.title} />
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel
          title={t.brief}
          className="xl:col-span-2"
          aside={
            latest ? (
              <span className="flex items-center gap-2 text-[12px] text-muted" data-brief-week="">
                {week(latest)}
                <BriefFlag flags={latest.flags} label={t.flagged} />
              </span>
            ) : undefined
          }
        >
          <div data-brief={latest?.key ?? ""}>{latest ? <BriefView brief={latest.content[locale]} labels={labels} /> : <p className="text-sm text-muted">{g.none}</p>}</div>
        </Panel>

        <Panel title={t.usage}>
          <p className="text-[1.7rem] leading-none font-semibold tracking-tight tabular-nums" data-usage="">
            {fill(t.usageValue, { used: exact(state.used, locale), limit: exact(state.limit, locale) })}
          </p>
          {manage && <AiControls limit={state.limit} labels={{ limit: t.limit, save: t.save, regenerate: t.regenerate, status: t.status }} />}
        </Panel>
      </div>

      <Panel title={tt.title} className="mt-5" aside={<TopicButtons manage={manage} labels={{ generate: tt.generate, regenerate: tt.regenerate, status: tt.status }} />}>
        {topics ? (
          <>
            <p className="mb-3 text-[12px] text-muted" data-topics-at="">
              {fill(tt.generatedAt, { time: formatDateTime(topics.createdAt), start: topics.facts.window.start, end: topics.facts.window.end })}
            </p>
            {topics.topics.length ? (
              <TopicCards
                topics={topics.topics}
                facts={topics.facts}
                locale={locale}
                editable={can(session, "blog.manage")}
                labels={{ keywords: tt.keywords, queries: tt.queries, impressions: tt.impressions, position: tt.position, existing: tt.existing, fresh: tt.fresh, copy: tt.copy, copied: tt.copied, copyLabels: tt.copyLabels }}
              />
            ) : (
              <p className="text-sm text-muted">{g.none}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">{g.none}</p>
        )}
      </Panel>

      <Panel title={t.history} className="mt-5">
        {older.length ? (
          <div className="divide-y divide-ink/[0.06]" data-history="">
            {older.map((brief) => (
              <details key={brief.key} data-brief-key={brief.key} className="py-3">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="text-[12px] text-muted tabular-nums">{week(brief)}</span>
                  <span className="font-medium">{brief.content[locale].headline}</span>
                  <BriefFlag flags={brief.flags} label={t.flagged} />
                </summary>
                <div className="mt-3">
                  <BriefView brief={brief.content[locale]} labels={labels} />
                </div>
              </details>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{g.none}</p>
        )}
      </Panel>
    </>
  );
}
