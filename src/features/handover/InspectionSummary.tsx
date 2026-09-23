import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { formatFullDateTime, formatMoney } from "@/lib/utils/format";
import { FeeList } from "./HandoverForms";
import type { FeeLine } from "./fees";
import type { InspectionRecord } from "./queries";

export async function InspectionSummary({ records }: { records: InspectionRecord[] }) {
  const [t, locale] = await Promise.all([getTranslations("handover"), getLocale()]);
  const accessoryLabels: Record<string, string> = { keyCard: t("keyCard"), charger: t("charger"), childSeat: t("childSeat") };

  return (
    <>
      {records.map((record) => {
        const fees = record.charges.filter((charge): charge is FeeLine => charge.code !== "damage" && typeof charge.quantity === "number" && typeof charge.unitCents === "number");
        const damage = record.charges.find((charge) => charge.code === "damage");
        const accessories = Object.entries(record.accessories)
          .filter(([, value]) => value)
          .map(([key]) => accessoryLabels[key] ?? key);
        const rows: Array<[string, string]> = [
          [t("odometer"), String(record.odometer)],
          [t("battery"), `${record.battery_level}%`],
          [record.kind === "PICKUP" ? t("accessories") : t("returned"), accessories.join("、") || "—"],
        ];
        if (record.damage_notes) rows.push([t("damageNotes"), record.damage_notes]);
        if (record.renter_remarks) rows.push([t("renterRemarks"), record.renter_remarks]);
        if (damage) rows.push([t("damage"), `${formatMoney(damage.amountCents)} · ${t("pendingConsent")}`]);

        return (
          <section key={record.id} className="card p-6">
            <h2 className="text-sm font-semibold">{record.kind === "PICKUP" ? t("startInspection") : t("endInspection")}</h2>
            <p className="mt-1 text-[12px] text-muted">
              {formatFullDateTime(record.performed_at, locale)}
              {record.performed_by ? ` · ${record.performed_by.display_name}` : ""}
            </p>
            <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
              {rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-6">
                  <dt className="shrink-0 text-muted">{label}</dt>
                  <dd className="text-right whitespace-pre-wrap">{value}</dd>
                </div>
              ))}
            </dl>
            {record.kind === "RETURN" && (
              <div className="mt-3 border-t border-ink/[0.08] pt-3">
                <FeeList lines={fees} />
              </div>
            )}
            {record.photos.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {record.photos.map((photo) => (
                  <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-pearl">
                    <Image src={photo.url} alt="" width={240} height={240} unoptimized className="aspect-square w-full object-cover" />
                  </a>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
