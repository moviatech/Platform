import Image from "next/image";
import type { ReactNode } from "react";
import type { ArticleBlock, ImageRef } from "./blocks";
import { siteLink } from "./publish";

type Props = {
  category: string;
  title: string;
  excerpt: string;
  kicker: string;
  line: string;
  cover: ImageRef | null;
  dates: string;
  blocks: ArticleBlock[];
  siteOrigin: string;
  locale: string;
  empty: string;
};

function emphasis(text: string, offset: number): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/).map((part, index) => {
    const key = `${offset}-${index}`;
    if (index % 2 === 0) return part;
    if (part.startsWith("`")) {
      return (
        <code key={key} className="rounded-md bg-pearl px-1.5 py-0.5 text-[0.9em] text-ink">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*")) return <em key={key}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function inline(text: string, base: string): ReactNode[] {
  return text.split(/(\[[^\]]+\]\([^)]+\))/).flatMap<ReactNode>((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!link) return emphasis(part, index);
    if (!siteLink(link[2])) return emphasis(link[1], index);
    return [
      <a key={index} href={link[2].startsWith("/") ? `${base}${link[2]}` : link[2]} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline decoration-gold/50 underline-offset-4 hover:text-gold">
        {link[1]}
      </a>,
    ];
  });
}

const source = (image: ImageRef, siteOrigin: string) => (image.src.startsWith("/") ? `${siteOrigin}${image.src}` : image.src);

function Picture({ image, alt, siteOrigin, sizes }: { image: ImageRef; alt: string; siteOrigin: string; sizes: string }) {
  return <Image src={source(image, siteOrigin)} alt={alt} fill unoptimized sizes={sizes} placeholder={image.blur ? "blur" : "empty"} blurDataURL={image.blur} className="object-cover" />;
}

function Block({ block, index, base, siteOrigin }: { block: ArticleBlock; index: number; base: string; siteOrigin: string }) {
  if (block.type === "h2") return <h2 className="mt-10 text-2xl font-medium tracking-tight text-ink">{block.text}</h2>;
  if (block.type === "h3") return <h3 className="mt-7 text-xl font-medium text-ink">{block.text}</h3>;
  if (block.type === "p") return <p className="mt-5 whitespace-pre-line text-[16px] leading-[1.8] text-charcoal">{inline(block.text, base)}</p>;
  if (block.type === "ul") {
    return (
      <ul className="mt-5 space-y-3">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-3 text-[16px] leading-[1.75] text-charcoal">
            <span className="mt-[0.72em] size-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
            <span>{inline(item, base)}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === "ol") {
    return (
      <ol className="mt-5 space-y-3">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-4 text-[16px] leading-[1.75] text-charcoal">
            <span className="mt-[0.2em] flex size-7 shrink-0 items-center justify-center rounded-full border border-gold text-xs font-medium text-gold">{i + 1}</span>
            <span>{inline(item, base)}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (block.type === "quote") return <blockquote className="mt-7 whitespace-pre-line border-l-2 border-gold pl-5 text-[16px] leading-[1.8] text-charcoal">{inline(block.text, base)}</blockquote>;
  if (block.type === "table") {
    return (
      <div className="mt-6 overflow-x-auto rounded-2xl border border-ink/8">
        <table className="w-full min-w-[26rem] border-collapse text-[14px]">
          <thead className="bg-pearl/60 text-left text-xs font-medium tracking-[0.12em] text-muted uppercase">
            <tr>
              {block.head.map((cell, i) => (
                <th key={i} scope="col" className="px-4 py-3 font-medium">
                  {inline(cell, base)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r} className="border-t border-ink/8 align-top">
                {row.map((cell, c) => (
                  <td key={c} className="px-4 py-3 leading-relaxed text-charcoal">
                    {inline(cell, base)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.type === "callout") {
    return (
      <aside className="mt-7 flex gap-4 rounded-2xl border border-gold/25 bg-[#fffdf8] p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold/12 text-gold" aria-hidden="true">
          ✦
        </span>
        <div>
          <p className="font-medium text-ink">{block.title}</p>
          <p className="mt-1 text-[15px] leading-relaxed text-charcoal">{inline(block.text, base)}</p>
        </div>
      </aside>
    );
  }
  if (block.type === "figure") {
    return (
      <figure className="mt-7">
        <div className="relative aspect-[16/10] overflow-hidden rounded-2xl border border-ink/6 bg-pearl">
          <Picture image={block.image} alt={block.alt} siteOrigin={siteOrigin} sizes="40rem" />
        </div>
        {block.caption && <figcaption className="mt-3 text-sm leading-relaxed text-muted">{block.caption}</figcaption>}
      </figure>
    );
  }
  return (
    <div className="mt-5 divide-y divide-ink/8 rounded-2xl border border-ink/8">
      {block.items.map((item, i) => (
        <details key={`${index}-${i}`} className="px-5 py-4">
          <summary className="font-medium text-ink">{item.q}</summary>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-charcoal">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

export function ArticlePreview({ category, title, excerpt, kicker, line, cover, dates, blocks, siteOrigin, locale, empty }: Props) {
  const base = `${siteOrigin}/${locale}`;
  return (
    <article className="min-w-0 [overflow-wrap:anywhere]">
      <p className="eyebrow">{category}</p>
      <h1 className="mt-3 text-3xl leading-[1.12] font-medium tracking-[-0.02em] text-balance text-ink">{title || "—"}</h1>
      {excerpt && <p className="mt-4 text-[16px] leading-relaxed text-muted">{excerpt}</p>}
      {dates && <p className="mt-4 border-y border-ink/8 py-3 text-[13px] text-muted">{dates}</p>}
      <figure className="relative mt-6 aspect-[16/9] overflow-hidden rounded-[22px] border border-ink/6 bg-pearl">
        {cover && <Picture image={cover} alt={title} siteOrigin={siteOrigin} sizes="40rem" />}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,17,17,0)_45%,rgba(17,17,17,0.62)_100%)]" aria-hidden="true" />
        <figcaption className="absolute right-5 bottom-5 left-5 text-white">
          <p className="text-[11px] font-medium tracking-[0.2em] text-gold-light uppercase">{kicker}</p>
          <p className="mt-1.5 text-xl font-medium">{line}</p>
        </figcaption>
      </figure>
      {blocks.length === 0 ? <p className="mt-8 text-sm text-muted">{empty}</p> : blocks.map((block, index) => <Block key={index} block={block} index={index} base={base} siteOrigin={siteOrigin} />)}
    </article>
  );
}
