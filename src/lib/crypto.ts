import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const configured = process.env.BANK_ENCRYPTION_KEY;
  if (configured) {
    const raw = /^[0-9a-f]{64}$/i.test(configured) ? Buffer.from(configured, "hex") : Buffer.from(configured, "base64");
    if (raw.length === 32) return raw;
    throw new Error("bank_encryption_key_invalid");
  }
  if (process.env.NODE_ENV === "production") throw new Error("bank_encryption_key_missing");
  return createHash("sha256").update(`${process.env.SUPABASE_SECRET_KEY ?? "movia"}:bank`).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function decryptSecret(payload: string) {
  const [iv, data, tag] = payload.split(".");
  if (!iv || !data || !tag) throw new Error("payload_invalid");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptionConfigured() {
  return Boolean(process.env.BANK_ENCRYPTION_KEY) || process.env.NODE_ENV !== "production";
}
