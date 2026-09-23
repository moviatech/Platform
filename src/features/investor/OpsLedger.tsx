import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, formatMoney } from "@/lib/utils/format";
import { holdFor, type HoldMap } from "./holds";
import { PlaceHoldForm, ReleaseHoldForm } from "./HoldForms";
import type { LedgerEntry } from "./ledger";
import { ReverseEntryForm } from "./OpsFinanceForms";

export const bucketTone: Record<string, string> = { AVAILABLE: "bg-status-available/12 text-status-available", PENDING: "bg-status-limited/15 text-[#a87415]", INVESTED: "bg-gold/12 text-gold", PAID_OUT: "bg-ink/5 text-charcoal" };

export async function OpsLedger({ entries, canReverse, canHold, holds }: { entries: LedgerEntry[]; canReverse: boolean; canHold: boolean; holds: HoldMap }) {
  const [t, common, h] = await Promise.all([getTranslations("investors.ledger"), getTranslations("common"), getTranslations("investors.holds")]);
  if (entries.length === 0) return <p className="text-[13px] text-muted">{common("empty")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-[13px]">
        <thead>
          <tr className="border-b border-ink/[0.07] text-left text-[11px] tracking-[0.12em] text-muted uppercase">
            <th className="py-2 pr-3 font-medium">{t("date")}</th>
            <th className="py-2 pr-3 font-medium">{t("type")}</th>
            <th className="py-2 pr-3 font-medium">{t("bucket")}</th>
            <th className="py-2 pr-3 font-medium">{t("ref")}</th>
            <th className="py-2 pr-3 font-medium">{t("memo")}</th>
            <th className="py-2 pr-3 text-right font-medium">{t("amount")}</th>
            {(canReverse || canHold) && <th className="py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/[0.06]">
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="py-2 pr-3 whitespace-nowrap text-muted">{formatDateTime(entry.created_at)}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{t(`types.${entry.type}`)}</td>
              <td className="py-2 pr-3">
                <span className={cn("inline-flex h-5 items-center rounded-pill px-2 text-[11px] font-medium", bucketTone[entry.bucket])}>{t(`buckets.${entry.bucket}`)}</span>
                {entry.bucket === "PENDING" && entry.settles_at && <span className="ml-1 text-[11px] text-muted">→ {formatDateTime(entry.settles_at)}</span>}
                {entry.bucket === "PENDING" && holdFor(holds, entry) && <span className="ml-1 text-[11px] text-[#a87415]">{h("heldTag")}</span>}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap text-muted">{[entry.reservation?.number, entry.vehicle?.fleet_number].filter(Boolean).join(" · ") || "—"}</td>
              <td className="max-w-[16rem] py-2 pr-3 text-charcoal">{entry.memo ?? "—"}</td>
              <td className={cn("py-2 pr-3 text-right tabular-nums", entry.amount_cents < 0 ? "text-status-danger" : "text-ink")}>{entry.amount_cents < 0 ? "−" : "+"}{formatMoney(Math.abs(entry.amount_cents))}</td>
              {(canReverse || canHold) && (
                <td className="py-2 text-right whitespace-nowrap">
                  <div className="flex flex-col items-end gap-1">
                    {canHold && entry.bucket === "PENDING" && (holds.entries[entry.id] ? (
                      <details>
                        <summary className="cursor-pointer list-none text-[12px] text-[#a87415] hover:text-ink">{h("release")}</summary>
                        <div className="mt-1">
                          <ReleaseHoldForm id={holds.entries[entry.id].id} compact />
                        </div>
                      </details>
                    ) : (
                      <details>
                        <summary className="cursor-pointer list-none text-[12px] text-muted hover:text-ink">{h("place")}</summary>
                        <div className="mt-1">
                          <PlaceHoldForm scope="ENTRY" target={entry.id} compact />
                        </div>
                      </details>
                    ))}
                    {canReverse && entry.type !== "REVERSAL" && entry.bucket !== "PAID_OUT" && <ReverseEntryForm id={entry.id} />}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
