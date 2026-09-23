import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/utils/format";
import { percent } from "./members";

export async function MemberStrip({ company, stakeCents, ratio }: { company: string; stakeCents: number; ratio: number }) {
  const t = await getTranslations("investor.member");
  return (
    <p className="card mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-[13px]">
      <span className="font-semibold">{company}</span>
      <span className="text-muted">
        {t("stake")} <span className="font-medium text-ink tabular-nums">{formatMoney(stakeCents)}</span>
      </span>
      <span className="text-muted">
        {t("ratio")} <span className="font-medium text-ink tabular-nums">{percent(ratio)}</span>
      </span>
    </p>
  );
}
