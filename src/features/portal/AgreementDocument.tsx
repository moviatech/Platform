import { cn } from "@/lib/utils/cn";
import type { Block, Row } from "./agreement";

const tones = { warning: "rounded-xl bg-status-danger/10 px-4 py-3 text-ink", muted: "text-muted", strong: "font-semibold text-ink" } as const;

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-[minmax(0,15rem)_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="mb-1 sm:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SignatureBlock({ rows, image }: { rows: Row[]; image?: string | null }) {
  return (
    <div className="border-t border-ink/[0.08] pt-5">
      {image && (
        <div className="mb-4 inline-block rounded-lg border border-ink/[0.08] bg-white px-4 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" className="block max-h-20 w-auto" />
        </div>
      )}
      <Rows rows={rows} />
    </div>
  );
}

export function AgreementDocument({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-5">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "title":
            return (
              <header key={index}>
                <p className="eyebrow">{block.brand}</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">{block.text}</h2>
                <p className="mt-1 text-[12px] tracking-wide text-muted uppercase">{block.sub}</p>
              </header>
            );
          case "meta":
          case "rows":
            return <Rows key={index} rows={block.rows} />;
          case "signature":
            return <SignatureBlock key={index} rows={block.rows} image={block.image} />;
          case "section":
            return (
              <h3 key={index} className="mt-3 border-b border-ink/[0.08] pb-2 text-sm font-semibold">
                {block.text}
              </h3>
            );
          case "clause":
            return (
              <section key={index}>
                <h4 className="text-sm font-semibold">{block.heading}</h4>
                {block.paragraphs.map((p, i) => (
                  <p key={i} className="mt-1.5 text-[14px] leading-relaxed text-charcoal">
                    {p}
                  </p>
                ))}
              </section>
            );
          case "paragraph":
            return (
              <p key={index} className={cn("text-[14px] leading-relaxed text-charcoal", block.tone && tones[block.tone])}>
                {block.text}
              </p>
            );
        }
      })}
    </div>
  );
}
