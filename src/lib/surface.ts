export const surfaces = ["ops", "account", "api"] as const;

export type Surface = (typeof surfaces)[number];

export function surfaceFromHost(host: string | null): Surface | null {
  const label = (host ?? "").split(":")[0].split(".")[0].toLowerCase();
  const name = label.replace(/-staging$/, "");
  return (surfaces as readonly string[]).includes(name) ? (name as Surface) : null;
}

export function isBareLocalhost(host: string | null) {
  const name = (host ?? "").split(":")[0].toLowerCase();
  return name === "localhost" || name === "127.0.0.1";
}
