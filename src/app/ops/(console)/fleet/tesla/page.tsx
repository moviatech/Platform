import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/Badge";
import { BackLink } from "@/components/ops/BackLink";
import { PageHeader } from "@/components/ops/PageHeader";
import { RegisterButton } from "@/features/tesla/TeslaPanel";
import { requireHqPage } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { listVehicles, loadTeslaSettings, publicKeyHosted, publicKeyUrl, redirectUri, teslaConfigured, type FleetVehicle } from "@/lib/tesla/client";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Tesla" };

type Props = { searchParams: Promise<{ connected?: string; error?: string; detail?: string }> };

export default async function TeslaPage({ searchParams }: Props) {
  await requireHqPage("settings.manage");
  const { connected, error, detail } = await searchParams;
  const [t, settings, hosted] = await Promise.all([getTranslations("tesla"), loadTeslaSettings(), publicKeyHosted()]);
  const configured = teslaConfigured();
  const isConnected = Boolean(settings.refresh && settings.access);
  let vehicles: FleetVehicle[] = [];
  let vehiclesError: string | null = null;
  if (isConnected) {
    try {
      vehicles = await listVehicles();
    } catch (cause) {
      vehiclesError = cause instanceof Error ? cause.message : "failed";
    }
  }
  const { data: fleetRows } = await createAdminClient().from("vehicles").select("fleet_number, vin");
  const fleetByVin = new Map((fleetRows ?? []).filter((row) => row.vin).map((row) => [String(row.vin).toUpperCase(), row.fleet_number as string]));

  const rows: Array<[string, React.ReactNode]> = [
    [t("app"), <Badge key="app" tone={configured ? "success" : "warning"}>{configured ? t("configured") : t("notConfigured")}</Badge>],
    [
      t("publicKey"),
      <span key="key" className="flex flex-wrap items-center gap-2">
        <Badge tone={hosted ? "success" : "warning"}>{hosted ? t("hosted") : t("notHosted")}</Badge>
        <a href={publicKeyUrl} target="_blank" rel="noreferrer" className="break-all text-[12px] text-charcoal underline decoration-gold/50 underline-offset-2">
          {publicKeyUrl}
        </a>
      </span>,
    ],
    [t("partner"), <Badge key="partner" tone={settings.registeredAt ? "success" : "warning"}>{settings.registeredAt ? `${t("registered")} · ${formatDateTime(settings.registeredAt)}` : t("notRegistered")}</Badge>],
    [t("account"), <Badge key="account" tone={isConnected ? "success" : "warning"}>{isConnected && settings.connectedAt ? `${t("connected")} · ${formatDateTime(settings.connectedAt)}` : t("notConnected")}</Badge>],
    [t("redirect"), <span key="redirect" className="break-all text-[12px] text-charcoal">{redirectUri}</span>],
  ];

  return (
    <>
      <BackLink href="/fleet" />
      <PageHeader title="Tesla" />
      {connected && <p className="mb-4 rounded-xl bg-status-available/10 px-4 py-3 text-[13px]">{t("connectedNow")}</p>}
      {error && (
        <p className="mb-4 rounded-xl bg-status-danger/8 px-4 py-3 text-[13px] text-status-danger" role="alert">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : `${t("errors.failed")} (${error})`}
          {detail ? ` · ${detail}` : ""}
        </p>
      )}
      <section className="card mb-5 p-6">
        <dl className="flex flex-col gap-2.5 text-[13px]">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
              <dt className="text-muted">{label}</dt>
              <dd className="min-w-0">{value}</dd>
            </div>
          ))}
        </dl>
        {configured && (
          <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-ink/[0.07] pt-5">
            <RegisterButton registered={Boolean(settings.registeredAt)} />
            {settings.registeredAt && (
              <a href="/api/tesla/connect" className="inline-flex h-9 items-center rounded-pill bg-ink px-4 text-[13px] font-medium text-white">
                {isConnected ? t("reconnect") : t("connect")}
              </a>
            )}
          </div>
        )}
      </section>
      {isConnected && (
        <section className="card p-6">
          <h2 className="mb-3 text-sm font-semibold">{t("vehicles")}</h2>
          {vehiclesError ? (
            <p className="text-[13px] text-status-danger">{vehiclesError}</p>
          ) : vehicles.length === 0 ? (
            <p className="text-[13px] text-muted">{t("noVehicles")}</p>
          ) : (
            <ul className="divide-y divide-ink/[0.06] text-[13px]">
              {vehicles.map((vehicle) => {
                const fleetNumber = fleetByVin.get(vehicle.vin.toUpperCase());
                return (
                  <li key={vehicle.vin} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2.5">
                    <span className="min-w-0">
                      <span className="font-medium">{vehicle.display_name || vehicle.vin}</span>
                      <span className="block font-mono text-[12px] text-muted">{vehicle.vin}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-muted">{vehicle.state}</span>
                      <Badge tone={fleetNumber ? "success" : "warning"}>{fleetNumber ?? t("unmatched")}</Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
