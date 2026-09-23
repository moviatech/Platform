import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

function matches(expected: string | undefined, provided: string | null) {
  if (!expected || expected.length < 24 || !provided) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

export function hasValidApiKey(request: Request) {
  return matches(process.env.PLATFORM_API_KEY, request.headers.get("x-api-key"));
}

export function hasValidInboundKey(request: Request) {
  return matches(process.env.INBOUND_EMAIL_KEY, request.headers.get("x-inbound-key"));
}

export function hasValidInternalKey(request: Request) {
  return matches(process.env.INTERNAL_TICK_KEY, request.headers.get("x-internal-key"));
}
