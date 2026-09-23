import Link from "next/link";
import { decimal, exact, type UiLocale } from "../figures";
import { fill } from "../text";
import { copyText, type CopyLabels, type Topic, type TopicFacts } from "../topics-math";
import { CopyButton } from "./TopicControls";

export type TopicLabels = { keywords: string; queries: string; impressions: string; position: string; existing: string; fresh: string; copy: string; copied: string; copyLabels: CopyLabels };

export function TopicCards({ topics, facts, locale, editable, labels }: { topics: Topic[]; facts: TopicFacts; locale: UiLocale; editable: boolean; labels: TopicLabels }) {
  const byQuery = new Map(facts.queries.map((item) => [item.query, item]));
  const articles = new Map(facts.articles.map((item) => [item.slug, item]));
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-topics="">
      {topics.map((topic, index) => {
        const article = topic.existing ? articles.get(topic.existing) : undefined;
        const articleTitle = article ? (locale === "en" ? article.titleEn : article.titleZh) : "";
        return (
          <article key={index} className="min-w-0 rounded-[12px] p-4 hairline" data-topic={index}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold" data-topic-title="">
                  {topic.titleZh}
                </h3>
                <p className="text-[13px] text-muted" data-topic-title-en="">
                  {topic.titleEn}
                </p>
              </div>
              <CopyButton text={copyText(topic, facts, labels.copyLabels, locale)} labels={{ copy: labels.copy, copied: labels.copied }} />
            </div>
            <p className="mt-2 text-sm text-ink/80" data-topic-angle="">
              {topic.angle}
            </p>
            <p className="mt-3 text-[12px] text-muted">{labels.keywords}</p>
            <p className="text-sm" data-topic-keywords="">
              {[...topic.keywordsZh, ...topic.keywordsEn].join(" · ")}
            </p>
            <table className="mt-3 w-full text-sm" data-topic-queries="">
              <thead>
                <tr className="text-[12px] text-muted">
                  <th className="pb-1 text-left font-normal">{labels.queries}</th>
                  <th className="pb-1 text-right font-normal">{labels.impressions}</th>
                  <th className="pb-1 text-right font-normal">{labels.position}</th>
                </tr>
              </thead>
              <tbody>
                {topic.queries.map((query) => {
                  const item = byQuery.get(query);
                  return (
                    <tr key={query}>
                      <td className="max-w-0 truncate py-0.5 pr-3">{query}</td>
                      <td className="w-16 py-0.5 text-right tabular-nums text-muted">{item ? exact(item.impressions, locale) : "—"}</td>
                      <td className="w-12 py-0.5 text-right tabular-nums text-muted">{item ? decimal(item.position) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[13px]" data-topic-existing={topic.existing ?? ""}>
              {article ? (
                editable ? (
                  <Link href={`/marketing/blog/${article.slug}`} className="text-gold hover:underline">
                    {fill(labels.existing, { title: articleTitle })}
                  </Link>
                ) : (
                  fill(labels.existing, { title: articleTitle })
                )
              ) : (
                <span className="text-muted">{labels.fresh}</span>
              )}
            </p>
          </article>
        );
      })}
    </div>
  );
}
