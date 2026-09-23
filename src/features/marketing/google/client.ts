import "server-only";
import { googleSettings } from "./config";
import { signAssertion } from "./jwt";
import { gaBody, gaRows, googleMessage, gscBody, gscRows, inspection, sitemaps, type GaRequest, type GaRow, type GscRequest, type GscRow, type Inspection, type Sitemap } from "./shape";

export class GoogleError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let held: { value: string; expiresAt: number; owner: string } | null = null;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function read(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function accessToken() {
  const { account, endpoints } = googleSettings();
  if (!account) throw new GoogleError(0, "not_configured");
  const owner = `${account.clientEmail}|${endpoints.token}`;
  if (held && held.owner === owner && held.expiresAt > Date.now() + 60000) return held.value;
  const assertion = signAssertion(account, endpoints.token, Math.floor(Date.now() / 1000));
  const response = await fetch(endpoints.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  const body = await read(response);
  const data = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const value = typeof data.access_token === "string" ? data.access_token : "";
  if (!response.ok || !value) throw new GoogleError(response.status, `token ${googleMessage(body, response.status)}`);
  const seconds = Number(data.expires_in);
  held = { value, expiresAt: Date.now() + (seconds > 0 ? seconds : 3000) * 1000, owner };
  return value;
}

async function call(url: string, body?: unknown, timeoutMs = 15000): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const token = await accessToken();
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const parsed = await read(response);
    if (response.ok) return parsed;
    const again = attempt === 0 && (response.status === 401 || response.status === 429 || response.status >= 500);
    if (!again) throw new GoogleError(response.status, googleMessage(parsed, response.status));
    if (response.status === 401) held = null;
    else await pause(600);
  }
}

export async function runReports(requests: GaRequest[]): Promise<GaRow[][]> {
  const { property, endpoints } = googleSettings();
  if (!property) throw new GoogleError(0, "not_configured");
  const groups: GaRequest[][] = [];
  for (let at = 0; at < requests.length; at += 5) groups.push(requests.slice(at, at + 5));
  const answers = await Promise.all(groups.map((group) => call(`${endpoints.analytics}/v1beta/properties/${property}:batchRunReports`, { requests: group.map(gaBody) })));
  return answers.flatMap((answer, index) => {
    const reports = answer && typeof answer === "object" && Array.isArray((answer as { reports?: unknown }).reports) ? (answer as { reports: unknown[] }).reports : [];
    if (reports.length !== groups[index].length) throw new GoogleError(502, "502 unexpected answer");
    return reports.map(gaRows);
  });
}

function siteBase() {
  const { site, endpoints } = googleSettings();
  if (!site) throw new GoogleError(0, "not_configured");
  return { site, endpoints, base: `${endpoints.webmasters}/v3/sites/${encodeURIComponent(site)}` };
}

export async function searchQuery(request: GscRequest): Promise<GscRow[]> {
  return gscRows(await call(`${siteBase().base}/searchAnalytics/query`, gscBody(request)));
}

export async function searchEverything(request: GscRequest, most = 50000): Promise<GscRow[]> {
  const rows: GscRow[] = [];
  for (let startRow = 0; startRow < most; startRow += 25000) {
    const page = await searchQuery({ ...request, rowLimit: 25000, startRow });
    rows.push(...page);
    if (page.length < 25000) break;
  }
  return rows;
}

export async function listSitemaps(): Promise<Sitemap[]> {
  return sitemaps(await call(`${siteBase().base}/sitemaps`));
}

export async function inspectUrl(url: string, timeoutMs = 15000): Promise<Inspection> {
  const { site, endpoints } = siteBase();
  return inspection(await call(`${endpoints.inspection}/v1/urlInspection/index:inspect`, { inspectionUrl: url, siteUrl: site, languageCode: "en-US" }, timeoutMs));
}

export function googleFailure(cause: unknown) {
  if (cause instanceof GoogleError) return cause.message;
  if (cause instanceof Error && cause.name === "TimeoutError") return "timeout";
  return "failed";
}
