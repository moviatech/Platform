import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

const cookieName = "movia_signup";
const ttlSeconds = 3600;
const confirmWindowMs = 120000;

const key = () => createHash("sha256").update(`${process.env.SUPABASE_SECRET_KEY ?? "movia"}:signup`).digest();

function seal(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${data.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

function unseal(payload: string) {
  const [iv, data, tag] = payload.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export async function rememberSignupPassword(email: string, password: string) {
  const value = seal(JSON.stringify({ email, password, expires: Date.now() + ttlSeconds * 1000 }));
  (await cookies()).set(cookieName, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ttlSeconds });
}

async function takeSignupPassword(email: string) {
  const store = await cookies();
  const raw = store.get(cookieName)?.value;
  if (!raw) return null;
  store.delete(cookieName);
  try {
    const parsed = JSON.parse(unseal(raw)) as { email?: string; password?: string; expires?: number };
    if (parsed.email !== email || typeof parsed.password !== "string" || !parsed.expires || parsed.expires < Date.now()) return null;
    return parsed.password;
  } catch {
    return null;
  }
}

type VerifiedUser = { id: string; email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null };

export async function settleVerifiedPassword(user: VerifiedUser | null | undefined) {
  if (!user?.id || !user.email) return;
  const pending = await takeSignupPassword(user.email.toLowerCase());
  const confirmedAt = Date.parse(user.email_confirmed_at ?? user.confirmed_at ?? "");
  const justConfirmed = Number.isFinite(confirmedAt) && Date.now() - confirmedAt < confirmWindowMs;
  if (!pending && !justConfirmed) return;
  await createAdminClient().auth.admin.updateUserById(user.id, { password: pending ?? randomBytes(32).toString("base64url") });
}
