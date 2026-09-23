import "server-only";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { opsOrigin, websiteOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const teslaConfigured = () => Boolean(process.env.TESLA_CLIENT_ID && process.env.TESLA_CLIENT_SECRET);

const fleetBase = process.env.TESLA_FLEET_API ?? "https://fleet-api.prd.na.vn.cloud.tesla.com";
const tokenUrl = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token";
const authorizeUrlBase = "https://auth.tesla.com/oauth2/v3/authorize";
export const teslaScopes = "openid offline_access user_data vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds";
export const partnerDomain = new URL(websiteOrigin).host;
export const publicKeyUrl = `https://${partnerDomain}/.well-known/appspecific/com.tesla.3p.public-key.pem`;
export const redirectUri = `${opsOrigin}/api/tesla/callback`;

export class TeslaError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export type TeslaSettings = { refresh?: string; access?: string; expiresAt?: string; connectedAt?: string | null; registeredAt?: string | null; domain?: string | null };

export async function loadTeslaSettings(): Promise<TeslaSettings> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "tesla").maybeSingle();
  return ((data?.value as TeslaSettings | null) ?? {}) as TeslaSettings;
}

async function saveTeslaSettings(patch: TeslaSettings) {
  const current = await loadTeslaSettings();
  await createAdminClient().from("settings").upsert({ key: "tesla", value: { ...current, ...patch }, updated_at: new Date().toISOString() });
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

async function tokenRequest(fields: Record<string, string>) {
  const response = await fetch(tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form(fields), signal: AbortSignal.timeout(15000) });
  const data = (await response.json().catch(() => null)) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
  if (!response.ok || !data?.access_token) throw new TeslaError("token_failed", data?.error_description ?? data?.error ?? `HTTP ${response.status}`);
  return data;
}

export async function partnerToken() {
  const data = await tokenRequest({ grant_type: "client_credentials", client_id: process.env.TESLA_CLIENT_ID ?? "", client_secret: process.env.TESLA_CLIENT_SECRET ?? "", scope: "openid vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds", audience: fleetBase });
  return data.access_token as string;
}

export async function publicKeyHosted() {
  try {
    const response = await fetch(publicKeyUrl, { signal: AbortSignal.timeout(10000), cache: "no-store" });
    const text = await response.text();
    return response.ok && text.includes("BEGIN PUBLIC KEY");
  } catch {
    return false;
  }
}

export async function registerPartner() {
  if (!(await publicKeyHosted())) throw new TeslaError("public_key_missing");
  const token = await partnerToken();
  const response = await fetch(`${fleetBase}/api/1/partner_accounts`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ domain: partnerDomain }), signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  if (!response.ok) throw new TeslaError("register_failed", text.slice(0, 300));
  await saveTeslaSettings({ registeredAt: new Date().toISOString(), domain: partnerDomain });
}

export function authorizeUrl(state: string) {
  const params = new URLSearchParams({ client_id: process.env.TESLA_CLIENT_ID ?? "", redirect_uri: redirectUri, response_type: "code", scope: teslaScopes, state, locale: "en-US", prompt_missing_scopes: "true" });
  return `${authorizeUrlBase}?${params.toString()}`;
}

export async function exchangeCode(code: string) {
  const data = await tokenRequest({ grant_type: "authorization_code", client_id: process.env.TESLA_CLIENT_ID ?? "", client_secret: process.env.TESLA_CLIENT_SECRET ?? "", code, audience: fleetBase, redirect_uri: redirectUri });
  await saveTeslaSettings({
    access: encryptSecret(data.access_token as string),
    refresh: data.refresh_token ? encryptSecret(data.refresh_token) : undefined,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    connectedAt: new Date().toISOString(),
  });
}

async function accessToken() {
  const stored = await loadTeslaSettings();
  if (!stored.access || !stored.refresh) throw new TeslaError("not_connected");
  if (Date.parse(stored.expiresAt ?? "0") - Date.now() > 120000) return decryptSecret(stored.access);
  const data = await tokenRequest({ grant_type: "refresh_token", client_id: process.env.TESLA_CLIENT_ID ?? "", refresh_token: decryptSecret(stored.refresh) });
  await saveTeslaSettings({ access: encryptSecret(data.access_token as string), refresh: data.refresh_token ? encryptSecret(data.refresh_token) : stored.refresh, expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString() });
  return data.access_token as string;
}

export async function fleet<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T | null }> {
  const token = await accessToken();
  const response = await fetch(`${fleetBase}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = (await response.json().catch(() => null)) as T | null;
  return { status: response.status, data };
}

export type FleetVehicle = { id: number; vehicle_id: number; vin: string; display_name: string | null; state: string };

export async function listVehicles() {
  const result = await fleet<{ response: FleetVehicle[] }>("/api/1/vehicles");
  if (result.status !== 200) throw new TeslaError(`http_${result.status}`);
  return result.data?.response ?? [];
}

export type VehicleSnapshot = { state: string; odometer: number | null; battery: number | null; charging: string | null; locked: boolean | null; latitude: number | null; longitude: number | null; at: string };

type VehicleData = { response: { state: string; charge_state?: { battery_level?: number; charging_state?: string }; vehicle_state?: { odometer?: number; locked?: boolean }; drive_state?: { latitude?: number; longitude?: number; active_route_latitude?: number } } };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function vehicleSnapshot(vin: string, options: { wake?: boolean; location?: boolean } = {}): Promise<VehicleSnapshot> {
  const endpoints = ["charge_state", "vehicle_state", "drive_state", ...(options.location ? ["location_data"] : [])].join(";");
  const read = () => fleet<VehicleData>(`/api/1/vehicles/${vin}/vehicle_data?endpoints=${encodeURIComponent(endpoints)}`);
  let result = await read();
  if (result.status === 408 && options.wake) {
    await fleet(`/api/1/vehicles/${vin}/wake_up`, { method: "POST" });
    for (let attempt = 0; attempt < 12 && result.status === 408; attempt += 1) {
      await sleep(3000);
      result = await read();
    }
  }
  if (result.status === 408) throw new TeslaError("asleep");
  if (result.status !== 200 || !result.data?.response) throw new TeslaError(`http_${result.status}`);
  const r = result.data.response;
  return {
    state: r.state,
    odometer: typeof r.vehicle_state?.odometer === "number" ? Math.round(r.vehicle_state.odometer) : null,
    battery: typeof r.charge_state?.battery_level === "number" ? r.charge_state.battery_level : null,
    charging: r.charge_state?.charging_state ?? null,
    locked: typeof r.vehicle_state?.locked === "boolean" ? r.vehicle_state.locked : null,
    latitude: typeof r.drive_state?.latitude === "number" ? r.drive_state.latitude : null,
    longitude: typeof r.drive_state?.longitude === "number" ? r.drive_state.longitude : null,
    at: new Date().toISOString(),
  };
}

type ChargingHistory = { data?: Array<{ sessionId: number; siteLocationName?: string; chargeStartDateTime?: string; chargeStopDateTime?: string; fees?: Array<{ feeType?: string; totalDue?: number; netDue?: number; currencyCode?: string }> }> };

export async function chargingHistory(vin: string, from: string, to: string) {
  const params = new URLSearchParams({ vin, startTime: from, endTime: to, pageSize: "100" });
  const result = await fleet<ChargingHistory>(`/api/1/dx/charging/history?${params.toString()}`);
  if (result.status !== 200) throw new TeslaError(`http_${result.status}`);
  const sessions = (result.data?.data ?? []).map((session) => ({
    site: session.siteLocationName ?? "",
    startedAt: session.chargeStartDateTime ?? null,
    cents: Math.round((session.fees ?? []).reduce((sum, fee) => sum + (typeof fee.totalDue === "number" ? fee.totalDue : 0), 0) * 100),
  }));
  return { sessions, totalCents: sessions.reduce((sum, session) => sum + session.cents, 0) };
}

type Invitation = { response: { id: string; share_link?: string; expires_at?: string } };

export async function createInvitation(vin: string) {
  const result = await fleet<Invitation>(`/api/1/vehicles/${vin}/invitations`, { method: "POST" });
  if (result.status !== 200 || !result.data?.response?.id) throw new TeslaError(`http_${result.status}`);
  return result.data.response;
}

export async function revokeInvitation(vin: string, id: string) {
  const result = await fleet(`/api/1/vehicles/${vin}/invitations/${id}/revoke`, { method: "POST" });
  if (result.status !== 200) throw new TeslaError(`http_${result.status}`);
}
