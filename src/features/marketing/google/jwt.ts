import { createSign } from "node:crypto";

export type ServiceAccount = { clientEmail: string; privateKey: string };

export const googleScopes = "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly";

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");

function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseServiceAccount(raw: string | undefined | null): ServiceAccount | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const decoded = text.startsWith("{") ? text : /^[A-Za-z0-9+/=_\s-]+$/.test(text) ? Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8") : "";
  const data = readJson(decoded);
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const clientEmail = typeof record.client_email === "string" ? record.client_email.trim() : "";
  const privateKey = typeof record.private_key === "string" ? record.private_key.replace(/\\n/g, "\n") : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail) || !privateKey.includes("PRIVATE KEY")) return null;
  return { clientEmail, privateKey };
}

export function signAssertion(account: ServiceAccount, audience: string, nowSeconds: number, scope = googleScopes) {
  const header = encode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = encode(JSON.stringify({ iss: account.clientEmail, scope, aud: audience, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.privateKey);
  return `${header}.${claims}.${encode(signature)}`;
}
