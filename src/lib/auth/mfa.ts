import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const mfaCookie = "movia_mfa";
const ttlSeconds = 7 * 86400;

const secret = () => process.env.SUPABASE_SECRET_KEY ?? "movia";

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function mfaToken(userId: string) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function mfaTokenValid(token: string | undefined, userId: string) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [id, expires, signature] = parts;
  if (id !== userId || Number(expires) < Date.now() / 1000) return false;
  const expected = sign(`${id}.${expires}`);
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function setMfaCookie(userId: string) {
  (await cookies()).set(mfaCookie, mfaToken(userId), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ttlSeconds });
}

export async function clearMfaCookie() {
  (await cookies()).delete(mfaCookie);
}
