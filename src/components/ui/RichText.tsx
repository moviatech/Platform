import { parseRich, type RichLine } from "@/features/portal/rich-text";
import { cn } from "@/lib/utils/cn";

export function RichText({ text, className, strong = "font-semibold" }: { text: string; className?: string; strong?: string }) {
  const groups: Array<RichLine | { kind: "list"; items: RichLine[] }> = [];
  for (const line of parseRich(text)) {
    const last = groups[groups.length - 1];
    if (line.kind !== "bullet") groups.push(line);
    else if (last && last.kind === "list") last.items.push(line);
    else groups.push({ kind: "list", items: [line] });
  }
  const spans = (line: RichLine) =>
    line.spans.map((span, index) =>
      span.bold ? (
        <strong key={index} className={strong}>
          {span.text}
        </strong>
      ) : (
        <span key={index}>{span.text}</span>
      ),
    );
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {groups.map((group, index) =>
        group.kind === "list" ? (
          <ul key={index} className="list-disc pl-5">
            {group.items.map((item, at) => (
              <li key={at}>{spans(item)}</li>
            ))}
          </ul>
        ) : group.kind === "gap" ? (
          <div key={index} className="h-1.5" />
        ) : group.kind === "heading" ? (
          <p key={index} className={cn("mt-1 first:mt-0", strong)}>
            {spans(group)}
          </p>
        ) : (
          <p key={index} className="whitespace-pre-wrap">
            {spans(group)}
          </p>
        ),
      )}
    </div>
  );
}
