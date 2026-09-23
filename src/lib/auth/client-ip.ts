import { BlockList, isIP } from "node:net";

const cloudflareV4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

const cloudflareV6 = ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];

const edges = new BlockList();
cloudflareV4.forEach((range) => {
  const [address, prefix] = range.split("/");
  edges.addSubnet(address, Number(prefix), "ipv4");
});
cloudflareV6.forEach((range) => {
  const [address, prefix] = range.split("/");
  edges.addSubnet(address, Number(prefix), "ipv6");
});

const privateRange = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80:)/i;

function fromCloudflare(address: string) {
  const family = isIP(address);
  if (family === 4) return edges.check(address, "ipv4");
  if (family === 6) return edges.check(address, "ipv6");
  return false;
}

export function clientIpFrom(head: Headers): string | null {
  const hops = (head.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => isIP(hop) > 0);
  if (hops.length >= 2) hops.pop();
  let index = hops.length - 1;
  while (index > 0 && privateRange.test(hops[index])) index -= 1;
  const edge = hops[index] ?? null;
  const viaCloudflare = head.get("cf-connecting-ip");
  if (edge && viaCloudflare && isIP(viaCloudflare) > 0 && fromCloudflare(edge)) return viaCloudflare;
  return edge;
}
