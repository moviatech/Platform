export const renewalMarginHours = 48;
export const renewalRetryHours = 12;
export const renewalLastHours = 2;

const hour = 3600000;

export function renewalDue(input: { status: string; expiresAt: string | null; returnAt: string; lastFailureAt: string | null; now: number }) {
  if (!input.expiresAt || !["CONFIRMED", "ACTIVE"].includes(input.status)) return false;
  const expires = new Date(input.expiresAt).getTime();
  const returns = new Date(input.returnAt).getTime();
  const neededUntil = (input.status === "ACTIVE" ? Math.max(returns, input.now) : returns) + renewalMarginHours * hour;
  if (expires >= neededUntil) return false;
  if (!input.lastFailureAt) return true;
  const failed = new Date(input.lastFailureAt).getTime();
  if (input.now - failed >= renewalRetryHours * hour) return true;
  const last = expires - renewalLastHours * hour;
  return input.now >= last && failed < last;
}
